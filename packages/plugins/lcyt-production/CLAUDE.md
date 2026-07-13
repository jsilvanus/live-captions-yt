# `packages/plugins/lcyt-production` — Production Control Plugin (v0.1.0)

Express router plugin for camera PTZ presets, video mixer source switching, and hardware encoder control. Used as an internal dependency by `lcyt-backend` (imported as `lcyt-production`).

**Main entry:** `src/api.js`
**Usage in lcyt-backend:**
```js
import { createProductionRouter, initProductionControl } from 'lcyt-production';
const { registry, bridgeManager, mediamtxClient } = await initProductionControl(db);
app.use('/production', createProductionRouter(db, registry, bridgeManager, { publicUrl, mediamtxClient }));
```

**Source files (`src/`):**
- `api.js` — `initProductionControl(db)` → `{ registry, bridgeManager, mediamtxClient }` (the MediaMTX client is non-null only when `MEDIAMTX_API_URL` is set) + `createProductionRouter(db, registry, bridgeManager, opts)`, which mounts `/cameras`, `/mixers`, `/encoders`, and `/bridge` subrouters. Also re-exports `crud.js`'s plain camera/mixer CRUD functions for `packages/lcyt-tools`, and re-exports `OBSClient` for `lcyt-bridge`'s `ObsPool`.
- `registry.js` — `DeviceRegistry`: loads cameras and mixers from DB, manages live adapter connections, resolves adapters by device type.
- `crud.js` — Plain, directly-callable camera/mixer CRUD (`listCameras`/`createCamera`/`updateCamera`/`deleteCamera` + mixer equivalents) — the in-process counterpart to `routes/cameras.js`/`routes/mixers.js`'s HTTP handlers, for callers with no Express `req`/`res` (`packages/lcyt-tools`'s `camera.*`/`mixer.*` tools, `plan/mcp`). Also owns `buildSwitchCommand(mixer, inputNumber)`, extracted here so both `routes/mixers.js` and the shared tool registry dispatch bridge-relayed mixer switches through one implementation rather than two.
- `bridge-manager.js` — `BridgeManager`: manages SSE connections from `lcyt-bridge` agents. `sendCommand(instanceId, command, { timeoutMs })` — per-call timeout override; defaults to 120s for `type: 'model_call'` (local AI inference is slow, `plan_ai_model_registry.md`) and 10s otherwise. Resolved command results now pass response payload fields (e.g. `status`/`body` from `http_request`/`model_call`) through to the caller instead of dropping them. Sends SSE heartbeats every 20s.
- `db.js` — SQLite migrations for `prod_cameras`, `prod_mixers`, `prod_bridge_instances`, `prod_encoders` tables.
- `camera-thumbnail.js` — `captureCameraThumbnail(db, camera, registry, opts)` + `deleteCameraThumbnailFile(cameraId, thumbnailsDir)` + `thumbnailPath(cameraId, thumbnailsDir)`: still-frame thumbnail capture for a camera's "picture", persisted to disk (`CAMERA_THUMBNAILS_DIR`) + a `thumbnail_captured_at` DB timestamp. Two capture paths depending on the camera's control type — see "Camera Thumbnail Capture" below.
- `obs-client.js` — `OBSClient`: shared OBS WebSocket v5 abstraction (connection lifecycle, auto-reconnect, RPC helpers) used by both the OBS mixer adapter (direct connections) and `lcyt-bridge`'s `ObsPool` (bridged connections). Owns all OBS protocol details.
- `mediamtx-client.js` — `MediaMtxClient` copy for production-control use (path liveness checks, WHIP publisher kick, path pre-registration). Copied from `lcyt-rtmp`'s client to avoid a cross-plugin dependency — keep in sync. Reads `MEDIAMTX_API_URL` / `MEDIAMTX_WEBRTC_BASE_URL` / `MEDIAMTX_API_USER` / `MEDIAMTX_API_PASSWORD`.
- `routes/cameras.js` — CRUD + PTZ preset trigger + thumbnail capture/serve (`POST /:id/thumbnail/capture`, `GET /:id/thumbnail[.jpg]`). `GET /` and `GET /:id` include a computed `thumbnailUrl` (`null` until first capture).
- `routes/mixers.js` — CRUD + source switching (dispatch logic now delegates to `crud.js`'s `buildSwitchCommand`).
- `routes/encoders.js` — Hardware encoder CRUD + control (`GET/POST /production/encoders`, `GET/PUT/DELETE /production/encoders/:id`, `POST /production/encoders/:id/start|stop|test`). Encoder types: `monarch_hd`, `monarch_hdx`. Connection sources: `backend` (server calls the encoder's HTTP API), `frontend` (browser calls it directly; backend only stores config), `bridge` (relayed via a bridge agent `http_request` command).
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

**Camera control types:** `none`, `amx`, `visca-ip`, `webcam`, `mobile` (`webcam`/`mobile` route through the browser/WebRTC adapter — only these two ever get a `camera_key`)
**Mixer types:** `roland`, `amx`, `atem`, `obs`, `lcyt`, `monarch_hdx`
**Encoder types:** `monarch_hd`, `monarch_hdx` (connection sources: `backend`, `frontend`, `bridge`)

## Camera Thumbnail Capture

`POST /production/cameras/:id/thumbnail/capture` grabs a still frame from a camera's live feed and persists it as that camera's "picture" (`thumbnail_captured_at` on `prod_cameras` + a JPEG file under `CAMERA_THUMBNAILS_DIR`), so an operator can see what a camera is framing without a live preview open. `GET /production/cameras/:id/thumbnail[.jpg]` serves the saved file; `DELETE /production/cameras/:id` removes it too. Manually triggered only — no background/periodic capture.

Both paths fetch from the backend's own public preview-JPEG endpoint (`GET /preview/:key/incoming`, `lcyt-rtmp`'s `PreviewManager`) over plain HTTP, the same "deliberately HTTP, not an in-process import" pattern `lcyt-agent`'s `VisionFrameFetcher` already uses against that endpoint — **this requires `RTMP_RELAY_ACTIVE=1`** on this backend (that's what mounts `/preview` at all); without it every capture attempt fails with the same error a genuinely-offline camera would produce.

