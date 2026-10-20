# Private Personal Feed — System Architecture & Roadmap Document

A self-hosted, personal discovery feed built with **Bun**, **ElysiaJS**, **SQLite (WAL)**, and **Cloudflare R2** featuring **zero-knowledge end-to-end chunked encryption**, a **normalized Danbooru tagging system**, and a **two-stage recommendation engine**.

---

## 1. System Topology & Architecture

```mermaid
flowchart TD
    subgraph Client [Web Client (React / Vite)]
        FeedUI[Vertical Snap Feed Container]
        Player[Adaptive Player / Ambient Glow]
        Scrubber[Seek Scrubber for 1h+ Videos]
        UploadUI[Dedicated Ingest & Tagging View]
        Nav[Fixed Bottom Navigation Bar]
    end

    subgraph Daemon [Local Bun + ElysiaJS Daemon :3001]
        MediaRoute["/api/media/:id/stream (HTTP Range Decryptor)"]
        FeedRoute["/api/feed (Two-Stage Ranker)"]
        SessionRoute["/api/session (Telemetry Logger)"]
        UploadRoute["/api/ingest (Chunker & Encryptor)"]
        
        CryptoEngine[BoringSSL / AES-256-GCM Chunker]
        RankerEngine[Dynamic Tag Affinity & Fatigue Ranker]
    end

    subgraph Storage [Encrypted Cloud Storage]
        R2[Cloudflare R2 Bucket]
        LocalStorage[Local Fallback .local_storage]
    end

    subgraph Database [Local Normalized SQLite (WAL Mode)]
        TPosts[(posts)]
        TTags[(tags)]
        TPostTags[(post_tags)]
        TSessions[(watch_sessions)]
    end

    FeedUI -->|GET /api/feed| FeedRoute
    Player -->|Range: bytes=X-Y| MediaRoute
    FeedUI -->|POST /api/session| SessionRoute
    UploadUI -->|POST /api/ingest| UploadRoute

    MediaRoute --> CryptoEngine
    UploadRoute --> CryptoEngine
    FeedRoute --> RankerEngine

    CryptoEngine <-->|Range Fetch / Put 2MB Blobs| R2
    CryptoEngine <-->|Local Fallback| LocalStorage

    RankerEngine <--> Database
    MediaRoute <--> Database
    UploadRoute <--> Database
    SessionRoute <--> Database
```

---

## 2. Cryptographic Protocol (Chunked Client-Side E2EE)

Because Cloudflare R2 is public cloud storage and files can be 1h+ long videos (~200MB+), files are **never encrypted or decrypted as a single monolithic block**.

### Key Hierarchy
1. **Master Key ($K_{master}$)**:
   * Derived from a user passphrase and a salt constant using `scrypt` ($N=16384, r=8, p=1$).
   * Never leaves the local host.
2. **Content Encryption Key ($K_{content}$)**:
   * A cryptographically secure random 256-bit key (`randomBytes(32)`) generated per upload.
   * Wrapped (encrypted) with $K_{master}$ using AES-256-GCM and stored in the SQLite `posts.encrypted_key` column.

### Chunked File Layout
* Target chunk size: **2 MB (2,097,152 bytes)**.
* Each chunk $i$ ($0, 1, 2, \dots, N-1$) is encrypted independently with AES-256-GCM:
  $$\text{IV}_i = \text{BaseIV} \oplus i$$
  $$\text{AAD}_i = \text{uint32\_be}(i)$$
  $$\text{Ciphertext}_i = \text{AES-GCM-Encrypt}(K_{content}, \text{IV}_i, \text{Chunk}_i, \text{AAD}_i)$$
* Output stored on R2:
  $$\underbrace{[\text{Ciphertext}_0, \text{Tag}_0]}_{2\text{MB} + 16\text{B}} \;\; \underbrace{[\text{Ciphertext}_1, \text{Tag}_1]}_{2\text{MB} + 16\text{B}} \;\; \dots \;\; \underbrace{[\text{Ciphertext}_{N-1}, \text{Tag}_{N-1}]}_{\le 2\text{MB} + 16\text{B}}$$

