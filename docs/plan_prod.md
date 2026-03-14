# Production Control — LCYT Feature Plan

## Overview

A new package `packages/production-control` inside the `live-captions-yt` monorepo. It adds a unified production control layer to LCYT, allowing one operator to control cameras (PTZ presets) and video mixer source switching from the same interface used for captions. AI (Claude via MCP) can participate as a co-pilot or take partial control.

The architecture follows the same pluggable adapter pattern already used in LCYT for caption destinations: declare a device type, implement one adapter file, configure instances. Adding new hardware later = add one adapter, register it, nothing else changes.

---

## Architecture

### Package location

```
packages/production-control/
  src/
    adapters/
      camera/
        amx.js         ← AMX NetLinx TCP (Phase 1)
        visca-ip.js    ← VISCA over IP (Phase 6)
        none.js        ← mixer-only stub
      mixer/
        roland.js      ← Roland V-series TCP (Phase 2)
        atem.js        ← Blackmagic ATEM (Phase 6)
        obs.js         ← OBS WebSocket (Phase 6)
    registry.js        ← loads devices from DB, holds live connections
    api.js             ← Express router plugin with REST routes + SSE endpoint
    mcp-tools.js       ← MCP tool definitions (Phase 3)
```

### Data model

```
BridgeInstance
  id              UUID PK
  name            TEXT           ← e.g. "Main church", "Chapel"
  token           TEXT unique    ← auth token, never shown in UI after generation
  status          TEXT           ← 'connected' | 'disconnected'
  lastSeen        TIMESTAMPTZ
  createdAt       TIMESTAMPTZ

Camera
  id              UUID PK
  name            TEXT
  mixerInput      INTEGER        ← which input number on the mixer
  controlType     TEXT           ← 'amx' | 'visca-ip' | 'none' | ...
  controlConfig   JSONB          ← type-specific, see per-adapter docs below
  bridgeInstanceId UUID FK → BridgeInstance (nullable)
  sortOrder       INTEGER
  createdAt       TIMESTAMPTZ

Mixer
  id              UUID PK
  name            TEXT
  type            TEXT           ← 'roland' | 'atem' | 'obs' | ...
  connectionConfig JSONB         ← host, port, credentials, etc.
  bridgeInstanceId UUID FK → BridgeInstance (nullable)
  createdAt       TIMESTAMPTZ
```

### AMX controlConfig structure

Presets and their command strings live inside `controlConfig` — fully user-defined, the adapter sends exactly what is configured:

```json
{
  "host": "192.168.2.50",
  "port": 1319,
  "presets": [
    { "id": "wide",  "name": "Wide shot",  "command": "SEND_COMMAND dvCam,'PRESET-1'" },
    { "id": "close", "name": "Close-up",   "command": "SEND_COMMAND dvCam,'PRESET-2'" },
    { "id": "cross", "name": "Cross",      "command": "SEND_COMMAND dvCam,'PRESET-3'" }
  ]
}
```

No command syntax is validated or interpreted — the adapter simply sends the string over TCP verbatim. Any AMX installation with any firmware or command structure works without code changes.

### Adapter interface contract

Every camera control adapter exports:

```js
export async function connect(config)
export async function disconnect(connection)
export async function callPreset(connection, camera, presetId)
// looks up presetId in camera.controlConfig.presets → sends command string
```

Every mixer adapter exports:

```js
export async function connect(config)
export async function disconnect(connection)
export async function switchSource(connection, mixerInputNumber)
export async function getActiveSource(connection) // → mixerInputNumber | null
```

### Camera capability model

`controlType` determines what the operator UI renders for each camera:

| controlType        | Preset buttons | Mixer source selectable |
|--------------------|---------------|------------------------|
| `amx`, `visca-ip`  | ✅             | ✅                      |
| `none`             | ❌             | ✅                      |

### Bridge communication (SSE + HTTP POST)

