# `packages/lcyt-bridge` — Production Control Bridge Agent (v0.3.0)

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

## Test Coverage

**Test files:** `test/bridge.test.js` (22 tests), `test/tcp-pool.test.js` (13 tests).

**Covered:** Bridge SSE connection/reconnect, TCP pool, command dispatch (`tcp_send`), heartbeat, event forwarding.

**Gaps (Medium):**
- `tray.js` (105 LOC) — system tray icon/menu/exit handler (desktop only).
- `src/index.js` (107 LOC) — `BACKEND_URL`/`BRIDGE_TOKEN` validation, `.env` loading, SIGTERM shutdown.

---

This agent talks to `packages/plugins/lcyt-production`'s `BridgeManager` (see `packages/plugins/lcyt-production/CLAUDE.md`) over the `/production/bridge/*` routes.