### On-the-Fly Range Decryption Flow
1. HTML5 Video Player requests: `Range: bytes=10485760-12582911` (byte offset inside the plain file).
2. Daemon calculates:
   * Starting chunk: $\lfloor 10485760 / 2097152 \rfloor = \text{Chunk } 5$.
   * Byte offset in R2 encrypted file: $5 \times (2097152 + 16)$.
3. Daemon issues an S3 Range Request to R2 for only the requested chunk(s).
4. Daemon decrypts the chunks in memory via AES-NI hardware acceleration and slices the exact requested byte window.
5. Returns an HTTP `206 Partial Content` stream to the browser.
* **Memory impact**: Under 10MB of RAM regardless of video length.

---

## 3. Normalized Database Schema (Danbooru Taxonomy)

The database runs in SQLite with **Write-Ahead Logging (WAL)** enabled for zero read/write blocking.

```sql
-- 1. Media Entities
CREATE TABLE posts (
    id TEXT PRIMARY KEY,                 -- Chronologically sortable ULID
    media_type TEXT NOT NULL,            -- 'short_video', 'long_video', 'cosplay_set', 'anime_art'
    duration_seconds REAL,               -- NULL for static images/galleries
    aspect_ratio REAL NOT NULL,          -- width / height (e.g., 0.5625 for 9:16, 1.777 for 16:9)
    page_count INTEGER DEFAULT 1,        -- For multi-image cosplay/art sets
    r2_storage_key TEXT NOT NULL,        -- e.g., 'media/01M5B9...enc'
    encrypted_key TEXT NOT NULL,         -- Base64 CEK wrapped with Master Key
    content_hash TEXT UNIQUE NOT NULL,   -- SHA-256 of plain content (deduplication)
    created_at INTEGER NOT NULL,         -- Epoch timestamp in ms
    rating TEXT DEFAULT 'general'        -- 'general', 'sensitive', 'questionable', 'explicit'
);

-- 2. Danbooru Tags (Normalized)
CREATE TABLE tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,           -- e.g. 'raiden_shogun', 'frieren', 'wlop'
    category TEXT NOT NULL               -- 'artist', 'character', 'copyright', 'general', 'meta'
);

-- 3. Many-to-Many Tag Mapping
CREATE TABLE post_tags (
    post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (post_id, tag_id)
);
CREATE INDEX idx_post_tags_tag_id ON post_tags(tag_id);

-- 4. Behavioral Telemetry (Algorithm Fuel)
CREATE TABLE watch_sessions (
    id TEXT PRIMARY KEY,
    post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    started_at INTEGER NOT NULL,
    watch_duration_seconds REAL NOT NULL,
    completion_rate REAL NOT NULL,       -- watch_duration / total_duration (can exceed 1.0 for loops)
    interacted_favorite INTEGER DEFAULT 0,
    interacted_skipped INTEGER DEFAULT 0,-- Skipped within 2-3 seconds
    interacted_dwell_ms INTEGER,         -- Gallery viewing time
    last_position_seconds REAL           -- Resumption pointer for 1h+ videos
);
CREATE INDEX idx_watch_sessions_post ON watch_sessions(post_id);
CREATE INDEX idx_watch_sessions_time ON watch_sessions(started_at);
```

---

## 4. The Recommendation Engine (Two-Stage Ranking)

Instead of naive random sorting or chronological feeds, the engine computes a dynamic, personalized affinity score for every post.

### Stage 1: Candidate Retrieval & Filtering
* Excludes hard-fatigued items (items watched within the last 6 hours).
* Pulls candidates matching active interest clusters plus an exploratory candidate pool.

### Stage 2: Scoring Formula
For each candidate post $P$:
$$Score(P) = \sum_{t \in \text{Tags}(P)} \text{Affinity}(t) + \text{ExplorationBonus}(P) - \text{FatiguePenalty}(P) + \text{Jitter}$$

#### Dynamic Tag Affinity with Exponential Decay
Given a half-life $t_{1/2} = 7\text{ days}$ ($\lambda = \frac{\ln 2}{7 \times 86400}$):
$$\text{Affinity}(t) = \sum_{s \in \text{Sessions}(t)} W(s) \cdot e^{-\lambda (t_{now} - t_s)}$$

