# live-captions-yt

## Overview

Monorepo for **LCYT** — a full-featured platform for sending live captions to YouTube Live via Google's HTTP POST caption ingestion API. Ships as a Node.js library + CLI, Python library, Express/Flask relay backends, a browser web UI, a Model Context Protocol (MCP) server for AI assistant integration, a DSK graphics overlay system, a production control layer for cameras/mixers, a bridge agent for AV hardware, server-side speech-to-text transcription, and a compute orchestration layer for horizontal scaling.

---

## Repository Structure

```
live-captions-yt/
├── packages/                   # Node.js workspace packages (npm workspaces)
│   ├── lcyt/                   # Core library (published to npm as `lcyt`)
│   ├── lcyt-cli/               # CLI tool (published to npm as `lcyt-cli`)
│   ├── lcyt-backend/           # Express.js HTTP relay backend
│   ├── lcyt-bridge/            # Production control bridge agent (TCP relay to AMX/Roland)
│   ├── lcyt-mcp-stdio/         # MCP server (stdio transport)
│   ├── lcyt-mcp-sse/           # MCP server (HTTP SSE transport)
│   ├── lcyt-site/              # Marketing/docs website (Astro)
│   ├── lcyt-web/               # Browser-based web UI (Vite + React + wouter)
│   ├── lcyt-orchestrator/      # Compute orchestrator — worker registration, job dispatch, Hetzner autoscaling
│   ├── lcyt-worker-daemon/     # Minimal worker daemon — ffmpeg job orchestration, S3 upload
│   ├── tools/                  # Standalone utilities
│   │   └── tcp-echo-server/    # TCP echo server for bridge connection testing
│   └── plugins/                # Plugin packages (npm workspaces glob: packages/plugins/*)
│       ├── lcyt-agent/         # AI Agent plugin (AI config, embeddings, LLM event evaluation)
│       ├── lcyt-cues/          # Cue Engine plugin (phrase/fuzzy/semantic/event cue matching)
│       ├── lcyt-dsk/           # DSK graphics plugin (Playwright renderer, templates, overlays)
│       ├── lcyt-files/         # Caption file storage plugin (local FS + S3 + WebDAV adapters)
│       ├── lcyt-production/    # Production control library (cameras, mixers, bridge)
│       └── lcyt-rtmp/          # RTMP relay plugin (HLS, radio, preview, STT, caption injection)
├── python-packages/            # Python packages
│   ├── lcyt/                   # Core Python library (published to PyPI as `lcyt`)
│   ├── lcyt-backend/           # Flask backend (cPanel/Passenger compatible)
│   └── lcyt-mcp/               # Python MCP server
├── android/                    # Native Android apps
│   └── lcyt-tv/                # Android TV caption viewer (Kotlin + Compose for TV)
├── docker/                     # Docker build contexts for containerised services
│   ├── lcyt-ffmpeg/            # ffmpeg Docker image (used by DockerFfmpegRunner)
│   ├── lcyt-dsk-renderer/      # Chromium DSK renderer Docker image
│   └── mediamtx.yml            # MediaMTX configuration template
├── ops/                        # Operational runbooks
│   └── runbooks/               # Deployment and maintenance runbooks
├── ci/                         # CI helper scripts
│   └── test-docker.sh          # Docker integration test runner
├── python/                     # LEGACY — do not use; canonical source is python-packages/
├── scripts/                    # Shell deployment scripts + screenshot capture
├── docs/                       # Planning docs, API guides, todo lists
│   ├── PLANS.md                # Index of all plans with status (implemented/pending/draft/…)
│   └── plans/                  # Individual plan files (plan_*.md)
├── .env.example                # Example environment variables
├── docker-compose.yml          # Compose stack for local development
├── docker-compose.orchestrator.yml # Compose stack with orchestrator + worker daemon
├── PORTS.md                    # Port assignment reference
├── TODO.md                     # Outstanding work items
├── package.json                # Root workspace manifest
└── CLAUDE.md                   # This file
```

> **Plugin packages** are under `packages/plugins/` and matched by the workspace glob `packages/plugins/*`. They are imported by `lcyt-backend` as named packages (`lcyt-dsk`, `lcyt-production`, `lcyt-rtmp`).

---

## Setup

```bash
# Must run at repo root — creates workspace symlinks in node_modules/
npm install
```

For Python:
```bash
# From python-packages/lcyt-backend/
pip install -r requirements.txt
# or: pip install -e ../lcyt -e .
```

---

## Root Scripts

```bash
npm run build          # Build lcyt CJS output (ESM→CJS transformer)
npm test               # Run tests across all Node.js packages
npm start              # Run lcyt-cli
npm run start:backend  # Run lcyt-backend Express server
npm run web            # Run lcyt-web Vite dev server
npm run build:web      # Build lcyt-web for production → packages/lcyt-web/dist/
npm run build:site     # Build lcyt-web then lcyt-site (Astro)
npm run preview:web    # Preview the lcyt-web production build locally
npm run screenshots    # Run Playwright screenshot capture (scripts/screenshots/capture.mjs)
```

---

## Node.js Packages

### `packages/lcyt` — Core Library (v2.5.0)

Published to npm. Dual ESM/CJS package.

**Source files (`src/`):**
- `sender.js` / `sender.d.ts` — `YoutubeLiveCaptionSender` class. HTTP caption ingestion, sequence tracking, NTP-style clock sync, batch send.
- `backend-sender.js` / `backend-sender.d.ts` — `BackendCaptionSender` class. Routes captions through the relay backend using `fetch()`. **Async delivery:** `send()`/`sendBatch()` return `{ ok, requestId }` immediately (202); the real YouTube outcome arrives on the `GET /events` SSE stream.
- `config.js` / `config.d.ts` — `loadConfig()`, `saveConfig()`, `buildIngestionUrl()`. Config stored at `~/.lcyt-config.json`.
- `logger.js` / `logger.d.ts` — Pluggable logger with `info/success/error/warn/debug`. Supports `setCallback()`, `setVerbose()`, `setSilent()`, `setUseStderr()`. Set `LCYT_LOG_STDERR=1` to route logs to stderr (MCP-friendly).
- `errors.js` / `errors.d.ts` — Typed error hierarchy: `LCYTError` → `ConfigError`, `NetworkError` (has `statusCode`), `ValidationError` (has `field`).

TypeScript declaration files (`.d.ts`) are included alongside each source file.

**Exports map:**
```
lcyt              → YoutubeLiveCaptionSender (ESM src/, CJS dist/)
lcyt/backend      → BackendCaptionSender
lcyt/config       → config utilities
lcyt/logger       → logger
lcyt/errors       → error classes
```

**Build:**
```bash
npm run build -w packages/lcyt
# Runs packages/lcyt/scripts/build-cjs.js — custom ESM→CJS transformer
# Outputs to dist/ with .cjs extension; no external bundler needed
```

**Tests:** `packages/lcyt/test/*.test.js` — uses Node's built-in `node:test`.

---

### `packages/lcyt-cli` — CLI Tool (v1.4.0)

Published to npm. ESM shebang script.

**Entrypoint:** `bin/lcyt`

**Modes:**
- Full-screen blessed UI (default)
- Interactive line-by-line (`-i`)
- Single caption: `lcyt "text"`
- Heartbeat test: `lcyt --heartbeat`

**Key options:** `--stream-key`, `--base-url`, `--region`, `--verbose`, `--log-stderr`

**Full-screen UI** (`src/interactive-ui.js`): blessed terminal panels — text preview, input field, sent-captions log, status bar. Supports `/load <file>`, batch mode, vim/arrow key navigation.

**Tests:** `packages/lcyt-cli/test/`.

---

### `packages/lcyt-backend` — Express Relay Backend (v1.0.0)

HTTP relay: clients authenticate with API keys + JWT tokens, backend sends captions to YouTube on their behalf. Supports multi-user sessions, user account registration/login, and per-user project key management.

**Entry:** `src/index.js` (graceful shutdown: SIGTERM/SIGINT, closes sender/DB/server)
**App factory:** `src/server.js`

**Environment variables:**
| Variable | Purpose | Default |
|---|---|---|
| `FFMPEG_RUNNER` | ffmpeg execution backend: `local` (default), `docker`, `worker` | `local` |
| `FFMPEG_IMAGE` | Docker image for ffmpeg when `FFMPEG_RUNNER=docker` | none |
| `DOCKER_BUILD_TIMEOUT_MS` | Timeout for Docker image builds (ms) | none |
| `WORKER_DAEMON_URL` | Worker daemon URL when `FFMPEG_RUNNER=worker` | none |
| `BRIDGE_DOWNLOAD_BASE_URL` | Base URL for bridge agent downloads | none |
| `BACKUP_DAYS` | Number of daily DB backups to retain | none |
| `BACKUP_DIR` | Directory for DB backup files | none |
| `ICONS_DIR` | Directory for icon assets served at `/icons/*` | none |
| `BACKEND_URL` | Server's own URL (used internally for DSK renderer etc.) | none |
| `FFMPEG_WRAPPER` | Custom ffmpeg wrapper script path | none |
| `JWT_SECRET` | HS256 signing key | auto-generated (warns) |
| `ADMIN_KEY` | Admin endpoint auth | none (disables admin) |
| `DB_PATH` | SQLite file path | `./lcyt-backend.db` |
| `SESSION_TTL` | Session timeout (ms) | 7200000 (2h) |
| `CLEANUP_INTERVAL` | Session cleanup sweep interval (ms) | 300000 (5m) |
| `PORT` | HTTP port | 3000 |
| `STATIC_DIR` | Serve static files from this directory | none |
| `PUBLIC_URL` | Server's public URL (used in generated .env files) | none |
| `TRUST_PROXY` | Express `trust proxy` value | `true` |
| `REVOKED_KEY_TTL_DAYS` | Days before revoked keys are purged | 30 |
| `REVOKED_KEY_CLEANUP_INTERVAL` | Revoked key cleanup interval (ms) | 86400000 (24h) |
| `ALLOWED_DOMAINS` | Comma-separated domains for session CORS filter | `lcyt.fi,www.lcyt.fi,localhost` |
| `ALLOWED_RTMP_DOMAINS` | Domains allowed to use `/stream` relay endpoints; falls back to `ALLOWED_DOMAINS` | (falls back) |
| `USAGE_PUBLIC` | If set, /usage endpoint needs no auth | unset |
| `FREE_APIKEY_ACTIVE` | If set to `1`, enables free API key self-registration endpoint | unset |
| `USE_USER_LOGINS` | Set to `0` to disable user registration/login (`/auth` routes) | enabled |
| `HLS_SUBS_ROOT` | Directory for WebVTT subtitle segment files | `/tmp/hls-subs` |
| `HLS_SUBS_SEGMENT_DURATION` | Subtitle segment length in seconds | `6` |
| `HLS_SUBS_WINDOW_SIZE` | Number of subtitle segments to keep per language | `10` |
| `HLS_ROOT` | HLS output directory for video+audio streams | `/tmp/hls-video` |
| `HLS_LOCAL_RTMP` | Local nginx-rtmp base URL for HLS/preview | `rtmp://127.0.0.1:1935` |
| `HLS_RTMP_APP` | RTMP application name for HLS/preview | `live` |
| `RADIO_HLS_ROOT` | HLS output directory for audio-only streams (ffmpeg mode) | `/tmp/hls` |
| `RADIO_LOCAL_RTMP` | Local nginx-rtmp URL for radio streams (ffmpeg mode) | `rtmp://127.0.0.1:1935` |
| `RADIO_RTMP_APP` | RTMP application name for radio (ffmpeg mode) | `live` |
| `RADIO_HLS_SOURCE` | Radio HLS backend: `ffmpeg` (default) or `mediamtx` (no ffmpeg, uses MediaMTX) | `ffmpeg` |
| `MEDIAMTX_HLS_BASE_URL` | MediaMTX HLS base URL used by NginxManager for internal proxy_pass directives | `http://127.0.0.1:8080` |
| `NGINX_RADIO_CONFIG_PATH` | Path to nginx include file managed by NginxManager; empty = no-op mode | (unset) |
| `NGINX_TEST_CMD` | Command to test nginx config before reloading | `nginx -t` |
| `NGINX_RELOAD_CMD` | Command to reload nginx after NginxManager writes config | `nginx -s reload` |
| `NGINX_RADIO_PREFIX` | Public URL prefix for slug-based radio proxy locations | `/r` |
| `RTMP_HOST` | RTMP host for RTMP relay | none |
| `RTMP_APP` / `RTMP_APPLICATION` | RTMP application name for relay | none |
| `RTMP_RELAY_ACTIVE` | If set to `1`, enables RTMP relay functionality | unset |
| `RTMP_CONTROL_URL` | nginx-rtmp control URL (legacy fallback for `dropPublisher`) | none |
| `MEDIAMTX_API_URL` | MediaMTX v3 REST API base URL; activates MediaMTX `dropPublisher` path when set | none |
| `MEDIAMTX_API_USER` | Basic-auth username for the MediaMTX API | none |
| `MEDIAMTX_API_PASSWORD` | Basic-auth password for the MediaMTX API | none |
| `PREVIEW_ROOT` | Directory for JPEG thumbnail files | `/tmp/previews` |
| `PREVIEW_INTERVAL_S` | Seconds between thumbnail updates | `5` |
| `GRAPHICS_DIR` | Image storage directory for DSK overlays | `/data/images` |
| `GRAPHICS_ENABLED` | If set to `1`, enables image upload/management | unset |
| `GRAPHICS_MAX_FILE_BYTES` | Max uploaded image size in bytes | 5242880 (5 MB) |
| `GRAPHICS_MAX_STORAGE_BYTES` | Max total image storage per key in bytes | 52428800 (50 MB) |
| `YOUTUBE_CLIENT_ID` | Google OAuth 2.0 Web client ID (for client-side token flow) | none |
| `CONTACT_EMAIL` | Contact info returned by `GET /contact` | none |
| `CONTACT_NAME` | Contact name returned by `GET /contact` | none |
| `CONTACT_PHONE` | Contact phone returned by `GET /contact` | none |
| `CONTACT_WEBSITE` | Contact website returned by `GET /contact` | none |
| `FILES_DIR` | Local directory for per-key caption files (local adapter) | `/data/files` |
| `FILE_STORAGE` | Caption file storage backend: `local` (default) or `s3` | `local` |
| `S3_BUCKET` | S3 bucket name (required when `FILE_STORAGE=s3`) | none |
| `S3_REGION` | S3 region (or `auto` for Cloudflare R2) | `auto` |
| `S3_ENDPOINT` | Custom S3-compatible endpoint URL (R2, MinIO, Backblaze B2) | none |
| `S3_PREFIX` | Object key prefix within the bucket | `captions` |
| `S3_ACCESS_KEY_ID` | Static S3 credentials access key | none (uses AWS credential chain) |
| `S3_SECRET_ACCESS_KEY` | Static S3 credentials secret | none |
| `CEA` | Enable CEA-608/708 caption encoding (experimental) | unset |
| `PLAYWRIGHT_DSK_CHROMIUM` | Path to Chromium binary for DSK renderer | Playwright cache path |
| `DSK_LOCAL_SERVER` | Local server URL used by DSK renderer | `http://localhost:$PORT` |
| `DSK_LOCAL_RTMP` | Local nginx-rtmp base URL for DSK RTMP output | `rtmp://127.0.0.1:1935` |
| `DSK_RTMP_APP` | RTMP application name for DSK renderer output | `live` |
| `STT_PROVIDER` | Default STT provider: `google`, `whisper_http`, `openai` | `google` |
| `STT_DEFAULT_LANGUAGE` | Default BCP-47 language tag for STT | `en-US` |
| `STT_AUDIO_SOURCE` | Default audio source for STT: `hls`, `rtmp`, `whep` | `hls` |
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to Google service account JSON (for OAuth2 STT) | none |
| `GOOGLE_STT_KEY` | Google Cloud STT REST API key (simpler alternative to service account) | none |
| `GOOGLE_STT_MODE` | Google STT mode: `rest` (default) or `grpc` (lower latency; requires `@google-cloud/speech`) | `rest` |
| `WHISPER_HTTP_URL` | Base URL of a Whisper-compatible HTTP STT server | none |
| `WHISPER_HTTP_MODEL` | Model name to request from the Whisper HTTP server | none |
| `OPENAI_STT_URL` | Base URL for OpenAI-compatible STT endpoint | OpenAI default |
| `OPENAI_STT_API_KEY` | API key for OpenAI STT endpoint | none |
| `OPENAI_STT_MODEL` | Model name for OpenAI STT requests | `whisper-1` |
| `EMBEDDING_API_URL` | Base URL for embedding API (server-level default) | `https://api.openai.com` |
| `EMBEDDING_API_KEY` | API key for the embedding provider (server-level) | none |
| `EMBEDDING_MODEL` | Embedding model name (server-level) | `text-embedding-3-small` |

