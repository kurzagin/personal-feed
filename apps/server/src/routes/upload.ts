import { Elysia, t } from "elysia";
import type { Database } from "bun:sqlite";
import { ulid } from "ulid";
import { createHash } from "node:crypto";
import { StorageProvider } from "../r2/client";
import {
  generateContentKey,
  wrapContentKey,
  encryptChunk,
  encryptBlob,
  CHUNK_SIZE,
} from "@personal-feed/crypto";
import type { TagCategory } from "@personal-feed/shared";
import { processImageToAvif } from "../pipeline/image";
import { processVideoToHLS } from "../pipeline/video";

export type UploadStage =
  | "receiving"
  | "deduplicating"
  | "transcoding"
  | "thumbnails"
  | "compressing"
  | "encrypting_uploading"
  | "finalizing"
  | "completed"
  | "cancelled"
  | "error";

export interface UploadProgressSnapshot {
  uploadId: string;
  stage: UploadStage;
  overallPercent: number; // 0..100 of server pipeline
  currentItem: number;
  totalItems: number;
  message: string;
  detail?: string;
  updatedAt: number;
  error?: string;
  postId?: string;
}

interface ActiveUploadJob {
  state: UploadProgressSnapshot;
  abortController: AbortController;
  uploadedKeys: string[];
  listeners: Set<(snapshot: UploadProgressSnapshot) => void>;
  cleanupTimer?: ReturnType<typeof setTimeout>;
  promise?: Promise<
    | { ok: true; postId: string; pageCount: number; uploadId: string }
    | { ok: false; status: number; error: string; cancelled?: boolean; uploadId: string }
  >;
}

const uploadJobs = new Map<string, ActiveUploadJob>();

function getOrCreateJob(uploadId: string, totalItems = 1): ActiveUploadJob {
  let job = uploadJobs.get(uploadId);
  if (!job) {
    job = {
      state: {
        uploadId,
        stage: "receiving",
        overallPercent: 0,
        currentItem: 1,
        totalItems,
        message: "Receiving media payload...",
        updatedAt: Date.now(),
      },
      abortController: new AbortController(),
      uploadedKeys: [],
      listeners: new Set(),
    };
    uploadJobs.set(uploadId, job);
  }
  return job;
}

function updateJobProgress(
  job: ActiveUploadJob,
  patch: Partial<Omit<UploadProgressSnapshot, "uploadId" | "updatedAt">>
) {
  job.state = {
    ...job.state,
    ...patch,
    overallPercent:
      patch.overallPercent !== undefined
        ? Math.max(0, Math.min(100, Math.round(patch.overallPercent)))
        : job.state.overallPercent,
    updatedAt: Date.now(),
  };
  for (const listener of job.listeners) {
    try {
      listener(job.state);
    } catch {}
  }
}

function scheduleJobCleanup(uploadId: string, delayMs = 120_000) {
  const job = uploadJobs.get(uploadId);
  if (!job) return;
  if (job.cleanupTimer) clearTimeout(job.cleanupTimer);
  job.cleanupTimer = setTimeout(() => {
    const current = uploadJobs.get(uploadId);
    if (current) {
      current.listeners.clear();
      uploadJobs.delete(uploadId);
    }
  }, delayMs);
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) {
    const err = new Error("Upload cancelled");
    err.name = "AbortError";
    throw err;
  }
}

interface PreparedFile {
  name: string;
  type: string;
  buffer: Buffer;
  hash: string;
  isVideo: boolean;
}

