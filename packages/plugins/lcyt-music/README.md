# lcyt-music — Music Detection Plugin

Metacode-based audio classification signaling for LCYT. Detects when music is playing (currently via the browser microphone) and feeds `music / speech / silence` + BPM signals into the existing caption pipeline as metacodes, which the backend converts into SSE events and a DB event log.

**Version:** 0.1.0
**License:** MIT
**Status:** Phase 1 — client-side (browser mic) detection only. Server-side HLS audio analysis is not implemented yet (see [Roadmap](#roadmap-phase-2) below).

## Overview

lcyt-music provides:
- **Client-side audio classification** — Classify browser microphone audio into `music / speech / silence` (Web Audio API, `useMusicDetector` hook in lcyt-web)
- **Client-side BPM estimation** — Real-time beats-per-minute estimate when music is detected
- **Metacode pipeline** — `<!-- sound:music -->`, `<!-- bpm:128 -->` markers, stripped server-side before YouTube delivery
- **SSE events** — `sound_label` and `bpm_update` events on the existing `GET /events` stream
- **Event log** — Every label change / BPM update is persisted to the `music_events` table

## Installation

```bash
npm install lcyt-music
```

## Quick Start

In `lcyt-backend`:

```javascript
import { initMusicControl, createSoundCaptionProcessor } from 'lcyt-music';

// Runs DB migrations. No return value — there is no MusicManager yet (Phase 2).
await initMusicControl(db);

const soundProcessor = createSoundCaptionProcessor({ store, db });

// Pass soundProcessor into the captions router alongside the other metacode
// processors (dskCaptionProcessor, cueProcessor) — see
// packages/lcyt-backend/src/metacode.js for the canonical processing order.
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

### Server-side (HLS segments) — not implemented yet

See [Roadmap](#roadmap-phase-2).

## API Routes

None. This plugin exposes no Express routes or `Router` in Phase 1 — `express` is currently an unused dependency, reserved for the Phase 2 HTTP surface (config CRUD, etc.). Detection is entirely passive:
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

There are currently no environment variables for this plugin. Detection is configured entirely client-side via `useMusicDetector` options (`enabled`, `bpmEnabled`, `intervalMs`, `confirmFrames`, `confidenceThreshold`) and persisted in `localStorage` by `useMusic` (`KEYS.audio.musicDetect`, `KEYS.audio.musicDetectBpm`).

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

`test/sound-caption-processor.test.js` covers:
- Metacode extraction and stripping (`sound:`, `bpm:`, both together, case-insensitivity)
- `music_events` DB inserts
- `sound_label` / `bpm_update` SSE emission (including no-op cases: unknown session, missing store/db)

## Client-side (lcyt-web)

- `packages/lcyt-web/src/hooks/useMusicDetector.js` — microphone-derived classification, BPM estimation, confirm/debounce state machine, sends the metacode caption.
- `packages/lcyt-web/src/hooks/useMusic.js` — wraps `useMusicDetector`, layers in SSE-confirmed state from the backend, and persists on/off + BPM-on/off toggles to `localStorage`.

## Limitations

- **No song identification** — No Shazam-style fingerprinting
- **No copyright detection** — Not for DMCA/rights management
- **No server-side audio path yet** — captions/streams with no browser microphone (e.g. hardware-only RTMP feeds) get no music detection (see Roadmap)
- **Accuracy depends on the spectral heuristic** — `classifyFromFrequency` is a heuristic classifier, not a trained ML model; accuracy varies by source material
- **Client-side requires mic permission** — User must grant microphone access in the browser
- **No confidence data in SSE/DB** — see [SSE Events](#sse-events) above

## Roadmap (Phase 2)

Not yet implemented — described here for context, not as current behavior:
- Server-side HLS segment analysis (`MediaMTX fMP4 HLS → lcyt-music → label/BPM → session._sendQueue`), so detection works without a browser microphone
- A `MusicManager` returned from `initMusicControl()`
- HTTP routes for per-key music detection config
- Confidence values carried through the metacode format and into SSE/DB

## See Also

- [Cue Engine documentation](../lcyt-cues/README.md)
- [DSK Graphics documentation](../lcyt-dsk/README.md)
- [LCYT backend documentation](../../lcyt-backend/README.md)
- [Plan: Music Detection](../../../docs/plans/plan_music.md)