**API routes:**
```
GET  /health              — uptime, session count, login state
GET  /contact             — server contact info (public)

POST /auth/register       — create user account (email + password)
POST /auth/login          — authenticate user → returns user JWT
GET  /auth/me             — current user info (user Bearer token)
POST /auth/change-password — change password (user Bearer token)

POST /live                — register session → returns session JWT
GET  /live                — session status (Bearer token)
DELETE /live              — tear down session (Bearer token)
POST /captions            — queue caption(s) → 202 { ok, requestId } (Bearer token)
GET  /events              — SSE stream of caption delivery results (Bearer token or ?token=)
POST /sync                — NTP clock sync (Bearer token)
GET  /stats               — per-key usage stats (Bearer token)
DELETE /stats             — GDPR right-to-erasure: anonymise key and delete personal data (Bearer token)
GET  /file                — list caption files saved for the authenticated key (Bearer token)
GET  /file/:id            — download a caption file (Bearer token or ?token=)
DELETE /file/:id          — delete a caption file (Bearer token)
GET  /usage               — per-domain caption stats (public if USAGE_PUBLIC, else X-Admin-Key)
POST /mic                 — claim/release soft mic lock for collaborative sessions (Bearer token)

GET/POST/PATCH/DELETE /keys — admin CRUD (X-Admin-Key header) OR user project CRUD (user Bearer token)
  POST   /keys?freetier   — self-service free-tier key sign-up (requires FREE_APIKEY_ACTIVE=1)

GET  /video/:key              — HLS.js player page (public, CORS *, iframe-embeddable)
GET  /video/:key/master.m3u8  — HLS master manifest (video + subtitle tracks, public)
GET  /video/:key/subs/:lang/playlist.m3u8 — HLS subtitle playlist per language (public)
GET  /video/:key/subs/:lang/:seg.vtt      — WebVTT subtitle segment file (public)
GET  /viewer/:key         — public SSE broadcast stream (no auth, CORS *); viewer targets subscribe here
GET  /stream-hls/:key/*   — HLS video+audio segments and playlist (public, rate-limited)
GET  /radio/:key/*        — audio-only HLS segments and playlist (public, rate-limited)
GET  /preview/:key/incoming.jpg — latest RTMP → JPEG thumbnail (public)

GET  /dsk/:apikey/images           — list DSK overlay images for an API key (public)
GET  /dsk/:apikey/events           — SSE stream of graphics events for DSK page (public)
GET  /dsk/:apikey/viewports/public — list public viewport definitions (public)
GET/POST/PUT/DELETE /dsk/:apikey/templates — DSK template CRUD (JWT Bearer or X-API-Key)
POST /dsk/:apikey/templates/:id/activate   — activate a template in renderer (JWT Bearer or X-API-Key)
POST /dsk/:apikey/template         — render a one-off template (JWT Bearer or X-API-Key)
POST /dsk/:apikey/broadcast        — push live data to renderer without reload (JWT Bearer or X-API-Key)
GET  /dsk/:apikey/renderer/status  — renderer running state (JWT Bearer or X-API-Key)
POST /dsk/:apikey/renderer/start   — start RTMP capture for a key (JWT Bearer or X-API-Key)
POST /dsk/:apikey/renderer/stop    — stop RTMP capture for a key (JWT Bearer or X-API-Key)
GET/POST/PUT/DELETE /dsk/:apikey/viewports — viewport CRUD (JWT Bearer or X-API-Key)
POST /dsk-rtmp/on_publish          — nginx-rtmp on_publish callback for DSK RTMP
POST /dsk-rtmp/on_publish_done     — nginx-rtmp on_publish_done callback for DSK RTMP

GET/POST/PUT/DELETE /images/:id — image upload/management for DSK overlays (JWT Bearer or X-API-Key)
GET  /youtube/config      — return YOUTUBE_CLIENT_ID for client-side OAuth (Bearer token)
GET/POST/PUT/DELETE /rtmp — RTMP relay slot management (Bearer token)
GET/POST /stream          — RTMP relay stream control (Bearer token + domain allowlist)

GET  /production/cameras  — list cameras (admin key)
POST /production/cameras  — create camera
PUT/DELETE /production/cameras/:id — update/delete camera
POST /production/cameras/:id/preset/:preset — trigger camera PTZ preset
GET  /production/mixers   — list mixers with connection status
POST /production/mixers   — create mixer
PUT/DELETE /production/mixers/:id — update/delete mixer
POST /production/mixers/:id/switch — switch mixer source
GET  /production/bridge/commands?token=xxx — SSE stream for bridge agents
POST /production/bridge/status — bridge heartbeat + command result callback
GET/POST/DELETE /production/bridge/instances — bridge instance CRUD

GET  /icons/*             — icon assets (authenticated)

GET/POST/PUT/DELETE /production/device-roles — device role CRUD (admin or user Bearer)
GET  /production/device-roles/:code/auth     — device role pin-code authentication

GET  /keys/:key/features — list project feature flags (user Bearer)
PUT  /keys/:key/features — update project feature flags (user Bearer)

GET  /keys/:key/members  — list project members (user Bearer)
POST /keys/:key/members  — invite member (user Bearer)
PUT  /keys/:key/members/:userId — update member role (user Bearer)
DELETE /keys/:key/members/:userId — remove member (user Bearer)

GET  /bridge/download/:platform — download pre-built bridge agent binary

GET  /stt/status          — current STT session state for the authenticated API key (Bearer token)
POST /stt/start           — start server-side STT { provider?, language?, audioSource?, streamKey?, confidenceThreshold? } (Bearer token)
POST /stt/stop            — stop STT session (Bearer token)
GET  /stt/events          — SSE stream of transcript events (Bearer token or ?token=)
GET  /stt/config          — get per-key STT config from DB (Bearer token)
PUT  /stt/config          — update per-key STT config (Bearer token)

GET/POST/PUT/DELETE /cues/rules — cue rule CRUD (Bearer token)
GET  /cues/events         — list recent cue events (Bearer token)

GET  /ai/config           — get per-key AI/embedding config (Bearer token)
PUT  /ai/config           — update AI provider, model, key, threshold (Bearer token)
GET  /ai/status           — server embedding capability info (Bearer token)

GET  /agent/status        — agent capabilities and config state (Bearer token)
GET  /agent/context       — current AI context window (Bearer token)
POST /agent/context       — add a context entry manually (Bearer token)
DELETE /agent/context     — clear context window (Bearer token)
GET  /agent/events        — recent agent events (Bearer token)
```

**Key internals:**
- `src/db.js` — Re-exports from `src/db/index.js` (modular). `better-sqlite3` (synchronous). Core tables: `users`, `api_keys` (with `user_id` FK), `caption_usage`, `session_stats`, `caption_errors`, `sessions`. Additional tables for graphics, radio, HLS, RTMP relay, and production control. Additive migrations run on startup.
- `src/store.js` — In-memory session store. Session = `{ sessionId, apiKey, streamKey, domain, sender, extraTargets, token, startedAt, lastActivity, sequence, syncOffset, emitter, _sendQueue }`. `sender` is null in target-array mode. `extraTargets` holds all targets including `youtube`, `viewer`, and `generic` types. `emitter` is a per-session `EventEmitter` for SSE routing. `_sendQueue` serialises concurrent YouTube sends so sequence numbers stay monotonic.
- `src/routes/stt.js` — `createSttRouter()`: server-side STT routes (`/stt/*`). Delegates to `SttManager` from `lcyt-rtmp`. Supports `google`, `whisper_http`, `openai` providers and `hls`, `rtmp`, `whep` audio sources. **SSE events** on `GET /stt/events`: `connected`, `transcript`, `stt_started`, `stt_stopped`, `stt_error`.
- `src/middleware/auth.js` — JWT Bearer verification (session tokens: `{ sessionId, apiKey }`).
- The RTMP/HLS/radio/preview/STT managers previously lived in `lcyt-backend`; they were extracted to `packages/plugins/lcyt-rtmp`. The backend imports them via `import { initRtmpControl, createRtmpRouters } from 'lcyt-rtmp'`.
- The Cue Engine (`lcyt-cues`) provides inline cue metacode processing, phrase/fuzzy/semantic/event matching, sound-cue listeners, and CRUD routes. Imported via `import { initCueEngine, createCueProcessor, createCueRouter, createSoundCueListener } from 'lcyt-cues'`.
- The AI Agent (`lcyt-agent`) owns AI configuration, embedding computation, context window management, and LLM-based event cue evaluation. Imported via `import { initAgent, createAgentRouter, createAiRouter, computeEmbeddings } from 'lcyt-agent'`.
- `src/ai/index.js` — Backward-compatible re-exports from `lcyt-agent` so existing imports from `lcyt-backend/src/ai/` continue to work.
- `src/middleware/user-auth.js` — JWT Bearer verification for user tokens (`{ type: 'user', userId, email }`).
- `src/middleware/cors.js` — Dynamic CORS: only allows registered session domains; never exposes admin routes.
- `src/middleware/admin.js` — `X-Admin-Key` constant-time comparison.
- `src/caption-files.js` — Pure caption-text utilities: `composeCaptionText`, `formatVttTime`, `buildVttCue`. File I/O was extracted to `lcyt-files`.
- `src/backup.js` — DB backup utilities.
- `src/dsk-bus.js` — `DskBus`: DSK graphics SSE subscriber registry and per-key graphics state, extracted from SessionStore so `lcyt-dsk` does not depend on session lifecycle.
- `src/ffmpeg/index.js` — ffmpeg runner factory: selects `local-runner`, `docker-runner`, or `worker-runner` based on `FFMPEG_RUNNER` env var. Exports `createFfmpegRunner()`.
- `src/ffmpeg/local-runner.js` — Spawns ffmpeg directly via `child_process.spawn`.
- `src/ffmpeg/docker-runner.js` — Runs ffmpeg inside a Docker container (`FFMPEG_IMAGE`).
- `src/ffmpeg/worker-runner.js` — Delegates ffmpeg jobs to the worker daemon (`WORKER_DAEMON_URL`).
- `src/ffmpeg/pipe-utils.js` — Shared pipe/stream utilities for ffmpeg runners.
- `src/storage/s3.js` — S3 upload utilities (used by backend-level S3 operations).
- `src/routes/device-roles.js` — Device role CRUD + pin-code auth for production devices.
- `src/routes/project-features.js` — Per-project feature flag CRUD.
- `src/routes/project-members.js` — Project membership CRUD (invite, role update, remove).
- `src/routes/bridge-download.js` — Bridge agent binary download endpoint.
- `src/routes/account.js` — User account routes (profile, settings).
- `src/routes/session.js` — Session management routes.
- `src/routes/content.js` — Content router factory (aggregates file, video, viewer routes).
- `src/db/device-roles.js` — Device role DB helpers (`prod_device_roles` table).
- `src/db/project-features.js` — Project feature flag DB helpers (`project_features` table).
- `src/db/project-members.js` — Project membership DB helpers (`project_members` table).
- `src/db/users.js` — User CRUD (`createUser`, `getUserByEmail`, `getUserById`, `updateUserPassword`).

