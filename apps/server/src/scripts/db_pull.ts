import { existsSync, writeFileSync, copyFileSync, unlinkSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { createDecipheriv } from "node:crypto";
import { Database } from "bun:sqlite";
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

async function run() {
  console.log(`⬇️ Pulling encrypted database from R2...`);
  console.log(`   R2 Key:    ${r2Key}`);
  console.log(`   Target DB: ${dbPath}`);

  const storage = new StorageProvider({
    accountId: process.env.R2_ACCOUNT_ID,
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    bucketName: process.env.R2_BUCKET,
  });

  let encryptedPayload: Buffer;
  try {
    encryptedPayload = await storage.getEncryptedObject(r2Key);
  } catch (err) {
    console.error(`❌ Could not fetch database from R2 (${r2Key}):`, err);
    process.exit(1);
  }

  if (encryptedPayload.length < 28) {
    console.error("❌ Downloaded payload is too small to be a valid encrypted database.");
    process.exit(1);
  }

  // Decrypt AES-256-GCM
  // Payload: [12 bytes IV][16 bytes GCM Auth Tag][Encrypted Data]
  console.log(`🔓 Decrypting database payload with Master Key...`);
  const iv = encryptedPayload.subarray(0, 12);
  const tag = encryptedPayload.subarray(12, 28);
  const ciphertext = encryptedPayload.subarray(28);

  let decrypted: Buffer;
  try {
    const decipher = createDecipheriv("aes-256-gcm", masterKey, iv);
    decipher.setAuthTag(tag);
    decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch (err) {
    console.error("❌ Decryption failed! Please check that APP_MASTER_PASSPHRASE and APP_MASTER_SALT match the device that pushed the DB.");
    process.exit(1);
  }

  // Validate SQLite header signature ("SQLite format 3\0")
  const magic = decrypted.subarray(0, 16).toString("utf-8");
  if (!magic.startsWith("SQLite format 3")) {
    console.error("❌ Integrity error: Decrypted data does not have a valid SQLite database header.");
    process.exit(1);
  }

  // Test opening the DB to confirm integrity
  const tempPath = join(process.cwd(), `.pulled_test_${Date.now()}.db`);
  try {
    writeFileSync(tempPath, decrypted, { mode: 0o600 });
    const testDb = new Database(tempPath, { readonly: true });
    const check = testDb.query("PRAGMA integrity_check;").get() as { integrity_check?: string } | null;
    testDb.close();

    if (check?.integrity_check !== "ok") {
      throw new Error(`SQLite integrity check returned: ${check?.integrity_check}`);
    }
  } catch (e) {
    console.error("❌ Integrity check failed on decrypted database:", e);
    if (existsSync(tempPath)) unlinkSync(tempPath);
    process.exit(1);
  } finally {
    if (existsSync(tempPath)) unlinkSync(tempPath);
  }

  // If local DB exists, create a safety backup before replacing
  if (existsSync(dbPath)) {
    const backupPath = `${dbPath}.backup_before_pull_${Date.now()}`;
    console.log(`💾 Existing local DB backed up to: ${backupPath}`);
    copyFileSync(dbPath, backupPath);
    try {
      chmodSync(backupPath, 0o600);
    } catch {}

    // Clean up old wal/shm if present to avoid corruption with replaced main file
    if (existsSync(`${dbPath}-wal`)) unlinkSync(`${dbPath}-wal`);
    if (existsSync(`${dbPath}-shm`)) unlinkSync(`${dbPath}-shm`);
  }

  // Write new database
  writeFileSync(dbPath, decrypted, { mode: 0o600 });
  console.log(`🎉 Database pulled and restored successfully to ${dbPath}! (${(decrypted.length / 1024 / 1024).toFixed(2)} MB)`);
}

run();
