import { Elysia, t } from "elysia";
import { ulid } from "ulid";
import { createHash } from "node:crypto";
import { generateContentKey, wrapContentKey, encryptChunk, CHUNK_SIZE, } from "@personal-feed/crypto";
export function createUploadRoutes(db, storage, masterKey) {
    return new Elysia({ prefix: "/api" })
        .get("/tags", ({ query }) => {
        const q = query.q ? `%${query.q}%` : "%";
        const tags = db.query("SELECT * FROM tags WHERE name LIKE ? ORDER BY name ASC LIMIT 50").all(q);
        return { tags };
    }, {
        query: t.Object({
            q: t.Optional(t.String()),
        })
    })
        .post("/ingest", async ({ body, set }) => {
        const file = body.file;
        const mediaType = body.mediaType;
        const aspectRatio = parseFloat(body.aspectRatio) || 0.5625; // default 9:16
        const duration = body.durationSeconds ? parseFloat(body.durationSeconds) : null;
        const rating = body.rating || "general";
        const rawTags = JSON.parse(body.tags || "[]");
        if (!file) {
            set.status = 400;
            return { error: "No file provided" };
        }
        const fileBuffer = Buffer.from(await file.arrayBuffer());
        const hash = createHash("sha256").update(fileBuffer).digest("hex");
        // Check deduplication
        const existing = db.query("SELECT id FROM posts WHERE content_hash = ?").get(hash);
        if (existing) {
            set.status = 409;
            return { error: "Post already exists", existingId: existing.id };
        }
        // Generate keys
        const postId = ulid();
        const contentKey = generateContentKey();
        const wrappedKey = wrapContentKey(contentKey, masterKey);
        const baseIV = Buffer.from(hash, "hex").subarray(0, 12);
        // Chunked encryption
        const encryptedChunks = [];
        const numChunks = Math.ceil(fileBuffer.length / CHUNK_SIZE);
        for (let i = 0; i < numChunks; i++) {
            const start = i * CHUNK_SIZE;
            const end = Math.min(start + CHUNK_SIZE, fileBuffer.length);
            const chunk = fileBuffer.subarray(start, end);
            encryptedChunks.push(encryptChunk(chunk, contentKey, baseIV, i));
        }
        const allEncrypted = Buffer.concat(encryptedChunks);
        const r2Key = `media/${postId}.enc`;
        // Upload to R2 (or local mock fallback)
        await storage.putEncryptedObject(r2Key, allEncrypted);
        // Insert post into SQLite
        db.query(`
        INSERT INTO posts (
          id, media_type, duration_seconds, aspect_ratio, page_count,
          r2_storage_key, encrypted_key, content_hash, created_at, rating
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(postId, mediaType, duration, aspectRatio, 1, r2Key, wrappedKey, hash, Date.now(), rating);
        // Process Danbooru tags
        for (const t of rawTags) {
            let tag = db.query("SELECT id FROM tags WHERE name = ?").get(t.name);
            if (!tag) {
                db.query("INSERT INTO tags (name, category) VALUES (?, ?)").run(t.name, t.category);
                tag = db.query("SELECT id FROM tags WHERE name = ?").get(t.name);
            }
            db.query("INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)").run(postId, tag.id);
        }
        return { success: true, postId };
    }, {
        body: t.Object({
            file: t.File(),
            mediaType: t.String(),
            aspectRatio: t.String(),
            durationSeconds: t.Optional(t.String()),
            rating: t.Optional(t.String()),
            tags: t.Optional(t.String()), // JSON string of [{ name, category }]
        })
    });
}
//# sourceMappingURL=upload.js.map