**SSE events** (on `GET /events`): `connected`, `caption_result`, `caption_error`, `session_closed`, `mic_state`, `cue_fired`. Plugin events are forwarded generically via `session.emitter.emit('event', { type, data })`.

**Admin CLI:** `bin/lcyt-backend-admin` — local key management + user management.
- Key commands: `list`, `add`, `update`, `revoke`, `delete`, `renew`, `info`, `clean`
- User commands: `users list`, `users info`, `users add`, `users set-password`, `users deactivate`, `users activate`, `users delete`

**Docker:** `Dockerfile` — node:20-slim, exposes port 3000.

**Tests:** `packages/lcyt-backend/test/*.test.js` — uses `node:test`.

---

### `packages/plugins/lcyt-files` — Caption File Storage Plugin (v0.1.0)

Storage-adapter–backed caption file I/O for lcyt-backend. Provides local filesystem (default), S3-compatible object storage, and WebDAV backends behind a common interface. Imported by `lcyt-backend` as `lcyt-files`.

**Main entry:** `src/api.js`
**Usage in lcyt-backend:**
```js
import { initFilesControl, createFilesRouter, writeToBackendFile, closeFileHandles } from 'lcyt-files';

const { storage } = await initFilesControl(db);
// Wire storage into captions.js (via createSessionRouters) and files route (via createContentRouters).
// Close handles on session end:
store.onSessionEnd = async (session) => {
  if (session._fileHandles?.size > 0) await closeFileHandles(session._fileHandles);
};
```

**Source files (`src/`):**
- `api.js` — `initFilesControl(db)` → `{ storage }` (logs adapter type at startup). Exports `writeToBackendFile`, `closeFileHandles`, `createFilesRouter`.
- `storage.js` — `createStorageAdapter()` factory; reads `FILE_STORAGE` env var.
- `caption-files.js` — `writeToBackendFile(context, text, timestamp, db, storage, buildVttCue)` + `closeFileHandles(fileHandles)`.
- `routes/files.js` — `createFilesRouter(db, auth, store, jwtSecret, storage)` → `GET /file`, `GET /file/:id`, `DELETE /file/:id`.
- `adapters/local.js` — `createLocalAdapter(baseDir)`: wraps `fs.WriteStream` (append) and `fs.ReadStream`. `storedKey` is the full filesystem path.
- `adapters/s3.js` — `createS3Adapter({ bucket, prefix, region, endpoint, credentials })`: multipart upload via `@aws-sdk/lib-storage`. `storedKey` is the S3 object key.
- `adapters/webdav.js` — `createWebdavAdapter({ url, username, password })`: WebDAV client adapter for remote file storage.

**Storage adapter interface:**
```
keyDir(apiKey)                                  → string (safe per-key prefix)
openAppend(apiKey, filename)                    → AppendHandle { storedKey, write(chunk), close(), sizeBytes() }
openRead(apiKey, storedKey, format)             → { stream, contentType, size }  (throws ENOENT if missing)
deleteFile(apiKey, storedKey)                   → Promise<void>
describe()                                      → string (startup log message)
```

**Environment variables** (see also backend env vars above):
| Variable | Purpose | Default |
|---|---|---|
| `FILE_STORAGE` | Storage backend: `local`, `s3`, or `webdav` | `local` |
| `FILES_DIR` | Base directory for local adapter | `/data/files` |
| `S3_BUCKET` | S3 bucket name (required when `FILE_STORAGE=s3`) | — |
| `S3_REGION` | AWS region (or `auto` for R2) | `auto` |
| `S3_ENDPOINT` | Custom endpoint (R2, MinIO, Backblaze B2) | — |
| `S3_PREFIX` | Object key prefix | `captions` |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | Static credentials | — (uses AWS chain) |

**Notes:**
- The `caption_files` DB table is owned by `lcyt-backend/src/db/schema.js` (unchanged).
- The `filename` column stores the adapter's `storedKey` — a full filesystem path for local, an S3 object key for S3. `basename()` is applied in list responses for display.
- For S3: the multipart upload streams data as it is written; `close()` (called in `onSessionEnd`) completes the upload.
- `@aws-sdk/client-s3` and `@aws-sdk/lib-storage` are optional dependencies; not required when `FILE_STORAGE=local`.

**Tests:** `packages/plugins/lcyt-files/test/local-adapter.test.js` — 17 tests covering adapter methods, `writeToBackendFile`, and `closeFileHandles`.

---

### `packages/plugins/lcyt-production` — Production Control Plugin (v0.1.0)

Express router plugin for camera PTZ presets and video mixer source switching. Used as an internal dependency by `lcyt-backend` (imported as `lcyt-production`).

**Main entry:** `src/api.js`
**Usage in lcyt-backend:**
```js
import { createProductionRouter, initProductionControl } from 'lcyt-production';
const { registry, bridgeManager } = await initProductionControl(db);
app.use('/production', createProductionRouter(db, registry, bridgeManager, { publicUrl }));
```

**Source files (`src/`):**
- `api.js` — `initProductionControl(db)` + `createProductionRouter(db, registry, bridgeManager, opts)`.
- `registry.js` — `DeviceRegistry`: loads cameras and mixers from DB, manages live adapter connections, resolves adapters by device type.
- `bridge-manager.js` — `BridgeManager`: manages SSE connections from `lcyt-bridge` agents. Dispatches `tcp_send` commands and resolves results via Promise with 10s timeout. Sends SSE heartbeats every 20s.
- `db.js` — SQLite migrations for `prod_cameras`, `prod_mixers`, `prod_bridge_instances` tables.
- `routes/cameras.js` — CRUD + PTZ preset trigger.
- `routes/mixers.js` — CRUD + source switching.
- `routes/bridge.js` — Bridge instance CRUD + SSE command stream + status callback.
- `adapters/camera/amx.js` — AMX camera adapter (TCP/IP PTZ control).
- `adapters/camera/visca-ip.js` — VISCA-over-IP camera adapter (PTZ control via VISCA protocol).
- `adapters/camera/browser.js` — Browser-based camera adapter (WebRTC / media device).
- `adapters/camera/none.js` — No-op camera adapter (software-only targets).
- `adapters/mixer/roland.js` — Roland video mixer adapter (TCP).
- `adapters/mixer/amx.js` — AMX mixer adapter (TCP).
- `adapters/mixer/atem.js` — Blackmagic ATEM mixer adapter.
- `adapters/mixer/obs.js` — OBS Studio mixer adapter (obs-websocket).
- `adapters/mixer/lcyt.js` — LCYT software mixer adapter.
- `adapters/mixer/monarch_hdx.js` — Matrox Monarch HDX encoder/mixer adapter.

**Camera control types:** `amx`, `visca-ip`, `browser`, `none`
**Mixer types:** `roland`, `amx`, `atem`, `obs`, `lcyt`, `monarch_hdx`

**Tests:** `packages/plugins/lcyt-production/test/*.test.js` — uses `node:test`.

---

### `packages/plugins/lcyt-rtmp` — RTMP Relay Plugin (v0.1.0)

RTMP relay, HLS streaming, audio-only radio, stream preview, caption injection, and server-side speech-to-text transcription. Extracted from `lcyt-backend` into its own plugin for modularity. Imported by `lcyt-backend` as `lcyt-rtmp`.

**Main entry:** `src/api.js`
**Usage in lcyt-backend:**
```js
import { initRtmpControl, createRtmpRouters } from 'lcyt-rtmp';

const rtmp = await initRtmpControl(db, store);
const { relayManager, hlsManager, radioManager, previewManager, hlsSubsManager, sttManager } = rtmp;

// Wire hlsSubsManager into the video route for subtitle sidecar support:
setHlsSubsManager(rtmp.hlsSubsManager);

if (process.env.RTMP_RELAY_ACTIVE === '1') {
  const routers = createRtmpRouters(db, auth, rtmp, { allowedRtmpDomains });
  app.use('/rtmp',       routers.rtmpRouter);
  app.use('/stream',     routers.streamRouter);
  app.use('/stream-hls', routers.streamHlsRouter);
  app.use('/radio',      routers.radioRouter);
  app.use('/preview',    routers.previewRouter);
}

// In graceful shutdown:
await rtmp.stop();
```

**Source files (`src/`):**
- `api.js` — `initRtmpControl(db, store?)` + `createRtmpRouters(db, auth, managers, opts)`. Returns all manager instances and a `stop()` function.
- `rtmp-manager.js` — `RtmpRelayManager`: manages RTMP relay sessions; calls `probeFfmpeg()` on startup. Fires `onStreamStarted`/`onStreamEnded` callbacks for DB stat tracking.
- `hls-manager.js` — `HlsManager`: manages MediaMTX-based RTMP → video+audio HLS (no ffmpeg in hot path).
- `radio-manager.js` — `RadioManager`: dual-mode audio-only HLS. **ffmpeg mode** (default): spawns ffmpeg RTMP → AAC HLS. **mediamtx mode**: no ffmpeg; MediaMTX serves HLS, `NginxManager` writes slug-based nginx proxy locations.
- `nginx-manager.js` — `NginxManager`: writes nginx `location` blocks for MediaMTX radio streams. Atomic file write + `nginx -t && nginx -s reload`. No-op when `NGINX_RADIO_CONFIG_PATH` is unset.
- `preview-manager.js` — `PreviewManager`: manages MediaMTX API or ffmpeg for RTMP → JPEG thumbnail generation.
- `hls-subs-manager.js` — `HlsSubsManager`: rolling WebVTT segment writer for subtitle sidecars.
- `mediamtx-client.js` — `MediaMtxClient`: REST API client for MediaMTX v3 (drop publisher, list streams, etc.).
- `hls-segment-fetcher.js` — `HlsSegmentFetcher`: polls a MediaMTX fMP4 HLS playlist, detects new segments, emits `segment` events with `{ buffer, timestamp, duration, url, index }`. Used by `SttManager`.
- `stt-manager.js` — `SttManager` (`EventEmitter`): manages one STT session per API key. Wires `HlsSegmentFetcher` → STT adapter → transcript → `session._sendQueue` for delivery. Supports `hls`, `rtmp`, `whep` audio sources. **Events:** `transcript`, `error`, `stopped`.
- `stt-adapters/google-stt.js` — `GoogleSttAdapter`: posts fMP4 segments to Google Cloud Speech-to-Text REST API or streams via gRPC (`GOOGLE_STT_MODE=grpc`). Emits `normalisePunctuation`-cleaned transcripts.
- `stt-adapters/whisper-http.js` — `WhisperHttpAdapter`: sends audio to a Whisper-compatible HTTP STT server.
- `stt-adapters/openai.js` — `OpenAiAdapter`: sends audio to OpenAI-compatible STT endpoint.
- `stt-adapters/pcm-buffer.js` — `PcmSilenceBuffer`: accumulates PCM frames and detects silence; `buildWav()` helper constructs WAV from raw PCM bytes.
- `db/relay.js` — RTMP relay DB helpers: `isRelayAllowed()`, `isRadioEnabled()`, per-key relay config CRUD.
- `routes/rtmp.js` — `GET/POST/PUT/DELETE /rtmp` — RTMP relay slot management.
- `routes/stream.js` — `GET/POST /stream` — RTMP relay stream control (domain allowlist enforced).
- `routes/stream-hls.js` — `GET /stream-hls/:key/*` — HLS video+audio proxy (public, rate-limited).
- `routes/radio.js` — `GET /radio/:key/*` — audio-only HLS proxy (public, rate-limited).
- `routes/preview.js` — `GET /preview/:key/incoming.jpg` — RTMP → JPEG thumbnail serving (public).

**Tests:** `packages/plugins/lcyt-rtmp/test/*.test.js` — uses `node:test` with `--experimental-test-module-mocks`.

---

### `packages/plugins/lcyt-dsk` — DSK Graphics Plugin (v0.1.0)

Playwright-based headless Chromium renderer for DSK (Downstream Key) graphics overlays. Manages template rendering, image upload, overlay broadcasting, and RTMP output. Imported by `lcyt-backend` as `lcyt-dsk`.

**Main entry:** `src/api.js`
**Usage in lcyt-backend:**
```js
import { initDskControl, createDskRouters } from 'lcyt-dsk';

const { captionProcessor, stop: stopDsk } = await initDskControl(db, store, relayManager);
const { dskRouter, dskTemplatesRouter, dskViewportsRouter, imagesRouter, dskRtmpRouter } =
  createDskRouters(db, store, auth, relayManager);
app.use('/dsk',      dskRouter);
app.use('/dsk',      dskTemplatesRouter);
app.use('/dsk',      dskViewportsRouter);
app.use('/images',   imagesRouter);
app.use('/dsk-rtmp', dskRtmpRouter);
// Pass backend metacode handoff + captionProcessor to createCaptionsRouter:
// backend metacode: packages/lcyt-backend/src/metacode.js
// DSK graphics processor (plugin): packages/plugins/lcyt-dsk/src/caption-processor.js
app.use('/captions', createCaptionsRouter(store, auth, db, relayManager, captionProcessor));
// In graceful shutdown:
await stopDsk();
```

