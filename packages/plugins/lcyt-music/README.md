# lcyt-music — Music Detection Plugin

Metacode-based audio classification signaling for LCYT. Detects when music is playing — via the browser microphone, or server-side from a stream's own HLS audio — and feeds `music / speech / silence` + BPM signals into the existing caption pipeline as metacodes, which the backend converts into SSE events and a DB event log.

**Version:** 0.1.0
**License:** MIT
**Status:** Phases 1-4 are all implemented — client-side browser-mic detection, server-side HLS/RTMP audio analysis, paginated event history, auto-calibration (client + server), and an optional external/ML classifier hook.

## Overview

lcyt-music provides:
- **Client-side audio classification** — Classify browser microphone audio into `music / speech / silence` (Web Audio API, `useMusicDetector` hook in lcyt-web)
- **Client-side BPM estimation** — Real-time beats-per-minute estimate when music is detected
- **Server-side audio classification** — `MusicManager` polls a stream's own MediaMTX fMP4 HLS segments, decodes them via ffmpeg, and runs the same spectral classifier + BPM estimator without any browser involved
- **Auto-calibration** — both the client detector and `MusicManager` can sample a few seconds of room/stream noise at startup and derive a calibrated silence threshold instead of relying on a fixed default
- **Optional external/ML classifier** — `MusicManager` can delegate classification to an external HTTP endpoint (`MUSIC_CLASSIFIER_URL`) instead of the built-in spectral heuristic, falling back to the heuristic on error/timeout
- **Metacode pipeline** — `<!-- sound:music -->`, `<!-- bpm:128 -->` markers, stripped server-side before YouTube delivery
- **SSE events** — `sound_label` and `bpm_update` events on the existing `GET /events` stream, plus a dedicated public `GET /music/:key/live` SSE stream (also emits `music_calibrated`)
- **Event log** — Every label change / BPM update is persisted to the `music_events` table, queryable via a paginated history endpoint
- **Per-key config** — `GET/PUT /music/config` for tuning thresholds, BPM range, confirm-segment smoothing, and auto-calibration

## Installation

```bash
npm install lcyt-music
```

## Quick Start

In `lcyt-backend`:

```javascript
import { initMusicControl, createSoundCaptionProcessor, createMusicRouters } from 'lcyt-music';

// Runs DB migrations and (when a session store is passed) constructs the
// MusicManager for server-side HLS audio analysis.
const { musicManager } = await initMusicControl(db, store);

const soundProcessor = createSoundCaptionProcessor({ store, db });

// Pass soundProcessor into the captions router alongside the other metacode
// processors (dskCaptionProcessor, cueProcessor) — see
// packages/lcyt-backend/src/metacode.js for the canonical processing order.

// Opt-in server-side analysis routes (MUSIC_DETECTION_ACTIVE=1):
if (process.env.MUSIC_DETECTION_ACTIVE === '1' && musicManager) {
  app.use('/music', ...createMusicRouters(db, auth, musicManager));
}

// In graceful shutdown:
if (musicManager) await musicManager.stopAll();
```

## Metacode Syntax

Captions emit sound metacodes (currently from the browser-mic detector in lcyt-web):

```
<!-- sound:music -->        Audio is music
<!-- sound:speech -->       Audio is speech (or mixed/predominantly speech)
<!-- sound:silence -->      Audio is silent
<!-- bpm:128 -->            Current BPM estimate (integer; only emitted when label=music)
```

Multiple metacodes in a single caption:

```
<!-- sound:music --> <!-- bpm:128 -->
```

These metacodes are never sent to YouTube — `createSoundCaptionProcessor` strips them from the caption text and converts them into SSE events + a DB log entry. Caption text containing only metacodes is reduced to an empty string and nothing is delivered to YouTube.

## Audio Sources

### Client-side (Browser microphone) — implemented

```
Browser Microphone (Web Audio API, via AudioContext's AnalyserNode)
    ↓
lcyt-web useMusicDetector hook (spectral classification + BPM estimation)
    ↓
caption.send('<!-- sound:music --> <!-- bpm:128 -->')
    ↓
Backend createSoundCaptionProcessor strips metacode, logs to music_events,
emits sound_label / bpm_update on GET /events
```

Usage (in lcyt-web):