```
Backend → Bridge:   SSE stream   GET /bridge/commands?token=xxx
Bridge → Backend:   HTTP POST    POST /bridge/status
```

Backend pushes command events over SSE. Bridge executes them via TCP, then POSTs status back. Works through standard NGINX proxying (`proxy_buffering off`, long `proxy_read_timeout`) — no WebSocket configuration needed.

### Progressive disclosure for bridge names

Bridge instance names are only shown in the UI when 2 or more bridge instances exist. With a single bridge, the concept of "instances" is invisible to the user.

| Bridge count | UI behaviour |
|---|---|
| 0 | Setup prompt in Settings → Bridges |
| 1 | Status only — connected/disconnected, last seen. No name shown. |
| 2+ | Instance names appear on status view, camera/mixer config cards, and operator UI camera cards |

### Duplicate connection handling

If a second bridge connects using the same token as an already-connected instance, the first connection is kicked immediately. The backend logs the reconnection event. This handles the common case of a streaming computer crashing and restarting without requiring manual intervention.

---

## Phase 1 — AMX Camera Preset Control

Goal: operator can trigger named camera presets via the LCYT UI. AMX sends IR signals via receivers next to each camera.

### Tasks

#### 1.1 Package scaffold
- [x] Create `packages/production-control/` with `package.json` (ESM, `"type": "module"`)
- [x] Add as workspace package in monorepo root `package.json`
- [x] Set up basic Express router export from `src/api.js`
- [x] Register router in the main LCYT backend

#### 1.2 Database migrations
- [x] Create migration: `bridge_instances` table
- [x] Create migration: `cameras` table (with nullable `bridge_instance_id` FK)
- [x] Create migration: `mixers` table (with nullable `bridge_instance_id` FK)
- [x] Seed script with example camera configs for dev including sample AMX command strings

#### 1.3 AMX adapter
- [x] Implement `src/adapters/camera/amx.js`
  - TCP connection to AMX NetLinx master (host + port from `controlConfig`)
  - `callPreset(connection, camera, presetId)` — looks up preset in `camera.controlConfig.presets`, sends `preset.command` verbatim over TCP
  - Connection keepalive / reconnect on drop
  - Error handling: device unreachable, TCP write failure
- [x] Implement `src/adapters/camera/none.js` — no-op stub for mixer-only cameras
- [x] Unit tests for preset lookup and command dispatch (no live hardware needed)

#### 1.4 Device registry
- [x] `src/registry.js` — loads cameras + mixers from DB on startup
- [x] Holds live connection handles keyed by device id
- [x] `getCameraAdapter(camera)` — returns correct adapter module for `controlType`
- [x] `getMixerAdapter(mixer)` — returns correct adapter module for `type`
- [x] Graceful startup: log warnings for unreachable devices, do not crash

#### 1.5 REST API — cameras
- [x] `GET    /production/cameras` — list all cameras with full config
- [x] `POST   /production/cameras` — create camera
- [x] `PUT    /production/cameras/:id` — update camera
- [x] `DELETE /production/cameras/:id` — delete camera
- [x] `POST   /production/cameras/:id/preset/:presetId` — trigger preset → calls adapter

#### 1.6 Configuration UI — cameras
- [x] Camera list: name, control type badge, mixer input number, preset count
- [x] Add/edit camera form:
  - Name, mixer input number, sort order
  - Control type selector (`amx` / `none` / ..., extensible dropdown)
  - AMX-specific section (shown when type = `amx`): host, port
  - Preset command editor — list of rows, each with preset name + free-text AMX command string
  - Add / remove preset rows
  - No command validation — store and send as-is
  - Placeholder text shows example AMX command format
- [x] Delete camera with confirmation

#### 1.7 Operator UI — camera preset panel
- [x] Camera grid: one card per camera showing name and preset buttons
- [x] Mixer-only cameras (`none`) show card without preset buttons
- [x] Visual feedback on preset trigger: pending → success / error
- [x] Responsive layout suitable for tablet use during a service