**Source files (`src/`):**
- `api.js` — `initDskControl(db, store, relayManager)` + `createDskRouters(db, store, auth, relayManager)`.
- `renderer.js` — `startRenderer()` / `stopRenderer()`. Manages a single persistent headless Chromium instance. Per-key: `updateTemplate()`, `broadcastData()`, `startRtmpStream()`, `stopRtmpStream()`, `getStatus()`. Uses ffmpeg to push frames to nginx-rtmp.
- `renderer-container.js` — Docker-based renderer: runs the Chromium DSK renderer inside a container (uses `docker/lcyt-dsk-renderer` image).
- `caption-processor.js` — `createDskCaptionProcessor()`. Extracts `<!-- graphics:... -->` and `<!-- graphics[viewport,...]:... -->` metacodes from caption text; emits DSK SSE events; updates RTMP relay overlay. Supports delta mode (`+name`, `-name`) and landscape aliases (`landscape`, `default`, `main`).
- `db.js` — Re-exports from `src/db/`. Migrations for `dsk_templates` table + image columns.
- `db/images.js` — Image CRUD; `deleteAllImages()` exported from main entry.
- `db/dsk-templates.js` — Template CRUD.
- `db/viewports.js` — Viewport CRUD.
- `routes/dsk.js` — Public endpoints: image list, public viewports, SSE events stream.
- `routes/dsk-templates.js` — Authenticated template CRUD + renderer start/stop + broadcast.
- `routes/dsk-viewports.js` — Authenticated viewport CRUD.
- `routes/images.js` — Image upload (POST), list (GET), update (PUT), serve (GET public), delete (DELETE).
- `routes/dsk-rtmp.js` — nginx-rtmp `on_publish` / `on_publish_done` callbacks.
- `middleware/editor-auth.js` — `createEditorAuth(db)`: accepts `X-API-Key` header (no live session needed). `editorAuthOrBearer(jwtAuth, editorAuth)`: tries X-API-Key first, falls through to JWT Bearer.

**DSK caption metacode syntax:**
```
<!-- graphics:logo,banner -->                         all viewports get logo+banner (absolute)
<!-- graphics[vertical-left]:stanza,logo -->          vertical-left gets stanza+logo
<!-- graphics[v1,v2]:stanza -->                       v1 AND v2 both get stanza
<!-- graphics[vertical-right]: -->                    vertical-right gets nothing (cleared)
<!-- graphics:+logo -->                               add logo to currently active set (delta)
<!-- graphics:-banner -->                             remove banner from active set (delta)
<!-- graphics:+logo,-banner -->                       add logo AND remove banner (delta)
```

**DSK SSE events** (on `GET /dsk/:apikey/events`):
- `graphics` — `{ default: string[]|null, viewports: { [name]: string[] }, ts: number }`
- `bindings` — `{ codes: { section?, stanza?, speaker?, ... }, ts: number }`

**Template JSON shape (layers):**
- `type: "text"` — text layer with CSS positioning, font, color
- `type: "rect"` — rectangle/box layer
- `type: "image"` — image layer (references uploaded image by ID)

**Environment variables** (see also backend env vars above):
| Variable | Purpose | Default |
|---|---|---|
| `PLAYWRIGHT_DSK_CHROMIUM` | Path to Chromium binary | Playwright cache location |
| `DSK_LOCAL_SERVER` | Local server URL for renderer to fetch templates | `http://localhost:$PORT` |
| `DSK_LOCAL_RTMP` | nginx-rtmp base URL for DSK RTMP output | `rtmp://127.0.0.1:1935` |
| `DSK_RTMP_APP` | RTMP application name for DSK renderer | `live` |

---

### `packages/plugins/lcyt-cues` — Cue Engine Plugin (v0.1.0)

Cue engine for detecting spoken phrases, sounds, and AI-analyzed events to auto-advance rundown files. Supports inline cue metacodes in caption files. Imported by `lcyt-backend` as `lcyt-cues`.

**Main entry:** `src/api.js`
**Usage in lcyt-backend:**
```js
import { initCueEngine, createCueProcessor, createCueRouter, createSoundCueListener } from 'lcyt-cues';

const { engine } = await initCueEngine(db);
const cueProcessor = createCueProcessor({ store, db, engine });
createSoundCueListener({ store, engine });
app.use('/cues', createCueRouter(db, auth, engine));
```

**Source files (`src/`):**
- `api.js` — `initCueEngine(db)` + `createCueProcessor()` + `createCueRouter()` + `createSoundCueListener()`.
- `cue-engine.js` — `CueEngine`: evaluates cue rules per caption, per API key. Match types: `phrase` (substring), `regex`, `section`, `fuzzy` (Jaro-Winkler), `semantic` (embedding-based), `event_cue` (LLM-based). Per-rule cooldown enforcement. Silence timer logic. Embedding + AI config + agent evaluate function injection via setters.
- `cue-processor.js` — `createCueProcessor()`: strips `<!-- cue:label -->` metacodes from caption text, fires cue events on session emitter, triggers CueEngine automatic rules and async event cue evaluation.
- `db.js` — `cue_rules` and `cue_events` tables with indexes on `api_key`. Migrations run on init.
- `routes/cues.js` — `GET/POST/PUT/DELETE /cues/rules`, `GET /cues/events`. Regex pattern validation on create/update.

**Cue metacode syntax (frontend inline markers):**
| Syntax | Mode | Matching |
|---|---|---|
| `<!-- cue:phrase -->` | next (default) | Exact/wildcard |
| `<!-- cue*:phrase -->` | skip (forward past other cues) | Exact/wildcard |
| `<!-- cue**:phrase -->` | any (including backwards) | Exact/wildcard |
| `<!-- cue~:phrase -->` | next + fuzzy | Jaro-Winkler |
| `<!-- cue[semantic]:phrase -->` | next + semantic | Embedding similarity (backend only) |
| `<!-- cue[events]:description -->` | next + AI event | LLM evaluation (backend only) |

**Sound cue match types:** `music_start`, `music_stop`, `silence` (with minimum duration timer).

**Tests:** `packages/plugins/lcyt-cues/test/*.test.js` — uses `node:test`.

---

### `packages/plugins/lcyt-agent` — AI Agent Plugin (v0.1.0)

Central AI service for LCYT. Owns AI configuration (per-user embedding/LLM provider settings), embedding computation, context window management, and LLM-based event cue evaluation. Other plugins delegate AI calls to the agent. Imported by `lcyt-backend` as `lcyt-agent`.

**Main entry:** `src/api.js`
**Usage in lcyt-backend:**
```js
import { initAgent, createAgentRouter, createAiRouter, computeEmbeddings } from 'lcyt-agent';

const { agent } = await initAgent(db);
cueEngine.setEmbeddingFn(computeEmbeddings);
cueEngine.setAiConfigFn((apiKey) => agent.getAiConfig(apiKey));
cueEngine.setAgentEvaluateFn((apiKey, desc, opts) => agent.evaluateEventCue(apiKey, desc, opts));
app.use('/ai', createAiRouter(db, auth));
app.use('/agent', createAgentRouter(db, auth, agent));
```

**Source files (`src/`):**
- `api.js` — `initAgent(db)` + `createAgentRouter()` + `createAiRouter()`. Re-exports AI config and embedding utilities.
- `agent-engine.js` — `AgentEngine`: context window management (per-API-key, max 50 entries), `evaluateEventCue()` via LLM chat completions, `analyseImage()` stub for future vision inference.
- `ai-config.js` — Per-API-key AI model settings DB helpers (`ai_config` table). Provider modes: `none`, `server`, `openai`, `custom`.
- `embeddings.js` — OpenAI-compatible `/v1/embeddings` API client. `computeEmbeddings()`, `cosineSimilarity()`, `isServerEmbeddingAvailable()`.
- `db.js` — `agent_events` and `agent_context` table migrations.
- `routes/ai.js` — `GET/PUT /ai/config`, `GET /ai/status`.
- `routes/agent.js` — `GET /agent/status`, `GET/POST/DELETE /agent/context`, `GET /agent/events`.

**Backward compatibility:** `packages/lcyt-backend/src/ai/index.js` re-exports from `lcyt-agent`.

**Tests:** `packages/plugins/lcyt-agent/test/*.test.js` — uses `node:test`.

---

### `packages/lcyt-bridge` — Production Control Bridge Agent (v0.3.0)

Standalone agent that connects to the LCYT backend via SSE and relays commands to physical AV hardware (AMX controllers, Roland mixers) over TCP. Designed to run on-site where the hardware is located.

**Entry:** `src/index.js` (shebang, runs with `node src/index.js` or as a compiled binary)
**Config:** `.env` file in the same directory as the executable (or `process.env`)

**Required env vars:**
| Variable | Purpose |
|---|---|
| `BACKEND_URL` | Base URL of the LCYT backend |
| `BRIDGE_TOKEN` | Authentication token from `POST /production/bridge/instances` |

**Source files (`src/`):**
- `index.js` — Entry point. Loads config, starts the Bridge, optionally shows system tray icon.
- `bridge.js` — `Bridge` class (`EventEmitter`). Connects to `GET /production/bridge/commands?token=xxx` SSE stream. Dispatches `tcp_send` commands to `TcpPool`. Reports results via `POST /production/bridge/status`. Exponential-backoff reconnect (5s → 60s max).
- `tcp-pool.js` — `TcpPool`: manages a pool of named TCP connections. Reconnects on drop.
- `tray.js` — Optional system tray icon (for packaged desktop use).

**Build as standalone executable** (using `pkg`):
```bash
npm run build:win    # → dist/lcyt-bridge.exe  (Windows x64)
npm run build:mac    # → dist/lcyt-bridge-mac  (macOS x64)
npm run build:linux  # → dist/lcyt-bridge-linux (Linux x64)
```

---

### `packages/lcyt-orchestrator` — Compute Orchestrator (v0.0.1, private)

Stateless Express HTTP service that manages a pool of worker VMs and dispatches compute jobs (e.g. ffmpeg transcoding). Supports on-demand burst provisioning via the Hetzner Cloud API and optional Prometheus metrics exposition.

**Entry:** `src/index.js` (CommonJS, `node src/index.js`)
**Port:** `process.env.PORT` (default 4000)

**Source files (`src/`):**
- `index.js` — Express app. In-memory `workers` and `jobs` maps. Pending burst queue. Kicks off Hetzner burst VM creation when no warm capacity is available.
- `hetzner.js` — `createHetznerClient()`: REST client for Hetzner Cloud API with exponential-backoff retry and 429 rate-limit handling. `createBurstServer()`, `pollServerReady()`.
- `autoscaler.js` — `startAutoscaler()`: periodic tick that provisions burst VMs when queued jobs exceed `burstQueueLimit`. Runs only when `HETZNER_API_TOKEN` is set.
- `metrics.js` — Lightweight in-memory counter/gauge store used by `GET /metrics` (Prometheus text format).

**API routes:**
```
POST   /compute/workers/register  — worker self-registration { id, privateIp, maxJobs }
GET    /compute/workers           — list registered workers
POST   /compute/jobs              — dispatch job; returns workerId + workerUrl (or 202 queued / 503 retry)
DELETE /compute/jobs/:jobId       — release job from worker
POST   /compute/jobs/:jobId/caption — forward caption payload to assigned worker (stub)
GET    /compute/health            — worker/job counts
GET    /metrics                   — Prometheus counter text
```

**Env vars:**
| Variable | Purpose | Default |
|---|---|---|
| `HETZNER_API_TOKEN` | Enables burst VM provisioning | none (disables Hetzner) |
| `HETZNER_API_BASE_URL` | Override Hetzner API base (for mocks) | Hetzner default |
| `HETZNER_SNAPSHOT_ID` | Image/snapshot ID for burst VMs | none |
| `HETZNER_SERVER_TYPE_BURST` | Server type for burst VMs | `cx31` |
| `MAX_CONCURRENT_BURST_CREATES` | Max parallel burst VM provisions | `2` |
| `ORCHESTRATOR_MAX_PENDING_JOBS` | Max queued jobs before 503 | `50` |
| `ORCHESTRATOR_BACKOFF_MS` | Base backoff ms for Hetzner retries | `1000` |

**Tests:** `test/hetzner.mock.test.js` — Hetzner client with mock HTTP server.

---

### `packages/lcyt-worker-daemon` — Worker Daemon (v0.0.0, private)

Minimal ESM Express service that runs on worker VMs. Receives job lifecycle commands from the orchestrator (or directly from `lcyt-backend`), spawns placeholder/ffmpeg subprocesses, and optionally uploads HLS output to S3.

**Entry:** `src/index.js` (`startServer(port)`)
**Port:** `process.env.PORT` (default 5000)

**Source files (`src/`):**
- `index.js` — `createApp()` (returns Express app) + `startServer(port)`. In-memory `jobs` map. `NODE_ENV=test` skips real subprocess spawning. Optional `X-Worker-Auth` header authentication via `WORKER_AUTH_TOKEN`.
- `uploader.js` — `createUploader({ watchDir, prefix, uploadFn })`: watches a directory for new files and uploads them via `uploadFn`.
- `s3-uploader.js` — `createS3UploadFn({ baseKey })`: creates an upload function using `@aws-sdk/client-s3`.

**API routes:**
```
POST   /jobs           — create job; spawns subprocess (or no-op in test mode)
DELETE /jobs/:id       — stop job, kill subprocess
POST   /jobs/:id/caption — append caption payload to job record
GET    /stats          — running/total job counts
GET    /health         — status + workerId
GET    /_jobs          — debug: list all jobs
```

**Env vars:**
| Variable | Purpose |
|---|---|
| `WORKER_ID` | This worker's identifier (default `worker-0`) |
| `WORKER_AUTH_TOKEN` / `BACKEND_INTERNAL_TOKEN` | Optional auth token for all `/jobs` endpoints |

**Tests:** `test/daemon.basic.test.js`.

---

### `packages/tools/tcp-echo-server` — TCP Echo Server

Standalone development utility. Listens for TCP connections and echoes every received message back to the sender. Used for testing `lcyt-bridge` TCP connections without real AV hardware.

**Entry:** `server.js`
**Usage:** `node server.js [port]` or `PORT=8080 node server.js`
**Default port:** 9999

