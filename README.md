# Personal Feed 

A private, self-hosted TikTok-style personal feed built with **Bun**, **ElysiaJS**, **SQLite**, and **Cloudflare R2** with end-to-end client-side chunked encryption.

---

## 🛠️ Architecture Highlights

1. **Storage & E2EE (ChaCha20-Poly1305 / AES-256-GCM)**:
   - Chunked symmetric encryption (2MB chunks).
   - Content keys are wrapped with an Argon2id/scrypt-derived Master Key.
   - HTTP `Range` requests dynamically fetch only the required chunks from Cloudflare R2 and decrypt on-the-fly with hardware acceleration (Status `206 Partial Content`).
   - Zero memory bloat even for 1h+ videos.

2. **Database & Normalized Danbooru Taxonomy**:
   - `bun:sqlite` in WAL mode with foreign keys.
   - Standard Danbooru categories: `artist`, `character`, `copyright`, `general`, `meta`.

3. **Two-Stage Recommendation Engine**:
   - **Candidate Selection**: Retrieval pool with active fatigue filtering.
   - **Multi-Objective Scoring**:
     - Dynamic user tag affinity computed from `watch_sessions`.
     - Exponential decay ($t_{1/2} = 7$ days).
     - Loop boost (>1.0 completion rate), quick-skip penalty (<3s), and dwell time for photo sets.
     - Fatigue damping (avoids repeat content within 48h).
     - Format interleaving (prevents clustering of long videos).

4. **Web Client (Ready for Expo Mobile)**:
   - TikTok-style vertical snap scrolling (`scroll-snap-type: y mandatory`).
   - Ambient blurred backdrop for 16:9 horizontal videos.
   - Real-time scrubbing progress bar for 1h+ videos.
   - Cosplay & anime art presentation cards.
   - Interactive manual Danbooru tagging and ingestion modal.

---

## 🚀 Quickstart

### 1. Configure Cloudflare R2 (Optional, defaults to local encrypted mock storage)
Set environment variables if connecting directly to Cloudflare R2:
```bash
export R2_ACCOUNT_ID="your_account_id"
export R2_ACCESS_KEY_ID="your_key_id"
export R2_SECRET_ACCESS_KEY="your_secret_key"
export R2_BUCKET="your-bucket-name"
export APP_MASTER_PASSPHRASE="your-secure-passphrase"
```

### 2. Run the Daemon
```bash
bun apps/server/src/index.ts
```
The server daemon and web client will be live at `http://localhost:3001`.