---

## Phase 2 — Roland Mixer Source Switching

Goal: operator can switch the active video source on the Roland mixer. Tapping a camera can optionally also cut the mixer to that camera's input.

### Tasks

#### 2.1 Roland adapter
- [x] Implement `src/adapters/mixer/roland.js`
  - TCP connection to Roland V-series (host + port from `connectionConfig`)
  - `switchSource(connection, inputNumber)` — send Roland TCP command
  - `getActiveSource(connection)` — maintain or poll current active input state
  - Document the specific Roland TCP command strings as named constants in the file
  - Reconnect logic

#### 2.2 REST API — mixers and switching
- [x] `GET    /production/mixers` — list configured mixers
- [x] `POST   /production/mixers` — create mixer
- [x] `PUT    /production/mixers/:id` — update mixer
- [x] `DELETE /production/mixers/:id` — delete mixer
- [x] `POST   /production/mixers/:id/switch/:inputNumber` — switch source
- [x] `GET    /production/mixers/:id/active` — current active input
- [x] `POST   /production/mixers/:id/test` — TCP reachability test (inline, no persistent connection)

#### 2.3 AMX mixer adapter
- [x] Implement `src/adapters/mixer/amx.js`
  - TCP connection to AMX NetLinx master
  - `connectionConfig.inputs[]` maps input numbers to AMX command strings
  - `switchSource(handle, inputNumber, mixer)` looks up command by input number, sends verbatim
  - `getSwitchCommand(connectionConfig, inputNumber)` exported for bridge routing

#### 2.4 Configuration UI — mixers
- [x] Mixer list: name, type badge, connection status indicator
- [x] Add/edit mixer form:
  - Name, type selector (`roland` / `amx`, extensible)
  - Roland-specific fields: host, port
  - AMX-specific fields: host, port, input command rows (number + free-text command)
  - Connection test button — attempts TCP connect, reports success/fail inline
- [x] Delete mixer with confirmation

#### 2.4 Operator UI — mixer integration
- [x] `LIVE` badge on the camera card whose mixer input is currently active
- [x] Quick-cut mode toggle: when enabled, tapping a camera card immediately switches the mixer to that camera's input
- [x] When quick-cut is off, tapping a camera only triggers presets; mixer switching is a separate explicit action
- [x] Roland connection status indicator in the operator UI (mixer status bar with connected dot + active PGM input)

---

## Phase 3 — MCP Tools

Goal: Claude can read production state and execute camera/mixer commands as co-pilot or in automated flows.

### Tasks

#### 3.1 MCP tool definitions
- [ ] `production_get_state` — returns all cameras (names, presets, mixer inputs) and which input is currently active on each mixer
- [ ] `camera_call_preset(cameraId, presetId)` — trigger a named preset; response includes human-readable camera and preset names
- [ ] `mixer_switch_source(mixerId, inputNumber)` — cut mixer to input number
- [ ] `mixer_switch_to_camera(cameraId)` — convenience: resolves camera's `mixerInput` and switches
- [ ] Register all tools in the LCYT MCP server

#### 3.2 Tool quality
- [ ] All tool descriptions written so Claude understands when and how to use them
- [ ] State responses use human-readable names throughout, not just UUIDs
- [ ] Error messages are descriptive: "AMX device unreachable", "unknown preset id", etc.

---

## Phase 4 — lcyt-bridge (Windows Agent)

Goal: a lightweight Windows agent that runs on the streaming computer, connects to the LCYT backend via SSE, and relays commands to AMX and Roland over TCP on the local network.

### Network topology

```
Internet
    │
    ▼
Streaming computer (Windows)
    ├── NIC 1: internet-facing LAN  ──→ LCYT backend (VPS)
    └── NIC 2: isolated AV network  ──→ AMX master
                                    ──→ Roland mixer (confirm which NIC)

lcyt-bridge.exe runs on the streaming computer:
    ├── SSE client   → GET /bridge/commands   (outbound, no inbound ports needed)
    ├── HTTP POST    → POST /bridge/status
    ├── TCP socket   → AMX    (via NIC 2, isolated AV network)
    └── TCP socket   → Roland (via whichever NIC reaches it — confirm before build)
```

