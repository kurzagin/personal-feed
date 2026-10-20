import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export const CHUNK_SIZE = 2 * 1024 * 1024; // 2 MB chunks
export const TAG_SIZE = 16;
export const ENCRYPTED_CHUNK_EXTRA = TAG_SIZE; // 16 bytes auth tag per chunk

/**
 * Creates a deterministic 12-byte IV for a specific chunk index using a base IV.
 */
export function deriveChunkIV(baseIV: Buffer, chunkIndex: number): Buffer {
  const iv = Buffer.from(baseIV);
  // XOR the chunkIndex into the last 4 bytes of the IV
  const view = new DataView(iv.buffer, iv.byteOffset, iv.byteLength);
  const current = view.getUint32(8, false);
  view.setUint32(8, current ^ chunkIndex, false);
  return iv;
}

/**
 * Encrypts a single chunk using AES-256-GCM.
 * Output layout: [Ciphertext (up to CHUNK_SIZE)][16 bytes GCM Auth Tag]
 */
export function encryptChunk(
  chunk: Buffer,
  contentKey: Buffer,
  baseIV: Buffer,
  chunkIndex: number
): Buffer {
  const iv = deriveChunkIV(baseIV, chunkIndex);
  const cipher = createCipheriv("aes-256-gcm", contentKey, iv);
  
  // Set AAD to chunk index as big-endian 32-bit int to prevent chunk swapping
  const aad = Buffer.alloc(4);
  aad.writeUInt32BE(chunkIndex, 0);
  cipher.setAAD(aad);

  const encrypted = cipher.update(chunk);
  cipher.final();
  const tag = cipher.getAuthTag();

  return Buffer.concat([encrypted, tag]);
}

/**
 * Decrypts a single encrypted chunk using AES-256-GCM.
 */
export function decryptChunk(
  encryptedChunkWithTag: Buffer,
  contentKey: Buffer,
  baseIV: Buffer,
  chunkIndex: number
): Buffer {
  if (encryptedChunkWithTag.length < TAG_SIZE) {
    throw new Error(`Encrypted chunk too small: ${encryptedChunkWithTag.length}`);
  }

  const ciphertext = encryptedChunkWithTag.subarray(0, encryptedChunkWithTag.length - TAG_SIZE);
  const tag = encryptedChunkWithTag.subarray(encryptedChunkWithTag.length - TAG_SIZE);

  const iv = deriveChunkIV(baseIV, chunkIndex);
  const decipher = createDecipheriv("aes-256-gcm", contentKey, iv);

  const aad = Buffer.alloc(4);
  aad.writeUInt32BE(chunkIndex, 0);
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * Encrypts an arbitrary buffer (like an HLS segment, image, or sprite sheet) as a single AES-256-GCM unit.
 * Format: [12-byte IV][16-byte Tag][Ciphertext]
 */
export function encryptBlob(plainBuffer: Buffer, key: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plainBuffer), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]);
}

/**
 * Decrypts a buffer encrypted via encryptBlob.
 */
export function decryptBlob(encryptedBuffer: Buffer, key: Buffer): Buffer {
  if (encryptedBuffer.length < 28) {
    throw new Error("Encrypted blob too small");
  }
  const iv = encryptedBuffer.subarray(0, 12);
  const tag = encryptedBuffer.subarray(12, 28);
  const ciphertext = encryptedBuffer.subarray(28);

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
