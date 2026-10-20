export declare const CHUNK_SIZE: number;
export declare const TAG_SIZE = 16;
export declare const ENCRYPTED_CHUNK_EXTRA = 16;
/**
 * Creates a deterministic 12-byte IV for a specific chunk index using a base IV.
 */
export declare function deriveChunkIV(baseIV: Buffer, chunkIndex: number): Buffer;
/**
 * Encrypts a single chunk using AES-256-GCM.
 * Output layout: [Ciphertext (up to CHUNK_SIZE)][16 bytes GCM Auth Tag]
 */
export declare function encryptChunk(chunk: Buffer, contentKey: Buffer, baseIV: Buffer, chunkIndex: number): Buffer;
/**
 * Decrypts a single encrypted chunk using AES-256-GCM.
 */
export declare function decryptChunk(encryptedChunkWithTag: Buffer, contentKey: Buffer, baseIV: Buffer, chunkIndex: number): Buffer;
//# sourceMappingURL=stream.d.ts.map