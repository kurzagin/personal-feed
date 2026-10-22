import { Database } from "bun:sqlite";
import type { Post, Tag, TagCategory } from "@personal-feed/shared";

interface CandidatePost {
  post: Post & { tags: Tag[] };
  vector: Map<number, number>; // tag_id -> tf-idf weight
  vectorNorm: number;
  simScore: number;
  ucbScore: number;
  finalScore: number;
}

/**
 * Category-based affinity multiplier.
 * Higher values for artist & character tags reflect higher user intent signals compared
 * to generic descriptors (e.g. 'solo', 'looking_at_viewer').
 */
const CATEGORY_WEIGHTS: Record<TagCategory, number> = {
  artist: 3.5,
  character: 2.5,
  copyright: 2.0,
  general: 1.0,
  meta: 0.5,
};

export class FeedRanker {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /**
   * Computes the dynamic user tag affinity vector with:
   * 1. Exponential time decay (7-day half life)
   * 2. Circadian / Time-of-Day contextual weighting (boosts current browsing time slot)
   * 3. Intelligent Skip Attribution (protects historically loved tags from fast skips)
   * 4. Multi-Signal interactions (re-watch loops, gallery swipe depth, audio unmute)
   */
  getUserTagAffinities(): Map<number, number> {
    const affinities = new Map<number, number>();
    const now = Date.now();
    const halfLifeMs = 7 * 24 * 60 * 60 * 1000;
    const lambda = Math.LN2 / halfLifeMs;

    // Current hour of day (0-23) for circadian matching
    const currentHour = new Date(now).getHours();

    // Fetch sessions from the last 30 days
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
    const sessions = this.db.query(`
      SELECT 
        ws.post_id,
        ws.started_at,
        ws.watch_duration_seconds,
        ws.completion_rate,
        ws.interacted_skipped,
        ws.interacted_dwell_ms,
        ws.loop_count,
        ws.carousel_depth,
        ws.audio_unmuted,
        p.media_type,
        pt.tag_id
      FROM watch_sessions ws
      JOIN posts p ON ws.post_id = p.id
      JOIN post_tags pt ON ws.post_id = pt.post_id
      WHERE ws.started_at >= ?
    `).all(thirtyDaysAgo) as Array<{
      post_id: string;
      started_at: number;
      watch_duration_seconds: number;
      completion_rate: number;
      interacted_skipped: number;
      interacted_dwell_ms: number | null;
      loop_count: number | null;
      carousel_depth: number | null;
      audio_unmuted: number | null;
      media_type: string;
      tag_id: number;
    }>;

    // Pass 1: Quick pre-aggregation of raw positive counts to identify established favorite tags
    const positiveCounts = new Map<number, number>();
    for (const s of sessions) {
      if (!s.interacted_skipped && (s.completion_rate >= 0.75 || (s.interacted_dwell_ms && s.interacted_dwell_ms > 4000))) {
        positiveCounts.set(s.tag_id, (positiveCounts.get(s.tag_id) || 0) + 1);
      }
    }

    // Pass 2: Calculate calibrated engagement with time-of-day boost and intelligent skip attribution
    for (const s of sessions) {
      let weight = 0;
      const isVideo = s.media_type === "short_video" || s.media_type === "long_video";

      if (s.interacted_skipped) {
        // Intelligent Skip Attribution:
        // If a user skips a post that contains a tag they have established 3+ positive views on,
        // do not ruin their affinity for that tag (soft penalty -0.5 instead of -3.0).
        const establishedPositives = positiveCounts.get(s.tag_id) || 0;
        if (establishedPositives >= 3) {
          weight = -0.5; // Soft penalty for established favorite tags
        } else {
          weight = -3.0; // Full penalty for unfamiliar / nuisance tags
        }
      } else if (isVideo) {
        // Video signals: completion rate, re-watch loop count, audio unmute
        const loops = s.loop_count || 0;
        weight += Math.min(s.completion_rate * 2.0, 4.0);
        if (loops > 0) {
          // Strongest signal: user looped the video
          weight += Math.min(loops * 2.0, 5.0);
        }
        if (s.audio_unmuted) {
          weight += 1.0;
        }
      } else {
        // Image / Carousel signals: dwell time and gallery depth
        const dwell = s.interacted_dwell_ms || (s.watch_duration_seconds * 1000);
        if (dwell > 8000) {
          weight += 4.0;
        } else if (dwell > 3000) {
          weight += 2.0;
        } else {
          weight += 0.5;
        }

        // Swiping through multiple slides in a carousel
        const depth = s.carousel_depth ?? 1.0;
        if (depth > 0.6) {
          weight += 1.5;
        }
      }

      // Circadian Contextual Alignment:
      // Sessions started at a similar hour of the day (+- 3 hours) get a 1.25x affinity multiplier
      const sessionHour = new Date(s.started_at).getHours();
      const hourDiff = Math.abs(currentHour - sessionHour);
      const isCircadianMatch = hourDiff <= 3 || hourDiff >= 21;
      const circadianFactor = isCircadianMatch ? 1.25 : 1.0;

      // Exponential time decay
      const ageMs = Math.max(0, now - s.started_at);
      const decayedWeight = weight * circadianFactor * Math.exp(-lambda * ageMs);

      const current = affinities.get(s.tag_id) || 0;
      affinities.set(s.tag_id, current + decayedWeight);
    }

    // 3. Tag Co-occurrence Graph Propagation (Associative Recommendations)
    // If user has high affinity for Tag A, diffuse 15% of that signal to frequently co-occurring Tag B
    const propagatedAffinities = this.propagateTagCoOccurrences(affinities);

    return propagatedAffinities;
  }

