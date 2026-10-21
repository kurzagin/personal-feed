import { Database } from "bun:sqlite";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { randomBytes, createCipheriv } from "node:crypto";
import { deriveMasterKey } from "@personal-feed/crypto";
import { StorageProvider } from "../r2/client";

const PASSPHRASE = process.env.APP_MASTER_PASSPHRASE;
const SALT_STR = process.env.APP_MASTER_SALT;

if (!PASSPHRASE || !SALT_STR) {
  console.error("❌ Error: APP_MASTER_PASSPHRASE and APP_MASTER_SALT must be defined in your .env file.");
  process.exit(1);
}

const masterKey = deriveMasterKey(PASSPHRASE, Buffer.from(SALT_STR, "utf-8"));

const dbPath = process.env.DATABASE_PATH || "personal_feed.db";
const r2Key = process.env.DB_BACKUP_R2_KEY || "db/personal_feed.db.enc";

if (!existsSync(dbPath)) {
  console.error(`❌ Error: Database file not found at ${dbPath}`);
  process.exit(1);
}

async function run() {
  console.log(`🔒 Starting database backup & push to R2...`);
  console.log(`   Source DB: ${dbPath}`);
  console.log(`   R2 Target: ${r2Key}`);

  // 1. Checkpoint WAL and create an atomic, clean snapshot with VACUUM INTO
  const tempSnapshot = join(process.cwd(), `.snapshot_${Date.now()}.db`);
  try {
    const db = new Database(dbPath);
    // Flush write-ahead log
    db.run("PRAGMA wal_checkpoint(TRUNCATE);");
    // Create clean isolated snapshot
    db.run(`VACUUM INTO '${tempSnapshot}';`);
    db.close();
    console.log(`✅ Created clean SQLite snapshot (${(readFileSync(tempSnapshot).length / 1024 / 1024).toFixed(2)} MB)`);

    // 2. Encrypt snapshot using AES-256-GCM with masterKey
    const rawData = readFileSync(tempSnapshot);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", masterKey, iv);
    const encrypted = Buffer.concat([cipher.update(rawData), cipher.final()]);
    const tag = cipher.getAuthTag();

    // Payload structure: [12 bytes IV][16 bytes GCM Auth Tag][Encrypted Data]
    const encryptedPayload = Buffer.concat([iv, tag, encrypted]);

    // 3. Upload to R2 (or local mock storage if R2 credentials are not set)
    const storage = new StorageProvider({
      accountId: process.env.R2_ACCOUNT_ID,
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      bucketName: process.env.R2_BUCKET,
    });

    console.log(`⬆️ Uploading encrypted snapshot to R2...`);
    await storage.putEncryptedObject(r2Key, encryptedPayload);

    // Also write a timestamped version for safety if configured
    const timestampKey = `db/backups/personal_feed_${Date.now()}.db.enc`;
    await storage.putEncryptedObject(timestampKey, encryptedPayload);

    console.log(`🎉 Success! DB snapshot encrypted and pushed to R2:`);
    console.log(`   - Latest pointer: ${r2Key}`);
    console.log(`   - Archive copy:   ${timestampKey}`);
  } catch (err) {
    console.error(`❌ Push failed:`, err);
    process.exit(1);
  } finally {
    if (existsSync(tempSnapshot)) {
      unlinkSync(tempSnapshot);
    }
  }
}

run();
