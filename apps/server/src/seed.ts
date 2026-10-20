import { initDatabase } from "./db/schema";
import { StorageProvider } from "./r2/client";
import { deriveMasterKey, generateContentKey, wrapContentKey, encryptChunk } from "@personal-feed/crypto";
import { ulid } from "ulid";
import { createHash } from "node:crypto";

const PASSPHRASE = process.env.APP_MASTER_PASSPHRASE;
const SALT_STR = process.env.APP_MASTER_SALT;

if (!PASSPHRASE || !SALT_STR) {
  console.error("❌ ERROR: APP_MASTER_PASSPHRASE and APP_MASTER_SALT must be defined in .env to run seed");
  process.exit(1);
}

const db = initDatabase(process.env.DATABASE_PATH || "personal_feed.db");
const storage = new StorageProvider({
  accountId: process.env.R2_ACCOUNT_ID,
  accessKeyId: process.env.R2_ACCESS_KEY_ID,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  bucketName: process.env.R2_BUCKET,
});
const masterKey = deriveMasterKey(PASSPHRASE, Buffer.from(SALT_STR, "utf-8"));

async function seed() {
  console.log("🌱 Seeding Danbooru tags and sample encrypted mock posts using .env credentials...");

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

  const mockItems = [
    {
      type: "short_video",
      aspectRatio: 0.5625,
      duration: 15.0,
      tags: ["genshin_impact", "raiden_shogun", "cosplay", "short_clip"],
      content: Buffer.from("MOCK_ENCRYPTED_SHORT_VERTICAL_VIDEO_DATA"),
    },
    {
      type: "long_video",
      aspectRatio: 1.777,
      duration: 3600.0,
      tags: ["genshin_impact", "landscape"],
      content: Buffer.from("MOCK_ENCRYPTED_LONG_HORIZONTAL_VIDEO_DATA"),
    },
    {
      type: "cosplay_set",
      aspectRatio: 0.666,
      duration: null,
      tags: ["frieren", "fern", "cosplay"],
      content: Buffer.from("MOCK_ENCRYPTED_COSPLAY_IMAGE_DATA"),
    },
    {
      type: "anime_art",
      aspectRatio: 0.75,
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
      INSERT OR REPLACE INTO posts (id, media_type, duration_seconds, aspect_ratio, page_count, r2_storage_key, encrypted_key, content_hash, created_at, rating)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'general')
    `).run(postId, item.type, item.duration, item.aspectRatio, 1, r2Key, wrappedKey, hash, Date.now());

    for (const tagName of item.tags) {
      const tag = db.query("SELECT id FROM tags WHERE name = ?").get(tagName) as any;
      if (tag) {
        db.query("INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)").run(postId, tag.id);
      }
    }
  }

  console.log("✅ Seed completed successfully with .env encryption keys!");
}

seed();
