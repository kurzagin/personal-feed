import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { initDatabase } from "./db/schema";
import { StorageProvider } from "./r2/client";
import { FeedRanker } from "./algo/ranker";
import { deriveMasterKey } from "@personal-feed/crypto";
import { createMediaRoutes } from "./routes/media";
import { createFeedRoutes } from "./routes/feed";
import { createUploadRoutes } from "./routes/upload";
// Derive Master Key from environment passphrase or fallback for local dev
const PASSPHRASE = process.env.APP_MASTER_PASSPHRASE || "default-personal-master-passphrase-2026";
const MASTER_SALT = Buffer.from(process.env.APP_MASTER_SALT || "personal-salt-constant", "utf-8");
const masterKey = deriveMasterKey(PASSPHRASE, MASTER_SALT);
// Initialize DB & Storage
const db = initDatabase();
const storage = new StorageProvider();
const ranker = new FeedRanker(db);
export const app = new Elysia()
    .use(cors())
    .get("/health", () => ({ status: "ok", timestamp: Date.now() }))
    .use(createMediaRoutes(db, storage, masterKey))
    .use(createFeedRoutes(db, ranker))
    .use(createUploadRoutes(db, storage, masterKey))
    .listen(3001);
console.log(`🦊 Personal Feed Server running at http://${app.server?.hostname}:${app.server?.port}`);
//# sourceMappingURL=index.js.map