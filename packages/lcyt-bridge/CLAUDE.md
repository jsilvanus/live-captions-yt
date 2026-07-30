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
- `bridge.js` — `Bridge` class (`EventEmitter`). Connects to `GET /production/bridge/commands?token=xxx` SSE stream. Dispatches `tcp_send`/`atem_switch`/`http_request`/`obs_switch` commands, plus `model_call` (AI inference relay, `plan_ai_model_registry.md`): fetches an optional `sourceUrl` itself (raw image bytes never cross the SSE command channel — the bridge pulls, the backend never pushes binary down the command stream) via `_modelCall()`, then POSTs to a local model `endpoint` (e.g. Ollama's `/api/generate`) with base64 `images`/JSON `format` as appropriate. Reports results via `POST /production/bridge/status`. Exponential-backoff reconnect (5s → 60s max). **Security policy (defense in depth):** before dispatching any of `tcp_send`/`atem_switch`/`obs_switch`/`http_request`/`model_call`, `_checkSecurity()` consults a local `SecurityPolicy` instance — a second, independent check duplicating `packages/plugins/lcyt-production/src/bridge-manager.js`'s authoritative `sendCommand()`-side check, in case the backend is ever compromised or a bug slips a bad command past it. The `connected` SSE event now carries `{ instanceId }`, captured to build `GET .../security-rules/for-agent?token=xxx` — fetched on connect, refetched on a `rules_updated` SSE push (fired by the backend whenever an admin edits that bridge's rules) and on a 60s fallback timer. **Fails closed**: any secured command arriving before the *first* successful policy fetch is rejected locally (`'bridge security policy not yet loaded'`); a later refetch failure keeps using the last known-good policy instead of clearing it.
- `security-policy.js` — `SecurityPolicy`: the bridge-side rule cache/evaluator described above. `checkIp(host, port)`/`checkCommand(payload)`, same allow/deny precedence as the backend's `bridge-security.js` (deny always wins; an allow-list, if populated, switches that rule kind to default-deny) — logic is intentionally duplicated rather than shared as a package dependency (same "copy, keep in sync" convention as `packages/plugins/lcyt-production/src/mediamtx-client.js`).
- `tcp-pool.js` — `TcpPool`: manages a pool of named TCP connections. Reconnects on drop.
- `atem-pool.js` — `AtemPool`: pooled Blackmagic ATEM connections (via the `atem-connection` UDP protocol) for `atem_switch` commands — persistent connections, reconnect logic, program input switching.
- `obs-pool.js` — `ObsPool`: pooled OBS WebSocket connections for `obs_switch` scene switching, built on the shared `OBSClient` abstraction from `packages/plugins/lcyt-production/src/obs-client.js`.
- `tray.js` — Optional system tray icon (for packaged desktop use).

`Bridge.status()` includes per-pool state: `tcp`, `atem`, and `obs` connection arrays.

**Build as standalone executable** (using `pkg`):
```bash
npm run build:win    # → dist/lcyt-bridge.exe  (Windows x64)
npm run build:mac    # → dist/lcyt-bridge-mac  (macOS x64)
npm run build:linux  # → dist/lcyt-bridge-linux (Linux x64)
```

**Docker deployment mode:** a second, simpler mode alongside the pkg-compiled desktop executable — a plain Node container (`docker/lcyt-bridge/Dockerfile`, just `node src/index.js`; `tray.js`'s import is already gracefully optional). `docker/lcyt-bridge-ollama/` compose-networks this with an `ollama/ollama` container on a private network never exposed to the host — the bridge is the only thing that can reach it, which matters specifically because Ollama has no built-in authentication. See that directory's README. Nothing about either mode is exclusive: the same bridge instance can relay real AMX/Roland/ATEM/OBS TCP commands (with real LAN access) while also dispatching `model_call` against a Docker-internal Ollama.

## Test Coverage

**Test files:** `test/bridge.test.js` (includes `model_call` dispatch: successful POST + parsed body, `sourceUrl` fetch + base64 image attachment, JSON output mode, source-fetch failure, missing-endpoint error; plus a local-security-enforcement describe block — blocked commands never reach `TcpPool`/`_httpRequest`, fail-closed before the first policy load, and a `_fetchSecurityPolicy()` wiring block covering the `connected`/`rules_updated` SSE events and stale-cache-on-refetch-failure), `test/tcp-pool.test.js`, `test/atem-pool.test.js` (includes its own `atem_switch` dispatch + security-policy-primed describe block), `test/security-policy.test.js` (`SecurityPolicy`'s own allow/deny precedence, fail-closed-until-loaded, CIDR/port pattern matching).

**Covered:** Bridge SSE connection/reconnect, TCP pool, command dispatch (`tcp_send`, `atem_switch`, `model_call`), heartbeat, event forwarding, local security-policy enforcement and fetch/refresh wiring.

**Gaps (Medium):**
- `tray.js` (105 LOC) — system tray icon/menu/exit handler (desktop only).
- `src/index.js` (107 LOC) — `BACKEND_URL`/`BRIDGE_TOKEN` validation, `.env` loading, SIGTERM shutdown.

---

This agent talks to `packages/plugins/lcyt-production`'s `BridgeManager` (see `packages/plugins/lcyt-production/CLAUDE.md`) over the `/production/bridge/*` routes. `BridgeManager.sendCommand()`'s per-call `timeoutMs` override (120s default for `model_call`, vs. 10s for everything else) lives on that side, as does the authoritative per-bridge TCP-command/target-IP allow-deny check (`bridge-security.js`) this agent's own `security-policy.js` duplicates locally.
