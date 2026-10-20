export class FeedRanker {
    db;
    constructor(db) {
        this.db = db;
    }
    /**
     * Computes the dynamic user tag affinity vector with exponential time decay.
     * Half-life is set to 7 days (604,800,000 ms).
     */
    getUserTagAffinities() {
        const affinities = new Map();
        const now = Date.now();
        const halfLifeMs = 7 * 24 * 60 * 60 * 1000;
        const lambda = Math.LN2 / halfLifeMs;
        // Fetch sessions from the last 30 days
        const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
        const sessions = this.db.query(`
      SELECT 
        ws.post_id,
        ws.started_at,
        ws.watch_duration_seconds,
        ws.completion_rate,
        ws.interacted_favorite,
        ws.interacted_skipped,
        ws.interacted_dwell_ms,
        pt.tag_id
      FROM watch_sessions ws
      JOIN post_tags pt ON ws.post_id = pt.post_id
      WHERE ws.started_at >= ?
    `).all(thirtyDaysAgo);
        for (const s of sessions) {
            // Calculate engagement weight:
            // - Completion >= 1.0 (looping): +3.0
            // - Favorited: +4.0
            // - High dwell time on galleries (>5s): +2.0
            // - Skipped (<3s): -3.0
            let weight = 0;
            if (s.interacted_skipped) {
                weight = -3.0;
            }
            else {
                weight += Math.min(s.completion_rate * 2.0, 4.0);
                if (s.interacted_favorite)
                    weight += 4.0;
                if (s.interacted_dwell_ms && s.interacted_dwell_ms > 5000)
                    weight += 2.0;
            }
            // Exponential decay
            const ageMs = Math.max(0, now - s.started_at);
            const decayedWeight = weight * Math.exp(-lambda * ageMs);
            const current = affinities.get(s.tag_id) || 0;
            affinities.set(s.tag_id, current + decayedWeight);
        }
        return affinities;
    }
    /**
     * Generates a ranked batch of feed items.
     */
    getRankedFeed(limit = 15) {
        const now = Date.now();
        const tagAffinities = this.getUserTagAffinities();
        // 1. Retrieve all candidate posts
        const rawPosts = this.db.query(`
      SELECT 
        p.*,
        GROUP_CONCAT(t.id || ':' || t.name || ':' || t.category, ';') as raw_tags
      FROM posts p
      LEFT JOIN post_tags pt ON p.id = pt.post_id
      LEFT JOIN tags t ON pt.tag_id = t.id
      GROUP BY p.id
    `).all();
        if (rawPosts.length === 0)
            return [];
        // Parse posts and tags
        const candidates = rawPosts.map((p) => {
            const tags = p.raw_tags
                ? p.raw_tags.split(";").map((str) => {
                    const [id, name, category] = str.split(":");
                    return { id: Number(id), name, category: category };
                })
                : [];
            return {
                id: p.id,
                media_type: p.media_type,
                duration_seconds: p.duration_seconds,
                aspect_ratio: p.aspect_ratio,
                page_count: p.page_count,
                r2_storage_key: p.r2_storage_key,
                encrypted_key: p.encrypted_key,
                content_hash: p.content_hash,
                created_at: p.created_at,
                rating: p.rating,
                tags,
            };
        });
        // 2. Fetch recent view history for fatigue calculation
        const recentViews = new Map();
        const views = this.db.query(`
      SELECT post_id, MAX(started_at) as last_seen
      FROM watch_sessions
      GROUP BY post_id
    `).all();
        for (const v of views) {
            recentViews.set(v.post_id, v.last_seen);
        }
        // 3. Score each candidate
        const scored = candidates.map((post) => {
            let score = 0;
            // A. Tag Affinity Score
            let tagScore = 0;
            for (const t of post.tags) {
                tagScore += tagAffinities.get(t.id) || 0;
            }
            score += tagScore;
            // B. Fatigue Penalty (seen recently)
            const lastSeen = recentViews.get(post.id);
            if (lastSeen) {
                const hoursAgo = (now - lastSeen) / (1000 * 60 * 60);
                if (hoursAgo < 6) {
                    score -= 100; // Hard fatigue (avoid seeing in same session)
                }
                else if (hoursAgo < 48) {
                    score -= 20;
                }
                else if (hoursAgo < 168) {
                    score -= 5;
                }
            }
            else {
                // Fresh exploration bonus for never-before-seen content
                score += 5.0;
            }
            // C. Exploration jitter (prevents deterministic ordering)
            score += (Math.random() - 0.5) * 2.0;
            return { post, score };
        });
        // Sort descending by score
        scored.sort((a, b) => b.score - a.score);
        // 4. Format Interleaving (Avoid 3 consecutive long videos)
        const result = [];
        const pool = [...scored];
        let consecutiveLongVideos = 0;
        while (pool.length > 0 && result.length < limit) {
            const idx = pool.findIndex((item) => {
                const isLong = item.post.media_type === "long_video";
                if (consecutiveLongVideos >= 2 && isLong) {
                    return false; // Skip if already too many long videos in a row
                }
                return true;
            });
            const selected = idx !== -1 ? pool.splice(idx, 1)[0] : pool.shift();
            if (selected.post.media_type === "long_video") {
                consecutiveLongVideos++;
            }
            else {
                consecutiveLongVideos = 0;
            }
            result.push(selected.post);
        }
        return result;
    }
}
//# sourceMappingURL=ranker.js.map