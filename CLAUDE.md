# live-captions-yt

## Overview

Monorepo for **LCYT** — a full-featured platform for sending live captions to YouTube Live via Google's HTTP POST caption ingestion API. Ships as a Node.js library + CLI, Python library, Express/Flask relay backends, a browser web UI, a Model Context Protocol (MCP) server for AI assistant integration, a production control layer for cameras/mixers, and a bridge agent for AV hardware.

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
│   ├── lcyt-web/               # Browser-based web UI (Vite + React)
│   └── production-control/     # Production control library (cameras, mixers, bridge)
├── python-packages/            # Python packages
│   ├── lcyt/                   # Core Python library (published to PyPI as `lcyt`)
│   ├── lcyt-backend/           # Flask backend (cPanel/Passenger compatible)
│   └── lcyt-mcp/               # Python MCP server
├── android/                    # Native Android apps
│   └── lcyt-tv/                # Android TV caption viewer (Kotlin + Compose for TV)
├── python/                     # LEGACY — do not use; canonical source is python-packages/
├── scripts/                    # Shell deployment scripts + screenshot capture
├── package.json                # Root workspace manifest
└── CLAUDE.md                   # This file
```

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

### `packages/lcyt` — Core Library (v2.3.0)

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

### `packages/lcyt-cli` — CLI Tool (v1.3.1)

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

HTTP relay: clients authenticate with API keys + JWT tokens, backend sends captions to YouTube on their behalf. Supports multi-user sessions.

**Entry:** `src/index.js` (graceful shutdown: SIGTERM/SIGINT, closes sender/DB/server)
**App factory:** `src/server.js`

**Environment variables:**
| Variable | Purpose | Default |
|---|---|---|
| `JWT_SECRET` | HS256 signing key | auto-generated (warns) |
| `ADMIN_KEY` | Admin endpoint auth | none (disables admin) |
| `DB_PATH` | SQLite file path | `./lcyt-backend.db` |
| `SESSION_TTL` | Session timeout (ms) | 7200000 (2h) |
| `CLEANUP_INTERVAL` | Session cleanup sweep interval (ms) | 300000 (5m) |
| `PORT` | HTTP port | 3000 |
| `STATIC_DIR` | Serve static files from this directory | none |
| `PUBLIC_URL` | Server's public URL (used in generated .env files) | none |
| `TRUST_PROXY` | Express `trust proxy` value | unset |
| `REVOKED_KEY_TTL_DAYS` | Days before revoked keys are purged | 30 |
| `REVOKED_KEY_CLEANUP_INTERVAL` | Revoked key cleanup interval (ms) | 86400000 (24h) |
| `ALLOWED_DOMAINS` | Comma-separated domains for session CORS filter | `lcyt.fi,www.lcyt.fi,localhost` |
| `ALLOWED_RTMP_DOMAINS` | Domains allowed to use `/stream` relay endpoints; falls back to `ALLOWED_DOMAINS` | (falls back) |
| `USAGE_PUBLIC` | If set, /usage endpoint needs no auth | unset |
| `FREE_APIKEY_ACTIVE` | If set, enables free API key self-registration endpoint | unset |
| `HLS_SUBS_ROOT` | Directory for WebVTT subtitle segment files | `/tmp/hls-subs` |
| `HLS_SUBS_SEGMENT_DURATION` | Subtitle segment length in seconds | `6` |
| `HLS_SUBS_WINDOW_SIZE` | Number of subtitle segments to keep per language | `10` |
| `HLS_ROOT` | HLS output directory for video+audio streams | `/tmp/hls-video` |
| `HLS_LOCAL_RTMP` | Local nginx-rtmp base URL for HLS/preview | `rtmp://127.0.0.1:1935` |
| `HLS_RTMP_APP` | RTMP application name for HLS/preview | `live` |
| `RADIO_HLS_ROOT` | HLS output directory for audio-only streams | `/tmp/hls` |
| `RADIO_LOCAL_RTMP` | Local nginx-rtmp URL for radio streams | `rtmp://127.0.0.1:1935` |
| `RADIO_RTMP_APP` | RTMP application name for radio | `live` |
| `RTMP_HOST` | RTMP host for RTMP relay | none |
| `RTMP_APP` / `RTMP_APPLICATION` | RTMP application name for relay | none |
| `RTMP_RELAY_ACTIVE` | If set, enables RTMP relay functionality | unset |
| `RTMP_CONTROL_URL` | nginx-rtmp control URL | none |
| `PREVIEW_ROOT` | Directory for JPEG thumbnail files | `/tmp/previews` |
| `PREVIEW_INTERVAL_S` | Seconds between thumbnail updates | `5` |
| `GRAPHICS_DIR` | Image storage directory for DSK overlays | `/data/images` |
| `GRAPHICS_ENABLED` | If set, enables image upload/management | unset |
| `GRAPHICS_MAX_FILE_BYTES` | Max uploaded image size in bytes | 5242880 (5 MB) |
| `GRAPHICS_MAX_STORAGE_BYTES` | Max total image storage per key in bytes | 52428800 (50 MB) |
| `YOUTUBE_CLIENT_ID` | Google OAuth 2.0 Web client ID (for client-side token flow) | none |
| `CONTACT_EMAIL` | Contact info returned by `GET /contact` | none |
| `CONTACT_NAME` | Contact name returned by `GET /contact` | none |
| `CONTACT_PHONE` | Contact phone returned by `GET /contact` | none |
| `CONTACT_WEBSITE` | Contact website returned by `GET /contact` | none |
| `CEA` | Enable CEA-608/708 caption encoding (experimental) | unset |

