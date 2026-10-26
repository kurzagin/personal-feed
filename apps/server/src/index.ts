import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { initDatabase } from "./db/schema";
import { StorageProvider } from "./r2/client";
import { FeedRanker } from "./algo/ranker";
import { deriveMasterKey } from "@personal-feed/crypto";
import { createMediaRoutes } from "./routes/media";
import { createFeedRoutes } from "./routes/feed";
import { createUploadRoutes } from "./routes/upload";
import { join, resolve, extname } from "node:path";
import { existsSync, readFileSync, chmodSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";

// Load and enforce environment configuration
const PASSPHRASE = process.env.APP_MASTER_PASSPHRASE;
const SALT_STR = process.env.APP_MASTER_SALT;

if (!PASSPHRASE || !SALT_STR) {
  console.error("ERROR: APP_MASTER_PASSPHRASE and APP_MASTER_SALT must be defined in .env");
  process.exit(1);
}

const MASTER_SALT = Buffer.from(SALT_STR, "utf-8");
const masterKey = deriveMasterKey(PASSPHRASE, MASTER_SALT);

// Initialize DB & Storage from env
const dbPath = process.env.DATABASE_PATH || "personal_feed.db";
const db = initDatabase(dbPath);
try {
  if (existsSync(dbPath)) chmodSync(dbPath, 0o600);
  if (existsSync(`${dbPath}-wal`)) chmodSync(`${dbPath}-wal`, 0o600);
  if (existsSync(`${dbPath}-shm`)) chmodSync(`${dbPath}-shm`, 0o600);
} catch {}

const storage = new StorageProvider({
  accountId: process.env.R2_ACCOUNT_ID,
  accessKeyId: process.env.R2_ACCESS_KEY_ID,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  bucketName: process.env.R2_BUCKET,
});
const ranker = new FeedRanker(db);

const distDir = resolve(process.cwd(), "apps/web/dist");
const hostname = process.env.HOST || "127.0.0.1";
const port = parseInt(process.env.PORT || "3001", 10);
const localApiToken = process.env.LOCAL_API_TOKEN?.trim() || "";

function isTrustedLocalOrigin(originHeader: string): boolean {
  if (process.env.ALLOWED_ORIGIN && originHeader === process.env.ALLOWED_ORIGIN) {
    return true;
  }
  try {
    const url = new URL(originHeader);
    return (
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "[::1]"
    );
  } catch {
    return false;
  }
}

function verifyApiToken(provided: string | null): boolean {
  if (!localApiToken) return true;
  if (!provided) return false;
  const clean = provided.replace(/^Bearer\s+/i, "").trim();
  const a = Buffer.from(clean, "utf-8");
  const b = Buffer.from(localApiToken, "utf-8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export const app = new Elysia()
  .use(
    cors({
      origin: (request) => {
        const origin = request.headers.get("origin");
        if (!origin) return true;
        return isTrustedLocalOrigin(origin);
      },
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Feed-Token", "X-Upload-Id", "X-Upload-Async", "Range"],
    })
  )
  .onBeforeHandle(({ request, set }) => {
    set.headers["X-Content-Type-Options"] = "nosniff";
    set.headers["X-Frame-Options"] = "DENY";
    set.headers["Referrer-Policy"] = "no-referrer";

    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      // Optional local API token check if configured in .env
      if (localApiToken) {
        const tokenHeader =
          request.headers.get("x-feed-token") ||
          request.headers.get("authorization") ||
          url.searchParams.get("token");
        if (!verifyApiToken(tokenHeader)) {
          set.status = 401;
          return { error: "Unauthorized: invalid or missing local API token" };
        }
      }

      // CSRF / cross-origin protection for state-changing requests from external websites
      const method = request.method.toUpperCase();
      if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
        const origin = request.headers.get("origin");
        if (origin && !isTrustedLocalOrigin(origin)) {
          set.status = 403;
          return { error: "Forbidden: untrusted origin" };
        }
        const secFetchSite = request.headers.get("sec-fetch-site");
        if (secFetchSite === "cross-site" && (!origin || !isTrustedLocalOrigin(origin))) {
          set.status = 403;
          return { error: "Forbidden: cross-site request blocked" };
        }
      }
    }
  })
  .get("/health", () => ({ status: "ok", timestamp: Date.now() }))
  .use(createMediaRoutes(db, storage, masterKey))
  .use(createFeedRoutes(db, ranker, storage, masterKey))
  .use(createUploadRoutes(db, storage, masterKey))
  .get("/", ({ set }) => {
    const indexPath = join(distDir, "index.html");
    if (existsSync(indexPath)) {
      set.headers["Content-Type"] = "text/html; charset=utf-8";
      set.headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
      return readFileSync(indexPath, "utf-8");
    }
    set.status = 404;
    return "Web build not found";
  })
  .get("/assets/:file", ({ params: { file }, set }) => {
    const assetsDir = resolve(distDir, "assets");
    const targetPath = resolve(assetsDir, file);
    if (!targetPath.startsWith(assetsDir + "/") || !existsSync(targetPath)) {
      set.status = 404;
      return "Asset not found";
    }
    const ext = extname(targetPath).toLowerCase();
    if (ext === ".js") set.headers["Content-Type"] = "application/javascript; charset=utf-8";
    else if (ext === ".css") set.headers["Content-Type"] = "text/css; charset=utf-8";
    else set.headers["Content-Type"] = "application/octet-stream";
    return readFileSync(targetPath);
  })
  .get("/main.js", ({ set }) => {
    const jsPath = join(distDir, "main.js");
    if (!existsSync(jsPath)) {
      set.status = 404;
      return "";
    }
    set.headers["Content-Type"] = "application/javascript; charset=utf-8";
    return readFileSync(jsPath, "utf-8");
  })
  .get("/main.css", ({ set }) => {
    const cssPath = join(distDir, "main.css");
    set.headers["Content-Type"] = "text/css; charset=utf-8";
    return existsSync(cssPath) ? readFileSync(cssPath, "utf-8") : "";
  })
  .get("*", ({ request, set }) => {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      set.status = 404;
      return { error: "Route not found" };
    }
    const indexPath = join(distDir, "index.html");
    if (existsSync(indexPath)) {
      set.headers["Content-Type"] = "text/html; charset=utf-8";
      return readFileSync(indexPath, "utf-8");
    }
    set.status = 404;
    return "Web build not found";
  })
  .listen({
    hostname,
    port,
    maxRequestBodySize: 1024 * 1024 * 1024 * 2, // 2GB limit for multi-file / large video uploads
  });

console.log(`Personal Feed Daemon & Web UI live at http://${hostname}:${port}`);

export type App = typeof app;