  /**
   * Precomputes pairwise co-occurrence between tags and propagates affinity signals.
   * Enables recommending items with related tags even before the user has directly encountered them.
   */
  private propagateTagCoOccurrences(rawAffinities: Map<number, number>): Map<number, number> {
    const result = new Map<number, number>(rawAffinities);
    if (rawAffinities.size === 0) return result;

    // Build co-occurrence table in memory (fast across post_tags)
    const postTagRows = this.db.query(`
      SELECT post_id, tag_id FROM post_tags
    `).all() as Array<{ post_id: string; tag_id: number }>;

    const tagsByPost = new Map<string, number[]>();
    for (const row of postTagRows) {
      if (!tagsByPost.has(row.post_id)) {
        tagsByPost.set(row.post_id, []);
      }
      tagsByPost.get(row.post_id)!.push(row.tag_id);
    }

    // Calculate co-occurrence frequency between pairs
    const coOccurrences = new Map<number, Map<number, number>>();
    for (const tags of tagsByPost.values()) {
      if (tags.length < 2) continue;
      for (let i = 0; i < tags.length; i++) {
        for (let j = i + 1; j < tags.length; j++) {
          const t1 = tags[i];
          const t2 = tags[j];

          if (!coOccurrences.has(t1)) coOccurrences.set(t1, new Map());
          if (!coOccurrences.has(t2)) coOccurrences.set(t2, new Map());

          const map1 = coOccurrences.get(t1)!;
          map1.set(t2, (map1.get(t2) || 0) + 1);

          const map2 = coOccurrences.get(t2)!;
          map2.set(t1, (map2.get(t1) || 0) + 1);
        }
      }
    }

    // Diffuse a portion of positive affinity to co-occurring neighbor tags
    for (const [tagId, aff] of rawAffinities.entries()) {
      if (aff <= 1.0) continue; // Only propagate positive preferences
      const neighbors = coOccurrences.get(tagId);
      if (!neighbors) continue;

      for (const [neighborId, count] of neighbors.entries()) {
        if (count >= 2) {
          // Transfer 15% normalized by co-occurrence strength
          const transferWeight = Math.min(0.15 * aff * (count / 5), 0.25 * aff);
          const current = result.get(neighborId) || 0;
          result.set(neighborId, current + transferWeight);
        }
      }
    }

    return result;
  }

  /**
   * Calculates Inverse Document Frequency (IDF) for all tags in the database:
   * IDF(t) = ln(1 + (Total_Posts / (Tag_Post_Count + 1)))
   * Dampens overly common tags (e.g. '1girl', 'solo') while elevating rare, high-intent tags.
   */
  private getTagIdfMap(totalPosts: number): Map<number, number> {
    const idfMap = new Map<number, number>();
    const tagCounts = this.db.query(`
      SELECT t.id, COALESCE(t.post_count, count(pt.post_id)) as actual_count
      FROM tags t
      LEFT JOIN post_tags pt ON t.id = pt.tag_id
      GROUP BY t.id
    `).all() as Array<{ id: number; actual_count: number }>;

    for (const row of tagCounts) {
      const count = Math.max(1, row.actual_count);
      const idf = Math.log(1 + (totalPosts / count));
      idfMap.set(row.id, idf);
    }

    return idfMap;
  }

