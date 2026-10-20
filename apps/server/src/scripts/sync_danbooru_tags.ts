import { initDatabase } from "../db/schema";
import type { TagCategory } from "@personal-feed/shared";

const CSV_URL = "https://raw.githubusercontent.com/DominikDoom/a1111-sd-webui-tagcomplete/main/tags/danbooru.csv";

const CATEGORY_MAP: Record<string, TagCategory> = {
  "0": "general",
  "1": "artist",
  "3": "copyright",
  "4": "character",
  "5": "meta",
};

/**
 * Downloads danbooru.csv and populates the SQLite `tags` table.
 * Filters for top tags by minimum post count to keep the database snappy and lightweight.
 */
export async function syncDanbooruTags(minPostCount = 50) {
  console.log(`⬇️ Fetching Danbooru tag taxonomy from GitHub...`);
  const res = await fetch(CSV_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch Danbooru tags: ${res.statusText}`);
  }

  const text = await res.text();
  const lines = text.split("\n");
  console.log(`📦 Downloaded ${lines.length} tags. Parsing and filtering (minPostCount >= ${minPostCount})...`);

  const db = initDatabase(process.env.DATABASE_PATH || "personal_feed.db");

  const insertStmt = db.prepare(`
    INSERT INTO tags (name, category, post_count)
    VALUES (?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      category = excluded.category,
      post_count = excluded.post_count
  `);

  let insertedCount = 0;

  const transaction = db.transaction((rows: Array<[string, TagCategory, number]>) => {
    for (const [name, category, count] of rows) {
      insertStmt.run(name, category, count);
    }
  });

  const batch: Array<[string, TagCategory, number]> = [];
  const BATCH_SIZE = 5000;

  for (const line of lines) {
    if (!line.trim()) continue;

    // Format: <name>,<type>,<postCount>,"<aliases>"
    // E.g.: 1girl,0,6008644,"1girls,sole_female"
    const firstComma = line.indexOf(",");
    if (firstComma === -1) continue;

    const secondComma = line.indexOf(",", firstComma + 1);
    if (secondComma === -1) continue;

    const thirdComma = line.indexOf(",", secondComma + 1);

    const name = line.substring(0, firstComma).trim().toLowerCase();
    const typeCode = line.substring(firstComma + 1, secondComma).trim();
    const countStr = (thirdComma !== -1 ? line.substring(secondComma + 1, thirdComma) : line.substring(secondComma + 1)).trim();

    const category = CATEGORY_MAP[typeCode];
    if (!category) continue; // Skip unknown category

    const count = parseInt(countStr, 10);
    if (isNaN(count) || count < minPostCount) continue;

    batch.push([name, category, count]);
    insertedCount++;

    if (batch.length >= BATCH_SIZE) {
      transaction(batch);
      batch.length = 0;
    }
  }

  if (batch.length > 0) {
    transaction(batch);
  }

  console.log(`✅ Danbooru sync finished! Synced ${insertedCount} top tags into SQLite.`);
}

if (import.meta.main) {
  syncDanbooruTags(100).catch((err) => {
    console.error("❌ Sync failed:", err);
    process.exit(1);
  });
}
