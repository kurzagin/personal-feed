import { Elysia, t } from "elysia";
import type { Database } from "bun:sqlite";
import { FeedRanker } from "../algo/ranker";
import { StorageProvider } from "../r2/client";
import { runStorageAudit } from "../services/audit";
import { repairPostVideo } from "../services/repair";

export function createFeedRoutes(
  db: Database,
  ranker: FeedRanker,
  storage?: StorageProvider,
  masterKey?: Buffer
) {
  return new Elysia({ prefix: "/api" })
    .get("/storage/audit", async () => {
      if (!storage) {
        return { error: "Storage not configured" };
      }
      const report = await runStorageAudit(db, storage);
      return report;
    })
    .post("/storage/repair-video", async ({ body }) => {
      const { postId } = body;
      if (!storage || !masterKey) {
        return { success: false, message: "Storage or master key unavailable" };
      }
      try {
        const result = await repairPostVideo(postId, db, storage, masterKey);
        return result;
      } catch (err: any) {
        return { success: false, message: err?.message || "Repair failed" };
      }
    }, {
      body: t.Object({
        postId: t.String(),
      })
    })
    .post("/storage/cleanup-orphans", async ({ body, set }) => {
      if (!storage) {
        return { success: false, message: "Storage not configured" };
      }
      const { keys } = body;
      if (!keys || keys.length === 0) {
        return { success: true, count: 0 };
      }
      const validKeys = keys.filter(
        (k) => typeof k === "string" && k.startsWith("media/") && !k.includes("..") && !k.includes("\0")
      );
      if (validKeys.length !== keys.length) {
        set.status = 400;
        return { success: false, message: "Invalid storage keys: only media/ keys may be cleaned up" };
      }
      await storage.deleteEncryptedObjects(validKeys);
      return { success: true, count: validKeys.length };
    }, {
      body: t.Object({
        keys: t.Array(t.String()),
      })
    })
    .get("/feed", ({ query }) => {
      const parsedLimit = query.limit ? parseInt(query.limit, 10) : 10;
      const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 200) : 10;
      const items = ranker.getRankedFeed(limit);
      return { items };
    }, {
      query: t.Object({
        limit: t.Optional(t.String()),
      })
    })
    .get("/explore", ({ query }) => {
      const parsedLimit = query.limit ? parseInt(query.limit, 10) : undefined;
      const limit = parsedLimit !== undefined && Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 500) : undefined;
      const items = ranker.getChronologicalPosts(limit);
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
        interactedSkipped,
        interactedDwellMs,
        lastPositionSeconds,
        loopCount,
        carouselDepth,
        audioUnmuted,
      } = body;

      const sessionId = crypto.randomUUID();
      const now = Date.now();

      db.query(`
        INSERT INTO watch_sessions (
          id, post_id, started_at, watch_duration_seconds, completion_rate,
          interacted_skipped, interacted_dwell_ms, last_position_seconds,
          loop_count, carousel_depth, audio_unmuted
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        sessionId,
        postId,
        now,
        watchDurationSeconds,
        completionRate,
        interactedSkipped ? 1 : 0,
        interactedDwellMs || null,
        lastPositionSeconds || null,
        loopCount || 0,
        carouselDepth ?? 1.0,
        audioUnmuted ? 1 : 0
      );

      return { success: true, sessionId };
    }, {
      body: t.Object({
        postId: t.String(),
        watchDurationSeconds: t.Number(),
        completionRate: t.Number(),
        interactedSkipped: t.Boolean(),
        interactedDwellMs: t.Optional(t.Number()),
        lastPositionSeconds: t.Optional(t.Number()),
        loopCount: t.Optional(t.Number()),
        carouselDepth: t.Optional(t.Number()),
        audioUnmuted: t.Optional(t.Boolean()),
      })
    });
}
