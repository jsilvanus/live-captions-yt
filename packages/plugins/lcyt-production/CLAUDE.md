# `packages/plugins/lcyt-production` — Production Control Plugin (v0.1.0)

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

`BridgeManager` here is the server side of the SSE link consumed by `packages/lcyt-bridge` (see its `CLAUDE.md`).