No ports are opened on the streaming computer. All connections are outbound.

### Config generation flow

1. Admin goes to Settings → Bridges → "Add bridge"
2. Enters a name for the instance (e.g. "Main church") — default suggestion is the organisation name
3. Backend generates a token, creates the `BridgeInstance` record
4. Admin clicks "Download .env" — backend serves a pre-filled config file
5. Token is never shown as plain text in the UI — download only
6. User places `.env` next to `lcyt-bridge.exe` and runs it

### Tasks

#### 4.1 Bridge agent core
- [x] New package `packages/lcyt-bridge` (ESM Node.js)
- [x] SSE client connecting to `/bridge/commands?token=xxx` (`eventsource` npm package)
- [x] HTTP POST client for status reporting to `/bridge/status`
- [x] AMX TCP connection + command relay
- [x] Roland TCP connection + command relay
- [x] Auto-reconnect for SSE and TCP connections on drop
- [x] Config loading from `.env` in same directory as exe (`dotenv`)

#### 4.2 System tray UI
- [x] System tray icon using `node-systray`
- [x] Right-click context menu:
  - **Status** — small status window showing: backend ✓/✗, AMX ✓/✗, Roland ✓/✗, last command timestamp
  - **Reconnect** — force reconnect all connections
  - **Quit** — clean shutdown, close all TCP connections
- [x] Tray icon reflects overall health (connected / degraded / disconnected)

#### 4.3 Backend — bridge endpoints
- [x] `GET  /bridge/commands` — SSE endpoint, authenticated by bridge token
- [x] `POST /bridge/status` — receives heartbeat and command results from bridge
- [x] Duplicate connection handling: if a token connects while already connected, kick the first connection
- [x] Log reconnection events

#### 4.4 Settings → Bridges tab
- [x] List of bridge instances
  - **0 bridges**: setup prompt and "Add bridge" button only
  - **1 bridge**: status (connected/disconnected, last seen), "Add bridge" button, delete button — no instance name shown
  - **2+ bridges**: instance names visible on all rows, status per instance, delete buttons
- [x] "Add bridge" flow: name input (with org name as default suggestion) → generates token → shows "Download .env" button
- [x] Token never shown as plain text — download only
- [x] Delete instance:
  - If cameras or mixers are assigned to it: warn ("X cameras and Y mixers will lose their bridge assignment") — user must confirm
  - On delete: remove instance, set `bridgeInstanceId` to null on affected cameras/mixers

#### 4.5 Progressive disclosure — bridge names in rest of UI
- [x] Camera and mixer config cards: show bridge instance name only when 2+ instances exist
- [x] Operator UI camera cards: show instance name as secondary label only when 2+ instances exist

#### 4.6 Windows executable build
- [x] Build script using `pkg` to produce `lcyt-bridge.exe` (Node.js bundled, no install required)
- [ ] Test on a clean Windows machine with no Node.js installed
- [ ] Document release process: build exe, make available for download from Settings → Bridges

---

## Phase 5 — Testing

Goal: automated test coverage for everything that can be tested in the development environment. Hardware-dependent behaviour (real AMX, real Roland TCP) is explicitly out of scope for automated tests and documented as requiring manual verification in the church environment.

### In scope (dev environment, no hardware needed)

#### 5.1 Unit tests — adapters
- [ ] AMX adapter: preset lookup by id, command string dispatch, missing preset error
- [ ] `none` adapter: no-op behaviour, no errors thrown
- [ ] Adapter registry: correct adapter module returned for each `controlType` and mixer `type`
- [ ] Command string passthrough — verify no transformation occurs between config and TCP send