Where session weight $W(s)$ is:
* $\mathbf{+4.0}$ for Favorited (`interacted_favorite = 1`)
* $\mathbf{+3.0}$ for Looping (`completion_rate \ge 1.0`)
* $\mathbf{+2.0}$ for High Dwell on Art/Cosplay (`dwell_ms > 5000`)
* $\mathbf{-3.0}$ for Quick Skip (`duration < 3.0s`)

#### Fatigue Damping
* Seen within 6 hours: $-100.0$ (hard block)
* Seen within 48 hours: $-20.0$
* Seen within 7 days: $-5.0$
* Never seen: $+5.0$ (fresh discovery bonus)

#### Format Interleaving
* Ensures long videos (>3 min to 1h+) do not cluster consecutively; limits long formats to at most 1 every 3 feed items.

---

## 5. Media Ingestion & Transcoding Standards

Before encryption and upload to R2, media is normalized to mobile-first standards:

### Video Standard: MP4 (H.264 + AAC, 480p/720p)
```bash
ffmpeg -i input_video.mkv \
  -vf "scale='min(720,iw)':-2" \
  -c:v libx264 -preset slow -crf 24 \
  -maxrate 1.8M -bufsize 3.6M \
  -c:a aac -b:a 128k \
  -movflags +faststart \
  output.mp4
```
* **`-movflags +faststart`**: **Essential**. Moves the `moov` atom header to the beginning of the file so chunk 0 contains the entire index table, allowing instant streaming and seeking without downloading intermediate chunks.

### Image Standard: AVIF (Cosplay Sets / Anime Art)
```bash
ffmpeg -i input_photo.jpg -c:v libsvtav1 -crf 28 -pix_fmt yuv420p output.avif
```
* Compresses raw DSLR photos (15MB+) to ~500KB–800KB with visually lossless fidelity.

---

## 6. Web Interface Design (Clean, Premium, Hashtag-Free)

* **Viewport**: Fullscreen fixed viewport (`fixed inset-0 overflow-hidden`) with mobile viewport emulation on desktop (`max-w-md mx-auto`).
* **Feed Display**:
  * Pure media view with **zero floating hashtags or category badges**.
  * Dynamic blurred ambient glow behind 16:9 horizontal videos to fill vertical viewports seamlessly.
  * Sleek progress scrubber for long videos with timestamp indicators.
* **Controls**:
  * Subtle frosted glass floating actions (Like `Heart`, Mute toggle).
* **Navigation**:
  * Fixed bottom bar (`fixed bottom-0 z-50 bg-black/95 border-t border-zinc-900`) with:
    1. **Feed (`Home`)**: Direct vertical scroll feed.
    2. **Center Action (`+`)**: Accent button transitioning to the dedicated ingest view.
    3. **Explore (`Compass`)**: One-tap discovery refresh and smooth scroll to top.
* **Upload View**:
  * Dedicated full-screen view replacing intrusive popups/modals.
  * Drag-and-drop file picking.
  * Private Danbooru tag category inputs (`character`, `artist`, `copyright`, `general`, `meta`).

---

## 7. Cloudflare R2 Production Deployment Guide

To switch from local mock storage to Cloudflare R2:

1. In the Cloudflare Dashboard, create an R2 bucket (e.g. `personal-feed-encrypted`).
2. Generate an **R2 API Token** with `Object Read & Write` permissions.
3. Create a `.env` file at the root:
   ```env
   R2_ACCOUNT_ID="your_cloudflare_account_id"
   R2_ACCESS_KEY_ID="your_r2_access_key_id"
   R2_SECRET_ACCESS_KEY="your_r2_secret_access_key"
   R2_BUCKET="personal-feed-encrypted"
   APP_MASTER_PASSPHRASE="your_secure_passphrase"
   ```
4. Run the daemon:
   ```bash
   bun apps/server/src/index.ts
   ```
5. Access the feed in any browser at `http://localhost:3001` (or your local LAN IP / Tailscale IP for mobile access).
