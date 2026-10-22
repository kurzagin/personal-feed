import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { ulid } from "ulid";

export interface ExtractedMediaItem {
  filename: string;
  filePath: string;
  mimeType: string;
  buffer?: Buffer;
}

export interface UrlDownloadResult {
  title?: string;
  description?: string;
  tags: string[];
  author?: string;
  items: ExtractedMediaItem[];
  cleanup: () => Promise<void>;
}

function runCommand(
  cmd: string,
  args: string[],
  options?: {
    cwd?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
    onOutput?: (line: string) => void;
  }
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    const proc = spawn(cmd, args, {
      cwd: options?.cwd,
      signal: options?.signal,
    });

    const timer = options?.timeoutMs
      ? setTimeout(() => {
          try {
            proc.kill("SIGKILL");
          } catch {}
        }, options.timeoutMs)
      : null;

    proc.stdout.on("data", (data) => {
      const str = data.toString();
      stdout += str;
      if (options?.onOutput) {
        options.onOutput(str.trim());
      }
    });

    proc.stderr.on("data", (data) => {
      const str = data.toString();
      stderr += str;
      if (options?.onOutput) {
        options.onOutput(str.trim());
      }
    });

    proc.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });

    proc.on("error", (err) => {
      if (timer) clearTimeout(timer);
      resolve({ stdout, stderr: stderr + `\n${err.message}`, exitCode: 1 });
    });
  });
}

function detectMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".avif":
      return "image/avif";
    case ".mp4":
      return "video/mp4";
    case ".webm":
      return "video/webm";
    case ".mov":
      return "video/quicktime";
    case ".m4v":
      return "video/x-m4v";
    case ".mkv":
      return "video/x-matroska";
    default:
      return "application/octet-stream";
  }
}

/**
 * Validates that a URL is a safe external HTTP(S) URL and blocks SSRF targets
 * (loopback, link-local, private LAN IPs, non-HTTP protocols, and CLI flag prefixes).
 */
export function validateExternalMediaUrl(rawUrl: string): URL {
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.startsWith("-")) {
    throw new Error("Invalid URL format");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Invalid URL format");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http:// and https:// URLs are supported");
  }

  if (parsed.username || parsed.password) {
    throw new Error("URLs with embedded credentials are not allowed");
  }

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host === "::" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
    /^fe80:/i.test(host) ||
    /^f[cd][0-9a-f]{2}:/i.test(host)
  ) {
    throw new Error("Local, private, or internal network URLs are not allowed");
  }

  return parsed;
}

/**
 * Downloads media from URL (X/Twitter, YouTube, direct media URLs) using gallery-dl or yt-dlp.
 */