---

### `packages/lcyt-mcp-stdio` — MCP Server, stdio transport (v0.1.0)

Model Context Protocol server enabling AI assistants (e.g. Claude) to send live captions via stdio.

**Entry:** `src/server.js`
**Transport:** stdio (no HTTP port)
**Tools exposed:** `start`, `send_caption`, `send_batch`, `sync_clock`, `status`

**Run:** `node packages/lcyt-mcp-stdio/src/server.js`

---

### `packages/lcyt-mcp-sse` — MCP Server, HTTP SSE transport (v0.1.0)

Same tools as `lcyt-mcp-stdio`, but exposed over HTTP Server-Sent Events for remote AI client connections.

**Entry:** `src/server.js`
**Transport:** HTTP SSE — `GET /sse` opens the stream, `POST /messages?sessionId=...` sends messages.
**Port:** `process.env.PORT` (default 3001)
**Tools exposed:** `start`, `send_caption`, `send_batch`, `sync_clock`, `status`

**Run:** `node packages/lcyt-mcp-sse/src/server.js`

---

### `packages/lcyt-site` — Marketing Website (v0.1.0, private)

Static documentation and marketing site built with Astro.

**Build:** `npm run build -w packages/lcyt-site` → `dist/`
**Dev:** `npm run dev -w packages/lcyt-site`

**Source (`src/`):**
- `pages/` — Astro pages: `index.astro` (landing), `blog/`, `embed/`, `guide/`, `mcp/`, `api/`, `lib/`.
- `layouts/` — Shared Astro layouts.
- `components/` — Astro/HTML components.
- `content.config.ts` — Astro content collections config.
- `styles/` — Global CSS.

---

### `packages/lcyt-web` — Web UI (v1.0.0, private)

Browser-based React app using Vite and **wouter** for routing. Uses sidebar navigation as the primary layout. Sends captions via the `lcyt-backend` relay.

**Build:** `npm run build:web` → `packages/lcyt-web/dist/`
**Dev:** `npm run web`

**Source (`src/`):**
- `main.jsx` — React entry point; wouter-based routing for sidebar pages and standalone pages
- `App.jsx` — legacy two-panel caption layout (mounted at `/legacy` and `/captions`)
- `components/` — React JSX components (see routing table below). Key subdirectories: `sidebar/` (Sidebar, TopBar, StatusPopover, QuickActionsPopover), `dashboard/` (DashboardCard, StatusWidget, SentLogWidget, etc.), `broadcast/` (EncoderTab, StreamTab, YouTubeTab), `dsk-editor/` (TemplatePreview, AnimationEditor, LayerPropertyEditor), `dsk-viewports/` (TextLayersEditor, ImageSettingsTable), `panels/` (TargetsPanel, TranslationPanel, RelayPanel, ServicePanel, DetailsPanel, CeaCaptionsPanel, EmbedPanel, SttPanel, VadPanel, ReviewSummary), `production/` (ConnectionDot), `audio/` (AudioLevelMeter)
- `contexts/` — React context providers: AppProviders, AudioContext, CaptionContext, ConnectionContext, FileContext, LangContext, SentLogContext, SessionApiContext, SessionContext, ToastContext
- `hooks/` — Custom React hooks: useBrowserFileSaving, useDashboardConfig, useEscapeKey, useFileStore, useProjectFeatures, useSentLog, useSession, useToast, useUserAuth, useWebSpeech, useWindowEvent
- `lib/` — Utilities: activeCodes.js, api.js, device.js, dskEditorAnimation.js, dskEditorGeometry.js, dskEditorPresets.js, fileUtils.js, formatting.js, googleCredential.js, i18n.js, inputLang.js, normalizeLines.js, plannerUtils.js, relayConfig.js, settings.js, settingsIO.js, storageKeys.js, sttConfig.js, targetConfig.js, translate.js, translationConfig.js, viewerUtils.js, youtubeApi.js, youtubeAuth.js
- `lib/metacode-*` — Metacode helpers: metacode-parser.js, metacode-active.js, metacode-planner.js, metacode-runtime.js (frontend metacode logic; `fileUtils.js`, `activeCodes.js`, and `plannerUtils.js` keep compatibility re-exports)
- `locales/` — i18n translation files: en.js, fi.js, sv.js
- `styles/` — reset.css, layout.css, components.css, dashboard.css

**URL routing** (wouter-based):

#### Sidebar routes (inside `SidebarLayout`)

| Path | Component | Notes |
|---|---|---|
| `/` | `DashboardPage` | Dockable mini-panel grid (react-grid-layout) |
| `/captions` | `AppLayout` | Classic two-panel caption layout (files + input + sent log) |
| `/audio` | `AudioPage` | Full-page audio/STT controls |
| `/broadcast` | `BroadcastPage` | Encoder, YouTube OAuth, RTMP relay tabs |
| `/graphics/editor` | `DskEditorPage` | Visual DSK template editor |
| `/graphics/control` | `DskControlPage` | DSK broadcast control panel |
| `/graphics/viewports` | `DskViewportsPage` | DSK viewport management |
| `/production` | `ProductionOperatorPage` | Production operator control surface |
| `/production/cameras` | `ProductionCamerasPage` | Camera management |
| `/production/mixers` | `ProductionMixersPage` | Mixer management |
| `/production/bridges` | `ProductionBridgesPage` | Bridge instance management |
| `/production/devices` | `ProductionDevicesPage` | Device role management |
| `/planner` | `PlannerPage` | Event/service planner |
| `/translations` | `TranslationsPage` | Translation management |
| `/projects` | `ProjectsPage` | User project (API key) management |
| `/setup` | `SetupWizardPage` | Guided setup wizard |
| `/account` | `AccountPage` | Login/register or user profile |
| `/settings` | `SettingsPage` | Unified settings (General, CC, I/O tabs) |
| `/ai` | `AiSettingsPage` | AI/embedding provider config (feature-gated: `ai`) |

#### Standalone routes (no sidebar)

| Path | Component | Notes |
|---|---|---|
| `/view/:key` | `ViewerPage` | Full-screen caption viewer (public) |
| `/dsk/:key` | `DskPage` | DSK green-screen overlay (public, transparent bg) |
| `/dsk-control/:key` | `DskControlPage` | DSK control (standalone mode) |
| `/mcp/:sessionId` | `SpeechCapturePage` | MCP speech session |
| `/embed/audio` | `EmbedAudioPage` | Mic / STT capture widget |
| `/embed/input` | `EmbedInputPage` | Text input + sent log widget |
| `/embed/sentlog` | `EmbedSentLogPage` | Read-only delivery log (BroadcastChannel) |
| `/embed/file-drop` | `EmbedFileDropPage` | Drop-one-file player widget |
| `/embed/files` | `EmbedFilesPage` | Full file management widget |
| `/embed/settings` | `EmbedSettingsPage` | Settings widget |
| `/embed/rtmp` | `EmbedRtmpPage` | RTMP relay-only widget |
| `/embed/viewer` | `EmbedViewerPage` | Embeddable viewer widget |
| `/login` | `LoginPage` | Two-phase login: backend selection → feature discovery → auth/API key |
| `/register` | `RegisterPage` | User registration (standalone access) |
| `/device-login` | `DeviceLoginPage` | Device pin-code login |
| `/production/camera/:key` | `CameraStreamPage` | Camera stream view |
| `/production/lcyt-mixer/:key` | `LcytMixerPage` | LCYT software mixer view |
| `/legacy` | `App` | Legacy two-panel layout |

**Embed pages** (`/embed/*`) accept `?server=`, `?apikey=`, and `?theme=` URL params and auto-connect when credentials are present. All session-owning embed pages (`/embed/audio`, `/embed/input`, `/embed/file-drop`, `/embed/files`) operate in `embed` mode: they broadcast the JWT token (`lcyt:session`) and each sent caption (`lcyt:caption`) on `BroadcastChannel('lcyt-embed')` so a sibling `/embed/sentlog` can subscribe without owning a session. See `docs/guide/embed.md` for full documentation.

**`AppProviders` props** (`src/contexts/AppProviders.jsx`):

| Prop | Type | Description |
|---|---|---|
| `initConfig` | `{ backendUrl, apiKey, streamKey? }` | Pre-populate credentials (overrides localStorage); used by embed pages to pass URL params |
| `autoConnect` | `boolean` | Call `session.connect(initConfig)` on mount when credentials are valid |
| `embed` | `boolean` | Enable BroadcastChannel broadcasting for cross-widget coordination |

---

## Python Packages

### `python-packages/lcyt` — Core Library (v1.2.0)

Published to PyPI. Python 3.10+.

- `lcyt/sender.py` — `YoutubeLiveCaptionSender` + `Caption`/`SendResult` dataclasses. Uses `http.client` (stdlib only).
- `lcyt/backend_sender.py` — `BackendCaptionSender` (relay client).
- `lcyt/config.py` — `LCYTConfig` dataclass, `load_config()`, `save_config()`, `build_ingestion_url()`.
- `lcyt/errors.py` — `LCYTError`, `ConfigError`, `NetworkError`, `ValidationError`.

> **Timestamp difference:** In Python, bare numeric epochs >= 1000 are treated as **seconds** (vs. milliseconds in Node.js). ISO strings use the same format on both platforms: `YYYY-MM-DDTHH:MM:SS.mmm` (no trailing Z).

---

### `python-packages/lcyt-backend` — Flask Backend (v1.0.0)

Feature parity with the Node.js backend. cPanel/Phusion Passenger compatible.

**Key files:**
- `lcyt_backend/app.py` — Flask app factory
- `lcyt_backend/db.py` — SQLite via stdlib `sqlite3`
- `lcyt_backend/store.py` — in-memory session store
- `lcyt_backend/_jwt.py` — **stdlib-only HS256 JWT** using `hmac` + `hashlib` (no external crypto dep)
- `lcyt_backend/routes/` — `live.py`, `captions.py`, `sync.py`, `keys.py` (Flask blueprints)
- `lcyt_backend/middleware/` — `auth.py`, `cors.py`, `admin.py`
- `passenger_wsgi.py` — cPanel entry point (`application = create_app()`)
- `run.py` — development server

**Commands:**
```bash
# from python-packages/lcyt-backend/
python run.py      # dev server
pytest             # run tests
```

**Tests:** `tests/test_*.py` with `conftest.py` fixtures.

---

### `python-packages/lcyt-mcp` — Python MCP Server (v0.1.0, alpha)

Python MCP server with the same tool interface as the Node.js version.

- `lcyt_mcp/server.py` — entry point
- Entry point script: `lcyt_mcp = "lcyt_mcp.server:main"`

---

## Android Apps

### `android/lcyt-tv` — Android TV Caption Viewer

Kotlin + Jetpack Compose for TV app. Subscribes to the public `GET /viewer/:key` SSE endpoint and displays captions full-screen on Android TV / Fire TV devices. No authentication required — uses the **viewer target** type configured in the web UI (CC → Targets tab).

**Min SDK:** API 21 (Android 5.0 / Fire TV Gen 1+)
**Build tool:** Gradle with version catalog (`gradle/libs.versions.toml`)

**Key source files (`app/src/main/java/fi/lcyt/tv/`):**
- `SseClient.kt` — OkHttp streaming SSE client; emits typed `SseEvent`s; exponential-backoff reconnect (1 s → 30 s max)
- `CaptionViewModel.kt` — `StateFlow`-driven state; persists `backendUrl` + `viewerKey` in `SharedPreferences`; default backend URL: `https://api.lcyt.fi`
- `SettingsScreen.kt` — D-pad-friendly settings screen; only the viewer key is required from the user
- `MainActivity.kt` — Compose entry point; full-screen viewer with large current caption, dimmed history list, status dot; Menu key opens settings

**SSE payload received** (from `GET /viewer/:key`):
```json
{ "text": "...", "composedText": "original<br>translation", "sequence": 42,
  "timestamp": "2026-03-10T12:00:00.000", "translations": { "fi-FI": "..." } }
```
`composedText` is displayed by default (mirrors `viewerUtils.js` behaviour). `<br>` splits original and translation onto separate lines.

**Configuration:**
- First launch → settings screen → enter viewer key (backend URL pre-filled)
- Settings persisted in `SharedPreferences`
- Deep-link: `lcyt-tv://viewer?server=https://api.lcyt.fi&key=myevent` (scannable QR from web UI)

**Build:**
```bash
cd android/lcyt-tv
./gradlew assembleDebug   # debug APK
./gradlew assembleRelease # release APK (requires signing config)
```

---

## CLI Usage

```bash
node_modules/.bin/lcyt                     # Full-screen mode
node_modules/.bin/lcyt "Hello, world!"    # Send single caption
node_modules/.bin/lcyt /batch "text"      # Batch mode
node_modules/.bin/lcyt --stream-key KEY   # Set stream key
node_modules/.bin/lcyt --heartbeat        # Test connection
node_modules/.bin/lcyt -i                 # Interactive line-by-line mode
```

---

## Testing

### Node.js
Uses Node's built-in `node:test` — no external test framework.

```bash
npm test                                        # all packages
npm test -w packages/lcyt                       # single package
npm test -w packages/lcyt-backend               # single package
npm test -w packages/plugins/lcyt-production    # plugin package
```

Test files: `test/*.test.js` inside each package.

### React components and hooks (lcyt-web only)
`packages/lcyt-web` uses **Vitest** (alongside `node:test`) for React hook and component tests that require a DOM environment.

```bash
npm run test:components -w packages/lcyt-web   # Vitest run (jsdom, @testing-library/react)
npm test -w packages/lcyt-web                  # node:test (pure utilities — unchanged)
```

Test files: `test/components/**/*.test.{js,jsx}`. Config: `packages/lcyt-web/vitest.config.js` (inherits Vite aliases via `mergeConfig`). Setup: `packages/lcyt-web/test/setup.vitest.js`.

