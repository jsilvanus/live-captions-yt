# `packages/plugins/lcyt-rtmp` — RTMP Relay Plugin (v0.1.0)

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
  app.use('/feed-rtmp',  routers.feedRtmpRouter);
  app.use('/ingestion',  routers.ingestionRouter);
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
- `rtmp-manager.js` — `RtmpRelayManager`: manages RTMP relay sessions; calls `probeFfmpeg()` on startup. Fires `onStreamStarted`/`onStreamEnded` callbacks for DB stat tracking. Server-side DSK RTMP composite (`setDskRtmpSource(apiKey, rtmpUrl, { chromaKey })`) optionally chroma-keys the overlay via the exported pure `buildDskCompositeFilter(chromaKey)` (`plan_dsk_viewport_settings` Phase 5) — no chromaKey = today's opaque full-frame overlay; the composite viewport's `stream.chromaKey` is passed in by `lcyt-dsk`'s `on_publish`. Named-feed publish tracking uses a separate `_feedPublishing` Set + `markFeedPublishing(cameraKey)`/`markFeedNotPublishing(cameraKey)`/`isFeedPublishing(cameraKey)`, kept apart from the apiKey-keyed `_publishing`/`markPublishing`/`isPublishing` so an operator-chosen `camera_key` string can never collide with (or spoof) a real project's live status. Multiple projects' camera-sourced relay slots referencing the same named feed are reconciled into one shared MediaMTX fan-out registration via `_reconcileCameraKeyFanout(cameraKey)` (rebuilds the path's `runOnPublish` tee from the union of every apiKey's slots for that `cameraKey`, only deleting the path once none remain) — this replaces an earlier last-writer-wins `addPath`/`deletePath` call that let two projects sharing a `camera_key` clobber each other's registration. `start()`'s per-`cameraKey` loop is isolated with its own try/catch so one malformed/unsafe camera-sourced group can't abort the program-sourced slots processed afterward (defense in depth — `CAMERA_KEY_RE` validation at camera create/update time in `lcyt-production` should already prevent an unsafe value from ever reaching here). Per-slot transcoding (Phase 7) re-encodes **every** program-sourced slot's video stream in one ffmpeg process once any single slot sets `scale`/`fps`/`videoBitrate`/`audioBitrate` (the `filter_complex split` means none of them can stream-copy) — `MAX_TRANSCODE_SLOTS` (8) is a hard technical ceiling on that mode alone (uncapped relay slot counts, see `db/relay.js` below, are fine for plain tee/copy fan-out; unbounded concurrent libx264 encodes in one process is a real resource-exhaustion risk).
- `crop-manager.js` — `CropManager`: starts/stops a per-key crop renderer, persists crop config and position state, and reuses the same ffmpeg runner abstraction as the relay manager.
- `routes/crop.js` — `/crop/*` session-authenticated CRUD API for crop config, presets, preset sets, and live position updates.
- `hls-manager.js` — `HlsManager`: manages MediaMTX-based RTMP → video+audio HLS (no ffmpeg in hot path unless `localRtmp` is configured, in which case a local `-c copy` passthrough ffmpeg is spawned). Optional `resolveStorage` constructor dependency (`tmp_plan_tier3.md` Item 1): when injected, a directory-polling watcher pushes new/changed HLS files to the resolved storage adapter via `putObject()` (index.m3u8 debounced 1.5s since it rewrites every few seconds), and `getPublicUrl()` delegates to the adapter's `publicUrl()`. `probeStreamInfo(hlsKey)` (Item 6) runs `ffprobe` against the running output (60s cache, hard-coded fallback on failure) and builds the real `BANDWIDTH`/`CODECS` values consumed by `lcyt-backend/src/routes/video.js`'s `buildMasterManifest()`.
- `radio-manager.js` — `RadioManager`: dual-mode audio-only HLS. **ffmpeg mode** (default): spawns ffmpeg RTMP → AAC HLS. **mediamtx mode**: no ffmpeg; MediaMTX serves HLS, `NginxManager` writes slug-based nginx proxy locations.
- `nginx-manager.js` — `NginxManager`: writes nginx `location` blocks for MediaMTX radio streams. Atomic file write + `nginx -t && nginx -s reload`. No-op when `NGINX_RADIO_CONFIG_PATH` is unset.
- `preview-manager.js` — `PreviewManager`: manages MediaMTX API or ffmpeg for RTMP → JPEG thumbnail generation.
- `hls-subs-manager.js` — `HlsSubsManager`: rolling WebVTT segment writer for subtitle sidecars.
- `mediamtx-client.js` — `MediaMtxClient`: REST API client for MediaMTX v3 (drop publisher, list streams, `addPath`/`patchPath`/`deletePath`; the relay manager uses add-then-patch upsert so reconfiguring a relay replaces a leftover path config instead of failing).
- `hls-segment-fetcher.js` — `HlsSegmentFetcher`: polls a MediaMTX fMP4 HLS playlist, detects new segments, emits `segment` events with `{ buffer, timestamp, duration, url, index }`. Used by `SttManager`.
- `stt-manager.js` — `SttManager` (`EventEmitter`): manages one STT session per API key. Wires `HlsSegmentFetcher` → STT adapter → transcript → `session._sendQueue` for delivery. Supports `hls`, `rtmp`, `whep` audio sources. **Events:** `transcript`, `error`, `stopped`. `setDeliveryHelpers({ getTranslationVendorConfig, getTranslationTargets, writeBackendCaptionFiles, composeCaptionText, fanOutToTargets })` injects the lcyt-backend helpers used by `_deliverTranscript`: Phase 5 server-side translation, backend caption-file archiving (`createSessionCaptionFileWriter`), default composition (`composeCaptionText`, using the captions-target row's `show_original` with the vendor-config flag as fallback), and extra-target delivery via the shared `createCaptionFanout` — same per-target routed composition and viewer-owner registration as `POST /captions`. Without injected helpers, transcripts go only to the legacy primary sender (uncomposed).
- `stt-adapters/google-stt.js` — `GoogleSttAdapter`: posts fMP4 segments to Google Cloud Speech-to-Text REST API or streams via gRPC (`GOOGLE_STT_MODE=grpc`). Emits `normalisePunctuation`-cleaned transcripts.
- `stt-adapters/whisper-http.js` — `WhisperHttpAdapter`: sends audio to a Whisper-compatible HTTP STT server.
- `stt-adapters/openai.js` — `OpenAiAdapter`: sends audio to OpenAI-compatible STT endpoint.
- `stt-adapters/pcm-buffer.js` — `PcmSilenceBuffer`: accumulates PCM frames and detects silence; `buildWav()` helper constructs WAV from raw PCM bytes.
- `db/relay.js` — RTMP relay DB helpers: `isRelayAllowed()`, `isRadioEnabled()`, `resolveApiKeyFromIngestStreamKey()` (resolves a rotated ingest stream key back to its owning api_key, falling back to treating the name as the literal api_key — `plan_selfservice_config_backend.md` §2), per-key relay config CRUD. `resolveRelaySourceCameraKey(db, cameraId, requestingApiKey)` and `getRelays()`/`getRelaySlot()`'s `source_camera_key` join (plan_ingest_feeds.md §1b/§2c) resolve a relay's optional `source_camera_id` against `prod_cameras` directly (cross-plugin query, degrades gracefully — probed once per db instance via `hasProdCamerasTable()`, exported for reuse by `routes/feed-rtmp.js` — when that table doesn't exist, e.g. a test harness that only runs this plugin's own migrations). `resolveRelaySourceCameraKey` enforces `prod_cameras.owner_api_key` ownership (`lcyt-production`'s cross-tenant review finding, see its own CLAUDE.md): a camera owned by a different project resolves to `null` exactly like an unknown camera, so `POST/PUT /stream` rejects it the same way (400). `getApiKeysReferencingCamera(db, cameraId)` returns every apiKey with a relay slot sourcing from a given camera — used by `routes/feed-rtmp.js`'s on_publish handler to start egress for camera-only configurations (see below). `upsertRelay()`'s `slot` has no upper bound.
- `crop-manager.js` — `CropManager`: vertical-crop rendition (plan_vertical_crop.md) — one long-running ffmpeg per key reads the raw ingest via RTSP, cuts a `crop@vcrop` window at incoming resolution, publishes to the `{key}-crop` MediaMTX path. Live repositioning via zmq runtime filter commands when `ffmpegCaps.hasZmq` AND the optional `zeromq` npm package import succeeds (not a declared dependency — its absence downgrades to restart-mode repositioning, position carried across the swap). Exports pure geometry helpers (`computeCropGeometry`, `normToPixels`, `buildEaseSteps`). `applyForSource(db, apiKey, { mixerId?, mixerInput?, cameraId?, cameraPreset? })` (§4, production-follow) is the callback target `lcyt-backend/src/server.js` wires `lcyt-production`'s `registry.onProgramChanged()`/`onCameraPresetRecalled()` to: no-op unless `crop_config.follow_program` and the renderer is running; tracks, per apiKey, the last program mixer input and each camera's last-recalled preset (`Map` in `_followState`) so a preset recalled while its camera is off program is remembered but only applied once that camera is actually on program; resolves via `resolveCropPresetForSource()` and calls `applyPosition()`.
- `db/crop.js` — crop migrations + helpers: `crop_config` (aspect/output/transition/active set), `crop_preset_sets` (banks), `crop_presets` (normalised 0..1 positions), `crop_source_map` + `resolveCropPresetForSource()` (most-specific wins: camera+PTZ-preset > camera > mixer input; scoped to the active set). Manual delete cascades (FK enforcement is off repo-wide). `crop_source_map.camera_preset` holds an **opaque per-camera preset identifier** (the `presetId` string `POST /production/cameras/:id/preset/:presetId` and `lcyt-production`'s camera adapters actually use — `'wide'`, a UUID, ... — not a universal numeric PTZ preset number; AMX cameras have no such number at all), stored via `toPresetKeyOrNull()`; `resolveCropPresetForSource()` compares it as a string on both sides so a pre-existing numeric-looking value still matches. `resolveCameraIdForMixerInput(db, mixerInput)` — cross-plugin `prod_cameras` lookup (same guarded `hasProdCamerasTable()` pattern as `resolveRelaySourceCameraKey()` below) used by `CropManager.applyForSource()` to turn a bare mixer-input switch into a cameraId.
- `routes/crop.js` — `/crop` router (session Bearer; feature-gated on `crop` when `FEATURE_GATE_ENFORCE=1`): config, status, free `POST /position`, preset CRUD + `POST /presets/:id/activate`, set CRUD + `POST /sets/:id/activate` (re-applies the same-named preset from the new set live), source-map CRUD.
- `db/radio.js` — `runRadioMigrations()` + `getRadioConfig()`/`setRadioConfig()`: Web Radio metadata (`radio_config` table — title/description/coverImageUrl/autoplay, plus `radio_enabled` surfaced read-only as `enabled`) — §3.
- `routes/rtmp.js` — `POST /rtmp` — nginx-rtmp `on_publish`/`on_publish_done` callback for the primary video app. Resolves the incoming stream name through `resolveApiKeyFromIngestStreamKey()` before treating it as an api_key.
- `routes/feed-rtmp.js` — `createFeedRtmpRouter(db, relayManager)` (`POST /feed-rtmp`, `/feed-rtmp/on_publish`, `/feed-rtmp/on_publish_done` — plan_ingest_feeds.md §2a): nginx-rtmp callbacks for the single `feed` app that handles arbitrarily many named feeds. Resolves the incoming stream name against `prod_cameras.camera_key` for a `control_type='rtmp'` row (queried directly — cross-plugin, same pattern as `resolveApiKeyFromIngestStreamKey()`, guarded by the same `hasProdCamerasTable()` check `db/relay.js` uses); no matching row is a 403, a match calls `relayManager.markFeedPublishing()`/`markFeedNotPublishing()` keyed by `camera_key` (a separate namespace from apiKey-keyed live status — see `rtmp-manager.js` above) for live-status tracking. On `publish`, also looks up every apiKey with a relay slot sourcing from this camera (`db/relay.js`'s `getApiKeysReferencingCamera`) and, for each one with an active relay (`isRelayActive`), calls `relayManager.startAll()` for it — otherwise a project whose *only* configured slot is camera-sourced would never start egress, since nginx-rtmp's own `on_publish` for the raw per-key ingest never fires when nothing publishes to that raw path.
- `routes/ingestion.js` — `GET/PATCH /ingestion/config`, `POST /ingestion/config/rotate` — self-service ingest status/enable/rotate (session Bearer). Nested `{ video, dsk }` shape: `video.enabled` flips `relay_allowed` (feature-gated on `ingest` when `FEATURE_GATE_ENFORCE=1`); `dsk.enabled` is read-only (`graphics_enabled`) and `PATCH .../dsk` is `501` until a real DSK-ingest gate exists (§2/§2a).
- `routes/stream.js` — `GET/POST/PUT/DELETE /stream` — RTMP relay egress slot management (domain allowlist enforced). No cap on the number of slots (`plan_ingest_feeds.md` §1b removed the earlier 4-slot limit — `POST /stream` without a `slot` defaults to `MAX(slot)+1`; a future per-team quota is an explicit non-goal, not enforced here). Slots carry `sourceView: 'program'|'crop'` — crop-view slots fan out the `{key}-crop` vertical rendition via a MediaMTX runOnPublish hook on that path instead of the raw ingest (never part of CEA-708/transcode/DSK modes) — **and/or** an optional `sourceCameraId` (a `prod_cameras` row with a `camera_key`), which takes priority over `sourceView` when set: the slot fans out from that camera's own MediaMTX path instead (`db/relay.js`'s `resolveRelaySourceCameraKey()` validates it and joins `source_camera_key` into every read; `rtmp-manager.js`'s `start()` groups camera-sourced slots by `cameraKey` and registers one runOnPublish hook per distinct feed via `_startCameraSourceRelay()`/`_stopCameraSourceRelays()`, mirroring the crop mechanism).
- `routes/stream-hls.js` — `GET /stream-hls/:key/*` — HLS video+audio proxy (public, rate-limited).
- `routes/radio.js` — `GET /radio/:key/*` — audio-only HLS proxy (public, rate-limited); `GET/PUT /radio/config` — self-service Web Radio metadata (session Bearer, §3/§3a); resolves nginx-rtmp callback stream names through `resolveApiKeyFromIngestStreamKey()`.
- `routes/preview.js` — `GET /preview/:key/incoming.jpg` — RTMP → JPEG thumbnail serving (public).

**Tests:** `packages/plugins/lcyt-rtmp/test/*.test.js` — uses `node:test` with `--experimental-test-module-mocks`.

## Server-side STT Architecture

Server-side speech-to-text transcription converts an incoming RTMP/HLS/WHEP audio stream into captions without requiring a browser microphone. Transcripts are injected directly into the session's `_sendQueue` and delivered to YouTube just like manually typed captions.

**Audio sources:**
| Source | How it works |
|---|---|
| `hls` | `HlsSegmentFetcher` polls MediaMTX fMP4 HLS playlist (`MEDIAMTX_HLS_BASE_URL`, default `http://127.0.0.1:8080`); segments sent to STT adapter |
| `rtmp` | ffmpeg reads RTMP stream and writes PCM/WAV frames to the adapter's stdin |
| `whep` | ffmpeg reads WHEP (WebRTC-HTTP Egress Protocol) stream from MediaMTX's WebRTC port (`MEDIAMTX_WEBRTC_BASE_URL`, default `http://127.0.0.1:8889`) and writes PCM frames |

**Providers:**
| Provider | Class | Notes |
|---|---|---|
| `google` | `GoogleSttAdapter` | REST (default) or gRPC (`GOOGLE_STT_MODE=grpc`); service account or API key auth |
| `whisper_http` | `WhisperHttpAdapter` | Any Whisper-compatible HTTP endpoint |
| `openai` | `OpenAiAdapter` | OpenAI `/audio/transcriptions`-compatible endpoint |

**Confidence filtering:** Each `POST /stt/start` request accepts an optional `confidenceThreshold` (0–1). Transcripts below the threshold are silently dropped.

**Per-key config persistence:** `GET/PUT /stt/config` stores preferred provider, language, audioSource, and confidenceThreshold in the DB (`getSttConfig`/`setSttConfig` in this plugin).

The HTTP routes for STT (`/stt/*`) live in `packages/lcyt-backend/src/routes/stt.js` and delegate to `SttManager` here — see `packages/lcyt-backend/CLAUDE.md`.

## Test Coverage

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
- `test/crop-geometry.test.js` — pure crop geometry: window derivation, even rounding, clamping, ease steps.
- `test/crop-db.test.js` — crop config/presets/sets (incl. clone)/source-map helpers + follow-resolution specificity; `resolveCameraIdForMixerInput()` (no `prod_cameras` table, matches, no-match); `camera_preset` as an opaque string identifier (accepts non-numeric values, legacy numeric-looking rows still resolve via string comparison).
- `test/crop-manager.test.js` — CropManager lifecycle with mock worker daemon; restart-mode repositioning; crop-slot fan-out registration in RtmpRelayManager; `applyForSource()` production-follow (§4): follow_program off/renderer-not-running no-ops, plain mixer-input mapping, the camera-1/preset-1 → camera-2 → camera-1/preset-2 walkthrough from the plan's own requirements, and a preset recalled while its camera is off program being remembered-not-applied until that camera is actually cut to program.
- `test/crop-routes.test.js` — /crop router CRUD, activate flows, feature gate.
- `test/feed-rtmp.test.js` — `/feed-rtmp` on_publish/on_publish_done (single-URL and separate-URL styles): unknown camera_key → 403, non-`'rtmp'`-type camera → 403, known feed → 200 + live-status tracking (plan_ingest_feeds.md §2a); plus a "camera-only egress" block covering the code-review follow-up — on_publish starts the relay for a project whose only slot sources from the published camera, and does not start it for a referencing project with `relay_active=0`.
- `test/rtmp-manager-camera-source.test.js` — `RtmpRelayManager` camera-sourced (named-feed) relay slots: fan-out registered on the camera's own path not the raw ingest, multiple distinct feeds grouped independently, camera-sourced-only slot sets, `sourceCameraKey` priority over `sourceView`, graceful no-MediaMTX-client skip (plan_ingest_feeds.md §2c).
- `test/rtmp-manager.test.js` — also covers the `MAX_TRANSCODE_SLOTS` resource-exhaustion guard: `start()` rejects per-slot transcoding once the program-sourced slot count exceeds the technical ceiling, even when only one slot actually sets a transcode option.

**Gaps (Medium):**
- gRPC streaming path in `GoogleSttAdapter` (requires `@google-cloud/speech` to be installed).
- `NginxManager` nginx reload failure handling.
- Full STT session E2E (HLS playlist → segment fetch → transcript → SSE delivery).