export async function downloadMediaFromUrl(
  targetUrl: string,
  options?: {
    signal?: AbortSignal;
    onProgress?: (msg: string) => void;
  }
): Promise<UrlDownloadResult> {
  const validatedUrl = validateExternalMediaUrl(targetUrl).toString();
  const tempDir = path.join(os.tmpdir(), `pf_url_${ulid()}`);
  await fs.mkdir(tempDir, { recursive: true, mode: 0o700 });

  const cleanup = async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {}
  };

  const isTwitter = /x\.com|twitter\.com/i.test(validatedUrl);
  let metadata: { title?: string; description?: string; tags: string[]; author?: string } = {
    tags: [],
  };

  const twitterAuthToken = process.env.X_AUTH_TOKEN || process.env.TWITTER_AUTH_TOKEN;
  const twitterCookiesPath = process.env.TWITTER_COOKIES_PATH || process.env.X_COOKIES_PATH;

  let downloadedFiles: string[] = [];

  const findFiles = async (dir: string): Promise<string[]> => {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    let files: string[] = [];
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files = files.concat(await findFiles(fullPath));
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
    return files;
  };

  // Strategy 1: Attempt gallery-dl with strict timeout so it never hangs
  options?.onProgress?.("Probing URL with gallery-dl extractor...");
  const galleryDlArgs = ["--destination", tempDir, "--http-timeout", "10"];

  if (twitterCookiesPath) {
    galleryDlArgs.push("--cookies", twitterCookiesPath);
  } else if (twitterAuthToken) {
    galleryDlArgs.push("-o", `auth_token=${twitterAuthToken}`);
  }

  galleryDlArgs.push("--", validatedUrl);

  await runCommand("gallery-dl", galleryDlArgs, {
    cwd: tempDir,
    timeoutMs: 15_000, // max 15s before fallback
    signal: options?.signal,
    onOutput: (out) => {
      const firstLine = out.split("\n")[0];
      if (firstLine) options?.onProgress?.(`gallery-dl: ${firstLine.slice(0, 70)}`);
    },
  });

  downloadedFiles = await findFiles(tempDir);

  // Strategy 2: If gallery-dl got no files or failed, try yt-dlp (fast fallback with strict socket timeout)
  if (downloadedFiles.length === 0) {
    options?.onProgress?.("Checking media streams with yt-dlp...");
    const ytDlpArgs = [
      "--no-playlist",
      "--no-exec",
      "--socket-timeout",
      "10",
      "-f",
      "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
      "-o",
      path.join(tempDir, "%(id)s.%(ext)s"),
      "--write-info-json",
    ];

    if (twitterCookiesPath) {
      ytDlpArgs.push("--cookies", twitterCookiesPath);
    }

    ytDlpArgs.push("--", validatedUrl);

    await runCommand("yt-dlp", ytDlpArgs, {
      cwd: tempDir,
      timeoutMs: 25_000,
      signal: options?.signal,
      onOutput: (out) => {
        const firstLine = out.split("\n")[0];
        if (firstLine) options?.onProgress?.(`yt-dlp: ${firstLine.slice(0, 70)}`);
      },
    });

    downloadedFiles = await findFiles(tempDir);
  }

  // Strategy 3: If still no files and it's an X/Twitter URL, try lightweight API resolver (unless disabled for strict privacy)
  if (downloadedFiles.length === 0 && isTwitter && process.env.DISABLE_VXTWITTER_FALLBACK !== "1") {
    options?.onProgress?.("Resolving X/Twitter post metadata via direct API...");
    const statusMatch = validatedUrl.match(/status\/(\d+)/i);
    if (statusMatch) {
      const statusId = statusMatch[1];
      try {
        const apiUrl = `https://api.vxtwitter.com/Twitter/status/${statusId}`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 6000);

        const resp = await fetch(apiUrl, {
          headers: { "User-Agent": "TelegramBot (like TwitterBot)" },
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (resp.ok) {
          const data = (await resp.json()) as any;
          if (data && data.text) {
            metadata.description = data.text;
            if (data.user_name) metadata.author = data.user_name;
            if (Array.isArray(data.hashtags)) {
              metadata.tags = data.hashtags;
            }
          }
          const mediaUrls: string[] = [];
          if (Array.isArray(data.media_extended)) {
            for (const m of data.media_extended) {
              if (m.url) mediaUrls.push(m.url);
            }
          } else if (Array.isArray(data.mediaURLs)) {
            mediaUrls.push(...data.mediaURLs);
          }

          if (mediaUrls.length > 0) {
            options?.onProgress?.(`Downloading ${mediaUrls.length} media file(s) from X...`);
          }

          for (let i = 0; i < mediaUrls.length; i++) {
            const mUrl = validateExternalMediaUrl(mediaUrls[i]).toString();
            options?.onProgress?.(`Downloading item ${i + 1}/${mediaUrls.length}...`);
            const fileResp = await fetch(mUrl, { signal: options?.signal });
            if (fileResp.ok) {
              const arrayBuf = await fileResp.arrayBuffer();
              const ext = mUrl.includes(".mp4") ? ".mp4" : ".jpg";
              const outPath = path.join(tempDir, `x_media_${i}${ext}`);
              await fs.writeFile(outPath, Buffer.from(arrayBuf), { mode: 0o600 });
              downloadedFiles.push(outPath);
            }
          }
        }
      } catch (err: any) {
        console.warn("Direct X media resolver error:", err?.message);
      }
    }
  }

  // Filter out any metadata JSON or non-media temp files
  const mediaFiles = downloadedFiles.filter((f) => {
    const ext = path.extname(f).toLowerCase();
    return [
      ".jpg",
      ".jpeg",
      ".png",
      ".webp",
      ".gif",
      ".avif",
      ".mp4",
      ".webm",
      ".mov",
      ".m4v",
    ].includes(ext);
  });

  if (mediaFiles.length === 0) {
    await cleanup();
    throw new Error(
      "Could not extract any image or video from the provided URL. Make sure the post is public and contains media."
    );
  }

  // Look for any info.json to harvest post tags & description
  const infoJsonFile = downloadedFiles.find((f) => f.endsWith(".info.json"));
  if (infoJsonFile) {
    try {
      const raw = await fs.readFile(infoJsonFile, "utf-8");
      const info = JSON.parse(raw);
      if (info.title) metadata.title = info.title;
      if (info.description) metadata.description = info.description;
      if (info.uploader || info.channel) metadata.author = info.uploader || info.channel;
      if (Array.isArray(info.tags)) {
        metadata.tags = [...new Set([...metadata.tags, ...info.tags])];
      }
    } catch {}
  }

  // Auto-extract hashtags from text description if tags are empty
  if (metadata.description && metadata.tags.length === 0) {
    const matches = metadata.description.match(/#([a-zA-Z0-9_\u0080-\uffff]+)/g);
    if (matches) {
      metadata.tags = matches.map((t) => t.replace(/^#/, ""));
    }
  }

  const items: ExtractedMediaItem[] = [];
  for (const mPath of mediaFiles) {
    const mime = detectMimeType(mPath);
    items.push({
      filename: path.basename(mPath),
      filePath: mPath,
      mimeType: mime,
    });
  }

  return {
    ...metadata,
    items,
    cleanup,
  };
}