#### 5.2 Unit tests — bridge instance logic
- [ ] Token generation produces unique values
- [ ] Progressive disclosure logic: name visibility threshold at exactly 2 instances
- [ ] Duplicate connection detection: second connection with same token kicks first

#### 5.3 Integration tests — REST API (test DB)
- [ ] Camera CRUD endpoints
- [ ] Mixer CRUD endpoints
- [ ] `POST /cameras/:id/preset/:presetId` — correct adapter called, correct command string passed
- [ ] `POST /mixers/:id/switch/:inputNumber` — correct adapter called
- [ ] Bridge token auth on SSE endpoint — valid token accepted, invalid rejected
- [ ] `POST /bridge/status` — status recorded against correct instance

#### 5.4 Integration tests — bridge agent (mocked backend)
- [ ] Bridge connects to mock SSE endpoint, receives command event, calls correct TCP handler
- [ ] Bridge POSTs status after command execution
- [ ] Bridge reconnects after SSE stream drop
- [ ] Bridge reconnects TCP after connection drop

#### 5.5 Integration tests — Settings UI
- [ ] Add bridge: instance created, `.env` download available
- [ ] Delete bridge with no assignments: removed cleanly
- [ ] Delete bridge with assigned cameras/mixers: warning shown, assignment nulled on confirm
- [ ] Bridge name visibility: hidden with 1 instance, visible with 2+

### Out of scope for automated tests (manual verification in church)

- Actual TCP communication with AMX NetLinx master
- Actual TCP communication with Roland mixer
- IR signal delivery to cameras via AMX
- End-to-end preset → camera movement latency
- Bridge behaviour across two physical NICs

---

## Phase 6 — Additional Adapters

Goal: support further hardware without touching existing code. Each adapter is one self-contained file implementing the standard interface.

### Tasks

#### 6.1 VISCA-IP camera adapter
- [ ] `src/adapters/camera/visca-ip.js`
- [ ] VISCA over IP (UDP or TCP depending on camera model)
- [ ] Same `connect` / `callPreset` interface
- [ ] Add `visca-ip` as selectable type in camera config UI with its specific fields

#### 6.2 ATEM mixer adapter
- [ ] `src/adapters/mixer/atem.js`
- [ ] Use `atem-connection` npm library
- [ ] Same `connect` / `switchSource` / `getActiveSource` interface
- [ ] Add `atem` as selectable type in mixer config UI

#### 6.3 OBS mixer adapter
- [ ] `src/adapters/mixer/obs.js`
- [ ] OBS WebSocket v5 (`obs-websocket-js` library)
- [ ] `switchSource` maps to scene switching or scene item activation
- [ ] Add `obs` as selectable type in mixer config UI

#### 6.4 Adapter registry cleanup
- [ ] `src/adapters/index.js` — central map of `type → adapter module`
- [ ] Adding a new adapter = one new file + one entry here, nothing else changes
- [ ] Write `ADAPTERS.md` documenting the interface contract for future implementors

---

## Open Questions

- **AMX command format**: review the provided NetLinx code to confirm exact TCP command strings. Use them as placeholder examples in the preset command editor so users know the expected format.
- **Roland protocol reference**: confirm the Roland model in use, verify TCP port (typically 8023), obtain protocol PDF from Roland support if needed.
- **Network path to Roland**: is the Roland on the same isolated AV network as AMX, or on the internet-facing LAN? Determines which NIC the bridge uses for Roland TCP connections.
- **Multi-mixer operator UI**: data model supports multiple mixers — clarify if operator UI needs a mixer selector or can assume one primary active mixer.
- **Active source on Roland**: decide whether to poll `getActiveSource` periodically or maintain persistent TCP state. Document the chosen approach in the adapter.
- **Tailscale as alternative to lcyt-bridge**: if church IT permits a VPN, Tailscale on the streaming computer would give the VPS direct network access to AMX/Roland, eliminating the bridge agent entirely. Worth evaluating before starting Phase 4.
