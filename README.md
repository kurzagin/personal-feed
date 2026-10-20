# Personal Feed

A private, self-hosted personal discovery feed built with Bun, ElysiaJS, SQLite, and Cloudflare R2 featuring zero-knowledge client-side encryption, video segmentation, thumbnail grids, and interactive scrubbing.

---

## Architecture Highlights

1. **Storage & Zero-Knowledge E2EE (AES-256-GCM)**:
   - Chunked symmetric encryption (2MB chunks) for monolithic media.
   - For video: automated 480p HLS segmentation (3-second chunks) capped at a maximum of 200MB.
   - 3x3 keyframe preview grid thumbnail and 1-second interval scrubbing sprite sheets with WebVTT coordinates.
   - All assets uploaded to Cloudflare R2 are encrypted blind blobs (.enc). Cloudflare R2 never sees raw video, playlists, keys, or metadata.
   - Content keys are wrapped locally with an scrypt-derived Master Key.

2. **Database & Normalized Danbooru Taxonomy**:
   - bun:sqlite in WAL mode with foreign keys.
   - Standard Danbooru categories: artist, character, copyright, general, meta.

3. **Two-Stage Recommendation Engine**:
   - **Candidate Selection**: Retrieval pool with active fatigue filtering.
   - **Multi-Objective Scoring**:
     - Dynamic user tag affinity computed from watch_sessions.
     - Exponential time decay (half-life = 7 days).
     - Loop boost (>1.0 completion rate), quick-skip penalty (<3s), and dwell time for photo sets.
     - Fatigue damping (avoids repeat content within 48h).
     - Format interleaving (prevents clustering of long videos).

4. **Web Client (Mobile-Focused)**:
   - Vertical snap feed container (scroll-snap-type: y mandatory).
   - Dynamic ambient blurred backdrop for horizontal media.
   - HLS streaming player with hls.js and native iOS/Safari fallback.
   - 1-second interval thumbnail preview bubble while scrubbing seekbar.
   - Carousel support for multi-item posts.
   - Tagging and ingestion modal.

---

## Quickstart

### 1. Configure Cloudflare R2 (Optional, defaults to local encrypted mock storage)
Copy `.env.example` to `.env.local` or set environment variables:
```bash
export R2_ACCOUNT_ID="your_account_id"
export R2_ACCESS_KEY_ID="your_key_id"
export R2_SECRET_ACCESS_KEY="your_secret_key"
export R2_BUCKET="your-bucket-name"
export APP_MASTER_PASSPHRASE="your-secure-passphrase"
export APP_MASTER_SALT="your-unique-salt-constant"
```

### 2. Run the Daemon
```bash
bun dev:server
```
The server daemon and web client will be live at `http://localhost:3001`.