**API routes:**
```
GET  /health              — uptime, session count
GET  /contact             — server contact info (public)
POST /live                — register session → returns JWT
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
GET/POST/PATCH/DELETE /keys — admin CRUD (X-Admin-Key header)
GET  /video/:key              — HLS.js player page (public, CORS *, iframe-embeddable)
GET  /video/:key/master.m3u8  — HLS master manifest (video + subtitle tracks, public)
GET  /video/:key/subs/:lang/playlist.m3u8 — HLS subtitle playlist per language (public)
GET  /video/:key/subs/:lang/:seg.vtt      — WebVTT subtitle segment file (public)
GET  /viewer/:key         — public SSE broadcast stream (no auth, CORS *); viewer targets subscribe here
GET  /stream-hls/:key/*   — HLS video+audio segments and playlist (public, rate-limited)
GET  /radio/:key/*        — audio-only HLS segments and playlist (public, rate-limited)
GET  /preview/:key/incoming.jpg — latest RTMP → JPEG thumbnail (public)
GET  /dsk/:apikey/images  — list DSK overlay images for an API key (public)
GET  /dsk/:apikey/events  — SSE stream of graphics events for DSK page (public)
POST /dsk-rtmp            — nginx-rtmp on_publish/on_publish_done callbacks for DSK RTMP
POST /dsk-rtmp/on_publish
POST /dsk-rtmp/on_publish_done
GET/POST/PUT/DELETE /images/:id — image upload/management for DSK overlays (Bearer token)
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
```

**Key internals:**
- `src/db.js` — Re-exports from `src/db/index.js` (modular). `better-sqlite3` (synchronous). Core tables: `api_keys`, `caption_usage`, `session_stats`, `caption_errors`, `sessions`. Additional tables for graphics, radio, HLS, RTMP relay, and production control. Additive migrations run on startup.
- `src/store.js` — In-memory session store. Session = `{ sessionId, apiKey, streamKey, domain, sender, extraTargets, token, startedAt, lastActivity, sequence, syncOffset, emitter, _sendQueue }`. `sender` is null in target-array mode. `extraTargets` holds all targets including `youtube`, `viewer`, and `generic` types. `emitter` is a per-session `EventEmitter` for SSE routing. `_sendQueue` serialises concurrent YouTube sends so sequence numbers stay monotonic.
- `src/hls-manager.js` — `HlsManager`: manages ffmpeg subprocesses for RTMP → video+audio HLS.
- `src/radio-manager.js` — `RadioManager`: manages ffmpeg subprocesses for RTMP → audio-only HLS.
- `src/preview-manager.js` — `PreviewManager`: manages ffmpeg for RTMP → JPEG thumbnail generation.
- `src/rtmp-manager.js` — `RtmpRelayManager`: manages RTMP relay sessions; calls `probeFfmpeg()` on startup.
- `src/hls-subs-manager.js` — `HlsSubsManager`: rolling WebVTT segment writer for subtitle sidecars.
- `src/middleware/auth.js` — JWT Bearer verification.
- `src/middleware/cors.js` — Dynamic CORS: only allows registered session domains; never exposes admin routes.
- `src/middleware/admin.js` — `X-Admin-Key` constant-time comparison.
- `src/caption-files.js` — Caption file storage helpers.
- `src/backup.js` — DB backup utilities.

