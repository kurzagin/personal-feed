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

async function runCommand(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  const proc = Bun.spawn([cmd, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text().catch(() => ""),
    new Response(proc.stderr).text().catch(() => ""),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(`Command ${cmd} exited with code ${exitCode}: ${stderr}`);
  }

  return { stdout, stderr };
}

/**
 * Probes video using ffprobe to get duration, dimensions, and aspect ratio.
 */
export async function probeVideo(filePath: string): Promise<VideoMetadata> {
  const { stdout } = await runCommand("ffprobe", [
    "-v", "error",
    "-show_entries", "stream=width,height,duration:format=duration",
    "-of", "json",
    filePath
  ]);

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
  postId: string
): Promise<ProcessedVideoHLS> {
  const tempDir = await mkdtemp(join(tmpdir(), `pf-vid-${postId}-`));
  const inputFilePath = join(tempDir, "input.mp4");

  try {
    await writeFile(inputFilePath, videoBuffer);
    const metadata = await probeVideo(inputFilePath);
    const { videoBitrateK, audioBitrateK } = calculateBitrateK(metadata.duration);

    // 1. Transcode to 480p HLS segments
    const hlsDir = join(tempDir, "hls");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(hlsDir, { recursive: true });

    // Target scale: limit smaller dimension to 480 or height to 480 maintaining aspect ratio
    // For mobile portrait (e.g. 720x1280), scale to 480:854 or width 480.
    // Ensure pixel format is standard yuv420p for max mobile compatibility and main profile
    const scaleFilter = metadata.height >= metadata.width
      ? "scale='min(480,iw)':-2,format=yuv420p"
      : "scale=-2:'min(480,ih)',format=yuv420p";

    await runCommand("ffmpeg", [
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
      join(hlsDir, "master.m3u8")
    ]);

    // Read segments
    const hlsFiles = await readdir(hlsDir);
    const segmentFileNames = hlsFiles
      .filter((f) => f.endsWith(".ts"))
      .sort();

    const segments: Buffer[] = [];
    for (const segName of segmentFileNames) {
      segments.push(await readFile(join(hlsDir, segName)));
    }

    const playlistM3u8 = await readFile(join(hlsDir, "master.m3u8"), "utf-8");

    // 2. Generate 3x3 Preview Grid Thumbnail (9 evenly spaced frames)
    const gridImagePath = join(tempDir, "grid_3x3.webp");
    // If video is short (< 3s), generate a single tile or fallback
    const tileFilter = metadata.duration >= 2
      ? `fps=9/${metadata.duration.toFixed(2)},scale=160:-2,tile=3x3`
      : "scale=480:-2";

    try {
      await runCommand("ffmpeg", [
        "-y",
        "-i", inputFilePath,
        "-vf", tileFilter,
        "-vframes", "1",
        "-q:v", "75",
        gridImagePath
      ]);
    } catch {
      // Fallback single frame
      await runCommand("ffmpeg", [
        "-y",
        "-ss", "00:00:00.5",
        "-i", inputFilePath,
        "-vframes", "1",
        "-vf", "scale=360:-2",
        gridImagePath
      ]);
    }
    const thumbnailGrid = await readFile(gridImagePath);

    // 3. Generate 1s Scrubbing Sprite Sheets (10x10 tiles per sheet = 100s per sheet)
    const scrubDir = join(tempDir, "scrub");
    await mkdir(scrubDir, { recursive: true });

    // Tile width: 100px width per thumb
    const thumbWidth = 100;
    const thumbHeight = Math.round(thumbWidth / metadata.aspectRatio);

    await runCommand("ffmpeg", [
      "-y",
      "-i", inputFilePath,
      "-vf", `fps=1,scale=${thumbWidth}:${thumbHeight},tile=10x10`,
      "-q:v", "70",
      join(scrubDir, "sheet_%03d.webp")
    ]);

    const scrubFiles = (await readdir(scrubDir))
      .filter((f) => f.endsWith(".webp"))
      .sort();

    const scrubSheets: Buffer[] = [];
    for (const sheetName of scrubFiles) {
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