### Python
Uses `pytest`.

```bash
# from python-packages/lcyt-backend/
pytest
pytest tests/test_captions.py   # single file
```

Test files: `tests/test_*.py`. Fixtures in `tests/conftest.py`.

---

## Key Conventions

### Error Hierarchy
All packages define a typed exception hierarchy: `LCYTError` (base) → `ConfigError`, `NetworkError` (has `statusCode`), `ValidationError` (has `field`). Always raise/throw the most specific type.

### Timestamp Handling
| Platform | Numeric value | ISO string |
|---|---|---|
| **Node.js** | >= 1000 → milliseconds | `YYYY-MM-DDTHH:MM:SS.mmm` |
| **Python** | >= 1000 → **seconds** | `YYYY-MM-DDTHH:MM:SS.mmm` |

No trailing `Z` in ISO strings — YouTube's API format.

### Caption Target Architecture

Captions are delivered to one or more **targets** configured in the lcyt-web CC → Targets tab.

**Target-array mode (current, recommended):**
- The client (lcyt-web) sends `POST /live` with `{ apiKey, domain, targets: [...] }` — **no top-level `streamKey`**.
- The backend creates a `YoutubeLiveCaptionSender` for each enabled YouTube target in the array.
- All senders are stored in `session.extraTargets = [{ id, type, sender }]`.
- `session.sender` is `null`; the backend synthesises a sequence number and emits a `caption_result` SSE event after fanning out to all targets.

**Legacy single-target mode (backward compatible):**
- The client sends `POST /live` with `{ apiKey, domain, streamKey }`.
- The backend creates one primary `YoutubeLiveCaptionSender` stored in `session.sender`.
- Additional targets can still be passed as the `targets` array; they are stored in `session.extraTargets`.
- Caption delivery calls `session.sender.send()` and uses the real YouTube response for the SSE result.

**Target types:**
| Type | Config field | Delivery mechanism |
|---|---|---|
| `youtube` | `streamKey` | `YoutubeLiveCaptionSender` per target; HTTP POST to YouTube ingestion API |
| `viewer` | `viewerKey` | `broadcastToViewers(key, payload)` → SSE `GET /viewer/:key` (public, no auth) |
| `generic` | `url`, `headers` | HTTP POST JSON `{ source, sequence, captions: [...] }` to arbitrary endpoint |

**`BackendCaptionSender` (`packages/lcyt/src/backend-sender.js`):**
- `streamKey` is optional; omit it for target-array mode.
- `start({ targets })` — pass the targets array to register them server-side.
- `send()` / `sendBatch()` — always the same; the backend handles routing.

### Authentication

1. **Session JWT Bearer** (`Authorization: Bearer <token>`) — session-level; payload `{ sessionId, apiKey }`. Used for `/live`, `/captions`, `/sync`, `/events`, `/stats`, `/file`, `/mic`.
2. **User JWT Bearer** (`Authorization: Bearer <token>`) — user-level; payload `{ type: 'user', userId, email }`. Used for `/auth/me`, `/auth/change-password`, user-owned `/keys` routes. 30-day TTL.
3. **Admin API key** (`X-Admin-Key` header) — server-level; for `/keys` admin routes. Uses constant-time comparison.
4. **DSK Editor API key** (`X-API-Key` header) — API key auth for DSK template management and image routes (no live session required). Falls through to JWT Bearer if header absent (`editorAuthOrBearer` middleware).
5. Sessions are ephemeral (in-memory). Session ID = SHA-256 of `apiKey:streamKey:domain` where `streamKey` defaults to `''` in target-array mode.

### Two-Phase Login & Feature-Based UI

lcyt-web uses a **two-phase login** flow that adapts to backend capabilities:

**Phase 1 — Backend Selection:** The login page (`/login`) presents a dropdown with backend presets:
- **Normal** (`https://api.lcyt.fi`) — full-featured Node.js backend
- **Minimal** (`https://minimal.lcyt.fi`) — Python minimal backend (captions only)
- **Custom** — user enters a self-hosted URL

After selection, the frontend probes `GET /health` to discover the backend's feature list.

**Phase 2 — Authentication:** Based on the features returned:
- If `login` is in the features list → show email/password login form (user account mode)
- If `login` is NOT in the features list → show API key entry only (minimal mode, no user account needed)

**Feature-based UI gating:** Backend features from `GET /health` are stored in `localStorage` (`lcyt.backend.features`) and exposed via `ConnectionContext.backendFeatures`. Sidebar navigation items and groups have an optional `feature` property in `navConfig.js` that controls visibility:

| Feature | Controls | Hidden when missing |
|---------|----------|-------------------|
| `rtmp` | Broadcast page | Sidebar "Broadcast" item |
| `graphics` | Graphics group | Sidebar "Graphics" group (Editor, Control, Viewports) |
| `production` | Production group | Sidebar "Production" group (Operator, Devices) |
| `login` | User account pages | Sidebar "Projects" and "Account" items |
| `ai` | AI settings page | Sidebar "AI" item |

**AuthGate** (`main.jsx`) supports two modes:
1. **User login mode** — checks `lcyt-user` localStorage for `{ token, backendUrl }`
2. **Minimal mode** — checks `lcyt.backend.features` (no `login` feature) + `lcyt.session.config` (has `backendUrl` + `apiKey`)

### User Management

User accounts (`USE_USER_LOGINS` is enabled by default; set to `0` to disable):
- Users register with email + password via `POST /auth/register`.
- Login returns a 30-day user JWT via `POST /auth/login`.
- Authenticated users can create/rename/revoke their own API keys (projects) via `GET/POST/PATCH/DELETE /keys` with a user Bearer token.
- The `api_keys` table has a `user_id` FK linking project keys to their owner.
- Admin CLI supports full user CRUD: `lcyt-backend-admin users [list|info|add|set-password|deactivate|activate|delete]`.

### Plugin Architecture

Backend plugins live in `packages/plugins/` and follow this pattern:
- Export `init*()` — runs DB migrations and starts background services; called once at startup.
- Export `create*Router()` / `create*Routers()` — returns Express router(s) to mount.
- Injected dependencies: `db` (SQLite instance), `store` (SessionStore), `auth` (JWT middleware), `relayManager` (from `lcyt-rtmp`, not inline in `lcyt-backend`).
- Plugin packages are workspace members via the glob `packages/plugins/*` in `package.json`.
- `lcyt-rtmp` is the canonical source for `RtmpRelayManager`, `HlsManager`, `RadioManager`, `PreviewManager`, `HlsSubsManager`, `SttManager`, `NginxManager`, and `MediaMtxClient`. The `lcyt-backend` no longer contains these classes directly.

### Server-side STT Architecture

Server-side speech-to-text transcription converts an incoming RTMP/HLS/WHEP audio stream into captions without requiring a browser microphone. Transcripts are injected directly into the session's `_sendQueue` and delivered to YouTube just like manually typed captions.

**Audio sources:**
| Source | How it works |
|---|---|
| `hls` | `HlsSegmentFetcher` polls MediaMTX fMP4 HLS playlist; segments sent to STT adapter |
| `rtmp` | ffmpeg reads RTMP stream and writes PCM/WAV frames to the adapter's stdin |
| `whep` | ffmpeg reads WHEP (WebRTC-HTTP Egress Protocol) stream and writes PCM frames |

**Providers:**
| Provider | Class | Notes |
|---|---|---|
| `google` | `GoogleSttAdapter` | REST (default) or gRPC (`GOOGLE_STT_MODE=grpc`); service account or API key auth |
| `whisper_http` | `WhisperHttpAdapter` | Any Whisper-compatible HTTP endpoint |
| `openai` | `OpenAiAdapter` | OpenAI `/audio/transcriptions`-compatible endpoint |

**Confidence filtering:** Each `POST /stt/start` request accepts an optional `confidenceThreshold` (0–1). Transcripts below the threshold are silently dropped.