**SSE events** (on `GET /events`): `connected`, `caption_result`, `caption_error`, `session_closed`, `mic_state`.

**Admin CLI:** `bin/lcyt-backend-admin` — local key management.

**Docker:** `Dockerfile` — node:20-slim, exposes port 3000.

**Tests:** `packages/lcyt-backend/test/*.test.js` — uses `node:test`.

---

### `packages/production-control` — Production Control Library (v0.1.0)

Express router plugin for camera PTZ presets and video mixer source switching. Used as an internal dependency by `lcyt-backend`.

**Main entry:** `src/api.js`
**Usage in lcyt-backend:**
```js
import { createProductionRouter, initProductionControl } from 'production-control';
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
- `adapters/camera/none.js` — No-op camera adapter (software-only targets).
- `adapters/mixer/roland.js` — Roland video mixer adapter (TCP).
- `adapters/mixer/amx.js` — AMX mixer adapter (TCP).

**Camera control types:** `amx`, `none`
**Mixer types:** `roland`, `amx`

**Tests:** `packages/production-control/test/*.test.js` — uses `node:test`.

---

### `packages/lcyt-bridge` — Production Control Bridge Agent (v0.1.0)

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

Browser-based React app using Vite. Sends captions via the `lcyt-backend` relay.

**Build:** `npm run build:web` → `packages/lcyt-web/dist/`
**Dev:** `npm run web`

**Source (`src/`):**
- `main.jsx` — React entry point; path-based routing for the main app and all sub-pages (see below)
- `App.jsx` — root component (full two-panel layout)
- `components/` — React JSX components (see routing table below for embed/production pages; others include AudioPanel, CaptionView, DropZone, FileTabs, InputBar, PrivacyModal, SentPanel, SettingsModal, StatsModal, StatusBar, ToastContainer, CCModal, ControlsPanel, StatusPanel, FilesModal, BroadcastModal, CaptionsModal, ActionsPanel, FloatingPanel, LanguagePicker, MobileAudioBar, NormalizeLinesModal, TranslationModal, EmbedApiKeyGate)
- `contexts/` — React context providers: AppProviders, FileContext, SentLogContext, SessionContext, ToastContext
- `hooks/` — Custom React hooks: useSession, useFileStore, useSentLog, useToast
- `lib/` — Utilities: googleCredential.js, sttConfig.js
- `styles/` — reset.css, layout.css, components.css

**URL routing** (path-based, no router library):

| Path prefix | Rendered component | Notes |
|---|---|---|
| `/` | `App` | Full main UI |
| `/mcp/:sessionId` | `SpeechCapturePage` | MCP speech session (self-contained) |
| `/embed/audio` | `EmbedAudioPage` | Mic / STT capture widget |
| `/embed/input` | `EmbedInputPage` | Text input + sent log widget |
| `/embed/sentlog` | `EmbedSentLogPage` | Read-only delivery log (BroadcastChannel subscriber) |
| `/embed/file-drop` | `EmbedFileDropPage` | Drop-one-file player widget |
| `/embed/files` | `EmbedFilesPage` | Full file management widget |
| `/embed/settings` | `EmbedSettingsPage` | Settings widget — General tab (credentials, theme) + CC tab (targets, STT, translations) |
| `/embed/rtmp` | `EmbedRtmpPage` | RTMP relay-only widget — ingest address + relay slot management |
| `/embed/viewer` | `EmbedViewerPage` | Embeddable viewer widget |
| `/dsk/:key` | `DskPage` | DSK green-screen overlay page (no auth; driven by `/dsk/:apikey/events` SSE) |
| `/view/:key` | `ViewerPage` | Full-screen caption viewer page |
| `/production/cameras` | `ProductionCamerasPage` | Camera management UI (admin) |
| `/production/mixers` | `ProductionMixersPage` | Mixer management UI (admin) |
| `/production/bridges` | `ProductionBridgesPage` | Bridge instance management UI (admin) |
| `/production` | `ProductionOperatorPage` | Production operator control surface |

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
npm test                           # all packages
npm test -w packages/lcyt          # single package
npm test -w packages/lcyt-backend  # single package
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
1. **JWT Bearer** (`Authorization: Bearer <token>`) — session-level, for `/live`, `/captions`, `/sync`.
2. **Admin API key** (`X-Admin-Key` header) — server-level, for `/keys` admin routes. Uses constant-time comparison.
3. Sessions are ephemeral (in-memory). Session ID = SHA-256 of `apiKey:streamKey:domain` where `streamKey` defaults to `''` in target-array mode (no primary stream key).

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

`useSession.onConnected` payload now includes `token: sender._token` so `AppProviders` (embed mode) can broadcast it without accessing the sender ref directly.

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
| `package.json` | Root workspace (workspaces: `packages/lcyt`, `packages/lcyt-cli`, `packages/lcyt-backend`, `packages/lcyt-web`, `packages/lcyt-mcp-stdio`, `packages/lcyt-mcp-sse`, `packages/lcyt-site`, `packages/production-control`, `packages/lcyt-bridge`) |
| `packages/lcyt/src/sender.js` | Core caption sender (Node.js) |
| `packages/lcyt/src/errors.js` | Error classes (Node.js) |
| `packages/lcyt/scripts/build-cjs.js` | ESM→CJS build transformer |
| `packages/lcyt-cli/bin/lcyt` | CLI entrypoint |
| `packages/lcyt-cli/src/interactive-ui.js` | Full-screen blessed terminal UI |
| `packages/lcyt-backend/src/server.js` | Express app factory |
| `packages/lcyt-backend/src/store.js` | In-memory session store (emitter + send queue + extraTargets per session) |
| `packages/lcyt-backend/src/routes/events.js` | SSE delivery-result stream (authenticated, session owner) |
| `packages/lcyt-backend/src/routes/viewer.js` | Public SSE broadcast stream `GET /viewer/:key` — no auth, CORS `*`; used by viewer targets |
| `packages/lcyt-backend/src/routes/dsk.js` | DSK overlay public endpoints |
| `packages/lcyt-backend/src/routes/images.js` | Image upload/management for DSK overlays (authenticated) |
| `packages/lcyt-backend/src/routes/radio.js` | Audio-only HLS streaming (public, rate-limited) |
| `packages/lcyt-backend/src/routes/stream-hls.js` | Video+audio HLS streaming (public, rate-limited) |
| `packages/lcyt-backend/src/routes/preview.js` | RTMP → JPEG thumbnail serving (public) |
| `packages/lcyt-backend/src/routes/youtube.js` | YouTube OAuth client ID endpoint |
| `packages/lcyt-backend/src/hls-subs-manager.js` | HLS subtitle sidecar: rolling WebVTT segment writer + in-memory playlist manager |
| `packages/lcyt-backend/src/hls-manager.js` | ffmpeg manager for RTMP → video+audio HLS |
| `packages/lcyt-backend/src/radio-manager.js` | ffmpeg manager for RTMP → audio-only HLS |
| `packages/lcyt-backend/src/preview-manager.js` | ffmpeg manager for RTMP → JPEG thumbnails |
| `packages/lcyt-backend/src/rtmp-manager.js` | RTMP relay session manager |
| `packages/lcyt-backend/src/routes/video.js` | `GET /video/:key` — HLS.js player, master manifest, subtitle playlist + segment serving |
| `packages/lcyt-backend/src/routes/stats.js` | Per-key usage stats + GDPR erasure |
| `packages/lcyt-backend/src/routes/usage.js` | Per-domain caption statistics |
| `packages/lcyt-backend/src/routes/mic.js` | Soft mic lock for collaborative sessions |
| `packages/lcyt-backend/src/db.js` | SQLite store re-export (modular, from src/db/) |
| `packages/lcyt-mcp-stdio/src/server.js` | MCP server — stdio transport |
| `packages/lcyt-mcp-sse/src/server.js` | MCP server — HTTP SSE transport |
| `packages/production-control/src/api.js` | Production control router + init function |
| `packages/production-control/src/registry.js` | DeviceRegistry: camera + mixer adapter management |
| `packages/production-control/src/bridge-manager.js` | BridgeManager: SSE command dispatch to bridge agents |
| `packages/lcyt-bridge/src/index.js` | Bridge agent entrypoint |
| `packages/lcyt-bridge/src/bridge.js` | Bridge SSE client + TCP command dispatcher |
| `packages/lcyt-bridge/src/tcp-pool.js` | Managed TCP connection pool |
| `packages/lcyt-web/src/main.jsx` | React entry point + path-based routing for all pages |
| `packages/lcyt-web/src/App.jsx` | Full two-panel main UI layout |
| `packages/lcyt-web/src/contexts/AppProviders.jsx` | All context providers; accepts `initConfig`, `autoConnect`, `embed` for embed pages |
| `packages/lcyt-web/src/hooks/useSession.js` | BackendCaptionSender session lifecycle hook; `onConnected` payload includes `token` |
| `packages/lcyt-web/src/components/EmbedAudioPage.jsx` | `/embed/audio` — mic/STT capture widget |
| `packages/lcyt-web/src/components/EmbedInputPage.jsx` | `/embed/input` — text input + sent log widget |
| `packages/lcyt-web/src/components/EmbedSentLogPage.jsx` | `/embed/sentlog` — read-only delivery log (BroadcastChannel + independent EventSource) |
| `packages/lcyt-web/src/components/EmbedFileDropPage.jsx` | `/embed/file-drop` — drop-one-file player widget |
| `packages/lcyt-web/src/components/EmbedFilesPage.jsx` | `/embed/files` — full file management widget (FileTabs + DropZone + CaptionView + InputBar + SentPanel) |
| `packages/lcyt-web/src/components/DskPage.jsx` | `/dsk/:key` — DSK green-screen overlay page |
| `packages/lcyt-web/src/components/ViewerPage.jsx` | `/view/:key` — full-screen caption viewer |
| `packages/lcyt-web/src/components/ProductionOperatorPage.jsx` | `/production` — operator control surface |
| `packages/lcyt-web/src/components/ProductionCamerasPage.jsx` | `/production/cameras` — camera management |
| `packages/lcyt-web/src/components/ProductionMixersPage.jsx` | `/production/mixers` — mixer management |
| `packages/lcyt-web/src/components/ProductionBridgesPage.jsx` | `/production/bridges` — bridge instance management |
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

*Last updated: 2026-03-16 (critical/high gaps addressed)*

### Coverage Summary

| Package | Source LOC | Test LOC | Coverage | Priority | Key Gaps |
|---------|-----------|----------|----------|----------|-----------|
| `packages/lcyt` | 1,016 | 1,267 | Excellent | Low | `logger.js`, `config.js` (no direct tests) |
| `packages/lcyt-cli` | 1,836 | ~900 | Moderate | Medium | entry-point edge cases |
| `packages/lcyt-backend` | 4,875 | ~2,600 | Good | Medium | CORS middleware, graceful shutdown, `caption-files.js` |
| `packages/lcyt-bridge` | 490 | ~400 | Good | Medium | `tray.js`, entry-point env-var validation |
| `packages/lcyt-mcp-stdio` | 272 | ~300 | Good | Low | Edge cases only |
| `packages/lcyt-mcp-sse` | 1,083 | ~400 | Good | Medium | Tool routing, concurrent sessions |
| `packages/lcyt-web` | 2,000+ | ~850 | Moderate | Medium | React components (most untested), embed pages, useSentLog |
| `python-packages/lcyt` | 1,053 | 1,200 | Excellent | Low | None identified |
| `python-packages/lcyt-backend` | 1,135 | 800 | Good | Medium | CORS middleware, incomplete feature parity with Node.js backend |
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
**Test files:** 24 test files (570 tests total as of 2026-03-16) covering all primary routes plus newly added tests.
**Added 2026-03-16:**
- `test/managers.test.js` (25 tests) — `HlsManager`, `RadioManager`, `PreviewManager` using `--experimental-test-module-mocks` to mock `child_process`/`fs`. Tests: constructor, `start()`, `stop()`, `stopAll()`, ffmpeg arg verification, directory creation.
- `test/rtmp-manager.test.js` (27 tests) — `RtmpRelayManager` and `probeFfmpeg`. Tests: all state queries, `start()`/`stop()`/`stopAll()`, `isSlotRunning()`, `runningSlots()`, `writeCaption()`, `dropPublisher()`.
- `test/auth.test.js` (20 tests) — Full auth lifecycle with in-memory SQLite: register, login, `GET /me`, `POST /change-password`, disabled logins (503).
- `test/video.test.js` (17 tests) — HLS player HTML (themes, CORS, Cache-Control), master manifest, subtitle playlist, segment serving, CORS preflight. Uses lightweight mock managers.
- `test/preview-route.test.js` (10 tests) — JPEG thumbnail serving with real temp-dir JPEG; key validation, 404, 200, CORS, Cache-Control, If-Modified-Since, OPTIONS.
- `test/stream.test.js` (22 tests) — RTMP relay slot CRUD with in-memory DB + mock `RtmpRelayManager`: auth, `relay_allowed` check, POST/GET/PUT/DELETE /stream, PUT /stream/active.

**Gaps (Medium):**
- **Middleware:** `cors.js` (dynamic CORS origin filtering).
- **Core:** `server.js` (Express factory), `caption-files.js`, `index.js` (graceful shutdown on SIGTERM/SIGINT).
- **DB:** `db/sequences.js`, `db/helpers.js`.

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
**Test files:** `test/speech.test.js` (~20 tests) — speech session lifecycle, transcript chunking, CORS, error paths.
**Gaps (Medium):**
- `src/server.js` — HTTP routing, message dispatch, error responses (zero direct tests).
- Concurrent session limits.

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

**Gaps (Medium):**
- **React components** — 30+ leaf components (App, panels, modals, all pages) have no tests.
- **Hooks** — `useSentLog` not yet tested with Vitest.
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

Items marked ✅ were completed 2026-03-16.

1. ✅ **`packages/lcyt-backend` ffmpeg managers** *(Critical → Done)* — `managers.test.js` + `rtmp-manager.test.js` added (52 tests).
2. ✅ **`packages/lcyt-backend` 5 untested routes** *(High → Done)* — `auth.test.js`, `video.test.js`, `preview-route.test.js`, `stream.test.js`, `youtube.test.js` added (69 tests).
3. ✅ **`packages/lcyt-cli/src/interactive-ui.js`** *(High → Done)* — `interactive-ui.test.js` added (49 tests).
4. ✅ **`packages/lcyt-web` pure utilities** *(High → Done)* — `fileUtils.test.js` + `i18n.test.js` added (38 tests).
5. ✅ **`packages/lcyt-web` React hooks + Vitest setup** *(Medium → Done)* — Vitest + jsdom added; `useSession.test.jsx` (25 tests), `useFileStore.test.jsx` (35 tests), `AppProviders.test.jsx` (15 tests) added (75 tests total).
6. **`packages/lcyt-backend/src/index.js`** *(Medium)* — graceful shutdown (SIGTERM/SIGINT) not tested.
7. **`packages/lcyt-backend/src/middleware/cors.js`** *(Medium)* — dynamic CORS origin filtering not tested.
