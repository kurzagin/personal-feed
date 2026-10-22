import { Elysia, t } from "elysia";
import type { Database } from "bun:sqlite";
import { StorageProvider } from "../r2/client";
import { unwrapContentKey, decryptChunk, decryptBlob, CHUNK_SIZE, TAG_SIZE } from "@personal-feed/crypto";

export function createMediaRoutes(db: Database, storage: StorageProvider, masterKey: Buffer) {
  const resolveTarget = (idOrItemId: string) => {
    // Try post first, then post_items
    let row = db.query("SELECT * FROM posts WHERE id = ?").get(idOrItemId) as any;
    let isItem = false;
    let storageKeyId = idOrItemId;

    if (row) {
      // If it's a post, find the first post_item to get the actual storage itemId
      const firstItem = db.query("SELECT * FROM post_items WHERE post_id = ? ORDER BY item_index ASC LIMIT 1").get(idOrItemId) as any;
      if (firstItem) {
        storageKeyId = firstItem.id;
      }
    } else {
      row = db.query("SELECT * FROM post_items WHERE id = ?").get(idOrItemId) as any;
      isItem = true;
      if (row) {
        storageKeyId = row.id;
      }
    }
    return { entity: row, isItem, storageKeyId };
  };

  const streamHandler = async (
    target: { r2_storage_key: string; encrypted_key: string; content_hash: string; media_type: string },
    headers: Record<string, string | undefined>,
    set: any
  ) => {
    // Content encryption key & Base IV
    const contentKey = unwrapContentKey(target.encrypted_key, masterKey);
    // Base IV is derived from content_hash (first 12 bytes)
    const baseIV = Buffer.from(target.content_hash, "hex").subarray(0, 12);

    // Get encrypted file size from storage
    const encryptedTotalSize = await storage.getObjectSize(target.r2_storage_key);
    const encChunkSize = CHUNK_SIZE + TAG_SIZE;
    const numChunks = Math.ceil(encryptedTotalSize / encChunkSize);

    const isVideo = target.media_type.includes("video");

    // Calculate approximate plain size (last chunk might be smaller)
    const rangeHeader = headers["range"];
    if (!rangeHeader) {
      // Full file request (e.g. for image sets / small clips)
      const fullEncrypted = await storage.getEncryptedRange(target.r2_storage_key, 0, encryptedTotalSize - 1);
      const decryptedBuffers: Buffer[] = [];

      for (let i = 0; i < numChunks; i++) {
        const start = i * encChunkSize;
        const end = Math.min(start + encChunkSize, fullEncrypted.length);
        const chunkData = fullEncrypted.subarray(start, end);
        if (chunkData.length > 0) {
          decryptedBuffers.push(decryptChunk(chunkData, contentKey, baseIV, i));
        }
      }
      const fullPlain = Buffer.concat(decryptedBuffers);
      set.headers["Content-Type"] = isVideo ? "video/mp4" : "image/avif";
      set.headers["Content-Length"] = fullPlain.length.toString();
      return new Response(fullPlain);
    }

    // Range request: "bytes=start-end"
    const parts = rangeHeader.replace(/bytes=/, "").split("-");
    const parsedStart = parseInt(parts[0], 10);
    const plainStart = Number.isFinite(parsedStart) && parsedStart >= 0 ? parsedStart : 0;
    
    // Determine starting chunk
    const startChunkIdx = Math.min(Math.floor(plainStart / CHUNK_SIZE), Math.max(0, numChunks - 1));
    const encStartOffset = startChunkIdx * encChunkSize;
    
    // Fetch up to 2 chunks (~4MB) at once for responsive buffering
    const endChunkIdx = Math.min(startChunkIdx + 1, numChunks - 1);
    const encEndOffset = Math.min((endChunkIdx + 1) * encChunkSize - 1, encryptedTotalSize - 1);

    const encBytes = await storage.getEncryptedRange(target.r2_storage_key, encStartOffset, encEndOffset);
    const decryptedParts: Buffer[] = [];

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
    set.headers["Content-Type"] = isVideo ? "video/mp4" : "image/avif";

    return new Response(plainSlice);
  };

  return new Elysia({ prefix: "/api/media" })
    .get("/:id/stream", async ({ params: { id }, headers, set }) => {
      const post = db.query("SELECT * FROM posts WHERE id = ?").get(id) as any;
      if (!post) {
        set.status = 404;
        return { error: "Media not found" };
      }
      return streamHandler(post, headers, set);
    })
    .get("/item/:itemId/stream", async ({ params: { itemId }, headers, set }) => {
      const item = db.query("SELECT * FROM post_items WHERE id = ?").get(itemId) as any;
      if (!item) {
        set.status = 404;
        return { error: "Media item not found" };
      }
      return streamHandler(item, headers, set);
    })
    // Dynamic HLS VOD Playlist (R2 never sees the playlist, synthesized on-the-fly locally)
    .get("/:id/playlist.m3u8", async ({ params: { id }, set }) => {
      const { entity } = resolveTarget(id);
      if (!entity || !entity.hls_segment_count) {
        set.status = 404;
        return { error: "HLS playlist not available for this item" };
      }

      const totalSegments = entity.hls_segment_count;
      const duration = entity.duration_seconds || (totalSegments * 3);
      const targetDuration = 4;

      let m3u8 = "#EXTM3U\n";
      m3u8 += "#EXT-X-VERSION:3\n";
      m3u8 += `#EXT-X-TARGETDURATION:${targetDuration}\n`;
      m3u8 += "#EXT-X-MEDIA-SEQUENCE:0\n";
      m3u8 += "#EXT-X-PLAYLIST-TYPE:VOD\n\n";

      const avgSegDuration = (duration / totalSegments).toFixed(3);
      for (let i = 0; i < totalSegments; i++) {
        // Last segment adjusts remainder duration
        const segDur = i === totalSegments - 1 ? (duration - (totalSegments - 1) * parseFloat(avgSegDuration)).toFixed(3) : avgSegDuration;
        m3u8 += `#EXTINF:${segDur},\n`;
        m3u8 += `/api/media/${id}/segment/${i}.ts\n`;
      }
      m3u8 += "#EXT-X-ENDLIST\n";

      set.headers["Content-Type"] = "application/vnd.apple.mpegurl";
      set.headers["Cache-Control"] = "no-cache";
      return m3u8;
    })
    // Individual decrypted HLS segment streaming
    .get("/:id/segment/:segmentIndex", async ({ params: { id, segmentIndex }, set }) => {
      const { entity, storageKeyId } = resolveTarget(id);
      if (!entity) {
        set.status = 404;
        return { error: "Media not found" };
      }

      const segIdx = parseInt(segmentIndex.replace(".ts", ""), 10);
      if (!Number.isInteger(segIdx) || segIdx < 0) {
        set.status = 400;
        return { error: "Invalid segment index" };
      }
      const contentKey = unwrapContentKey(entity.encrypted_key, masterKey);
      const segKey = `media/${storageKeyId}/hls/${segIdx}.enc`;

      try {
        const encryptedSeg = await storage.getEncryptedObject(segKey);
        const decryptedSeg = decryptBlob(encryptedSeg, contentKey);

        set.headers["Content-Type"] = "video/MP2T";
        set.headers["Content-Length"] = decryptedSeg.length.toString();
        set.headers["Cache-Control"] = "private, max-age=31536000, immutable";
        return new Response(decryptedSeg);
      } catch (err: any) {
        set.status = 404;
        return { error: `Segment not found or decryption failed: ${err?.message}` };
      }
    })
    // 3x3 Preview grid thumbnail
    .get("/:id/thumbnail-grid", async ({ params: { id }, set }) => {
      const { entity, storageKeyId } = resolveTarget(id);
      if (!entity) {
        set.status = 404;
        return { error: "Media not found" };
      }

      const contentKey = unwrapContentKey(entity.encrypted_key, masterKey);
      const gridKey = `media/${storageKeyId}/grid_3x3.enc`;

      try {
        const encData = await storage.getEncryptedObject(gridKey);
        const decData = decryptBlob(encData, contentKey);

        set.headers["Content-Type"] = "image/webp";
        set.headers["Cache-Control"] = "private, max-age=86400";
        return new Response(decData);
      } catch {
        // Fallback to primary stream
        return streamHandler(entity, {}, set);
      }
    })
    // 1-second interval scrubbing sprite sheet
    .get("/:id/scrub/sheet/:sheetIndex", async ({ params: { id, sheetIndex }, set }) => {
      const { entity, storageKeyId } = resolveTarget(id);
      if (!entity) {
        set.status = 404;
        return { error: "Media not found" };
      }

      const sIdx = parseInt(sheetIndex.replace(".webp", ""), 10);
      if (!Number.isInteger(sIdx) || sIdx < 0) {
        set.status = 400;
        return { error: "Invalid sheet index" };
      }
      const contentKey = unwrapContentKey(entity.encrypted_key, masterKey);
      const sheetKey = `media/${storageKeyId}/scrub/${sIdx}.enc`;

      try {
        const encData = await storage.getEncryptedObject(sheetKey);
        const decData = decryptBlob(encData, contentKey);

        set.headers["Content-Type"] = "image/webp";
        set.headers["Cache-Control"] = "private, max-age=31536000, immutable";
        return new Response(decData);
      } catch (err: any) {
        set.status = 404;
        return { error: `Scrub sheet not found: ${err?.message}` };
      }
    })
    // Scrubbing WebVTT manifest
    .get("/:id/scrub/vtt", async ({ params: { id }, set }) => {
      const { entity, storageKeyId } = resolveTarget(id);
      if (!entity) {
        set.status = 404;
        return { error: "Media not found" };
      }

      const contentKey = unwrapContentKey(entity.encrypted_key, masterKey);
      const vttKey = `media/${storageKeyId}/scrub.vtt.enc`;

      try {
        const encData = await storage.getEncryptedObject(vttKey);
        const decData = decryptBlob(encData, contentKey);

        set.headers["Content-Type"] = "text/vtt; charset=utf-8";
        set.headers["Cache-Control"] = "private, max-age=86400";
        return new Response(decData);
      } catch (err: any) {
        set.status = 404;
        return { error: `Scrub VTT not found: ${err?.message}` };
      }
    });
}
