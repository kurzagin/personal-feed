import { createCipheriv, createDecipheriv } from "node:crypto";
export const CHUNK_SIZE = 2 * 1024 * 1024; // 2 MB chunks
export const TAG_SIZE = 16;
export const ENCRYPTED_CHUNK_EXTRA = TAG_SIZE; // 16 bytes auth tag per chunk
/**
 * Creates a deterministic 12-byte IV for a specific chunk index using a base IV.
 */
export function deriveChunkIV(baseIV, chunkIndex) {
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
export function encryptChunk(chunk, contentKey, baseIV, chunkIndex) {
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
export function decryptChunk(encryptedChunkWithTag, contentKey, baseIV, chunkIndex) {
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
//# sourceMappingURL=stream.js.map