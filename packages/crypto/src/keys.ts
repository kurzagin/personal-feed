import { scryptSync, randomBytes, createCipheriv, createDecipheriv } from "node:crypto";

/**
 * Derives a 256-bit Master Key from a user passphrase and salt.
 */
export function deriveMasterKey(passphrase: string, salt: Buffer): Buffer {
  // scrypt key derivation (N=16384, r=8, p=1, maxmem=64MB)
  return scryptSync(passphrase, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

/**
 * Generates a random 256-bit Content Encryption Key (CEK).
 */
export function generateContentKey(): Buffer {
  return randomBytes(32);
}

/**
 * Wraps (encrypts) the Content Key with the Master Key using AES-256-GCM.
 */
export function wrapContentKey(contentKey: Buffer, masterKey: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey, iv);
  const encrypted = Buffer.concat([cipher.update(contentKey), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Return base64 payload: [12-byte IV][16-byte Tag][Encrypted Key]
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

/**
 * Unwraps (decrypts) the Content Key using the Master Key.
 */
export function unwrapContentKey(wrappedKeyBase64: string, masterKey: Buffer): Buffer {
  const buf = Buffer.from(wrappedKeyBase64, "base64");
  if (buf.length < 28) {
    throw new Error("Invalid wrapped key format");
  }
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const encrypted = buf.subarray(28);

  const decipher = createDecipheriv("aes-256-gcm", masterKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}
