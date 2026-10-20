import { initDatabase } from "./db/schema";
import { StorageProvider } from "./r2/client";
import { deriveMasterKey, generateContentKey, wrapContentKey, encryptChunk, CHUNK_SIZE } from "@personal-feed/crypto";
import { ulid } from "ulid";
import { createHash } from "node:crypto";

const db = initDatabase();
const storage = new StorageProvider();
const masterKey = deriveMasterKey("default-personal-master-passphrase-2026", Buffer.from("personal-salt-constant", "utf-8"));

async function seed() {
  console.log("🌱 Seeding Danbooru tags and sample encrypted mock posts...");

  // Sample Danbooru tags
  const tags = [
    { name: "genshin_impact", category: "copyright" },
    { name: "raiden_shogun", category: "character" },
    { name: "cosplay", category: "general" },
    { name: "frieren", category: "copyright" },
    { name: "fern", category: "character" },
    { name: "anime_art", category: "general" },
    { name: "wlop", category: "artist" },
    { name: "landscape", category: "general" },
    { name: "short_clip", category: "meta" },
  ];

  for (const t of tags) {
    db.query("INSERT OR IGNORE INTO tags (name, category) VALUES (?, ?)").run(t.name, t.category);
  }

  // Generate 4 mock posts
  const mockItems = [
    {
      type: "short_video",
      aspectRatio: 0.5625, // 9:16
      duration: 15.0,
      tags: ["genshin_impact", "raiden_shogun", "cosplay", "short_clip"],
      content: Buffer.from("MOCK_ENCRYPTED_SHORT_VERTICAL_VIDEO_DATA"),
    },
    {
      type: "long_video",
      aspectRatio: 1.777, // 16:9
      duration: 3600.0, // 1 hour
      tags: ["genshin_impact", "landscape"],
      content: Buffer.from("MOCK_ENCRYPTED_LONG_HORIZONTAL_VIDEO_DATA"),
    },
    {
      type: "cosplay_set",
      aspectRatio: 0.666, // 2:3 portrait
      duration: null,
      tags: ["frieren", "fern", "cosplay"],
      content: Buffer.from("MOCK_ENCRYPTED_COSPLAY_IMAGE_DATA"),
    },
    {
      type: "anime_art",
      aspectRatio: 0.75, // 3:4 portrait
      duration: null,
      tags: ["frieren", "anime_art", "wlop"],
      content: Buffer.from("MOCK_ENCRYPTED_ANIME_ART_IMAGE_DATA"),
    },
  ];

  for (const item of mockItems) {
    const postId = ulid();
    const hash = createHash("sha256").update(item.content).digest("hex");
    const contentKey = generateContentKey();
    const wrappedKey = wrapContentKey(contentKey, masterKey);
    const baseIV = Buffer.from(hash, "hex").subarray(0, 12);

    const encChunk = encryptChunk(item.content, contentKey, baseIV, 0);
    const r2Key = `media/${postId}.enc`;
    await storage.putEncryptedObject(r2Key, encChunk);

    db.query(`
      INSERT INTO posts (id, media_type, duration_seconds, aspect_ratio, page_count, r2_storage_key, encrypted_key, content_hash, created_at, rating)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'general')
    `).run(postId, item.type, item.duration, item.aspectRatio, 1, r2Key, wrappedKey, hash, Date.now());

    for (const tagName of item.tags) {
      const tag = db.query("SELECT id FROM tags WHERE name = ?").get(tagName) as any;
      if (tag) {
        db.query("INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)").run(postId, tag.id);
      }
    }
  }

  console.log("✅ Seed completed successfully!");
}

seed();
