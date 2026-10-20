import { Elysia, t } from "elysia";
import type { Database } from "bun:sqlite";
import { ulid } from "ulid";
import { createHash } from "node:crypto";
import { StorageProvider } from "../r2/client";
import {
  generateContentKey,
  wrapContentKey,
  encryptChunk,
  CHUNK_SIZE,
} from "@personal-feed/crypto";
import type { TagCategory } from "@personal-feed/shared";
import { processImageToAvif } from "../pipeline/image";

export function createUploadRoutes(db: Database, storage: StorageProvider, masterKey: Buffer) {
  return new Elysia({ prefix: "/api" })
    .get("/tags", ({ query }) => {
      const q = query.q ? query.q.trim().toLowerCase() : "";
      if (!q) {
        const topTags = db.query(`
          SELECT id, name, category, post_count 
          FROM tags 
          ORDER BY post_count DESC 
          LIMIT 25
        `).all();
        return { tags: topTags };
      }

      // Exact prefix match first, then infix match, ordered by post_count popularity
      const tags = db.query(`
        SELECT id, name, category, post_count
        FROM tags
        WHERE name LIKE ?
        ORDER BY 
          CASE WHEN name LIKE ? THEN 0 ELSE 1 END,
          post_count DESC,
          name ASC
        LIMIT 25
      `).all(`%${q}%`, `${q}%`);

      return { tags };
    }, {
      query: t.Object({
        q: t.Optional(t.String()),
      })
    })
    .post("/ingest", async ({ body, set }) => {
      // Support either single file or multiple files
      const rawFiles = body.files ? (Array.isArray(body.files) ? body.files : [body.files]) : (body.file ? [body.file] : []);
      const rating = body.rating || "general";
      const rawTags: Array<{ name: string; category: TagCategory }> = JSON.parse(body.tags || "[]");

      if (rawFiles.length === 0) {
        set.status = 400;
        return { error: "No files provided" };
      }

      // Process each file (encrypt & upload)
      const processedItems: Array<{
        itemId: string;
        mediaType: "image" | "video";
        duration: number | null;
        aspectRatio: number;
        r2Key: string;
        wrappedKey: string;
        hash: string;
      }> = [];

      // Process all files
      for (let idx = 0; idx < rawFiles.length; idx++) {
        const file = rawFiles[idx] as File;
        let payloadBuffer = Buffer.from(await file.arrayBuffer());
        const isVideo = file.type.startsWith("video/");
        let aspectRatio = 0.5625; // default 9:16
        let duration: number | null = null;

        if (isVideo) {
          // If duration is passed per file or single video
          if (body.durationSeconds && rawFiles.length === 1) {
            duration = parseFloat(body.durationSeconds);
          }
          if (body.aspectRatio && rawFiles.length === 1) {
            aspectRatio = parseFloat(body.aspectRatio);
          }
        } else {
          // Image optimization
          try {
            const processed = await processImageToAvif(payloadBuffer);
            payloadBuffer = processed.avifBuffer;
            aspectRatio = processed.aspectRatio;
          } catch (err: any) {
            console.warn("⚠️ Image AVIF processing failed or skipped:", err?.message);
          }
        }

        const hash = createHash("sha256").update(payloadBuffer).digest("hex");
        const itemId = ulid();
        const contentKey = generateContentKey();
        const wrappedKey = wrapContentKey(contentKey, masterKey);
        const baseIV = Buffer.from(hash, "hex").subarray(0, 12);

        // Chunked encryption
        const encryptedChunks: Buffer[] = [];
        const numChunks = Math.ceil(payloadBuffer.length / CHUNK_SIZE);
        for (let i = 0; i < numChunks; i++) {
          const start = i * CHUNK_SIZE;
          const end = Math.min(start + CHUNK_SIZE, payloadBuffer.length);
          const chunk = payloadBuffer.subarray(start, end);
          encryptedChunks.push(encryptChunk(chunk, contentKey, baseIV, i));
        }

        const allEncrypted = Buffer.concat(encryptedChunks);
        const r2Key = `media/${itemId}.enc`;
        await storage.putEncryptedObject(r2Key, allEncrypted);

        processedItems.push({
          itemId,
          mediaType: isVideo ? "video" : "image",
          duration,
          aspectRatio,
          r2Key,
          wrappedKey,
          hash,
        });
      }

      // Determine top-level post type
      const hasVideo = processedItems.some((it) => it.mediaType === "video");
      const hasImage = processedItems.some((it) => it.mediaType === "image");
      let overallMediaType: string = "image";
      if (hasVideo && hasImage) {
        overallMediaType = "mixed";
      } else if (hasVideo) {
        overallMediaType = "video";
      } else {
        overallMediaType = "image";
      }

      const firstItem = processedItems[0];
      const postId = ulid();

      // Check deduplication if single file
      if (processedItems.length === 1) {
        const existing = db.query("SELECT id FROM posts WHERE content_hash = ?").get(firstItem.hash);
        if (existing) {
          set.status = 409;
          return { error: "Post already exists", existingId: (existing as any).id };
        }
      }

      // Insert primary post
      db.query(`
        INSERT INTO posts (
          id, media_type, duration_seconds, aspect_ratio, page_count,
          r2_storage_key, encrypted_key, content_hash, created_at, rating
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        postId,
        overallMediaType,
        firstItem.duration,
        firstItem.aspectRatio,
        processedItems.length,
        firstItem.r2Key,
        firstItem.wrappedKey,
        firstItem.hash,
        Date.now(),
        rating
      );

      // Insert individual items
      for (let idx = 0; idx < processedItems.length; idx++) {
        const item = processedItems[idx];
        db.query(`
          INSERT INTO post_items (
            id, post_id, item_index, media_type, duration_seconds,
            aspect_ratio, r2_storage_key, encrypted_key, content_hash, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          item.itemId,
          postId,
          idx,
          item.mediaType,
          item.duration,
          item.aspectRatio,
          item.r2Key,
          item.wrappedKey,
          item.hash,
          Date.now()
        );
      }

      // Process Danbooru tags
      for (const t of rawTags) {
        let tag = db.query("SELECT id, category FROM tags WHERE name = ?").get(t.name) as any;
        if (!tag) {
          const category = t.category || "general";
          db.query("INSERT INTO tags (name, category) VALUES (?, ?)").run(t.name, category);
          tag = db.query("SELECT id, category FROM tags WHERE name = ?").get(t.name) as any;
        }
        db.query("INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)").run(postId, tag.id);
      }

      return { success: true, postId, pageCount: processedItems.length };
    }, {
      body: t.Object({
        file: t.Optional(t.File()),
        files: t.Optional(t.Any()),
        mediaType: t.Optional(t.String()),
        aspectRatio: t.Optional(t.String()),
        durationSeconds: t.Optional(t.String()),
        rating: t.Optional(t.String()),
        tags: t.Optional(t.String()), // JSON string of [{ name, category }]
      })
    });
}
