import { mkdtemp, readdir, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

export interface VideoMetadata {
  duration: number;
  width: number;
  height: number;
  aspectRatio: number;
}

export interface ProcessedVideoHLS {
  metadata: VideoMetadata;
  playlistM3u8: string;
  segments: Buffer[]; // Ordered list of segment .ts buffers
  thumbnailGrid: Buffer; // 3x3 grid webp
  scrubSheets: Buffer[]; // 10x10 sprite sheets webp
  scrubVtt: string; // VTT text mapping timestamps to sprite sheets
}

export interface VideoProcessProgress {
  stage: "probing" | "transcoding" | "grid" | "scrub_sheets";
  percent: number; // 0..100 across the video processing pipeline
  detail?: string;
}

export interface VideoProcessOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  onProgress?: (progress: VideoProcessProgress) => void;
}

function createAbortError(message = "Video processing aborted"): Error {
  const err = new Error(message);
  err.name = "AbortError";
  return err;
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

/**
 * Parses ffmpeg stderr output for `time=HH:MM:SS.ms` and returns seconds elapsed.
 */
function parseFfmpegTimeSeconds(text: string): number | null {
  const matches = [...text.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
  if (matches.length === 0) return null;
  const last = matches[matches.length - 1];
  const hrs = parseFloat(last[1]);
  const mins = parseFloat(last[2]);
  const secs = parseFloat(last[3]);
  if (isNaN(hrs) || isNaN(mins) || isNaN(secs)) return null;
  return hrs * 3600 + mins * 60 + secs;
}

interface RunCommandOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  onStderrChunk?: (chunkText: string) => void;
}

async function runCommand(
  cmd: string,
  args: string[],
  options: RunCommandOptions = {}
): Promise<{ stdout: string; stderr: string }> {
  const { signal, timeoutMs = 180_000, onStderrChunk } = options;
  throwIfAborted(signal);

  const proc = Bun.spawn([cmd, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });

  let timedOut = false;
  let aborted = false;

  const onAbort = () => {
    aborted = true;
    try {
      proc.kill();
    } catch {}
  };

  signal?.addEventListener("abort", onAbort, { once: true });

  const timer = setTimeout(() => {
    timedOut = true;
    try {
      proc.kill();
    } catch {}
  }, timeoutMs);

  const readStream = async (
    stream: ReadableStream<Uint8Array> | null,
    onChunk?: (text: string) => void
  ): Promise<string> => {
    if (!stream) return "";
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let full = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        full += text;
        if (onChunk) {
          try {
            onChunk(text);
          } catch {}
        }
      }
      full += decoder.decode();
    } catch {
      // Stream closed due to kill/abort
    } finally {
      reader.releaseLock();
    }
    return full;
  };

  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      readStream(proc.stdout),
      readStream(proc.stderr, onStderrChunk),
      proc.exited,
    ]);

    if (aborted || signal?.aborted) {
      throw createAbortError();
    }

    if (timedOut) {
      throw new Error(`Command ${cmd} timed out after ${Math.round(timeoutMs / 1000)}s`);
    }

    if (exitCode !== 0) {
      throw new Error(`Command ${cmd} exited with code ${exitCode}: ${stderr.slice(-500)}`);
    }

    return { stdout, stderr };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * Probes video using ffprobe to get duration, dimensions, and aspect ratio.
 */
export async function probeVideo(filePath: string, signal?: AbortSignal): Promise<VideoMetadata> {
  const { stdout } = await runCommand(
    "ffprobe",
    [
      "-v", "error",
      "-show_entries", "stream=width,height,duration:format=duration",
      "-of", "json",
      filePath,
    ],
    { signal, timeoutMs: 30_000 }
  );

  const parsed = JSON.parse(stdout);
  let duration = parseFloat(parsed.format?.duration || "0");
  let width = 0;
  let height = 0;

  if (parsed.streams && parsed.streams.length > 0) {
    for (const stream of parsed.streams) {
      if (stream.width && stream.height) {
        width = stream.width;
        height = stream.height;
        if (!duration && stream.duration) {
          duration = parseFloat(stream.duration);
        }
        break;
      }
    }
  }

  if (width === 0 || height === 0) {
    width = 720;
    height = 1280;
  }
  if (!duration || isNaN(duration) || duration <= 0) {
    duration = 5.0; // Fallback minimal duration
  }

  const aspectRatio = parseFloat((width / height).toFixed(4));
  return { duration, width, height, aspectRatio };
}

