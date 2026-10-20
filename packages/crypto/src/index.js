// packages/crypto/src/keys.ts
import { scryptSync, randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
function deriveMasterKey(passphrase, salt) {
  return scryptSync(passphrase, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}
function generateContentKey() {
  return randomBytes(32);
}
function wrapContentKey(contentKey, masterKey) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey, iv);
  const encrypted = Buffer.concat([cipher.update(contentKey), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}
function unwrapContentKey(wrappedKeyBase64, masterKey) {
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
// packages/crypto/src/stream.ts
import { createCipheriv as createCipheriv2, createDecipheriv as createDecipheriv2, randomBytes as randomBytes2 } from "node:crypto";
var CHUNK_SIZE = 2 * 1024 * 1024;
var TAG_SIZE = 16;
var ENCRYPTED_CHUNK_EXTRA = TAG_SIZE;
function deriveChunkIV(baseIV, chunkIndex) {
  const iv = Buffer.from(baseIV);
  const view = new DataView(iv.buffer, iv.byteOffset, iv.byteLength);
  const current = view.getUint32(8, false);
  view.setUint32(8, current ^ chunkIndex, false);
  return iv;
}
function encryptChunk(chunk, contentKey, baseIV, chunkIndex) {
  const iv = deriveChunkIV(baseIV, chunkIndex);
  const cipher = createCipheriv2("aes-256-gcm", contentKey, iv);
  const aad = Buffer.alloc(4);
  aad.writeUInt32BE(chunkIndex, 0);
  cipher.setAAD(aad);
  const encrypted = cipher.update(chunk);
  cipher.final();
  const tag = cipher.getAuthTag();
  return Buffer.concat([encrypted, tag]);
}
function decryptChunk(encryptedChunkWithTag, contentKey, baseIV, chunkIndex) {
  if (encryptedChunkWithTag.length < TAG_SIZE) {
    throw new Error(`Encrypted chunk too small: ${encryptedChunkWithTag.length}`);
  }
  const ciphertext = encryptedChunkWithTag.subarray(0, encryptedChunkWithTag.length - TAG_SIZE);
  const tag = encryptedChunkWithTag.subarray(encryptedChunkWithTag.length - TAG_SIZE);
  const iv = deriveChunkIV(baseIV, chunkIndex);
  const decipher = createDecipheriv2("aes-256-gcm", contentKey, iv);
  const aad = Buffer.alloc(4);
  aad.writeUInt32BE(chunkIndex, 0);
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
function encryptBlob(plainBuffer, key) {
  const iv = randomBytes2(12);
  const cipher = createCipheriv2("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plainBuffer), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]);
}
function decryptBlob(encryptedBuffer, key) {
  if (encryptedBuffer.length < 28) {
    throw new Error("Encrypted blob too small");
  }
  const iv = encryptedBuffer.subarray(0, 12);
  const tag = encryptedBuffer.subarray(12, 28);
  const ciphertext = encryptedBuffer.subarray(28);
  const decipher = createDecipheriv2("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
export {
  CHUNK_SIZE,
  ENCRYPTED_CHUNK_EXTRA,
  TAG_SIZE,
  decryptBlob,
  decryptChunk,
  deriveChunkIV,
  deriveMasterKey,
  encryptBlob,
  encryptChunk,
  generateContentKey,
  unwrapContentKey,
  wrapContentKey
};
