# lcyt-music — Music Detection Plugin

Metacode-based audio classification signaling for LCYT. Detects when music is playing — via the browser microphone, or server-side from a stream's own HLS audio — and feeds `music / speech / silence` + BPM signals into the existing caption pipeline as metacodes, which the backend converts into SSE events and a DB event log.

**Version:** 0.1.0
**License:** MIT
**Status:** Phase 1 (client-side browser-mic detection) and Phase 2 (server-side HLS audio analysis) are both implemented.

## Overview

lcyt-music provides:
- **Client-side audio classification** — Classify browser microphone audio into `music / speech / silence` (Web Audio API, `useMusicDetector` hook in lcyt-web)
- **Client-side BPM estimation** — Real-time beats-per-minute estimate when music is detected
- **Server-side audio classification** — `MusicManager` polls a stream's own MediaMTX fMP4 HLS segments, decodes them via ffmpeg, and runs the same spectral classifier + BPM estimator without any browser involved
- **Metacode pipeline** — `<!-- sound:music -->`, `<!-- bpm:128 -->` markers, stripped server-side before YouTube delivery
- **SSE events** — `sound_label` and `bpm_update` events on the existing `GET /events` stream, plus a dedicated public `GET /music/:key/live` SSE stream
- **Event log** — Every label change / BPM update is persisted to the `music_events` table
- **Per-key config** — `GET/PUT /music/config` for tuning thresholds, BPM range, and confirm-segment smoothing

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

## API Routes

Mounted at `/music` only when `MUSIC_DETECTION_ACTIVE=1` and a `MusicManager` was constructed (i.e. `initMusicControl(db, store)` was called with a session store):

```
GET  /music/status      — current analysis state for the authenticated API key (Bearer token)
POST /music/start       — start server-side analysis { streamKey? } (Bearer token)
POST /music/stop        — stop analysis (Bearer token)
GET  /music/:key/live   — public SSE stream of label_change / bpm_update / music_error / music_stopped events
GET  /music/config      — get per-key detector config (Bearer token)
PUT  /music/config      — update per-key detector config, partial patch (Bearer token)
```

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

## Configuration

| Variable | Purpose | Default |
|---|---|---|
| `MUSIC_DETECTION_ACTIVE` | Set to `1` to mount the `/music` routes and allow `MusicManager` to be started for an API key | unset |
| `MEDIAMTX_HLS_BASE_URL` | Base URL of the MediaMTX HLS server `MusicManager` polls for fMP4 audio segments (shared with `lcyt-rtmp`'s `HlsManager`/`SttManager`) | `http://127.0.0.1:8888` |

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
-- Per-API-key server-side detector config (Phase 2). Row is created lazily
-- on first GET/PUT /music/config with DEFAULT_MUSIC_CONFIG values.
CREATE TABLE music_config (
  api_key           TEXT PRIMARY KEY,
  silence_threshold REAL    NOT NULL DEFAULT 0.01,
  flatness_threshold REAL   NOT NULL DEFAULT 0.4,
  zcr_threshold     REAL    NOT NULL DEFAULT 0.15,
  confirm_segments  INTEGER NOT NULL DEFAULT 2,
  bpm_enabled       INTEGER NOT NULL DEFAULT 1,
  bpm_min           INTEGER NOT NULL DEFAULT 40,
  bpm_max           INTEGER NOT NULL DEFAULT 200,
  auto_start        INTEGER NOT NULL DEFAULT 0
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

## Client-side (lcyt-web)

- `packages/lcyt-web/src/hooks/useMusicDetector.js` — microphone-derived classification, BPM estimation, confirm/debounce state machine, sends the metacode caption.
- `packages/lcyt-web/src/hooks/useMusic.js` — wraps `useMusicDetector`, layers in SSE-confirmed state from the backend, and persists on/off + BPM-on/off toggles to `localStorage`.

## Limitations

- **No song identification** — No Shazam-style fingerprinting
- **No copyright detection** — Not for DMCA/rights management
- **Server-side analysis requires an active RTMP/HLS stream** — `MusicManager` reads from the same MediaMTX HLS output as `HlsManager`; there must be a live stream for the API key for `POST /music/start` to do anything
- **Accuracy depends on the spectral heuristic** — `classifyFromFrequency` is a heuristic classifier, not a trained ML model; accuracy varies by source material
- **Client-side requires mic permission** — User must grant microphone access in the browser
- **No confidence data in SSE/DB** — see [SSE Events](#sse-events) above

## See Also

- [Cue Engine documentation](../lcyt-cues/README.md)
- [DSK Graphics documentation](../lcyt-dsk/README.md)
- [LCYT backend documentation](../../lcyt-backend/README.md)
- [Plan: Music Detection](../../../docs/plans/plan_music.md)