export function createUploadRoutes(db: Database, storage: StorageProvider, masterKey: Buffer) {
  /**
   * Detached background pipeline runner.
   * Continues running even if the browser tab is refreshed or closed during Phase 2.
   * Only aborts if explicitly cancelled via POST /api/ingest/cancel/:uploadId.
   */
  async function runDetachedPipeline(
    job: ActiveUploadJob,
    preparedFiles: PreparedFile[],
    rating: string,
    rawTags: Array<{ name: string; category: TagCategory }>
  ): Promise<
    | { ok: true; postId: string; pageCount: number; uploadId: string }
    | { ok: false; status: number; error: string; cancelled?: boolean; uploadId: string }
  > {
    const { uploadId } = job.state;
    const signal = job.abortController.signal;

    const recordAndPutObject = async (key: string, data: Buffer) => {
      throwIfAborted(signal);
      job.uploadedKeys.push(key);
      await storage.putEncryptedObject(key, data);
    };

    try {
      throwIfAborted(signal);

      const processedItems: Array<{
        itemId: string;
        mediaType: "image" | "video";
        duration: number | null;
        aspectRatio: number;
        r2Key: string;
        wrappedKey: string;
        hash: string;
        hlsSegmentCount: number;
        hasScrubSheet: boolean;
        hasThumbnailGrid: boolean;
      }> = [];

      const totalItems = preparedFiles.length;
      const pipelineSpan = 90; // 5% -> 95% of server pipeline
      const itemSpan = pipelineSpan / totalItems;

      for (let idx = 0; idx < totalItems; idx++) {
        throwIfAborted(signal);
        const { name: fileName, buffer: initialBuffer, hash, isVideo } = preparedFiles[idx];
        let payloadBuffer = initialBuffer;
        const itemNumber = idx + 1;
        const itemPrefix = totalItems > 1 ? `Item ${itemNumber}/${totalItems}: ` : "";
        const itemBasePercent = 5 + idx * itemSpan;

        let aspectRatio = 0.5625; // default 9:16
        let duration: number | null = null;
        let hlsSegmentCount = 0;
        let hasScrubSheet = false;
        let hasThumbnailGrid = false;

        const itemId = ulid();
        const contentKey = generateContentKey();
        const wrappedKey = wrapContentKey(contentKey, masterKey);
        const baseIV = Buffer.from(hash, "hex").subarray(0, 12);
        let r2Key = `media/${itemId}.enc`;

        if (isVideo) {
          try {
            updateJobProgress(job, {
              stage: "transcoding",
              overallPercent: itemBasePercent,
              currentItem: itemNumber,
              totalItems,
              message: `${itemPrefix}Transcoding video to 480p HLS...`,
              detail: fileName,
            });

            const hlsResult = await processVideoToHLS(payloadBuffer, itemId, {
              signal,
              onProgress: (vp) => {
                const mappedStage: UploadStage =
                  vp.stage === "grid" || vp.stage === "scrub_sheets"
                    ? "thumbnails"
                    : "transcoding";
                const subPercent = itemBasePercent + (vp.percent / 100) * (itemSpan * 0.72);
                updateJobProgress(job, {
                  stage: mappedStage,
                  overallPercent: subPercent,
                  currentItem: itemNumber,
                  totalItems,
                  message: `${itemPrefix}${vp.detail || "Processing video..."}`,
                  detail: fileName,
                });
              },
            });

            throwIfAborted(signal);

            aspectRatio = hlsResult.metadata.aspectRatio;
            duration = hlsResult.metadata.duration;
            hlsSegmentCount = hlsResult.segments.length;
            hasScrubSheet = hlsResult.scrubSheets.length > 0;
            hasThumbnailGrid = true;

            // Upload tasks: segments + 3x3 grid + scrub sheets + scrub VTT
            const uploadTasks: Array<{ key: string; data: Buffer }> = [];

            for (let sIdx = 0; sIdx < hlsResult.segments.length; sIdx++) {
              throwIfAborted(signal);
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
              throwIfAborted(signal);
              uploadTasks.push({
                key: `media/${itemId}/scrub/${shIdx}.enc`,
                data: encryptBlob(hlsResult.scrubSheets[shIdx], contentKey),
              });
            }

            uploadTasks.push({
              key: `media/${itemId}/scrub.vtt.enc`,
              data: encryptBlob(Buffer.from(hlsResult.scrubVtt, "utf-8"), contentKey),
            });

            // Upload encrypted objects with bounded concurrency (4 at a time)
            const concurrency = 4;
            let completedUploads = 0;
            const uploadStartPercent = itemBasePercent + itemSpan * 0.72;
            const uploadSpan = itemSpan * 0.28;

            for (let b = 0; b < uploadTasks.length; b += concurrency) {
              throwIfAborted(signal);
              const batch = uploadTasks.slice(b, b + concurrency);
              await Promise.all(batch.map((t) => recordAndPutObject(t.key, t.data)));
              completedUploads += batch.length;
              const uploadRatio = completedUploads / uploadTasks.length;
              updateJobProgress(job, {
                stage: "encrypting_uploading",
                overallPercent: uploadStartPercent + uploadRatio * uploadSpan,
                currentItem: itemNumber,
                totalItems,
                message: `${itemPrefix}Encrypting & storing segments (${completedUploads}/${uploadTasks.length})...`,
                detail: fileName,
              });
            }

            r2Key = `media/${itemId}/hls/manifest`;
          } catch (videoErr: any) {
            if (videoErr?.name === "AbortError" || signal.aborted) {
              throw videoErr;
            }
            console.error(
              "Video HLS segmentation failed, falling back to legacy single chunking:",
              videoErr?.message
            );

            updateJobProgress(job, {
              stage: "encrypting_uploading",
              overallPercent: itemBasePercent + itemSpan * 0.6,
              currentItem: itemNumber,
              totalItems,
              message: `${itemPrefix}Encrypting video chunks (fallback)...`,
              detail: fileName,
            });

            const encryptedChunks: Buffer[] = [];
            const numChunks = Math.ceil(payloadBuffer.length / CHUNK_SIZE);
            for (let i = 0; i < numChunks; i++) {
              throwIfAborted(signal);
              const start = i * CHUNK_SIZE;
              const end = Math.min(start + CHUNK_SIZE, payloadBuffer.length);
              const chunk = payloadBuffer.subarray(start, end);
              encryptedChunks.push(encryptChunk(chunk, contentKey, baseIV, i));
            }
            await recordAndPutObject(r2Key, Buffer.concat(encryptedChunks));
          }
        } else {
          // Image optimization to AVIF
          updateJobProgress(job, {
            stage: "compressing",
            overallPercent: itemBasePercent + itemSpan * 0.15,
            currentItem: itemNumber,
            totalItems,
            message: `${itemPrefix}Optimizing image to AVIF...`,
            detail: fileName,
          });

          try {
            const processed = await processImageToAvif(payloadBuffer, { signal });
            payloadBuffer = processed.avifBuffer;
            aspectRatio = processed.aspectRatio;
          } catch (err: any) {
            if (err?.name === "AbortError" || signal.aborted) {
              throw err;
            }
            console.warn("Image AVIF processing failed or skipped:", err?.message);
          }

          throwIfAborted(signal);

          // Chunked AES-256-GCM encryption for images
          updateJobProgress(job, {
            stage: "encrypting_uploading",
            overallPercent: itemBasePercent + itemSpan * 0.65,
            currentItem: itemNumber,
            totalItems,
            message: `${itemPrefix}Encrypting & storing image...`,
            detail: fileName,
          });

          const encryptedChunks: Buffer[] = [];
          const numChunks = Math.ceil(payloadBuffer.length / CHUNK_SIZE);
          for (let i = 0; i < numChunks; i++) {
            throwIfAborted(signal);
            const start = i * CHUNK_SIZE;
            const end = Math.min(start + CHUNK_SIZE, payloadBuffer.length);
            const chunk = payloadBuffer.subarray(start, end);
            encryptedChunks.push(encryptChunk(chunk, contentKey, baseIV, i));
          }
          await recordAndPutObject(r2Key, Buffer.concat(encryptedChunks));
        }

        processedItems.push({
          itemId,
          mediaType: isVideo ? "video" : "image",
          duration,
          aspectRatio,
          r2Key,
          wrappedKey,
          hash,
          hlsSegmentCount,
          hasScrubSheet,
          hasThumbnailGrid,
        });
      }

      throwIfAborted(signal);

      // STEP 3: Atomic Database Commit
      updateJobProgress(job, {
        stage: "finalizing",
        overallPercent: 97,
        currentItem: totalItems,
        totalItems,
        message: "Saving post & tags to database...",
      });

      const hasVideo = processedItems.some((it) => it.mediaType === "video");
      const hasImage = processedItems.some((it) => it.mediaType === "image");
      let overallMediaType: string = "image";
      if (hasVideo && hasImage) {
        overallMediaType = "mixed";
      } else if (hasVideo) {
        overallMediaType = "video";
      } else {
        overallMediaType = "image";
      }

      const firstItem = processedItems[0];
      const postId = ulid();
      const now = Date.now();

      const commitToDb = db.transaction(() => {
        throwIfAborted(signal);

        db.query(`
          INSERT INTO posts (
            id, media_type, duration_seconds, aspect_ratio, page_count,
            r2_storage_key, encrypted_key, content_hash, created_at, rating,
            hls_segment_count, has_scrub_sheet, has_thumbnail_grid
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          postId,
          overallMediaType,
          firstItem.duration,
          firstItem.aspectRatio,
          processedItems.length,
          firstItem.r2Key,
          firstItem.wrappedKey,
          firstItem.hash,
          now,
          rating,
          firstItem.hlsSegmentCount,
          firstItem.hasScrubSheet ? 1 : 0,
          firstItem.hasThumbnailGrid ? 1 : 0
        );

        for (let idx = 0; idx < processedItems.length; idx++) {
          const item = processedItems[idx];
          db.query(`
            INSERT INTO post_items (
              id, post_id, item_index, media_type, duration_seconds,
              aspect_ratio, r2_storage_key, encrypted_key, content_hash, created_at,
              hls_segment_count, has_scrub_sheet, has_thumbnail_grid
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            item.itemId,
            postId,
            idx,
            item.mediaType,
            item.duration,
            item.aspectRatio,
            item.r2Key,
            item.wrappedKey,
            item.hash,
            now,
            item.hlsSegmentCount,
            item.hasScrubSheet ? 1 : 0,
            item.hasThumbnailGrid ? 1 : 0
          );
        }

        for (const t of rawTags) {
          let tag = db
            .query("SELECT id, category FROM tags WHERE name = ?")
            .get(t.name) as any;
          if (!tag) {
            const category = t.category || "general";
            db.query("INSERT INTO tags (name, category) VALUES (?, ?)").run(
              t.name,
              category
            );
            tag = db
              .query("SELECT id, category FROM tags WHERE name = ?")
              .get(t.name) as any;
          }
          db.query(
            "INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)"
          ).run(postId, tag.id);
        }
      });

      commitToDb();

      updateJobProgress(job, {
        stage: "completed",
        overallPercent: 100,
        currentItem: totalItems,
        totalItems,
        message: "Post encrypted and published!",
        postId,
      });

      scheduleJobCleanup(uploadId, 60_000);
      return { ok: true, postId, pageCount: processedItems.length, uploadId };
    } catch (err: any) {
      const isAbort = err?.name === "AbortError" || signal.aborted;

      if (job.uploadedKeys.length > 0) {
        console.log(
          `Rolling back ${job.uploadedKeys.length} storage objects for upload ${uploadId}...`
        );
        await storage.deleteEncryptedObjects(job.uploadedKeys);
        job.uploadedKeys = [];
      }

      if (isAbort) {
        updateJobProgress(job, {
          stage: "cancelled",
          message: "Upload cancelled and temporary files cleaned up.",
        });
        scheduleJobCleanup(uploadId, 20_000);
        return {
          ok: false,
          status: 499,
          error: "Upload cancelled",
          cancelled: true,
          uploadId,
        };
      }

      const errorMsg = err?.message || "Failed to process and upload media";
      console.error(`Upload ${uploadId} failed:`, errorMsg);
      updateJobProgress(job, {
        stage: "error",
        error: errorMsg,
        message: "Upload failed",
      });
      scheduleJobCleanup(uploadId, 60_000);
      return { ok: false, status: 500, error: errorMsg, uploadId };
    }
  }

  return new Elysia({ prefix: "/api" })
    .get("/tags", ({ query }) => {
      const q = query.q ? query.q.trim().toLowerCase() : "";
      if (!q) {
        const topTags = db.query(`
          SELECT id, name, category, post_count 
          FROM tags 
          ORDER BY post_count DESC 
          LIMIT 25
        `).all();
        return { tags: topTags };
      }

      const tags = db.query(`
        SELECT id, name, category, post_count
        FROM tags
        WHERE name LIKE ?
        ORDER BY 
          CASE WHEN name LIKE ? THEN 0 ELSE 1 END,
          post_count DESC,
          name ASC
        LIMIT 25
      `).all(`%${q}%`, `${q}%`);

      return { tags };
    }, {
      query: t.Object({
        q: t.Optional(t.String()),
      })
    })
    .get("/ingest/active", () => {
      const active: UploadProgressSnapshot[] = [];
      for (const job of uploadJobs.values()) {
        const s = job.state.stage;
        if (
          s === "deduplicating" ||
          s === "transcoding" ||
          s === "thumbnails" ||
          s === "compressing" ||
          s === "encrypting_uploading" ||
          s === "finalizing"
        ) {
          active.push(job.state);
        }
      }
      // Sort most recently updated first
      active.sort((a, b) => b.updatedAt - a.updatedAt);
      return { active: active[0] || null, jobs: active };
    })
    .get("/ingest/status/:uploadId", ({ params }) => {
      const existing = uploadJobs.get(params.uploadId);
      if (!existing) {
        return {
          uploadId: params.uploadId,
          stage: "receiving" as UploadStage,
          overallPercent: 0,
          currentItem: 1,
          totalItems: 1,
          message: "Waiting for upload payload...",
          updatedAt: Date.now(),
          notFound: true,
        };
      }
      return existing.state;
    })
    .get("/ingest/progress/:uploadId", ({ params, request }) => {
      const { uploadId } = params;
      const job = getOrCreateJob(uploadId);
      const accept = request.headers.get("accept") || "";

      if (!accept.includes("text/event-stream")) {
        return job.state;
      }

      const encoder = new TextEncoder();
      let closed = false;
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
      let listener: ((snapshot: UploadProgressSnapshot) => void) | null = null;

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const sendSnapshot = (snapshot: UploadProgressSnapshot) => {
            if (closed) return;
            try {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(snapshot)}\n\n`));
              if (
                snapshot.stage === "completed" ||
                snapshot.stage === "cancelled" ||
                snapshot.stage === "error"
              ) {
                cleanup();
                controller.close();
              }
            } catch {
              cleanup();
            }
          };

          const cleanup = () => {
            if (closed) return;
            closed = true;
            if (heartbeatTimer) clearInterval(heartbeatTimer);
            if (listener) job.listeners.delete(listener);
          };

          listener = sendSnapshot;
          job.listeners.add(listener);

          // Immediately send initial state
          sendSnapshot(job.state);

          // Periodic heartbeat comments so client stall detector knows connection is live
          heartbeatTimer = setInterval(() => {
            if (closed) return;
            try {
              controller.enqueue(encoder.encode(`: heartbeat ${Date.now()}\n\n`));
            } catch {
              cleanup();
            }
          }, 2500);

          request.signal.addEventListener("abort", cleanup, { once: true });
        },
        cancel() {
          closed = true;
          if (heartbeatTimer) clearInterval(heartbeatTimer);
          if (listener) job.listeners.delete(listener);
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    })
    .post("/ingest/cancel/:uploadId", async ({ params }) => {
      const { uploadId } = params;
      const job = getOrCreateJob(uploadId);
      if (job.state.stage !== "completed") {
        updateJobProgress(job, {
          stage: "cancelled",
          message: "Cancelling upload and cleaning up temporary files...",
        });
        job.abortController.abort(new Error("Cancelled by user"));
      }
      scheduleJobCleanup(uploadId, 20_000);
      return { cancelled: true, uploadId };
    })
    .post("/ingest", async ({ body, request, set }) => {
      const headerUploadId = request.headers.get("x-upload-id");
      const isAsyncMode = request.headers.get("x-upload-async") === "1";
      const uploadId = (body.uploadId || headerUploadId || ulid()).trim();

      const rawFiles = body.files
        ? Array.isArray(body.files)
          ? body.files
          : [body.files]
        : body.file
        ? [body.file]
        : [];
      const rating = body.rating || "general";
      let rawTags: Array<{ name: string; category: TagCategory }> = [];
      if (Array.isArray(body.tags)) {
        rawTags = body.tags;
      } else if (typeof body.tags === "string") {
        try {
          rawTags = JSON.parse(body.tags);
        } catch {
          rawTags = [];
        }
      }

      if (rawFiles.length === 0) {
        set.status = 400;
        return { error: "No files provided" };
      }

      const job = getOrCreateJob(uploadId, rawFiles.length);
      const signal = job.abortController.signal;

      try {
        throwIfAborted(signal);

        // STEP 1: Fast Pre-flight Hashing & Deduplication BEFORE spawning background pipeline
        updateJobProgress(job, {
          stage: "deduplicating",
          overallPercent: 3,
          currentItem: 1,
          totalItems: rawFiles.length,
          message: "Verifying integrity & checking for duplicates...",
          detail: `${rawFiles.length} ${rawFiles.length === 1 ? "file" : "files"} received`,
        });

        const preparedFiles: PreparedFile[] = [];

        for (let i = 0; i < rawFiles.length; i++) {
          throwIfAborted(signal);
          const file = rawFiles[i] as File;
          const buffer = Buffer.from(await file.arrayBuffer());
          const hash = createHash("sha256").update(buffer).digest("hex");
          const isVideo =
            file.type.startsWith("video/") ||
            /\.(mp4|mov|webm)$/i.test(file.name);
          preparedFiles.push({
            name: file.name,
            type: file.type,
            buffer,
            hash,
            isVideo,
          });
        }

        // Check deduplication immediately if single file
        if (preparedFiles.length === 1) {
          const existing = db
            .query("SELECT id FROM posts WHERE content_hash = ?")
            .get(preparedFiles[0].hash) as { id: string } | null;
          if (existing) {
            updateJobProgress(job, {
              stage: "error",
              error: "Duplicate post: this media already exists in your feed.",
              message: "Duplicate post detected",
            });
            scheduleJobCleanup(uploadId, 30_000);
            set.status = 409;
            return {
              error: "Duplicate post: this media already exists in your feed.",
              existingId: existing.id,
              uploadId,
            };
          }
        }

        // Start detached pipeline (survives browser refresh / disconnect)
        const pipelinePromise = runDetachedPipeline(job, preparedFiles, rating, rawTags);
        job.promise = pipelinePromise;

        if (isAsyncMode) {
          set.status = 202;
          return {
            accepted: true,
            status: "processing",
            uploadId,
            totalItems: preparedFiles.length,
          };
        }

        const result = await pipelinePromise;
        if (result.ok) {
          return {
            success: true,
            postId: result.postId,
            pageCount: result.pageCount,
            uploadId: result.uploadId,
          };
        } else {
          set.status = result.status;
          return {
            error: result.error,
            cancelled: result.cancelled,
            uploadId: result.uploadId,
          };
        }
      } catch (err: any) {
        if (err?.name === "AbortError" || signal.aborted) {
          updateJobProgress(job, {
            stage: "cancelled",
            message: "Upload cancelled and temporary files cleaned up.",
          });
          scheduleJobCleanup(uploadId, 20_000);
          set.status = 499;
          return { error: "Upload cancelled", cancelled: true, uploadId };
        }
        const errorMsg = err?.message || "Failed to initialize upload";
        updateJobProgress(job, {
          stage: "error",
          error: errorMsg,
          message: "Upload failed",
        });
        scheduleJobCleanup(uploadId, 30_000);
        set.status = 500;
        return { error: errorMsg, uploadId };
      }
    }, {
      body: t.Object({
        uploadId: t.Optional(t.String()),
        file: t.Optional(t.File()),
        files: t.Optional(t.Any()),
        mediaType: t.Optional(t.String()),
        aspectRatio: t.Optional(t.String()),
        durationSeconds: t.Optional(t.String()),
        rating: t.Optional(t.String()),
        tags: t.Optional(t.Any()),
      })
    });
}