```javascript
import { useMusicDetector } from '../hooks/useMusicDetector.js';

const { label, bpm, confidence, available, running } = useMusicDetector({
  analyserRef,        // AnalyserNode ref already set up by the audio panel
  enabled: true,
  bpmEnabled: true,
  confidenceThreshold: 0.5,
});
```

`useMusicDetector` never requests microphone access itself — it reads from an `AnalyserNode` ref that the caller (`AudioPanel`) already created. It runs a local confirm/debounce state machine and calls `caption.send(...)` itself when a label change is confirmed; it does not require the caller to manually build/send the metacode string.

`useMusic` (`packages/lcyt-web/src/hooks/useMusic.js`) wraps `useMusicDetector` and additionally subscribes to the SSE-confirmed `sound_label` / `bpm_update` events from the backend, treating the server-confirmed values as authoritative once the round trip succeeds.

### Server-side (HLS segments) — implemented

```
MediaMTX fMP4 HLS segments (RTMP relay's own stream)
    ↓
HlsSegmentFetcher (polls playlist, emits segment buffers)
    ↓
MusicManager: extractPcm (ffmpeg) → classify() → detectBpm()
    ↓ (confirm-segments smoothing + BPM delta-gating)
soundProcessor(apiKey, '<!-- sound:music --> <!-- bpm:128 -->')
    ↓
createSoundCaptionProcessor strips metacode, logs to music_events,
emits sound_label / bpm_update on GET /events (and on GET /music/:key/live)
```

Unlike `SttManager`, `MusicManager` calls the sound processor directly — analysis results are signal-only and are never fanned out through `session._sendQueue` to YouTube/viewer/generic targets.