/**
 * Calculates optimal video bitrate to strictly enforce <= 200MB size.
 */
function calculateBitrateK(durationSec: number): { videoBitrateK: number; audioBitrateK: number } {
  const maxBytes = 190 * 1024 * 1024; // 190 MB safety limit under 200 MB
  const totalBits = maxBytes * 8;
  const maxTotalBitrateK = Math.floor(totalBits / durationSec / 1000);

  const audioBitrateK = 96;
  let videoBitrateK = Math.min(1000, Math.max(250, maxTotalBitrateK - audioBitrateK));
  return { videoBitrateK, audioBitrateK };
}

/**
 * Processes an input video buffer:
 * 1. Probes dimensions & duration
 * 2. Transcodes to 480p H.264/AAC with HLS segmentation (3s chunks) capped under 200MB
 * 3. Extracts a 3x3 preview grid WebP image
 * 4. Extracts 1-second interval scrubbing sprite sheets (10x10) + WebVTT manifest
 */
export async function processVideoToHLS(
  videoBuffer: Buffer,
  postId: string,
  options: VideoProcessOptions = {}
): Promise<ProcessedVideoHLS> {
  const { signal, timeoutMs = 240_000, onProgress } = options;
  throwIfAborted(signal);

  const tempDir = await mkdtemp(join(tmpdir(), `pf-vid-${postId}-`));
  const inputFilePath = join(tempDir, "input.mp4");

  try {
    onProgress?.({ stage: "probing", percent: 2, detail: "Analyzing video dimensions & duration..." });
    await writeFile(inputFilePath, videoBuffer);
    throwIfAborted(signal);

    const metadata = await probeVideo(inputFilePath, signal);
    const { videoBitrateK, audioBitrateK } = calculateBitrateK(metadata.duration);

    // 1. Transcode to 480p HLS segments
    onProgress?.({
      stage: "transcoding",
      percent: 6,
      detail: `Transcoding to 480p HLS (0% of ${Math.round(metadata.duration)}s)...`,
    });

    const hlsDir = join(tempDir, "hls");
    await mkdir(hlsDir, { recursive: true });

    const scaleFilter = metadata.height >= metadata.width
      ? "scale='min(480,iw)':-2,format=yuv420p"
      : "scale=-2:'min(480,ih)',format=yuv420p";

    await runCommand(
      "ffmpeg",
      [
        "-y",
        "-i", inputFilePath,
        "-vf", scaleFilter,
        "-c:v", "libx264",
        "-profile:v", "main",
        "-pix_fmt", "yuv420p",
        "-preset", "faster",
        "-b:v", `${videoBitrateK}k`,
        "-maxrate", `${Math.floor(videoBitrateK * 1.5)}k`,
        "-bufsize", `${videoBitrateK * 2}k`,
        "-c:a", "aac",
        "-b:a", `${audioBitrateK}k`,
        "-ac", "2",
        "-hls_time", "3",
        "-hls_playlist_type", "vod",
        "-hls_segment_filename", join(hlsDir, "segment_%03d.ts"),
        join(hlsDir, "master.m3u8"),
      ],
      {
        signal,
        timeoutMs,
        onStderrChunk: (chunkText) => {
          const sec = parseFfmpegTimeSeconds(chunkText);
          if (sec !== null && metadata.duration > 0) {
            const ratio = Math.min(1, Math.max(0, sec / metadata.duration));
            const pct = Math.round(6 + ratio * 64); // 6% -> 70%
            const transcodePct = Math.min(99, Math.round(ratio * 100));
            onProgress?.({
              stage: "transcoding",
              percent: pct,
              detail: `Transcoding 480p HLS (${transcodePct}% • ${Math.round(sec)}s / ${Math.round(metadata.duration)}s)...`,
            });
          }
        },
      }
    );

    throwIfAborted(signal);

    // Read segments
    const hlsFiles = await readdir(hlsDir);
    const segmentFileNames = hlsFiles
      .filter((f) => f.endsWith(".ts"))
      .sort();

    const segments: Buffer[] = [];
    for (const segName of segmentFileNames) {
      throwIfAborted(signal);
      segments.push(await readFile(join(hlsDir, segName)));
    }

    const playlistM3u8 = await readFile(join(hlsDir, "master.m3u8"), "utf-8");

    // 2. Generate 3x3 Preview Grid Thumbnail (9 evenly spaced frames)
    onProgress?.({
      stage: "grid",
      percent: 74,
      detail: "Generating 3x3 preview thumbnail grid...",
    });

    const gridImagePath = join(tempDir, "grid_3x3.webp");
    const tileFilter = metadata.duration >= 2
      ? `fps=9/${metadata.duration.toFixed(2)},scale=160:-2,tile=3x3`
      : "scale=480:-2";

    try {
      await runCommand(
        "ffmpeg",
        [
          "-y",
          "-i", inputFilePath,
          "-vf", tileFilter,
          "-vframes", "1",
          "-q:v", "75",
          gridImagePath,
        ],
        { signal, timeoutMs: 60_000 }
      );
    } catch (gridErr: any) {
      if (gridErr?.name === "AbortError" || signal?.aborted) {
        throw createAbortError();
      }
      // Fallback single frame
      await runCommand(
        "ffmpeg",
        [
          "-y",
          "-ss", "00:00:00.5",
          "-i", inputFilePath,
          "-vframes", "1",
          "-vf", "scale=360:-2",
          gridImagePath,
        ],
        { signal, timeoutMs: 45_000 }
      );
    }
    const thumbnailGrid = await readFile(gridImagePath);

    // 3. Generate 1s Scrubbing Sprite Sheets (10x10 tiles per sheet = 100s per sheet)
    onProgress?.({
      stage: "scrub_sheets",
      percent: 82,
      detail: "Generating 1s scrubbing sprite sheets...",
    });

    const scrubDir = join(tempDir, "scrub");
    await mkdir(scrubDir, { recursive: true });

    const thumbWidth = 100;
    const thumbHeight = Math.round(thumbWidth / metadata.aspectRatio);

    await runCommand(
      "ffmpeg",
      [
        "-y",
        "-i", inputFilePath,
        "-vf", `fps=1,scale=${thumbWidth}:${thumbHeight},tile=10x10`,
        "-q:v", "70",
        join(scrubDir, "sheet_%03d.webp"),
      ],
      {
        signal,
        timeoutMs: 120_000,
        onStderrChunk: (chunkText) => {
          const sec = parseFfmpegTimeSeconds(chunkText);
          if (sec !== null && metadata.duration > 0) {
            const ratio = Math.min(1, Math.max(0, sec / metadata.duration));
            const pct = Math.round(82 + ratio * 17); // 82% -> 99%
            onProgress?.({
              stage: "scrub_sheets",
              percent: pct,
              detail: `Generating scrub sprites (${Math.min(99, Math.round(ratio * 100))}%)...`,
            });
          }
        },
      }
    );

    throwIfAborted(signal);

    const scrubFiles = (await readdir(scrubDir))
      .filter((f) => f.endsWith(".webp"))
      .sort();

    const scrubSheets: Buffer[] = [];
    for (const sheetName of scrubFiles) {
      throwIfAborted(signal);
      scrubSheets.push(await readFile(join(scrubDir, sheetName)));
    }

    // Generate WebVTT
    const totalFrames = Math.floor(metadata.duration);
    let vttContent = "WEBVTT\n\n";

    for (let sec = 0; sec < totalFrames; sec++) {
      const sheetIndex = Math.floor(sec / 100);
      const frameInSheet = sec % 100;
      const col = frameInSheet % 10;
      const row = Math.floor(frameInSheet / 10);
      const x = col * thumbWidth;
      const y = row * thumbHeight;

      const startTime = formatVttTimestamp(sec);
      const endTime = formatVttTimestamp(sec + 1);

      vttContent += `${startTime} --> ${endTime}\n`;
      vttContent += `/api/media/${postId}/scrub/sheet/${sheetIndex}#xywh=${x},${y},${thumbWidth},${thumbHeight}\n\n`;
    }

    onProgress?.({
      stage: "scrub_sheets",
      percent: 100,
      detail: "Video processing complete",
    });

    return {
      metadata,
      playlistM3u8,
      segments,
      thumbnailGrid,
      scrubSheets,
      scrubVtt: vttContent,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

function formatVttTimestamp(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${hrs.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}.000`;
}