  /**
   * Fetches posts in chronological order (latest to oldest, created_at DESC) without algorithm scoring.
   */
  getChronologicalPosts(limit?: number): (Post & { tags: Tag[] })[] {
    const safeLimit =
      limit !== undefined && Number.isFinite(limit) && limit > 0
        ? Math.floor(limit)
        : undefined;
    const queryStr = `
      SELECT 
        p.*,
        GROUP_CONCAT(t.id || ':' || t.name || ':' || t.category, ';') as raw_tags
      FROM posts p
      LEFT JOIN post_tags pt ON p.id = pt.post_id
      LEFT JOIN tags t ON pt.tag_id = t.id
      GROUP BY p.id
      ORDER BY p.created_at DESC
      ${safeLimit !== undefined ? "LIMIT ?" : ""}
    `;

    const rawPosts = (
      safeLimit !== undefined
        ? this.db.query(queryStr).all(safeLimit)
        : this.db.query(queryStr).all()
    ) as any[];
    if (rawPosts.length === 0) return [];

    const allItems = this.db.query(`
      SELECT * FROM post_items ORDER BY item_index ASC
    `).all() as any[];
    const itemsByPost = new Map<string, any[]>();
    for (const item of allItems) {
      if (!itemsByPost.has(item.post_id)) {
        itemsByPost.set(item.post_id, []);
      }
      itemsByPost.get(item.post_id)!.push(item);
    }

    return rawPosts.map((p) => {
      const tags: Tag[] = p.raw_tags
        ? p.raw_tags.split(";").map((str: string) => {
            const [id, name, category] = str.split(":");
            return { id: Number(id), name, category: category as TagCategory };
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
        hls_segment_count: p.hls_segment_count,
        has_scrub_sheet: Boolean(p.has_scrub_sheet),
        has_thumbnail_grid: Boolean(p.has_thumbnail_grid),
        tags,
        items: itemsByPost.get(p.id) || [],
      };
    });
  }

  /**
   * Two-Stage Feed Retrieval & Re-ranking:
   * Stage 1 (Retrieval): Indexed candidate selection (top user tags + fresh unviewed posts)
   * Stage 2 (Scoring & Re-ranking): Vector Cosine similarity + UCB1 + MMR Diversity
   */
  getRankedFeed(limit: number = 15): (Post & { tags: Tag[] })[] {
    const now = Date.now();
    const tagAffinities = this.getUserTagAffinities();

    // Stage 1: Candidate Generation (Fetch candidates with tag aggregation)
    const rawPosts = this.db.query(`
      SELECT 
        p.*,
        GROUP_CONCAT(t.id || ':' || t.name || ':' || t.category, ';') as raw_tags
      FROM posts p
      LEFT JOIN post_tags pt ON p.id = pt.post_id
      LEFT JOIN tags t ON pt.tag_id = t.id
      GROUP BY p.id
    `).all() as any[];

    if (rawPosts.length === 0) return [];

    const totalPosts = rawPosts.length;
    const tagIdf = this.getTagIdfMap(totalPosts);

    // Fetch multi-item carousel items in batch
    const allItems = this.db.query(`
      SELECT * FROM post_items ORDER BY item_index ASC
    `).all() as any[];
    const itemsByPost = new Map<string, any[]>();
    for (const item of allItems) {
      if (!itemsByPost.has(item.post_id)) {
        itemsByPost.set(item.post_id, []);
      }
      itemsByPost.get(item.post_id)!.push(item);
    }

    // Exposure and fatigue history
    const recentViews = new Map<string, number>();
    const impressions = new Map<string, number>();
    const views = this.db.query(`
      SELECT post_id, COUNT(*) as view_count, MAX(started_at) as last_seen
      FROM watch_sessions
      GROUP BY post_id
    `).all() as Array<{ post_id: string; view_count: number; last_seen: number }>;

    let totalSessions = 0;
    for (const v of views) {
      recentViews.set(v.post_id, v.last_seen);
      impressions.set(v.post_id, v.view_count);
      totalSessions += v.view_count;
    }
    const logTotalSessions = Math.log(Math.max(1, totalSessions));

    // Build normalized user vector
    let userNormSq = 0;
    const userVector = new Map<number, number>();
    for (const [tagId, rawAff] of tagAffinities.entries()) {
      if (rawAff <= 0) continue;
      const idf = tagIdf.get(tagId) ?? 1.0;
      const w = rawAff * idf;
      userVector.set(tagId, w);
      userNormSq += w * w;
    }
    const userNorm = Math.sqrt(userNormSq);

    // Stage 2: Vectorize candidate posts and compute scores
    const candidates: CandidatePost[] = rawPosts.map((p) => {
      const tags: Tag[] = p.raw_tags
        ? p.raw_tags.split(";").map((str: string) => {
            const [id, name, category] = str.split(":");
            return { id: Number(id), name, category: category as TagCategory };
          })
        : [];

      // Build post TF-IDF vector with category weighting
      const vector = new Map<number, number>();
      let postNormSq = 0;
      for (const t of tags) {
        const catWeight = CATEGORY_WEIGHTS[t.category] ?? 1.0;
        const idf = tagIdf.get(t.id) ?? 1.0;
        const weight = catWeight * idf;
        vector.set(t.id, weight);
        postNormSq += weight * weight;
      }
      const postNorm = Math.sqrt(postNormSq);

      // A. Cosine Similarity with User Profile
      let simScore = 0;
      if (userNorm > 0 && postNorm > 0) {
        let dotProduct = 0;
        for (const [tagId, postWeight] of vector.entries()) {
          const uWeight = userVector.get(tagId);
          if (uWeight !== undefined) {
            dotProduct += uWeight * postWeight;
          }
        }
        simScore = (dotProduct / (userNorm * postNorm)) * 10;
      }

      // B. UCB1 Exploration Bonus for Under-explored items
      const postViews = impressions.get(p.id) || 0;
      const explorationFactor = 2.5;
      const ucbScore = Math.min(
        explorationFactor * Math.sqrt(logTotalSessions / (postViews + 1)),
        8.0
      );

      // C. Fatigue Penalties
      let fatiguePenalty = 0;
      const lastSeen = recentViews.get(p.id);
      if (lastSeen) {
        const hoursAgo = (now - lastSeen) / (1000 * 60 * 60);
        if (hoursAgo < 6) {
          fatiguePenalty = 100;
        } else if (hoursAgo < 24) {
          fatiguePenalty = 30;
        } else if (hoursAgo < 72) {
          fatiguePenalty = 10;
        } else if (hoursAgo < 168) {
          fatiguePenalty = 3;
        }
      }

      const jitter = (Math.random() - 0.5) * 0.4;
      const finalScore = simScore + ucbScore - fatiguePenalty + jitter;

      return {
        post: {
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
          hls_segment_count: p.hls_segment_count,
          has_scrub_sheet: Boolean(p.has_scrub_sheet),
          has_thumbnail_grid: Boolean(p.has_thumbnail_grid),
          tags,
          items: itemsByPost.get(p.id) || [],
        },
        vector,
        vectorNorm: postNorm,
        simScore,
        ucbScore,
        finalScore,
      };
    });

    // Stage 3: MMR Semantic Diversity & Format Interleaving Selection
    return this.selectDiverseBatch(candidates, limit);
  }

  /**
   * Computes cosine similarity between two post vectors.
   */
  private computeItemSimilarity(a: CandidatePost, b: CandidatePost): number {
    if (a.vectorNorm === 0 || b.vectorNorm === 0) return 0;
    let dot = 0;
    const [small, large] = a.vector.size < b.vector.size ? [a.vector, b.vector] : [b.vector, a.vector];
    for (const [tagId, val] of small.entries()) {
      const otherVal = large.get(tagId);
      if (otherVal !== undefined) {
        dot += val * otherVal;
      }
    }
    return dot / (a.vectorNorm * b.vectorNorm);
  }

  /**
   * Greedy MMR Selection:
   * MMR = lambda * Score(item) - (1 - lambda) * max_{selected} Sim(item, selected)
   * Prevents clustering of identical characters/artists while keeping quality high.
   */
  private selectDiverseBatch(
    candidates: CandidatePost[],
    limit: number
  ): (Post & { tags: Tag[] })[] {
    const pool = [...candidates].sort((a, b) => b.finalScore - a.finalScore);
    const selected: CandidatePost[] = [];
    const lambda = 0.72;
    let consecutiveLongVideos = 0;

    while (pool.length > 0 && selected.length < limit) {
      let bestIdx = -1;
      let bestMMRScore = -Infinity;

      for (let i = 0; i < pool.length; i++) {
        const item = pool[i];

        const isLong = item.post.media_type === "long_video";
        if (consecutiveLongVideos >= 2 && isLong) {
          continue;
        }

        let maxSimilarity = 0;
        for (const s of selected) {
          const sim = this.computeItemSimilarity(item, s);
          if (sim > maxSimilarity) {
            maxSimilarity = sim;
          }
        }

        const redundancyPenalty = (1 - lambda) * (maxSimilarity * 8.0);
        const mmr = lambda * item.finalScore - redundancyPenalty;

        if (mmr > bestMMRScore) {
          bestMMRScore = mmr;
          bestIdx = i;
        }
      }

      if (bestIdx === -1) {
        bestIdx = 0;
      }

      const picked = pool.splice(bestIdx, 1)[0];
      selected.push(picked);

      if (picked.post.media_type === "long_video") {
        consecutiveLongVideos++;
      } else {
        consecutiveLongVideos = 0;
      }
    }

    return selected.map((s) => s.post);
  }
}
