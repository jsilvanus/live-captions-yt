# `packages/lcyt-bridge` — Production Control Bridge Agent (v0.3.0)

Standalone agent that connects to the LCYT backend via SSE and relays commands to physical AV hardware (AMX controllers, Roland mixers) over TCP, and — since `plan_ai_model_registry.md` — to a local AI model endpoint (e.g. self-hosted Ollama) unreachable from the backend directly. Designed to run on-site where the hardware/model is located.

**Entry:** `src/index.js` (shebang, runs with `node src/index.js` or as a compiled binary)
**Config:** `.env` file in the same directory as the executable (or `process.env`)

**Required env vars:**
| Variable | Purpose |
|---|---|
| `BACKEND_URL` | Base URL of the LCYT backend |
| `BRIDGE_TOKEN` | Authentication token from `POST /production/bridge/instances` |

**Source files (`src/`):**
- `index.js` — Entry point. Loads config, starts the Bridge, optionally shows system tray icon.
- `bridge.js` — `Bridge` class (`EventEmitter`). Connects to `GET /production/bridge/commands?token=xxx` SSE stream. Dispatches `tcp_send`/`atem_switch`/`http_request`/`obs_switch` commands, plus `model_call` (AI inference relay, `plan_ai_model_registry.md`): fetches an optional `sourceUrl` itself (raw image bytes never cross the SSE command channel — the bridge pulls, the backend never pushes binary down the command stream) via `_modelCall()`, then POSTs to a local model `endpoint` (e.g. Ollama's `/api/generate`) with base64 `images`/JSON `format` as appropriate. Reports results via `POST /production/bridge/status`. Exponential-backoff reconnect (5s → 60s max).
- `tcp-pool.js` — `TcpPool`: manages a pool of named TCP connections. Reconnects on drop.
- `tray.js` — Optional system tray icon (for packaged desktop use).

**Build as standalone executable** (using `pkg`):
```bash
npm run build:win    # → dist/lcyt-bridge.exe  (Windows x64)
npm run build:mac    # → dist/lcyt-bridge-mac  (macOS x64)
npm run build:linux  # → dist/lcyt-bridge-linux (Linux x64)
```

**Docker deployment mode:** a second, simpler mode alongside the pkg-compiled desktop executable — a plain Node container (`docker/lcyt-bridge/Dockerfile`, just `node src/index.js`; `tray.js`'s import is already gracefully optional). `docker/lcyt-bridge-ollama/` compose-networks this with an `ollama/ollama` container on a private network never exposed to the host — the bridge is the only thing that can reach it, which matters specifically because Ollama has no built-in authentication. See that directory's README. Nothing about either mode is exclusive: the same bridge instance can relay real AMX/Roland/ATEM/OBS TCP commands (with real LAN access) while also dispatching `model_call` against a Docker-internal Ollama.

## Test Coverage

**Test files:** `test/bridge.test.js` (31 tests, including `model_call` dispatch: successful POST + parsed body, `sourceUrl` fetch + base64 image attachment, JSON output mode, source-fetch failure, missing-endpoint error), `test/tcp-pool.test.js` (13 tests).

**Covered:** Bridge SSE connection/reconnect, TCP pool, command dispatch (`tcp_send`, `model_call`), heartbeat, event forwarding.

**Gaps (Medium):**
- `tray.js` (105 LOC) — system tray icon/menu/exit handler (desktop only).
- `src/index.js` (107 LOC) — `BACKEND_URL`/`BRIDGE_TOKEN` validation, `.env` loading, SIGTERM shutdown.

---

This agent talks to `packages/plugins/lcyt-production`'s `BridgeManager` (see `packages/plugins/lcyt-production/CLAUDE.md`) over the `/production/bridge/*` routes. `BridgeManager.sendCommand()`'s per-call `timeoutMs` override (120s default for `model_call`, vs. 10s for everything else) lives on that side.
