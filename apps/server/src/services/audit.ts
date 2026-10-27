import { Database } from "bun:sqlite";
import { StorageProvider } from "../r2/client";
import { ListObjectsV2Command } from "@aws-sdk/client-s3";

export interface AuditIssue {
  type: "missing_in_r2" | "zero_byte_r2" | "orphaned_r2" | "video_missing_hls";
  severity: "error" | "warning";
  key?: string;
  postId?: string;
  itemId?: string;
  mediaType?: string;
  size?: number;
  message: string;
}

export interface AuditReport {
  timestamp: number;
  totalPosts: number;
  totalPostItems: number;
  totalR2Objects: number;
  zeroByteCount: number;
  missingInR2Count: number;
  orphanedR2Count: number;
  unprocessedVideosCount: number;
  issues: AuditIssue[];
}

export async function runStorageAudit(db: Database, storage: StorageProvider): Promise<AuditReport> {
  const s3 = (storage as any).s3;
  const issues: AuditIssue[] = [];

  const r2Objects = new Map<string, { size: number; lastModified?: Date }>();

  if (s3) {
    let continuationToken: string | undefined;
    do {
      const res = await s3.send(
        new ListObjectsV2Command({
          Bucket: (storage as any).bucket,
          ContinuationToken: continuationToken,
        })
      );
      for (const obj of res.Contents || []) {
        if (obj.Key) {
          r2Objects.set(obj.Key, { size: obj.Size || 0, lastModified: obj.LastModified });
        }
      }
      continuationToken = res.NextContinuationToken;
    } while (continuationToken);
  }

  // Check 0-byte objects in R2
  let zeroByteCount = 0;
  for (const [key, meta] of r2Objects.entries()) {
    if (meta.size === 0) {
      zeroByteCount++;
      issues.push({
        type: "zero_byte_r2",
        severity: "error",
        key,
        size: 0,
        message: `R2 object is completely empty (0 bytes): ${key}`,
      });
    }
  }

  const posts = db.query("SELECT * FROM posts").all() as any[];
  const postItems = db.query("SELECT * FROM post_items").all() as any[];

  const expectedKeys = new Map<string, { postId: string; itemId?: string; desc: string }>();

  let unprocessedVideosCount = 0;

  // Check posts
  for (const post of posts) {
    const isVideo = post.media_type === "video" || post.media_type?.includes("video");
    if (isVideo && (!post.hls_segment_count || post.hls_segment_count === 0 || !post.has_thumbnail_grid)) {
      unprocessedVideosCount++;
      issues.push({
        type: "video_missing_hls",
        severity: "warning",
        postId: post.id,
        mediaType: post.media_type,
        message: `Video post ${post.id} is missing HLS transcoding or thumbnail grid (displays as 'VID')`,
      });
    }

    if (post.r2_storage_key.endsWith("/manifest")) {
      const base = post.r2_storage_key.replace(/\/hls\/manifest$/, "");
      for (let i = 0; i < (post.hls_segment_count || 0); i++) {
        expectedKeys.set(`${base}/hls/${i}.enc`, { postId: post.id, desc: `HLS segment ${i}` });
      }
      if (post.has_scrub_sheet) {
        expectedKeys.set(`${base}/scrub/0.enc`, { postId: post.id, desc: "Scrub sheet 0" });
        expectedKeys.set(`${base}/scrub.vtt.enc`, { postId: post.id, desc: "Scrub WebVTT" });
      }
      if (post.has_thumbnail_grid) {
        expectedKeys.set(`${base}/grid_3x3.enc`, { postId: post.id, desc: "3x3 Preview Grid" });
      }
    } else {
      expectedKeys.set(post.r2_storage_key, { postId: post.id, desc: "Primary encrypted media file" });
    }
  }

  // Check post_items
  for (const item of postItems) {
    if (item.r2_storage_key.endsWith("/manifest")) {
      const base = item.r2_storage_key.replace(/\/hls\/manifest$/, "");
      for (let i = 0; i < (item.hls_segment_count || 0); i++) {
        expectedKeys.set(`${base}/hls/${i}.enc`, { postId: item.post_id, itemId: item.id, desc: `Item HLS segment ${i}` });
      }
      if (item.has_scrub_sheet) {
        expectedKeys.set(`${base}/scrub/0.enc`, { postId: item.post_id, itemId: item.id, desc: "Item scrub sheet 0" });
        expectedKeys.set(`${base}/scrub.vtt.enc`, { postId: item.post_id, itemId: item.id, desc: "Item scrub WebVTT" });
      }
      if (item.has_thumbnail_grid) {
        expectedKeys.set(`${base}/grid_3x3.enc`, { postId: item.post_id, itemId: item.id, desc: "Item 3x3 Preview Grid" });
      }
    } else {
      expectedKeys.set(item.r2_storage_key, { postId: item.post_id, itemId: item.id, desc: "Item media file" });
    }
  }

  // Check missing files in R2 (DB ghosts)
  let missingInR2Count = 0;
  if (s3) {
    for (const [key, info] of expectedKeys.entries()) {
      if (!r2Objects.has(key)) {
        missingInR2Count++;
        issues.push({
          type: "missing_in_r2",
          severity: "error",
          key,
          postId: info.postId,
          itemId: info.itemId,
          message: `Database references ${key} (${info.desc}), but file is missing in R2`,
        });
      }
    }
  }

  // Check orphaned files in R2 (R2 ghosts) - only consider media/ prefix
  let orphanedR2Count = 0;
  for (const [key, meta] of r2Objects.entries()) {
    if (!key.startsWith("media/")) continue;
    if (!expectedKeys.has(key)) {
      orphanedR2Count++;
      issues.push({
        type: "orphaned_r2",
        severity: "warning",
        key,
        size: meta.size,
        message: `R2 file ${key} (${Math.round(meta.size / 1024)} KB) is not referenced by any post in SQLite`,
      });
    }
  }

  return {
    timestamp: Date.now(),
    totalPosts: posts.length,
    totalPostItems: postItems.length,
    totalR2Objects: r2Objects.size,
    zeroByteCount,
    missingInR2Count,
    orphanedR2Count,
    unprocessedVideosCount,
    issues,
  };
}
