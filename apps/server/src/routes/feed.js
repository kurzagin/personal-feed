import { Elysia, t } from "elysia";
export function createFeedRoutes(db, ranker) {
    return new Elysia({ prefix: "/api" })
        .get("/feed", ({ query }) => {
        const limit = query.limit ? parseInt(query.limit, 10) : 10;
        const items = ranker.getRankedFeed(limit);
        return { items };
    }, {
        query: t.Object({
            limit: t.Optional(t.String()),
        })
    })
        .post("/session", ({ body }) => {
        const { postId, watchDurationSeconds, completionRate, interactedFavorite, interactedSkipped, interactedDwellMs, lastPositionSeconds, } = body;
        const sessionId = crypto.randomUUID();
        const now = Date.now();
        db.query(`
        INSERT INTO watch_sessions (
          id, post_id, started_at, watch_duration_seconds, completion_rate,
          interacted_favorite, interacted_skipped, interacted_dwell_ms, last_position_seconds
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(sessionId, postId, now, watchDurationSeconds, completionRate, interactedFavorite ? 1 : 0, interactedSkipped ? 1 : 0, interactedDwellMs || null, lastPositionSeconds || null);
        return { success: true, sessionId };
    }, {
        body: t.Object({
            postId: t.String(),
            watchDurationSeconds: t.Number(),
            completionRate: t.Number(),
            interactedFavorite: t.Boolean(),
            interactedSkipped: t.Boolean(),
            interactedDwellMs: t.Optional(t.Number()),
            lastPositionSeconds: t.Optional(t.Number()),
        })
    });
}
//# sourceMappingURL=feed.js.map