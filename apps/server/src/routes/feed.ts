import { Elysia, t } from "elysia";
import type { Database } from "bun:sqlite";
import { FeedRanker } from "../algo/ranker";

export function createFeedRoutes(db: Database, ranker: FeedRanker) {
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
    .get("/preferences/stats", () => {
      const sessionCountRow = db.query("SELECT COUNT(*) as count FROM watch_sessions").get() as { count: number };
      const affinities = ranker.getUserTagAffinities();
      
      const tagAffinityList: Array<{ tagId: number; name: string; category: string; score: number }> = [];
      if (affinities.size > 0) {
        const tagIds = Array.from(affinities.keys());
        const placeholders = tagIds.map(() => "?").join(",");
        const tagRows = db.query(`SELECT id, name, category FROM tags WHERE id IN (${placeholders})`).all(...tagIds) as Array<{ id: number; name: string; category: string }>;
        const tagMap = new Map(tagRows.map(t => [t.id, t]));

        for (const [id, score] of affinities.entries()) {
          const tagInfo = tagMap.get(id);
          if (tagInfo) {
            tagAffinityList.push({
              tagId: id,
              name: tagInfo.name,
              category: tagInfo.category,
              score: Math.round(score * 100) / 100,
            });
          }
        }
        tagAffinityList.sort((a, b) => b.score - a.score);
      }

      return {
        sessionCount: sessionCountRow?.count || 0,
        topAffinities: tagAffinityList.slice(0, 30),
      };
    })
    .post("/preferences/reset", () => {
      const deletedSessions = db.query("DELETE FROM watch_sessions").run();
      return {
        success: true,
        message: "Algorithm and watch session history reset successfully",
        clearedSessions: deletedSessions.changes,
      };
    })
    .post("/session", ({ body }) => {
      const {
        postId,
        watchDurationSeconds,
        completionRate,
        interactedFavorite,
        interactedSkipped,
        interactedDwellMs,
        lastPositionSeconds,
      } = body;

      const sessionId = crypto.randomUUID();
      const now = Date.now();

      db.query(`
        INSERT INTO watch_sessions (
          id, post_id, started_at, watch_duration_seconds, completion_rate,
          interacted_favorite, interacted_skipped, interacted_dwell_ms, last_position_seconds
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        sessionId,
        postId,
        now,
        watchDurationSeconds,
        completionRate,
        interactedFavorite ? 1 : 0,
        interactedSkipped ? 1 : 0,
        interactedDwellMs || null,
        lastPositionSeconds || null
      );

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