- **Path A — independent feed** (`webcam`/`mobile`, `camera.cameraKey` set): fetches `/preview/:cameraKey/incoming` directly. 409 if the camera isn't currently publishing.
- **Path B — program-feed capture** (`amx`/`visca-ip`, no `cameraKey`): these control types are pure PTZ protocols with no video path of their own — the only feed ever available for them is the mixer's program output, and only while this camera is the mixer's active source. The request body must supply `apiKey` (the project's RTMP ingest key; this plugin has no project/apiKey concept of its own, so the caller provides it) and, if more than one mixer row exists, `mixerId` to disambiguate. Liveness is checked via `registry.getActiveSource(mixerId) === camera.mixerInput` before saving — 409 if this camera isn't currently cut to program. Not supported for `none`-type cameras (no `mixerInput` relationship implied) unless `mixerInput` is set.

**Environment variables:**
| Variable | Purpose | Default |
|---|---|---|
| `CAMERA_THUMBNAILS_DIR` | Local directory for captured camera thumbnail JPEGs | `/data/camera-thumbnails` |
| `CAMERA_PREVIEW_BASE_URL` | Base URL this plugin fetches `/preview/:key/incoming` from (same underlying backend process in every real deployment — same convention as `lcyt-agent`'s `VISION_PREVIEW_BASE_URL`/`lcyt-dsk`'s `DSK_LOCAL_SERVER`, each plugin owns its own copy rather than sharing one) | `http://localhost:$PORT` |

**Tests:** `packages/plugins/lcyt-production/test/*.test.js` — uses `node:test`. `test/crud.test.js` covers the plain CRUD helpers; `test/bridge-manager.test.js` covers the per-call `timeoutMs` override and result-payload passthrough; `test/camera-thumbnail.test.js` covers `captureCameraThumbnail`'s two capture paths (mocked `fetch`); `test/cameras-routes.test.js` is the first route-level test for `routes/cameras.js`, covering the thumbnail capture/serve/delete endpoints end-to-end against a real Express app.

---

`BridgeManager` here is the server side of the SSE link consumed by `packages/lcyt-bridge` (see its `CLAUDE.md`), including the `model_call` command for bridge-relayed AI provider inference (`plan_ai_model_registry.md`) — also the source of the Dockerized bridge+Ollama deployment mode (`docker/lcyt-bridge/`, `docker/lcyt-bridge-ollama/`).
