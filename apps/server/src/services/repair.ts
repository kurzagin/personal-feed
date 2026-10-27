import { Database } from "bun:sqlite";
import { StorageProvider } from "../r2/client";
import { processVideoToHLS } from "../pipeline/video";
import {
  unwrapContentKey,
  decryptChunk,
  encryptBlob,
  CHUNK_SIZE,
  TAG_SIZE,
} from "@personal-feed/crypto";

export async function repairPostVideo(
  postId: string,
  db: Database,
  storage: StorageProvider,
  masterKey: Buffer
): Promise<{ success: boolean; message: string; duration?: number; segments?: number }> {
  const post = db.query("SELECT * FROM posts WHERE id = ?").get(postId) as any;
  if (!post) {
    throw new Error(`Post ${postId} not found`);
  }

  const isVideo = post.media_type === "video" || post.media_type?.includes("video");
  if (!isVideo) {
    throw new Error(`Post ${postId} is not a video`);
  }

  const contentKey = unwrapContentKey(post.encrypted_key, masterKey);
  const baseIV = Buffer.from(post.content_hash, "hex").subarray(0, 12);

  // If already full HLS with thumbnail, return early
  if (post.hls_segment_count > 0 && post.has_thumbnail_grid && post.r2_storage_key.endsWith("/manifest")) {
    return {
      success: true,
      message: "Post already has HLS and thumbnail grid.",
      duration: post.duration_seconds,
      segments: post.hls_segment_count,
    };
  }

  // Find the raw storage key
  const oldStorageKey = post.r2_storage_key;
  const encSize = await storage.getObjectSize(oldStorageKey);
  if (!encSize || encSize === 0) {
    throw new Error(`Storage file ${oldStorageKey} is missing or 0 bytes`);
  }

  // Download and decrypt the legacy raw payload
  const fullEncrypted = await storage.getEncryptedRange(oldStorageKey, 0, encSize - 1);
  const encChunkSize = CHUNK_SIZE + TAG_SIZE;
  const numChunks = Math.ceil(encSize / encChunkSize);
  const decryptedBuffers: Buffer[] = [];

  for (let i = 0; i < numChunks; i++) {
    const start = i * encChunkSize;
    const end = Math.min(start + encChunkSize, fullEncrypted.length);
    decryptedBuffers.push(decryptChunk(fullEncrypted.subarray(start, end), contentKey, baseIV, i));
  }

  const rawVideoBuffer = Buffer.concat(decryptedBuffers);

  // Run HLS transcoding pipeline with full CPU threads
  // Derive itemId from old key: e.g. "media/01M5F6DYG0J5P4FDSR4K5WGZ0W.enc" -> "01M5F6DYG0J5P4FDSR4K5WGZ0W"
  const itemIdMatch = oldStorageKey.match(/media\/([^\.\/]+)/);
  const itemId = itemIdMatch ? itemIdMatch[1] : postId;

  console.log(`[repair] Starting HLS transcode for ${postId} (${rawVideoBuffer.length} bytes)...`);
  const hlsResult = await processVideoToHLS(rawVideoBuffer, itemId, {
    timeoutMs: Math.max(600_000, Math.round((rawVideoBuffer.length / 100_000) * 1000)),
    onProgress: (p) => {
      console.log(`[repair] ${p.stage}: ${p.percent}% - ${p.detail || ""}`);
    },
  });

  // Upload segments, 3x3 grid, scrub sheets, and scrub VTT
  const uploadTasks: Array<{ key: string; data: Buffer }> = [];

  for (let sIdx = 0; sIdx < hlsResult.segments.length; sIdx++) {
    uploadTasks.push({
      key: `media/${itemId}/hls/${sIdx}.enc`,
      data: encryptBlob(hlsResult.segments[sIdx], contentKey),
    });
  }

  uploadTasks.push({
    key: `media/${itemId}/grid_3x3.enc`,
    data: encryptBlob(hlsResult.thumbnailGrid, contentKey),
  });

  for (let shIdx = 0; shIdx < hlsResult.scrubSheets.length; shIdx++) {
    uploadTasks.push({
      key: `media/${itemId}/scrub/${shIdx}.enc`,
      data: encryptBlob(hlsResult.scrubSheets[shIdx], contentKey),
    });
  }

  uploadTasks.push({
    key: `media/${itemId}/scrub.vtt.enc`,
    data: encryptBlob(Buffer.from(hlsResult.scrubVtt, "utf-8"), contentKey),
  });

  const concurrency = 4;
  for (let b = 0; b < uploadTasks.length; b += concurrency) {
    const batch = uploadTasks.slice(b, b + concurrency);
    await Promise.all(batch.map((t) => storage.putEncryptedObject(t.key, t.data)));
  }

  const newManifestKey = `media/${itemId}/hls/manifest`;

  // Update Database
  db.run(`
    UPDATE posts
    SET r2_storage_key = ?,
        duration_seconds = ?,
        aspect_ratio = ?,
        hls_segment_count = ?,
        has_scrub_sheet = ?,
        has_thumbnail_grid = ?
    WHERE id = ?
  `, [
    newManifestKey,
    hlsResult.metadata.duration,
    hlsResult.metadata.aspectRatio,
    hlsResult.segments.length,
    hlsResult.scrubSheets.length > 0 ? 1 : 0,
    1,
    postId,
  ]);

  // Also update corresponding post_items
  db.run(`
    UPDATE post_items
    SET r2_storage_key = ?,
        duration_seconds = ?,
        aspect_ratio = ?,
        hls_segment_count = ?,
        has_scrub_sheet = ?,
        has_thumbnail_grid = ?
    WHERE post_id = ?
  `, [
    newManifestKey,
    hlsResult.metadata.duration,
    hlsResult.metadata.aspectRatio,
    hlsResult.segments.length,
    hlsResult.scrubSheets.length > 0 ? 1 : 0,
    1,
    postId,
  ]);

  // Clean up legacy fallback single chunk object from storage
  if (oldStorageKey !== newManifestKey) {
    await storage.deleteEncryptedObject(oldStorageKey).catch(() => {});
  }

  return {
    success: true,
    message: `Reprocessed ${hlsResult.segments.length} HLS segments & thumbnail grid for post ${postId}`,
    duration: hlsResult.metadata.duration,
    segments: hlsResult.segments.length,
  };
}
