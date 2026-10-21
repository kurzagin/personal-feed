import { Database } from "bun:sqlite";

export function initDatabase(dbPath: string = "personal_feed.db"): Database {
  const db = new Database(dbPath);

  // Enable Write-Ahead Logging (WAL) for concurrency & fast I/O
  db.run("PRAGMA journal_mode = WAL;");
  db.run("PRAGMA synchronous = NORMAL;");
  db.run("PRAGMA foreign_keys = ON;");

  // Posts table
  db.run(`
    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      media_type TEXT NOT NULL,
      duration_seconds REAL,
      aspect_ratio REAL NOT NULL,
      page_count INTEGER DEFAULT 1,
      r2_storage_key TEXT NOT NULL,
      encrypted_key TEXT NOT NULL,
      content_hash TEXT UNIQUE NOT NULL,
      created_at INTEGER NOT NULL,
      rating TEXT DEFAULT 'general',
      hls_segment_count INTEGER DEFAULT 0,
      has_scrub_sheet INTEGER DEFAULT 0,
      has_thumbnail_grid INTEGER DEFAULT 0
    );
  `);

  // Try adding columns if existing database table
  try { db.run("ALTER TABLE posts ADD COLUMN hls_segment_count INTEGER DEFAULT 0;"); } catch {}
  try { db.run("ALTER TABLE posts ADD COLUMN has_scrub_sheet INTEGER DEFAULT 0;"); } catch {}
  try { db.run("ALTER TABLE posts ADD COLUMN has_thumbnail_grid INTEGER DEFAULT 0;"); } catch {}

  // Post Items table for multi-file posts (carousels: images and videos)
  db.run(`
    CREATE TABLE IF NOT EXISTS post_items (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      item_index INTEGER NOT NULL,
      media_type TEXT NOT NULL,
      duration_seconds REAL,
      aspect_ratio REAL NOT NULL,
      r2_storage_key TEXT NOT NULL,
      encrypted_key TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      hls_segment_count INTEGER DEFAULT 0,
      has_scrub_sheet INTEGER DEFAULT 0,
      has_thumbnail_grid INTEGER DEFAULT 0
    );
  `);

  try { db.run("ALTER TABLE post_items ADD COLUMN hls_segment_count INTEGER DEFAULT 0;"); } catch {}
  try { db.run("ALTER TABLE post_items ADD COLUMN has_scrub_sheet INTEGER DEFAULT 0;"); } catch {}
  try { db.run("ALTER TABLE post_items ADD COLUMN has_thumbnail_grid INTEGER DEFAULT 0;"); } catch {}

  db.run(`CREATE INDEX IF NOT EXISTS idx_post_items_post_id ON post_items(post_id, item_index);`);

  // Danbooru Tags table
  db.run(`
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      category TEXT NOT NULL,
      post_count INTEGER DEFAULT 0
    );
  `);

  // Ensure post_count column exists for existing DBs
  try {
    db.run("ALTER TABLE tags ADD COLUMN post_count INTEGER DEFAULT 0;");
  } catch {
    // Column already exists
  }

  db.run(`CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name);`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_tags_post_count ON tags(post_count DESC);`);

  // Many-to-many relationship
  db.run(`
    CREATE TABLE IF NOT EXISTS post_tags (
      post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (post_id, tag_id)
    );
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_post_tags_tag_id ON post_tags(tag_id);`);

  // Watch Sessions (Interaction telemetry)
  db.run(`
    CREATE TABLE IF NOT EXISTS watch_sessions (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      started_at INTEGER NOT NULL,
      watch_duration_seconds REAL NOT NULL,
      completion_rate REAL NOT NULL,
      interacted_skipped INTEGER DEFAULT 0,
      interacted_dwell_ms INTEGER,
      last_position_seconds REAL
    );
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_watch_sessions_post ON watch_sessions(post_id);`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_watch_sessions_time ON watch_sessions(started_at);`);

  return db;
}