Control via `POST /music/start` / `POST /music/stop` (see [API Routes](#api-routes)). Requires `RTMP_RELAY_ACTIVE=1` and an active RTMP/HLS stream for the API key, since `MusicManager` reads from the same MediaMTX HLS output as `HlsManager`.

### Server-side (RTMP) — implemented

Fallback audio source for deployments without MediaMTX: `MusicManager` spawns `ffmpeg` directly against the RTMP relay's own stream (the same approach `SttManager` uses for its `rtmp` audio source) instead of polling HLS segments.

```
RTMP relay stream (rtmp://HLS_LOCAL_RTMP/HLS_RTMP_APP/streamKey)
    ↓
ffmpeg -i <rtmp url> -vn -ac 1 -ar 22050 -f s16le pipe:1
    ↓
MusicManager: accumulate raw PCM bytes, slice into fixed 6s windows
    ↓
classify() → detectBpm()  (same shared analysis pipeline as the HLS path)
    ↓ (confirm-segments smoothing + BPM delta-gating)
soundProcessor(apiKey, '<!-- sound:music --> <!-- bpm:128 -->')
```

Select it by passing `audioSource: 'rtmp'` to `POST /music/start` (default is `'hls'`). No MediaMTX or `HlsSegmentFetcher` involvement — only `HLS_LOCAL_RTMP` / `HLS_RTMP_APP` (already used by the RTMP relay) are needed.

## Auto-Calibration (Phase 4)

A fixed silence threshold doesn't generalise across rooms/streams with different background noise floors. When `music_config.auto_calibrate` is enabled for a key (`PUT /music/config { autoCalibrate: true }`; default `false`), both the server-side and client-side detectors run a short calibration phase instead of using the configured/default `silenceThreshold` outright:

- **Server-side** (`MusicManager`): for the first ~5 seconds of audio after `POST /music/start`, RMS energy is sampled per window instead of running `classify()` — no `label_change`/`bpm_update` events are emitted during this window. Once enough audio has accumulated, a calibrated threshold is derived from the observed min/max RMS range (`min + (max - min) * 0.5`, clamped to `[0.002, 0.05]`), stored on the session, and a `calibrated` event (`{ apiKey, silenceThreshold, ts }`) is emitted — relayed as `music_calibrated` on `GET /music/:key/live` (see [SSE Events](#sse-events)). All classification from then on for that session uses the calibrated threshold instead of `config.silenceThreshold`. `GET /music/status` exposes `calibrating` and `calibratedSilenceThreshold` so clients can show a "calibrating…" state.
- **Client-side** (`useMusicDetector`): mirrors the same idea — samples RMS for the first ~5s after the detector starts, derives a calibrated `silenceThreshold`, and persists it to the `musicDetectThreshold` localStorage key so the browser doesn't recalibrate on every page load. Gated by a separate client-only `autoCalibrate` option (default `true` — no backward-compatibility concern client-side, unlike the server default).

Calibration runs once per `MusicManager.start()` / detector-start call, regardless of whether the session was started manually or (in the future) via an `on_publish` auto-start hook.

## External Classifier Hook (Phase 4)

By default, server-side classification uses the built-in zero-dependency spectral heuristic (`analyser/spectral-detector.js`). Setting `MUSIC_CLASSIFIER_URL` lets `MusicManager` delegate classification to an external HTTP endpoint instead — useful for swapping in a trained ML model without adding any ML library as a hard dependency of this plugin:

- `MusicManager` POSTs the window's raw PCM, encoded as a WAV body (`Content-Type: audio/wav`), to `MUSIC_CLASSIFIER_URL`.
- The endpoint must respond with JSON: `{ "label": "music"|"speech"|"silence", "confidence": number|null }`.
- Requests time out after 3 seconds (`AbortSignal.timeout`); on error, non-2xx response, timeout, or a malformed response (missing `label`), `MusicManager` transparently falls back to the built-in heuristic for that window — there is no user-visible failure mode.
- Leave `MUSIC_CLASSIFIER_URL` unset (the default) to always use the built-in heuristic; nothing else changes.

## API Routes

Mounted at `/music` only when `MUSIC_DETECTION_ACTIVE=1` and a `MusicManager` was constructed (i.e. `initMusicControl(db, store)` was called with a session store):

```
GET  /music/status          — current analysis state for the authenticated API key (Bearer token)
POST /music/start           — start server-side analysis { streamKey?, audioSource? } (Bearer token)
                                audioSource: 'hls' (default) | 'rtmp'
POST /music/stop            — stop analysis (Bearer token)
GET  /music/events/history  — paginated music_events history (Bearer token)
                                query: limit? (default 50, clamp 1-200), offset? (default 0),
                                       eventType? ('label_change' | 'bpm_update')
                                response: { events, total, limit, offset }
GET  /music/:key/live       — public SSE stream of snapshot / label_change / bpm_update /
                                music_calibrated / music_error / music_stopped events
GET  /music/config          — get per-key detector config (Bearer token)
PUT  /music/config          — update per-key detector config, partial patch (Bearer token)
```

On connect, `GET /music/:key/live` seeds the client with a `snapshot` event built from the most recent `label_change` / `bpm_update` rows in `music_events` (if any exist for the key), so a newly-opened SSE connection doesn't have to wait for the next live transition to know the current state.

`GET /music/events/history` is ordered `ts DESC, id DESC` (most recent first; `id` is a composite tiebreaker since `ts` only has 1-second resolution) and is scoped to the authenticated session's `api_key`.

Phase 1 (client-side / browser mic) requires no routes — it's entirely passive:
1. The frontend detector sends a caption containing a `<!-- sound:... -->` / `<!-- bpm:... -->` metacode.
2. `createSoundCaptionProcessor` strips it from the caption text, logs it to `music_events`, and emits an SSE event on the session's existing `GET /events` stream.

## SSE Events

On `GET /events`, music detection emits:

```json
{
  "type": "sound_label",
  "data": { "label": "music", "bpm": 128, "confidence": null, "ts": 1772100000000 }
}
```

```json
{
  "type": "bpm_update",
  "data": { "bpm": 128, "confidence": null, "ts": 1772100000050 }
}
```

`ts` is a `Date.now()` millisecond epoch (Node.js convention — see the timestamp handling section of the root `CLAUDE.md`), not an ISO string. `confidence` is currently always `null`: the `<!-- sound:... -->` / `<!-- bpm:... -->` metacode format does not carry a confidence value, so nothing is available server-side to populate it with, even though `useMusicDetector` computes a confidence score locally (exposed via its own return value, not over SSE).

On the dedicated `GET /music/:key/live` SSE stream only (not on `GET /events`), `MusicManager` additionally emits a `music_calibrated` event once its auto-calibration phase finishes (only when `music_config.auto_calibrate` is enabled for the key — see [Auto-Calibration](#auto-calibration) below):

```json
{
  "type": "music_calibrated",
  "data": { "silenceThreshold": 0.0123, "ts": 1772100000000 }
}
```

## Configuration

| Variable | Purpose | Default |
|---|---|---|
| `MUSIC_DETECTION_ACTIVE` | Set to `1` to mount the `/music` routes and allow `MusicManager` to be started for an API key | unset |
| `MEDIAMTX_HLS_BASE_URL` | Base URL of the MediaMTX HLS server `MusicManager` polls for fMP4 audio segments (`audioSource: 'hls'`; shared with `lcyt-rtmp`'s `HlsManager`/`SttManager`) | `http://127.0.0.1:8888` |
| `HLS_LOCAL_RTMP` | Local nginx-rtmp base URL `MusicManager` spawns ffmpeg against (`audioSource: 'rtmp'`; shared with the RTMP relay) | `rtmp://127.0.0.1:1935` |
| `HLS_RTMP_APP` | RTMP application name for the `rtmp` audio source (shared with the RTMP relay) | `live` |
| `MUSIC_CLASSIFIER_URL` | Optional external/ML classifier endpoint (Phase 4). When set, `MusicManager` POSTs raw PCM as a WAV body and uses the returned `{ label, confidence }`, falling back to the built-in heuristic on error/timeout | unset (always uses the built-in heuristic) |

Client-side (browser-mic) detection has no environment variables — it's configured entirely client-side via `useMusicDetector` options (`enabled`, `bpmEnabled`, `intervalMs`, `confirmFrames`, `confidenceThreshold`) and persisted in `localStorage` by `useMusic` (`KEYS.audio.musicDetect`, `KEYS.audio.musicDetectBpm`).

Server-side detection thresholds (silence/flatness/zcr, confirm-segments smoothing, BPM range, auto-start) are per-API-key and stored in the `music_config` table, tunable via `GET/PUT /music/config`.

### Database Schema

```sql
-- Event log: label transitions and BPM snapshots.
-- Populated by createSoundCaptionProcessor when it processes a
-- <!-- sound:... --> or <!-- bpm:... --> metacode.
CREATE TABLE music_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  api_key    TEXT    NOT NULL,
  event_type TEXT    NOT NULL,   -- 'label_change' or 'bpm_update'
  label      TEXT,               -- 'music' | 'speech' | 'silence' (label_change rows only)
  bpm        REAL,
  confidence REAL,                -- currently always NULL (see SSE Events above)
  ts         INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE INDEX music_events_key_ts ON music_events(api_key, ts);
```

If a single caption carries both a `sound:` and a `bpm:` metacode, only one `label_change` row is written (with `bpm` attached) — there is no separate `bpm_update` row in that case, even though a separate `bpm_update` SSE event is still emitted.

```sql
-- Per-API-key server-side detector config (Phase 2; auto_calibrate added in
-- Phase 4 via an additive migration). Row is created lazily on first
-- GET/PUT /music/config with DEFAULT_MUSIC_CONFIG values.
CREATE TABLE music_config (
  api_key           TEXT PRIMARY KEY,
  silence_threshold REAL    NOT NULL DEFAULT 0.01,
  flatness_threshold REAL   NOT NULL DEFAULT 0.4,
  zcr_threshold     REAL    NOT NULL DEFAULT 0.15,
  confirm_segments  INTEGER NOT NULL DEFAULT 2,
  bpm_enabled       INTEGER NOT NULL DEFAULT 1,
  bpm_min           INTEGER NOT NULL DEFAULT 40,
  bpm_max           INTEGER NOT NULL DEFAULT 200,
  auto_start        INTEGER NOT NULL DEFAULT 0,
  auto_calibrate    INTEGER NOT NULL DEFAULT 0
);
```

## Use Cases

### 1. Mute STT During Music

When `sound_label` is `music`, suppress STT output or discard low-confidence transcripts:

```javascript
// Frontend
if (soundLabel === 'music') {
  // Skip STT or mark as low-priority
  return;
}
```

### 2. Signal Music Presence to Overlays

DSK graphics can react to music detection:

```
<!-- sound:music -->
(DSK receives sound_label event)
(Overlays can change style, show visual cue, etc.)
```

### 3. Production Cue Light

Show operator a visual indicator when music is detected:

```javascript
// Frontend: Show red/green cue light based on soundLabel
<div className={`cue-light ${soundLabel === 'music' ? 'active' : ''}`} />
```

### 4. BPM Display

Display current BPM for producers timing transitions to beat:

```javascript
// Frontend
<span>{bpm} BPM</span>  // Updates when sound_label=music
```

## Integration with Other Plugins

**Cue Engine** (`lcyt-cues`):
- `createSoundCueListener({ store, engine })` subscribes to `sound_label` events on each session and evaluates `music_start` / `music_stop` / `silence` sound-cue rules.

**DSK Graphics** (`lcyt-dsk`):
- Receives `sound_label` events via SSE.
- Can use events in templates/overlays.

## Testing

```bash
npm test -w packages/plugins/lcyt-music
```

- `test/sound-caption-processor.test.js` — metacode extraction and stripping (`sound:`, `bpm:`, both together, case-insensitivity), `music_events` DB inserts, `sound_label` / `bpm_update` SSE emission (including no-op cases: unknown session, missing store/db)
- `test/fft.test.js` — FFT correctness (known signals, power-of-two sizes)
- `test/spectral-detector.test.js` — `classifyFromFrequency` heuristic classifier (music/speech/silence thresholds)
- `test/bpm-detector.test.js` — `detectBpm` beat-tracking estimator
- `test/music-manager.test.js` — `MusicManager` start/stop lifecycle, confirm-segments smoothing, BPM delta-gating, direct `soundProcessor` invocation (bypassing `_sendQueue`)
- `test/music-manager-rtmp.test.js` — `MusicManager` RTMP audio source: ffmpeg spawn args/URL building, process lifecycle (stop/error/non-zero exit), PCM windowing/accumulation, shared classify/confirm-segments/BPM pipeline reuse
- `test/db.test.js` (Phase 4) — `getMusicEventsPage` pagination/ordering/`eventType` filtering/`total` count, `autoCalibrate` config field round-trip, `runMigrations` idempotency (re-running migrations on an already-migrated DB is a no-op)
- `test/music-manager-calibration.test.js` (Phase 4) — RMS accumulation during the calibration window, classification/emission suppressed while calibrating, `calibratedSilenceThreshold` derivation, `calibrated` event emission, subsequent classification using the calibrated threshold, `getStatus()` calibration fields
- `test/external-classifier.test.js` (Phase 4) — `classifyExternal` success path (mocked `fetch`), timeout (`AbortSignal.timeout`), non-2xx response, malformed response, and `MUSIC_CLASSIFIER_URL` unset
- `test/music-manager-classifier-queue.test.js` (Phase 4) — `MUSIC_CLASSIFIER_URL` integration: async `_analysePcm`/`_processRtmpWindow`, fallback to the built-in heuristic on classifier failure, RTMP `processingQueue` ordering guarantee when multiple windows arrive within a single `data` chunk (events fire in emission order, not promise-resolution order)

## Client-side (lcyt-web)

- `packages/lcyt-web/src/hooks/useMusicDetector.js` — microphone-derived classification, BPM estimation, confirm/debounce state machine, auto-calibration phase (Phase 4; persists the calibrated threshold to the `musicDetectThreshold` localStorage key), sends the metacode caption.
- `packages/lcyt-web/src/hooks/useMusic.js` — wraps `useMusicDetector`, layers in SSE-confirmed state from the backend, and persists on/off + BPM-on/off toggles to `localStorage`.
- `packages/lcyt-web/src/components/panels/MusicHistoryPanel.jsx` (Phase 4) — self-fetching, paginated timeline of server-side `music_events` history via `useSessionApiContext().getMusicEventsHistory()`; mounted alongside `MusicPanel` in the Music Detection settings tab (`CaptionsModal.jsx`).

## Limitations

- **No song identification** — No Shazam-style fingerprinting
- **No copyright detection** — Not for DMCA/rights management
- **Server-side analysis requires an active RTMP/HLS stream** — `MusicManager` reads from the same MediaMTX HLS output as `HlsManager`; there must be a live stream for the API key for `POST /music/start` to do anything
- **Accuracy depends on the spectral heuristic by default** — `classifyFromFrequency` is a heuristic classifier, not a trained ML model; accuracy varies by source material. Set `MUSIC_CLASSIFIER_URL` to delegate to an external/ML classifier instead (see [External Classifier Hook](#external-classifier-hook-phase-4))
- **Client-side requires mic permission** — User must grant microphone access in the browser
- **No confidence data in SSE/DB** — see [SSE Events](#sse-events) above

## See Also

- [Cue Engine documentation](../lcyt-cues/README.md)
- [DSK Graphics documentation](../lcyt-dsk/README.md)
- [LCYT backend documentation](../../lcyt-backend/README.md)
- [Plan: Music Detection](../../../docs/plans/plan_music.md)
