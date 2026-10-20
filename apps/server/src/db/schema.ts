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
      rating TEXT DEFAULT 'general'
    );
  `);

  // Danbooru Tags table
  db.run(`
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      category TEXT NOT NULL
    );
  `);

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
      interacted_favorite INTEGER DEFAULT 0,
      interacted_skipped INTEGER DEFAULT 0,
      interacted_dwell_ms INTEGER,
      last_position_seconds REAL
    );
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_watch_sessions_post ON watch_sessions(post_id);`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_watch_sessions_time ON watch_sessions(started_at);`);

  return db;
}
