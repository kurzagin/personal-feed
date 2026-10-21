# Personal Feed

A private, self-hosted personal discovery feed built with Bun, ElysiaJS, SQLite (WAL), and Cloudflare R2 featuring zero-knowledge client-side encryption, automated HLS video segmentation, thumbnail sprite grids, and an advanced two-stage recommendation engine.

---

## Architecture Highlights

1. **Storage & Zero-Knowledge E2EE (AES-256-GCM)**:
   - Chunked symmetric encryption (2MB chunks) for monolithic media and on-the-fly HTTP Range decryption.
   - For video: automated 480p HLS segmentation (3-second chunks) capped at a maximum of 200MB.
   - 3x3 keyframe preview grid thumbnail and 1-second interval scrubbing sprite sheets with WebVTT coordinates.
   - All assets uploaded to Cloudflare R2 are encrypted blind blobs (`.enc`). Cloudflare R2 never sees raw video, playlists, keys, or metadata.
   - Content keys are wrapped locally with an scrypt-derived Master Key.

2. **Database & Normalized Danbooru Taxonomy**:
   - `bun:sqlite` in WAL mode with cascading foreign keys.
   - Standard Danbooru categories: `artist`, `character`, `copyright`, `general`, `meta`.
   - Rich interaction telemetry in `watch_sessions` (dwell time, completion rate, loop counts, carousel swipe depth, audio unmute, and skip flags).

3. **Recommendation Engine (Two-Stage Ranking & Reranking)**:
   - **Multi-Signal Engagement Calibration**:
     - *Video*: Completion rate, loop count (up to +5.0 weight for repeated loops), and audio unmute (+1.0).
     - *Images & Carousels*: Multi-tiered dwell time (>8s: +4.0, >3s: +2.0) and carousel swipe depth (>0.6: +1.5).
   - **Intelligent Skip Attribution**: Fast skips on items with established favorite tags (≥3 positive interactions) receive a gentle soft penalty (-0.5) instead of a harsh penalty (-3.0), preserving core interests while filtering nuisances.
   - **Circadian Context**: Dynamic 1.25× affinity multiplier for sessions matching the current browsing time window (±3 hours).
   - **Tag Co-Occurrence Propagation**: Diffuses 15% positive affinity across co-occurring tags in the graph to discover related content proactively.
   - **TF-IDF & Category Weighting**: Category affinity multipliers (`artist: 3.5`, `character: 2.5`, `copyright: 2.0`, `general: 1.0`, `meta: 0.5`) combined with IDF tag damping to prioritize rare, high-intent tags over generic descriptors (e.g. `solo`, `1girl`).
   - **UCB1 Bandit Exploration**: Upper Confidence Bound formula ($c \cdot \sqrt{\frac{\ln N}{n_i + 1}}$) ensures fresh and under-explored posts get fair exposure.
   - **Multi-Tier Fatigue Damping**: Blocks items seen within 6h (-100), with decaying penalties up to 7 days.
   - **MMR (Maximal Marginal Relevance) Diversity Reranking**: Balances item relevance with post-to-post tag vector diversity ($\lambda = 0.72$) and format interleaving to prevent content fatigue or tag clustering.

4. **Web Client (Mobile-Focused)**:
   - Vertical snap feed container (`scroll-snap-type: y mandatory`).
   - Dynamic ambient blurred backdrop for horizontal media.
   - HLS streaming player with `hls.js` and native iOS/Safari fallback.
   - 1-second interval thumbnail preview bubble while scrubbing seekbar.
   - Carousel support for multi-item posts with swipe tracking.
   - Tagging and ingestion view with Danbooru category prefixes (`artist:`, `character:`, `copyright:`, etc.).

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

---

## Database Sync & Migration Across Devices

You can safely sync or migrate your SQLite database to another device via Cloudflare R2 with full zero-knowledge encryption (AES-256-GCM).

### Push Database (Current Device)
Creates a consistent snapshot (WAL checkpointed via `VACUUM INTO`), encrypts it with your master key, and uploads it to R2:
```bash
bun run db:push
```

### Pull Database (New Device)
Downloads the encrypted backup from R2, verifies cryptographic integrity with your master key, runs SQLite integrity checks, and restores `personal_feed.db` (automatically backing up any existing local copy first):
```bash
bun run db:pull
```

> **Note**: Both devices must share the same `APP_MASTER_PASSPHRASE` and `APP_MASTER_SALT` in `.env.local` to decrypt the database.

