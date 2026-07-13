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
- `rtmp-manager.js` — `RtmpRelayManager`: manages RTMP relay sessions; calls `probeFfmpeg()` on startup. Fires `onStreamStarted`/`onStreamEnded` callbacks for DB stat tracking. Server-side DSK RTMP composite (`setDskRtmpSource(apiKey, rtmpUrl, { chromaKey })`) optionally chroma-keys the overlay via the exported pure `buildDskCompositeFilter(chromaKey)` (`plan_dsk_viewport_settings` Phase 5) — no chromaKey = today's opaque full-frame overlay; the composite viewport's `stream.chromaKey` is passed in by `lcyt-dsk`'s `on_publish`.
- `hls-manager.js` — `HlsManager`: manages MediaMTX-based RTMP → video+audio HLS (no ffmpeg in hot path).
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
- `db/relay.js` — RTMP relay DB helpers: `isRelayAllowed()`, `isRadioEnabled()`, `resolveApiKeyFromIngestStreamKey()` (resolves a rotated ingest stream key back to its owning api_key, falling back to treating the name as the literal api_key — `plan_selfservice_config_backend.md` §2), per-key relay config CRUD.
- `crop-manager.js` — `CropManager`: vertical-crop rendition (plan_vertical_crop.md) — one long-running ffmpeg per key reads the raw ingest via RTSP, cuts a `crop@vcrop` window at incoming resolution, publishes to the `{key}-crop` MediaMTX path. Live repositioning via zmq runtime filter commands when `ffmpegCaps.hasZmq` AND the optional `zeromq` npm package import succeeds (not a declared dependency — its absence downgrades to restart-mode repositioning, position carried across the swap). Exports pure geometry helpers (`computeCropGeometry`, `normToPixels`, `buildEaseSteps`).
- `db/crop.js` — crop migrations + helpers: `crop_config` (aspect/output/transition/active set), `crop_preset_sets` (banks), `crop_presets` (normalised 0..1 positions), `crop_source_map` + `resolveCropPresetForSource()` (most-specific wins: camera+PTZ-preset > camera > mixer input; scoped to the active set). Manual delete cascades (FK enforcement is off repo-wide).
- `routes/crop.js` — `/crop` router (session Bearer; feature-gated on `crop` when `FEATURE_GATE_ENFORCE=1`): config, status, free `POST /position`, preset CRUD + `POST /presets/:id/activate`, set CRUD + `POST /sets/:id/activate` (re-applies the same-named preset from the new set live), source-map CRUD.
- `db/radio.js` — `runRadioMigrations()` + `getRadioConfig()`/`setRadioConfig()`: Web Radio metadata (`radio_config` table — title/description/coverImageUrl/autoplay, plus `radio_enabled` surfaced read-only as `enabled`) — §3.
- `routes/rtmp.js` — `POST /rtmp` — nginx-rtmp `on_publish`/`on_publish_done` callback for the primary video app. Resolves the incoming stream name through `resolveApiKeyFromIngestStreamKey()` before treating it as an api_key.
- `routes/ingestion.js` — `GET/PATCH /ingestion/config`, `POST /ingestion/config/rotate` — self-service ingest status/enable/rotate (session Bearer). Nested `{ video, dsk }` shape: `video.enabled` flips `relay_allowed` (feature-gated on `ingest` when `FEATURE_GATE_ENFORCE=1`); `dsk.enabled` is read-only (`graphics_enabled`) and `PATCH .../dsk` is `501` until a real DSK-ingest gate exists (§2/§2a).
- `routes/stream.js` — `GET/POST/PUT/DELETE /stream` — RTMP relay egress slot management (domain allowlist enforced). Slots carry `sourceView: 'program'|'crop'` — crop-view slots fan out the `{key}-crop` vertical rendition via a MediaMTX runOnPublish hook on that path instead of the raw ingest (never part of CEA-708/transcode/DSK modes).
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
- `test/crop-db.test.js` — crop config/presets/sets (incl. clone)/source-map helpers + follow-resolution specificity.
- `test/crop-manager.test.js` — CropManager lifecycle with mock worker daemon; restart-mode repositioning; crop-slot fan-out registration in RtmpRelayManager.
- `test/crop-routes.test.js` — /crop router CRUD, activate flows, feature gate.

**Gaps (Medium):**
- gRPC streaming path in `GoogleSttAdapter` (requires `@google-cloud/speech` to be installed).
- `NginxManager` nginx reload failure handling.
- Full STT session E2E (HLS playlist → segment fetch → transcript → SSE delivery).
