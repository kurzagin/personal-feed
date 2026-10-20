import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { initDatabase } from "./db/schema";
import { StorageProvider } from "./r2/client";
import { FeedRanker } from "./algo/ranker";
import { deriveMasterKey } from "@personal-feed/crypto";
import { createMediaRoutes } from "./routes/media";
import { createFeedRoutes } from "./routes/feed";
import { createUploadRoutes } from "./routes/upload";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";

// Load and enforce environment configuration
const PASSPHRASE = process.env.APP_MASTER_PASSPHRASE;
const SALT_STR = process.env.APP_MASTER_SALT;

if (!PASSPHRASE || !SALT_STR) {
  console.error("❌ ERROR: APP_MASTER_PASSPHRASE and APP_MASTER_SALT must be defined in .env");
  process.exit(1);
}

const MASTER_SALT = Buffer.from(SALT_STR, "utf-8");
const masterKey = deriveMasterKey(PASSPHRASE, MASTER_SALT);

// Initialize DB & Storage from env
const dbPath = process.env.DATABASE_PATH || "personal_feed.db";
const db = initDatabase(dbPath);
const storage = new StorageProvider({
  accountId: process.env.R2_ACCOUNT_ID,
  accessKeyId: process.env.R2_ACCESS_KEY_ID,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  bucketName: process.env.R2_BUCKET,
});
const ranker = new FeedRanker(db);

const distDir = join(process.cwd(), "apps/web/dist");
const port = parseInt(process.env.PORT || "3001", 10);

export const app = new Elysia()
  .use(cors())
  .get("/health", () => ({ status: "ok", timestamp: Date.now() }))
  .use(createMediaRoutes(db, storage, masterKey))
  .use(createFeedRoutes(db, ranker))
  .use(createUploadRoutes(db, storage, masterKey))
  .get("/", ({ set }) => {
    const indexPath = join(distDir, "index.html");
    if (existsSync(indexPath)) {
      set.headers["Content-Type"] = "text/html; charset=utf-8";
      return readFileSync(indexPath, "utf-8");
    }
    set.status = 404;
    return "Web build not found";
  })
  .get("/main.js", ({ set }) => {
    const jsPath = join(distDir, "main.js");
    set.headers["Content-Type"] = "application/javascript; charset=utf-8";
    return readFileSync(jsPath, "utf-8");
  })
  .get("/main.css", ({ set }) => {
    const cssPath = join(distDir, "main.css");
    set.headers["Content-Type"] = "text/css; charset=utf-8";
    return existsSync(cssPath) ? readFileSync(cssPath, "utf-8") : "";
  })
  .listen(port);

console.log(`🦊 Personal Feed Daemon & Web UI live at http://localhost:${port}`);

export type App = typeof app;