**Per-key config persistence:** `GET/PUT /stt/config` stores preferred provider, language, audioSource, and confidenceThreshold in the DB (`lcyt-rtmp`'s `getSttConfig`/`setSttConfig`).

### DSK Graphics System

- **Templates** are JSON objects describing a layered HTML page (background, layers with text/rect/image types).
- The **renderer** (`lcyt-dsk/src/renderer.js`) holds a single persistent Chromium instance; per-key pages are rendered and optionally streamed to nginx-rtmp via ffmpeg.
- **Caption metacodes** (`<!-- graphics:... -->`) in caption text are intercepted by `captionProcessor` before delivery, triggering SSE events to connected DSK overlay pages.
- **Viewports** define named display regions (e.g. `vertical-left`, `landscape`). The default landscape display is aliased as `landscape`, `default`, or `main`.
- **Delta mode** (`+name`, `-name` prefixes) lets captions add/remove individual graphic elements without replacing the full active set.

### Metacode Organization

- Plugin metacode handling stays inside plugin-owned processors; the DSK `graphics` metacode remains in `packages/plugins/lcyt-dsk/src/caption-processor.js`. The `cue` metacode is handled by `packages/plugins/lcyt-cues/src/cue-processor.js`.
- Core backend metacode handoff now lives in `packages/lcyt-backend/src/metacode.js` (dedicated helper), used by the captions router and other backend consumers.
- Frontend metacode parser, runtime, manual-state, and planner helpers live in `packages/lcyt-web/src/lib/metacode-parser.js`, `packages/lcyt-web/src/lib/metacode-active.js`, `packages/lcyt-web/src/lib/metacode-planner.js`, and `packages/lcyt-web/src/lib/metacode-runtime.js`. The parser extracts cue metacodes (`cue:`, `cue*:`, `cue**:`, `cue~:`, `cue[semantic]:`, `cue[events]:`) alongside standard metacodes.
- For compatibility, `packages/lcyt-web/src/lib/fileUtils.js`, `packages/lcyt-web/src/lib/activeCodes.js`, and `packages/lcyt-web/src/lib/plannerUtils.js` continue to re-export or adapt the moved helpers so existing imports keep working.
- See `docs/METACODE.md` and `docs/plans/plan_metacode_refactor.md` for the current scoped refactor plan.

### ESM/CJS Dual Package (`packages/lcyt`)
- ESM source in `src/` (canonical).
- CJS output in `dist/` generated by `scripts/build-cjs.js` (custom transformer, no bundler).
- Run `npm run build` before publishing or importing CJS.

### Embed Widget Coordination (lcyt-web)

Embed pages that own a session (`/embed/audio`, `/embed/input`, `/embed/file-drop`, `/embed/files`) broadcast state via `BroadcastChannel('lcyt-embed')`. `/embed/sentlog` listens on the same channel without owning a session. All iframes must share the same origin.

| Message type | Sender | Receiver | Payload |
|---|---|---|---|
| `lcyt:session` | session-owning embed | sentlog | `{ token, backendUrl }` — emitted on connect and in response to `lcyt:request_session` |
| `lcyt:caption` | session-owning embed | sentlog | `{ requestId, text, timestamp }` — emitted per caption sent |
| `lcyt:request_session` | sentlog | session-owning embed | _(no payload)_ — emitted on sentlog mount so it gets the token even if already connected |

`useSession.onConnected` payload includes `token: sender._token` so `AppProviders` (embed mode) can broadcast it without accessing the sender ref directly.

### Logger
Use the `lcyt/logger` module rather than `console.*` directly. For MCP contexts, set `LCYT_LOG_STDERR=1` to avoid writing to stdout (which the MCP protocol uses).

### Configuration
- CLI config: `~/.lcyt-config.json`. Precedence: CLI args > config file > defaults.
- Server config: environment variables only (12-factor style). Warn at startup if `JWT_SECRET` / `ADMIN_KEY` are missing.

### Legacy Python Source
`python/` at the repo root is **legacy**. Do not add code there. All Python development goes in `python-packages/`.

---

## Key Files Reference

| File | Purpose |
|---|---|
| `package.json` | Root workspace (workspaces: `packages/lcyt`, `packages/lcyt-cli`, `packages/lcyt-backend`, `packages/lcyt-web`, `packages/lcyt-mcp-stdio`, `packages/lcyt-mcp-sse`, `packages/lcyt-site`, `packages/lcyt-bridge`, `packages/plugins/*`) |
| `packages/lcyt/src/sender.js` | Core caption sender (Node.js) |
| `packages/lcyt/src/errors.js` | Error classes (Node.js) |
| `packages/lcyt/scripts/build-cjs.js` | ESM→CJS build transformer |
| `packages/lcyt-cli/bin/lcyt` | CLI entrypoint |
| `packages/lcyt-cli/src/interactive-ui.js` | Full-screen blessed terminal UI |
| `packages/lcyt-backend/src/server.js` | Express app factory (imports + mounts all plugins and routers) |
| `packages/lcyt-backend/src/store.js` | In-memory session store (emitter + send queue + extraTargets per session) |
| `packages/lcyt-backend/src/dsk-bus.js` | DskBus: DSK graphics SSE subscriber registry + per-key graphics state |
| `packages/lcyt-backend/src/ffmpeg/index.js` | ffmpeg runner factory (local / docker / worker) |
| `packages/lcyt-backend/src/routes/auth.js` | User registration/login/me/change-password routes |
| `packages/lcyt-backend/src/routes/keys.js` | API key CRUD (admin + user project management) |
| `packages/lcyt-backend/src/routes/events.js` | SSE delivery-result stream (authenticated, session owner) |
| `packages/lcyt-backend/src/routes/viewer.js` | Public SSE broadcast stream `GET /viewer/:key` — no auth, CORS `*` |
| `packages/lcyt-backend/src/routes/radio.js` | Audio-only HLS streaming (public, rate-limited) |
| `packages/lcyt-backend/src/routes/stream-hls.js` | Video+audio HLS streaming (public, rate-limited) |
| `packages/lcyt-backend/src/routes/preview.js` | RTMP → JPEG thumbnail serving (public) |
| `packages/lcyt-backend/src/routes/youtube.js` | YouTube OAuth client ID endpoint |
| `packages/lcyt-backend/src/routes/video.js` | `GET /video/:key` — HLS.js player, master manifest, subtitle playlist + segment serving |
| `packages/lcyt-backend/src/routes/stats.js` | Per-key usage stats + GDPR erasure |
| `packages/lcyt-backend/src/routes/usage.js` | Per-domain caption statistics |
| `packages/lcyt-backend/src/routes/mic.js` | Soft mic lock for collaborative sessions |
| `packages/lcyt-backend/src/routes/stt.js` | Server-side STT routes (`/stt/*`) — delegates to `SttManager` from `lcyt-rtmp` |
| `packages/lcyt-backend/src/routes/device-roles.js` | Device role CRUD + pin-code auth for production devices |
| `packages/lcyt-backend/src/routes/project-features.js` | Per-project feature flag CRUD |
| `packages/lcyt-backend/src/routes/project-members.js` | Project membership CRUD |
| `packages/lcyt-backend/src/routes/bridge-download.js` | Bridge agent binary download endpoint |
| `packages/lcyt-backend/src/db.js` | SQLite store re-export (modular, from src/db/) |
| `packages/plugins/lcyt-rtmp/src/api.js` | RTMP plugin entry: `initRtmpControl()` + `createRtmpRouters()` |
| `packages/plugins/lcyt-rtmp/src/rtmp-manager.js` | RTMP relay session manager |
| `packages/plugins/lcyt-rtmp/src/hls-manager.js` | MediaMTX-based RTMP → video+audio HLS manager |
| `packages/plugins/lcyt-rtmp/src/radio-manager.js` | Audio-only HLS manager (ffmpeg or MediaMTX mode) |
| `packages/plugins/lcyt-rtmp/src/preview-manager.js` | RTMP → JPEG thumbnail manager (MediaMTX API or ffmpeg) |
| `packages/plugins/lcyt-rtmp/src/hls-subs-manager.js` | Rolling WebVTT segment writer for subtitle sidecars |
| `packages/plugins/lcyt-rtmp/src/nginx-manager.js` | Nginx location writer for MediaMTX radio streams |
| `packages/plugins/lcyt-rtmp/src/mediamtx-client.js` | MediaMTX v3 REST API client |
| `packages/plugins/lcyt-rtmp/src/stt-manager.js` | STT session manager — wires HLS fetcher → adapter → session send queue |
| `packages/plugins/lcyt-rtmp/src/hls-segment-fetcher.js` | Polls MediaMTX fMP4 HLS playlist and emits segment buffers |
| `packages/plugins/lcyt-rtmp/src/stt-adapters/google-stt.js` | Google Cloud STT adapter (REST + gRPC modes) |
| `packages/plugins/lcyt-rtmp/src/stt-adapters/whisper-http.js` | Whisper HTTP STT adapter |
| `packages/plugins/lcyt-rtmp/src/stt-adapters/openai.js` | OpenAI-compatible STT adapter |
| `packages/plugins/lcyt-rtmp/src/stt-adapters/pcm-buffer.js` | PCM silence buffer + WAV builder |
| `packages/lcyt-orchestrator/src/index.js` | Compute orchestrator — worker registry + job dispatch + burst provisioning |
| `packages/lcyt-orchestrator/src/hetzner.js` | Hetzner Cloud API client (burst VM lifecycle) |
| `packages/lcyt-orchestrator/src/autoscaler.js` | Periodic autoscaler — provisions burst VMs on queue pressure |
| `packages/lcyt-worker-daemon/src/index.js` | Worker daemon — job lifecycle + optional subprocess + S3 upload wiring |
| `packages/lcyt-backend/src/db/index.js` | DB init + all table migrations (users, api_keys, sessions, etc.) |
| `packages/lcyt-backend/src/db/users.js` | User CRUD operations |
| `packages/lcyt-backend/src/middleware/auth.js` | Session JWT Bearer verification |
| `packages/lcyt-backend/src/middleware/user-auth.js` | User JWT Bearer verification |
| `packages/lcyt-backend/bin/lcyt-backend-admin` | Admin CLI for key + user management |
| `packages/lcyt-mcp-stdio/src/server.js` | MCP server — stdio transport |
| `packages/lcyt-mcp-sse/src/server.js` | MCP server — HTTP SSE transport |
| `packages/plugins/lcyt-production/src/api.js` | Production control router + init function |
| `packages/plugins/lcyt-production/src/registry.js` | DeviceRegistry: camera + mixer adapter management |
| `packages/plugins/lcyt-production/src/bridge-manager.js` | BridgeManager: SSE command dispatch to bridge agents |
| `packages/plugins/lcyt-dsk/src/api.js` | DSK plugin entry: `initDskControl()` + `createDskRouters()` |
| `packages/plugins/lcyt-dsk/src/renderer.js` | Playwright Chromium renderer: per-key template rendering + ffmpeg RTMP output |
| `packages/plugins/lcyt-dsk/src/renderer-container.js` | Docker-based DSK renderer alternative |
| `packages/plugins/lcyt-dsk/src/caption-processor.js` | DSK caption metacode processor (graphics:... comments → SSE events) |
| `packages/plugins/lcyt-dsk/src/middleware/editor-auth.js` | X-API-Key auth + `editorAuthOrBearer` middleware |
| `packages/plugins/lcyt-cues/src/api.js` | Cue Engine plugin entry: `initCueEngine()` + `createCueProcessor()` + `createCueRouter()` + `createSoundCueListener()` |
| `packages/plugins/lcyt-cues/src/cue-engine.js` | CueEngine: phrase/regex/fuzzy/semantic/event cue matching + silence timer |
| `packages/plugins/lcyt-cues/src/cue-processor.js` | Cue caption metacode processor (cue:... comments → SSE events) |
| `packages/plugins/lcyt-agent/src/api.js` | AI Agent plugin entry: `initAgent()` + `createAgentRouter()` + `createAiRouter()` |
| `packages/plugins/lcyt-agent/src/agent-engine.js` | AgentEngine: context window, event cue LLM evaluation, embeddings |
| `packages/plugins/lcyt-agent/src/ai-config.js` | Per-API-key AI model settings DB helpers |
| `packages/plugins/lcyt-agent/src/embeddings.js` | OpenAI-compatible embedding API client |
| `packages/lcyt-bridge/src/index.js` | Bridge agent entrypoint |
| `packages/lcyt-bridge/src/bridge.js` | Bridge SSE client + TCP command dispatcher |
| `packages/lcyt-bridge/src/tcp-pool.js` | Managed TCP connection pool |
| `packages/lcyt-web/src/main.jsx` | React entry point + wouter-based routing for sidebar and standalone pages |
| `packages/lcyt-web/src/App.jsx` | Legacy two-panel caption layout (mounted at `/captions` and `/legacy`) |
| `packages/lcyt-web/src/components/SidebarLayout.jsx` | Sidebar navigation shell: TopBar, Sidebar, drawer, reconnect banner |
| `packages/lcyt-web/src/components/DashboardPage.jsx` | `/` — dockable mini-panel grid (react-grid-layout) |
| `packages/lcyt-web/src/components/AudioPage.jsx` | `/audio` — full-page audio/STT controls |
| `packages/lcyt-web/src/components/BroadcastPage.jsx` | `/broadcast` — encoder, YouTube, RTMP relay tabs |
| `packages/lcyt-web/src/components/SettingsPage.jsx` | `/settings` — unified settings (General / CC / I/O) |
| `packages/lcyt-web/src/components/SetupWizardPage.jsx` | `/setup` — guided setup wizard |
| `packages/lcyt-web/src/components/AccountPage.jsx` | `/account` — login/register or user profile |
| `packages/lcyt-web/src/components/PlannerPage.jsx` | `/planner` — event/service planner |
| `packages/lcyt-web/src/components/TranslationsPage.jsx` | `/translations` — translation management |
| `packages/lcyt-web/src/components/DeviceLoginPage.jsx` | `/device-login` — device pin-code login |
| `packages/lcyt-web/src/components/CameraStreamPage.jsx` | `/production/camera/:key` — camera stream view |
| `packages/lcyt-web/src/components/LcytMixerPage.jsx` | `/production/lcyt-mixer/:key` — LCYT software mixer |
| `packages/lcyt-web/src/components/ProductionDevicesPage.jsx` | `/production/devices` — device role management |
| `packages/lcyt-web/src/contexts/AppProviders.jsx` | All context providers; accepts `initConfig`, `autoConnect`, `embed` for embed pages |
| `packages/lcyt-web/src/contexts/ConnectionContext.jsx` | Connection state, health, connect/disconnect |
| `packages/lcyt-web/src/contexts/CaptionContext.jsx` | Send, sendBatch, sequence, syncOffset |
| `packages/lcyt-web/src/contexts/AudioContext.jsx` | Audio/STT state and controls |
| `packages/lcyt-web/src/contexts/LangContext.jsx` | i18n language provider |
| `packages/lcyt-web/src/hooks/useSession.js` | BackendCaptionSender session lifecycle hook; `onConnected` payload includes `token` |
| `packages/lcyt-web/src/hooks/useDashboardConfig.js` | Dashboard panel/layout CRUD (localStorage persistence) |
| `packages/lcyt-web/src/hooks/useWebSpeech.js` | WebSpeech recognition state machine (start, stop, error recovery) |
| `packages/lcyt-web/src/hooks/useProjectFeatures.js` | Project feature flag hook |
| `packages/lcyt-web/src/hooks/useUserAuth.js` | User authentication hook |
| `packages/lcyt-web/src/lib/storageKeys.js` | Normalized localStorage key registry (`lcyt.{category}.{key}` convention) |
| `packages/lcyt-web/src/lib/settingsIO.js` | Settings export/import (downloadSettings, importSettings) |
| `packages/lcyt-web/src/lib/i18n.js` | i18n framework (locale loading, `useLang` hook) |
| `packages/lcyt-web/src/components/EmbedAudioPage.jsx` | `/embed/audio` — mic/STT capture widget |
| `packages/lcyt-web/src/components/DskPage.jsx` | `/dsk/:key` — DSK green-screen overlay page |
| `packages/lcyt-web/src/components/DskEditorPage.jsx` | `/graphics/editor` — visual DSK template editor |
| `packages/lcyt-web/src/components/DskControlPage.jsx` | `/graphics/control` — DSK broadcast control panel |
| `packages/lcyt-web/src/components/DskViewportsPage.jsx` | `/graphics/viewports` — DSK viewport management |
| `packages/lcyt-web/src/components/ViewerPage.jsx` | `/view/:key` — full-screen caption viewer |
| `packages/lcyt-web/src/components/ProductionOperatorPage.jsx` | `/production` — operator control surface |
| `packages/lcyt-web/src/components/ProductionCamerasPage.jsx` | `/production/cameras` — camera management |
| `packages/lcyt-web/src/components/ProductionMixersPage.jsx` | `/production/mixers` — mixer management |
| `packages/lcyt-web/src/components/ProductionBridgesPage.jsx` | `/production/bridges` — bridge management |
| `packages/lcyt-web/src/components/LoginPage.jsx` | `/login` — two-phase login (backend preset → probe → auth/API key) |
| `packages/lcyt-web/src/components/RegisterPage.jsx` | `/register` — user registration (standalone) |
| `packages/lcyt-web/src/components/ProjectsPage.jsx` | `/projects` — user project (API key) management |
| `python-packages/lcyt/lcyt/sender.py` | Core caption sender (Python) |
| `python-packages/lcyt-backend/lcyt_backend/app.py` | Flask app factory |
| `python-packages/lcyt-backend/lcyt_backend/_jwt.py` | Stdlib-only HS256 JWT |
| `python-packages/lcyt-backend/passenger_wsgi.py` | cPanel entry point |
| `python-packages/lcyt-backend/run.py` | Python dev server |
| `android/lcyt-tv/app/src/main/java/fi/lcyt/tv/SseClient.kt` | OkHttp SSE client for Android TV viewer |
| `android/lcyt-tv/app/src/main/java/fi/lcyt/tv/CaptionViewModel.kt` | StateFlow state + SharedPreferences persistence |
| `android/lcyt-tv/app/src/main/java/fi/lcyt/tv/MainActivity.kt` | Compose TV viewer UI + deep-link handling |
| `android/lcyt-tv/gradle/libs.versions.toml` | Dependency version catalog |

---

## Test Coverage

*Last updated: 2026-03-27 (lcyt-web sidebar navigation, component split, new plugins added)*

### Coverage Summary

| Package | Source LOC | Test LOC | Coverage | Priority | Key Gaps |
|---------|-----------|----------|----------|----------|-----------|
| `packages/lcyt` | 1,016 | 1,267 | Excellent | Low | `logger.js`, `config.js` (no direct tests) |
| `packages/lcyt-cli` | 1,836 | ~900 | Moderate | Low | Blessed rendering (requires full blessed mock) |
| `packages/lcyt-backend` | ~3,500 | ~2,750 | Good | Low | graceful shutdown (`index.js`), `db/sequences.js`, `db/helpers.js` |
| `packages/plugins/lcyt-rtmp` | ~2,500 | ~600 | Moderate | Medium | `SttManager` audio-source switching (rtmp/whep), grpc streaming path, `NginxManager` reload |
| `packages/lcyt-orchestrator` | ~400 | ~200 | Moderate | Low | `autoscaler.js`, full burst-provisioning E2E |
| `packages/lcyt-worker-daemon` | ~200 | ~150 | Moderate | Low | `uploader.js`, S3 upload errors |
| `packages/lcyt-bridge` | 490 | ~400 | Good | Low | `tray.js` (desktop-only), entry-point env-var validation |
| `packages/lcyt-mcp-stdio` | 272 | ~300 | Good | Low | Edge cases only |
| `packages/lcyt-mcp-sse` | 1,083 | ~450 | Good | Low | Full MCP tool-call flow via SSE (requires MCP client harness) |
| `packages/lcyt-web` | 5,000+ | ~1,000 | Good | Low | React components (sidebar, dashboard, pages, panels), embed pages, production pages |
| `python-packages/lcyt` | 1,053 | 1,200 | Excellent | Low | None identified |
| `python-packages/lcyt-backend` | 1,135 | 800 | Good | Low | `middleware/cors.py`, incomplete feature parity with Node.js backend |
| `python-packages/lcyt-mcp` | 252 | 300 | Good | Low | None identified |

---

### Per-Package Detail

#### `packages/lcyt` — Core Library
**Covered:** Constructor options, URL building, sequence tracking, timestamp formatting (Date/number/ISO), send/sendBatch flow, backend relay, error classes, network error handling.
**Gaps (Low):**
- `logger.js` — `setVerbose()`, `setSilent()`, `setUseStderr()`, `setCallback()`, output formatting
- `config.js` — `loadConfig()` edge cases, `saveConfig()` error paths

---

#### `packages/lcyt-cli` — CLI Tool
**Test files:** `test/cli.test.js` (25 tests), `test/interactive-ui.test.js` (49 tests, added 2026-03-16).
**Covered:** Argument parsing, `--heartbeat`, config precedence, session lifecycle. Pure-logic methods of `InteractiveUI`: `loadFile`, `shiftPointer`, `gotoLine`, `isSendableLine`, `sendCurrentLine`, `sendCustomCaption`, `sendBatch`, all `handleCommand` branches (`/load`, `/goto`, `/batch`, `/timestamps`, `/ts`, `/send`, `/stream`, `/reload`), `_parseVideoId`.
**Gaps (Medium):**
- `bin/lcyt` entry point — CLI argument error handling, `LCYT_LOG_STDERR` flag, env-variable precedence.
- Blessed rendering (`initScreen`, `updateTextPreview`, `updateStatus`) — requires a full blessed mock or snapshot approach.

---

#### `packages/lcyt-backend` — Express Relay Backend
**Test files:** 26 test files (608 tests total as of 2026-03-17) covering all primary routes plus newly added tests. RTMP/HLS/preview manager tests moved to `packages/plugins/lcyt-rtmp/test/`.
**Added 2026-03-16:**
- `test/auth.test.js` (20 tests) — Full auth lifecycle with in-memory SQLite: register, login, `GET /me`, `POST /change-password`, disabled logins (503).
- `test/video.test.js` (17 tests) — HLS player HTML (themes, CORS, Cache-Control), master manifest, subtitle playlist, segment serving, CORS preflight. Uses lightweight mock managers.
- `test/preview-route.test.js` (10 tests) — JPEG thumbnail serving with real temp-dir JPEG; key validation, 404, 200, CORS, Cache-Control, If-Modified-Since, OPTIONS.
- `test/stream.test.js` (22 tests) — RTMP relay slot CRUD with in-memory DB + mock `RtmpRelayManager`: auth, `relay_allowed` check, POST/GET/PUT/DELETE /stream, PUT /stream/active.

**Added 2026-03-17:**
- `test/cors.test.js` (19 tests) — `createCorsMiddleware`: free-tier signup, admin routes (no CORS), permissive routes (POST /live, GET /health, GET /contact, OPTIONS), dynamic origin matching via session store.
- `test/caption-files.test.js` (21 tests) — Pure-function exports: `composeCaptionText` (all translation/showOriginal branches), `formatVttTime` (edge cases: 0ms, sub-second, multi-hour), `buildVttCue` (format, end newline).

**Gaps (Low):**
- **Core:** `server.js` (Express factory), `index.js` (graceful shutdown on SIGTERM/SIGINT), `routes/stt.js` (server-side STT routes).
- **DB:** `db/sequences.js`, `db/helpers.js`.

---

#### `packages/plugins/lcyt-rtmp` — RTMP Relay Plugin
**Test files (node:test with `--experimental-test-module-mocks`):**
- `test/rtmp-manager.test.js` — `RtmpRelayManager`, `probeFfmpeg`: state queries, `start()`/`stop()`/`stopAll()`, `dropPublisher()`.
- `test/rtmp-manager.unit.test.js` — additional unit tests for relay manager edge cases.
- `test/nginx-manager.test.js` — `NginxManager`: config write, slug computation, reload, no-op mode.
- `test/hls-segment-fetcher.test.js` — `HlsSegmentFetcher`: playlist parsing, segment emission, poll interval.
- `test/pcm-buffer.test.js` — `PcmSilenceBuffer`: silence detection, `buildWav()`.
- `test/google-stt.test.js` — `GoogleSttAdapter`: REST flow, punctuation normalisation, segment skip on small buffers.
- `test/whisper-http.test.js` — `WhisperHttpAdapter`: HTTP POST, transcript emission.
- `test/openai-stt.test.js` — `OpenAiAdapter`: OpenAI-compatible endpoint, model param.
- `test/stt-manager.test.js` — `SttManager`: session lifecycle (start/stop), transcript routing to session send queue.
- `test/stt-manager-rtmp.test.js` — `SttManager` RTMP/WHEP audio source paths (ffmpeg-based).
- `test/hetzner.integration.test.js` — Hetzner client integration test (uses mock HTTP server).

**Gaps (Medium):**
- gRPC streaming path in `GoogleSttAdapter` (requires `@google-cloud/speech` to be installed).
- `NginxManager` nginx reload failure handling.
- Full STT session E2E (HLS playlist → segment fetch → transcript → SSE delivery).

---

#### `packages/lcyt-bridge` — Production Control Bridge Agent
**Test files:** `test/bridge.test.js` (22 tests), `test/tcp-pool.test.js` (13 tests).
**Covered:** Bridge SSE connection/reconnect, TCP pool, command dispatch (`tcp_send`), heartbeat, event forwarding.
**Gaps (Medium):**
- `tray.js` (105 LOC) — system tray icon/menu/exit handler (desktop only).
- `src/index.js` (107 LOC) — `BACKEND_URL`/`BRIDGE_TOKEN` validation, `.env` loading, SIGTERM shutdown.

---

#### `packages/lcyt-mcp-stdio` — MCP Server (stdio)
**Test files:** `test/server.test.js` (~15 tests) — tool invocation, session lifecycle, send/batch/sync/status.
**Gaps (Low):** Invalid input handling, tool descriptor validation, special-character captions.

---

#### `packages/lcyt-mcp-sse` — MCP Server (HTTP SSE)
**Test files:** `test/speech.test.js` (20 tests), `test/server.test.js` (6 tests, added 2026-03-17).
**Added 2026-03-17:**
- `test/server.test.js` (6 tests) — HTTP route logic: `POST /messages` returns 404 for unknown/missing sessionId, delegates to `transport.handlePostMessage` for known session; `GET /sse` returns 200 with `text/event-stream` when auth not required, 401 when `REQUIRE_API_KEY` is set; transport session isolation.
**Gaps (Low):**
- Full MCP tool-call flow (start → send_caption → stop) via SSE requires a real MCP client harness and is better covered by E2E tests.

---

#### `packages/lcyt-web` — Browser Web UI

**Test commands:**
- `npm test -w packages/lcyt-web` → `node --test test/*.test.js` — pure utility functions (59 tests)
- `npm run test:components -w packages/lcyt-web` → `vitest run` — React hooks/components (75 tests via jsdom)

**Test files (node:test):** `test/api.test.js`, `test/formatting.test.js`, `test/viewer.test.js` (~30 tests), `test/fileUtils.test.js` (27 tests, added 2026-03-16), `test/i18n.test.js` (11 tests, added 2026-03-16).
**Test files (Vitest):** `test/components/useSession.test.jsx` (25 tests), `test/components/useFileStore.test.jsx` (35 tests), `test/components/AppProviders.test.jsx` (15 tests) — all added 2026-03-16.

**Vitest setup (added 2026-03-16):**
- `vitest.config.js` — `mergeConfig(viteConfig, ...)` inherits `lcyt/*` alias resolution from `vite.config.js` automatically; no manual mapper needed.
- `test/setup.vitest.js` — `@testing-library/jest-dom`, localStorage/sessionStorage clear between tests, `EventSource` + `BroadcastChannel` global stubs.
- Mock pattern: `vi.fn(function() { return mockSender; })` (regular function, not arrow, so `new` works).

**Added 2026-03-16 (Vitest):**
- `test/components/useSession.test.jsx` — initial state, persistence helpers (`getPersistedConfig`, `getAutoConnect`/`setAutoConnect`, `clearPersistedConfig`), `connect()` (sets connected/backendUrl/apiKey/healthStatus, fires `onConnected` with token, persists config, throws on no token), `disconnect()` (sets connected=false, calls `end()`, fires `onDisconnected`, resets sequence, no-op when not connected), `send()` and `sendBatch()` (delegation + callbacks).
- `test/components/useFileStore.test.jsx` — initial state, `loadFile()` (file parsing, active tracking, `onFileLoaded`/`onActiveChanged` callbacks, localStorage persistence), `removeFile()`, `setActive()`/`cycleActive()`, `setPointer()`/`advancePointer()` (clamping, localStorage, callbacks), `createEmptyFile()`, `updateFileFromRawText()`, localStorage restore on remount.
- `test/components/AppProviders.test.jsx` — smoke render, `autoConnect` behaviour (connects when valid config, no-op otherwise), embed mode (`BroadcastChannel` opened/closed, `lcyt:session` broadcast on connect, responds to `lcyt:request_session`).

**Added 2026-03-17 (Vitest):**
- `test/components/useSentLog.test.jsx` (30 tests) — initial state, localStorage restore on mount (invalid JSON, non-array), `add()` (prepend order, pending flag, timestamp, localStorage persistence), `confirm()` (string + object arg, sequence update, no-op for unknown), `markError()` (error flag, clears pending, no-op for unknown, not persisted), `updateRequestId()`, `clear()` (empties entries + storage).
- `test/components/useToast.test.jsx` (18 tests) — `useToast`: initial state, `showToast()` (type default, custom type, unique IDs, auto-dismiss timer, no-dismiss when duration=0), `dismissToast()` (removes matching, partial, no-op for unknown); `ToastContainer`: no-crash empty, renders messages, CSS class, multiple toasts, click-to-dismiss with 200ms fade.

**Gaps (Low):**
- **React components** — 30+ leaf components (App, panels, modals, all pages) have no tests.
- **Embed pages** — BroadcastChannel cross-iframe caption coordination.
- **Production pages** — `/production/*` operator control surface.

---

#### `python-packages/lcyt` — Core Python Library
**Test files:** 4 test files, 121 tests — full coverage of sender, backend relay, config, and errors.
**Gaps (Low):** None identified.

---

#### `python-packages/lcyt-backend` — Flask Backend
**Test files:** 8 test files (~70 tests) — all primary routes (live, captions, sync, keys), DB, session store, JWT.
**Gaps (Medium):**
- `middleware/cors.py` — dynamic origin validation.
- Feature parity gaps vs. Node.js backend (no file management, stats, usage, viewer, icons routes tested).

---

#### `python-packages/lcyt-mcp` — Python MCP Server
**Test files:** `tests/test_server.py` (~15 tests).
**Gaps (Low):** Error handling for malformed requests, concurrent session limits.

---

### Top Priorities for Next Test Expansion

Items marked ✅ were completed 2026-03-16 or 2026-03-17.

1. ✅ **`packages/lcyt-backend` ffmpeg managers** *(Critical → Done)* — manager tests moved to `lcyt-rtmp` plugin (52+ tests).
2. ✅ **`packages/lcyt-backend` 5 untested routes** *(High → Done)* — `auth.test.js`, `video.test.js`, `preview-route.test.js`, `stream.test.js`, `youtube.test.js` added (69 tests).
3. ✅ **`packages/lcyt-cli/src/interactive-ui.js`** *(High → Done)* — `interactive-ui.test.js` added (49 tests).
4. ✅ **`packages/lcyt-web` pure utilities** *(High → Done)* — `fileUtils.test.js` + `i18n.test.js` added (38 tests).
5. ✅ **`packages/lcyt-web` React hooks + Vitest setup** *(Medium → Done)* — Vitest + jsdom added; `useSession.test.jsx` (25 tests), `useFileStore.test.jsx` (35 tests), `AppProviders.test.jsx` (15 tests) added (75 tests total).
6. ✅ **`packages/lcyt-backend/src/middleware/cors.js`** *(Medium → Done)* — `cors.test.js` added (19 tests).
7. ✅ **`packages/lcyt-backend/src/caption-files.js`** *(Medium → Done)* — `caption-files.test.js` added (21 tests, pure functions).
8. ✅ **`packages/lcyt-web` useSentLog + ToastContainer** *(Medium → Done)* — `useSentLog.test.jsx` (30 tests) + `useToast.test.jsx` (18 tests) added.
9. ✅ **`packages/lcyt-mcp-sse/src/server.js` HTTP routes** *(Medium → Done)* — `server.test.js` added (6 tests).
10. **`packages/lcyt-backend/src/index.js`** *(Low)* — graceful shutdown (SIGTERM/SIGINT) not tested; tightly coupled to process signals and server startup.
11. **`packages/plugins/lcyt-rtmp` STT gRPC path** *(Medium)* — `GoogleSttAdapter` gRPC streaming (requires `@google-cloud/speech` installed) not covered by CI.
12. **`packages/lcyt-backend/src/routes/stt.js`** *(Medium)* — server-side STT HTTP routes untested.
13. **`packages/lcyt-orchestrator` autoscaler** *(Low)* — `autoscaler.js` not covered; burst provisioning E2E requires Hetzner mock server.
