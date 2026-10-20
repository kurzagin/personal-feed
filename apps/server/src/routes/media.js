import { Elysia } from "elysia";
import { unwrapContentKey, decryptChunk, CHUNK_SIZE, TAG_SIZE } from "@personal-feed/crypto";
export function createMediaRoutes(db, storage, masterKey) {
    return new Elysia({ prefix: "/api/media" })
        .get("/:id/stream", async ({ params: { id }, headers, set }) => {
        const post = db.query("SELECT * FROM posts WHERE id = ?").get(id);
        if (!post) {
            set.status = 404;
            return { error: "Media not found" };
        }
        // Content encryption key & Base IV
        const contentKey = unwrapContentKey(post.encrypted_key, masterKey);
        // Base IV is derived from content_hash (first 12 bytes)
        const baseIV = Buffer.from(post.content_hash, "hex").subarray(0, 12);
        // Get encrypted file size from storage
        const encryptedTotalSize = await storage.getObjectSize(post.r2_storage_key);
        const encChunkSize = CHUNK_SIZE + TAG_SIZE;
        const numChunks = Math.ceil(encryptedTotalSize / encChunkSize);
        // Calculate approximate plain size (last chunk might be smaller)
        // For exact streaming, we decrypt requested range
        const rangeHeader = headers["range"];
        if (!rangeHeader) {
            // Full file request (e.g. for image sets / small clips)
            const fullEncrypted = await storage.getEncryptedRange(post.r2_storage_key, 0, encryptedTotalSize - 1);
            const decryptedBuffers = [];
            for (let i = 0; i < numChunks; i++) {
                const start = i * encChunkSize;
                const end = Math.min(start + encChunkSize, fullEncrypted.length);
                const chunkData = fullEncrypted.subarray(start, end);
                if (chunkData.length > 0) {
                    decryptedBuffers.push(decryptChunk(chunkData, contentKey, baseIV, i));
                }
            }
            const fullPlain = Buffer.concat(decryptedBuffers);
            set.headers["Content-Type"] = post.media_type.includes("video") ? "video/mp4" : "image/avif";
            set.headers["Content-Length"] = fullPlain.length.toString();
            return new Response(fullPlain);
        }
        // Range request: "bytes=start-end"
        const parts = rangeHeader.replace(/bytes=/, "").split("-");
        const plainStart = parseInt(parts[0], 10);
        // Determine starting chunk
        const startChunkIdx = Math.floor(plainStart / CHUNK_SIZE);
        const encStartOffset = startChunkIdx * encChunkSize;
        // Fetch up to 2 chunks (~4MB) at once for responsive buffering
        const endChunkIdx = Math.min(startChunkIdx + 1, numChunks - 1);
        const encEndOffset = Math.min((endChunkIdx + 1) * encChunkSize - 1, encryptedTotalSize - 1);
        const encBytes = await storage.getEncryptedRange(post.r2_storage_key, encStartOffset, encEndOffset);
        const decryptedParts = [];
        for (let c = startChunkIdx; c <= endChunkIdx; c++) {
            const offsetInSlice = (c - startChunkIdx) * encChunkSize;
            const sliceEnd = Math.min(offsetInSlice + encChunkSize, encBytes.length);
            const chunkData = encBytes.subarray(offsetInSlice, sliceEnd);
            if (chunkData.length > 0) {
                decryptedParts.push(decryptChunk(chunkData, contentKey, baseIV, c));
            }
        }
        const combinedDecrypted = Buffer.concat(decryptedParts);
        const offsetWithinFirstChunk = plainStart - (startChunkIdx * CHUNK_SIZE);
        const plainSlice = combinedDecrypted.subarray(offsetWithinFirstChunk);
        const plainTotal = (numChunks - 1) * CHUNK_SIZE + (encryptedTotalSize - (numChunks - 1) * encChunkSize - TAG_SIZE);
        const plainEnd = plainStart + plainSlice.length - 1;
        set.status = 206;
        set.headers["Content-Range"] = `bytes ${plainStart}-${plainEnd}/${plainTotal}`;
        set.headers["Accept-Ranges"] = "bytes";
        set.headers["Content-Length"] = plainSlice.length.toString();
        set.headers["Content-Type"] = post.media_type.includes("video") ? "video/mp4" : "image/avif";
        return new Response(plainSlice);
    });
}
//# sourceMappingURL=media.js.map