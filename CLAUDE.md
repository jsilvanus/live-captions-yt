# live-captions-yt

## Overview

Monorepo for **LCYT** — a full-featured platform for sending live captions to YouTube Live via Google's HTTP POST caption ingestion API. Ships as a Node.js library + CLI, Python library, Express/Flask relay backends, a browser web UI, and a Model Context Protocol (MCP) server for AI assistant integration.

---

## Repository Structure

```
live-captions-yt/
├── packages/                   # Node.js workspace packages (npm workspaces)
│   ├── lcyt/                   # Core library (published to npm as `lcyt`)
│   ├── lcyt-cli/               # CLI tool (published to npm as `lcyt-cli`)
│   ├── lcyt-backend/           # Express.js HTTP relay backend
│   ├── lcyt-mcp-stdio/         # MCP server (stdio transport)
│   ├── lcyt-mcp-sse/           # MCP server (HTTP SSE transport)
│   └── lcyt-web/               # Browser-based web UI (Vite + React)
├── python-packages/            # Python packages
│   ├── lcyt/                   # Core Python library (published to PyPI as `lcyt`)
│   ├── lcyt-backend/           # Flask backend (cPanel/Passenger compatible)
│   └── lcyt-mcp/               # Python MCP server
├── android/                    # Native Android apps
│   └── lcyt-tv/                # Android TV caption viewer (Kotlin + Compose for TV)
├── python/                     # LEGACY — do not use; canonical source is python-packages/
├── scripts/                    # Shell deployment scripts
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
| `STATIC_DIR` | Serve static files | none |
| `REVOKED_KEY_TTL_DAYS` | Days before revoked keys are purged | 30 |
| `REVOKED_KEY_CLEANUP_INTERVAL` | Revoked key cleanup interval (ms) | 86400000 (24h) |
| `ALLOWED_DOMAINS` | Comma-separated domains for /usage CORS filter | `lcyt.fi,www.lcyt.fi` |
| `ALLOWED_RTMP_DOMAINS` | Comma-separated domains allowed to use `/stream` relay endpoints; if unset, falls back to `ALLOWED_DOMAINS` | (falls back to `ALLOWED_DOMAINS`) |
| `USAGE_PUBLIC` | If set, /usage endpoint needs no auth | unset |

**API routes:**
```
GET  /health              — uptime, session count
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
```

**Key internals:**
- `src/db.js` — `better-sqlite3` (synchronous). Tables: `api_keys` (key, owner, active, email, daily_limit, lifetime_limit, lifetime_used, revoked_at, expires_at, created_at, sequence, last_caption_at), `caption_usage` (per-key daily count), `session_stats` (per-session telemetry), `caption_errors` (delivery failure log), `sessions` (persistent session metadata for server-restart survival). Additive migrations run on startup. Per-key sequence helpers (`getKeySequence`, `updateKeySequence`, `resetKeySequence`) implement a 2-hour inactivity TTL reset. Session persistence helpers (`saveSession`, `loadSession`, `deleteSession`, `listSessions`, `incSessionSequence`) back the store's `rehydrate()` call on startup.
- `src/store.js` — In-memory session store. Session = `{ sessionId, apiKey, streamKey, domain, sender, extraTargets, token, startedAt, lastActivity, sequence, syncOffset, emitter, _sendQueue }`. `sender` is null in target-array mode (no primary streamKey). `extraTargets` is an array of `{ id, type, sender? }` objects representing all targets. `emitter` is a per-session `EventEmitter` for SSE routing. `_sendQueue` serialises concurrent YouTube sends so sequence numbers stay monotonic. Auto-cleanup on TTL.
- `src/middleware/auth.js` — JWT Bearer verification.
- `src/middleware/cors.js` — Dynamic CORS: only allows registered session domains; never exposes admin routes.
- `src/middleware/admin.js` — `X-Admin-Key` constant-time comparison.

**SSE events** (on `GET /events`): `connected`, `caption_result`, `caption_error`, `session_closed`, `mic_state`.

**Admin CLI:** `bin/lcyt-backend-admin` — local key management.

**Docker:** `Dockerfile` — node:20-slim, exposes port 3000.

**Tests:** `packages/lcyt-backend/test/*.test.js` — uses `node:test`.

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

### `packages/lcyt-web` — Web UI (v1.0.0, private)

Browser-based React app using Vite. Sends captions via the `lcyt-backend` relay.

**Build:** `npm run build -w packages/lcyt-web` → `dist/`
**Dev:** `npm run web`

**Source (`src/`):**
- `main.jsx` — React entry point; path-based routing for the main app and all sub-pages (see below)
- `App.jsx` — root component (full two-panel layout)
- `components/` — React JSX components: AudioPanel, CaptionView, DropZone, FileTabs, InputBar, PrivacyModal, SentPanel, SettingsModal, StatsModal, StatusBar, ToastContainer, CCModal, ControlsPanel, StatusPanel, FilesModal, SpeechCapturePage, EmbedAudioPage, EmbedInputPage, EmbedSentLogPage, EmbedFileDropPage, EmbedFilesPage
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
| `package.json` | Root workspace (workspaces: `packages/lcyt`, `packages/lcyt-cli`, `packages/lcyt-backend`, `packages/lcyt-web`, `packages/lcyt-mcp-stdio`, `packages/lcyt-mcp-sse`) |
| `packages/lcyt/src/sender.js` | Core caption sender (Node.js) |
| `packages/lcyt/src/errors.js` | Error classes (Node.js) |
| `packages/lcyt/scripts/build-cjs.js` | ESM→CJS build transformer |
| `packages/lcyt-cli/bin/lcyt` | CLI entrypoint |
| `packages/lcyt-cli/src/interactive-ui.js` | Full-screen blessed terminal UI |
| `packages/lcyt-backend/src/server.js` | Express app factory |
| `packages/lcyt-backend/src/store.js` | In-memory session store (emitter + send queue + extraTargets per session) |
| `packages/lcyt-backend/src/routes/events.js` | SSE delivery-result stream (authenticated, session owner) |
| `packages/lcyt-backend/src/routes/viewer.js` | Public SSE broadcast stream `GET /viewer/:key` — no auth, CORS `*`; used by viewer targets |
| `packages/lcyt-backend/src/routes/stats.js` | Per-key usage stats + GDPR erasure |
| `packages/lcyt-backend/src/routes/usage.js` | Per-domain caption statistics |
| `packages/lcyt-backend/src/routes/mic.js` | Soft mic lock for collaborative sessions |
| `packages/lcyt-backend/src/db.js` | SQLite store: api_keys, caption_usage, session_stats, caption_errors, sessions |
| `packages/lcyt-mcp-stdio/src/server.js` | MCP server — stdio transport |
| `packages/lcyt-mcp-sse/src/server.js` | MCP server — HTTP SSE transport |
| `packages/lcyt-web/src/main.jsx` | React entry point + path-based routing for all pages |
| `packages/lcyt-web/src/App.jsx` | Full two-panel main UI layout |
| `packages/lcyt-web/src/contexts/AppProviders.jsx` | All context providers; accepts `initConfig`, `autoConnect`, `embed` for embed pages |
| `packages/lcyt-web/src/hooks/useSession.js` | BackendCaptionSender session lifecycle hook; `onConnected` payload includes `token` |
| `packages/lcyt-web/src/components/EmbedAudioPage.jsx` | `/embed/audio` — mic/STT capture widget |
| `packages/lcyt-web/src/components/EmbedInputPage.jsx` | `/embed/input` — text input + sent log widget |
| `packages/lcyt-web/src/components/EmbedSentLogPage.jsx` | `/embed/sentlog` — read-only delivery log (BroadcastChannel + independent EventSource) |
| `packages/lcyt-web/src/components/EmbedFileDropPage.jsx` | `/embed/file-drop` — drop-one-file player widget |
| `packages/lcyt-web/src/components/EmbedFilesPage.jsx` | `/embed/files` — full file management widget (FileTabs + DropZone + CaptionView + InputBar + SentPanel) |
| `python-packages/lcyt/lcyt/sender.py` | Core caption sender (Python) |
| `python-packages/lcyt-backend/lcyt_backend/app.py` | Flask app factory |
| `python-packages/lcyt-backend/lcyt_backend/_jwt.py` | Stdlib-only HS256 JWT |
| `python-packages/lcyt-backend/passenger_wsgi.py` | cPanel entry point |
| `python-packages/lcyt-backend/run.py` | Python dev server |
| `android/lcyt-tv/app/src/main/java/fi/lcyt/tv/SseClient.kt` | OkHttp SSE client for Android TV viewer |
| `android/lcyt-tv/app/src/main/java/fi/lcyt/tv/CaptionViewModel.kt` | StateFlow state + SharedPreferences persistence |
| `android/lcyt-tv/app/src/main/java/fi/lcyt/tv/MainActivity.kt` | Compose TV viewer UI + deep-link handling |
| `android/lcyt-tv/gradle/libs.versions.toml` | Dependency version catalog |
