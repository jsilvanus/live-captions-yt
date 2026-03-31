---
id: plan/music
title: "Music Detection Plugin (`lcyt-music`)"
status: in-progress
summary: "Detect when music is playing and estimate BPM — no song identification. Two paths: server-side HLS analysis via a new `lcyt-music` plugin; client-side browser mic analysis via Web Audio API in lcyt-web. Events feed into the caption pipeline (optional ♪ annotation) and are exposed via SSE. Phase 1 implemented: `lcyt-music` plugin (SoundCaptionProcessor, DB migrations), `subscribeSseEvent` in useSession, `useMusic`/`useMusicDetector` hooks, `MusicChip`/`MusicPanel` components, AudioPanel fftSize→2048, storageKeys update, i18n, backend + frontend tests. Phase 2 pending: `music_config` DB table, backend API routes, server-side HLS analysis, MusicPanel wiring."
---

# Music Detection Plugin (`lcyt-music`)

**Status:** In progress — Phase 1 implemented; Phase 2 pending  
**Scope:** New plugin `packages/plugins/lcyt-music`; new `/music` routes in `packages/lcyt-backend`; client-side detection in `packages/lcyt-web` using the browser microphone via Web Audio API.

---

## Motivation

Live-caption operators often want to know whether the audio currently coming from the microphone or flowing through the RTMP stream is speech, silence, or music.  Key use cases:

- **Mute STT during music** — suppress STT output (or discard low-confidence transcripts) when a song or background track is detected.
- **Signal music presence** — emit a `<!-- sound:music -->` metacode so DSK overlays, viewer pages, and production tools can react to musical segments in real time.
- **BPM display** — emit `<!-- bpm:128 -->` metacodes useful for broadcast producers timing cuts or graphics transitions to the beat.
- **Production cue light** — surface a visual indicator in the control UI so operators know a musical segment is in progress.

What is explicitly **out of scope**:

- Song title / artist identification (no Shazam-style fingerprinting).
- Copyright detection or content matching.
- Lyrics recognition (use the STT pipeline for that).

---

## Metacode Protocol

Music detection communicates through **caption metacodes** — the same `<!-- ... -->` HTML-comment convention used by the DSK graphics system (`<!-- graphics:... -->`).  The metacodes are injected into the caption pipeline, stripped before delivery to YouTube, and fire SSE events that the frontend listens to.

### Syntax

```
<!-- sound:music -->          audio is music
<!-- sound:speech -->         audio is speech (or mixed / predominantly speech)
<!-- sound:silence -->        audio is silent
<!-- bpm:128 -->              current BPM estimate (integer; only emitted when label=music)
```

Multiple metacodes can appear in the same caption text:

```
<!-- sound:music --> <!-- bpm:128 -->
```

The stripped text after removing all `<!-- sound:... -->` and `<!-- bpm:... -->` codes is always empty — these are **signal-only** metacodes.  They are never sent to YouTube.

### Processing pipeline

Both paths (server-side and client-side) emit captions that contain only metacodes.  A `SoundCaptionProcessor` (analogous to `createDskCaptionProcessor`) is injected into the captions route and:

1. Extracts `<!-- sound:... -->` and `<!-- bpm:... -->` codes from the caption text.
2. Updates the current `soundState` for the API key (`{ label, bpm, confidence, ts }`).
3. If the label changed, emits a `sound_label` SSE event on `GET /events` (the session SSE stream the frontend already listens to).
4. Emits a `bpm_update` SSE event whenever a BPM estimate changes by more than 2 BPM.
5. Returns the `cleanText` (always `""` for pure metacode captions).

```
Server-side MusicManager                Client-side useMusicDetector
  ↓ label_change event                    ↓ label_change callback
  ↓                                       ↓
  Inject into session._sendQueue          captionContext.send('<!-- sound:music --> <!-- bpm:128 -->')
  '<!-- sound:music --> <!-- bpm:128 -->'
  ↓                                       ↓
  captions route → SoundCaptionProcessor  (same SoundCaptionProcessor via server)
  ↓                                       ↓
  cleanText = ""   →  nothing to YouTube  SSE: sound_label, bpm_update → frontend
  SSE: sound_label, bpm_update → frontend
```

### SSE events on `GET /events` (new event types)

| Event | Payload |
|---|---|
| `sound_label` | `{ label: 'music'\|'speech'\|'silence', previous, confidence, ts }` |
| `bpm_update` | `{ bpm: number, confidence, ts }` |

The frontend subscribes to these events on the existing `GET /events` session stream — no separate SSE connection needed.

---

## Architecture Overview

There are **two independent analysis paths** that share the same feature-extraction logic and emit the same metacodes:

| Path | Audio source | Where it runs | When to use |
|---|---|---|---|
| **Server-side** | HLS segments (MediaMTX fMP4) | `lcyt-music` Node.js plugin | Headless / hardware streams; no browser required |
| **Client-side** | Browser microphone | `lcyt-web` (Web Audio API) | Operator is already using the browser mic for STT |

Both paths classify audio into `music / speech / silence` and estimate BPM.  They can run simultaneously but independently.

### Server-side path

```
MediaMTX (fMP4 HLS output)
  /{streamKey}/index.m3u8   ←── HlsSegmentFetcher (already in lcyt-rtmp)
  /{streamKey}/init.mp4          │
  /{streamKey}/seg*.mp4          │  Buffer (AAC in MP4 container)
                                 ▼
                        ffmpeg  (PCM extractor)
                        -i pipe:0  -f s16le -ac 1 -ar 22050  pipe:1
                                 │
                                 ▼
                        MusicAnalyser
                        ├─ SpectralDetector   → music / speech / silence label
                        └─ BpmDetector        → beats-per-minute estimate
                                 │
                        { label, bpm, confidence, timestamp }
                                 │
                                 ▼
                        MusicManager (EventEmitter)
                          injects: '<!-- sound:music --> <!-- bpm:128 -->'
                          into session._sendQueue
                                 │
                                 ▼
                        SoundCaptionProcessor (in captions route)
                        ├─ strip metacodes → cleanText = ""
                        ├─ SSE  sound_label / bpm_update  on GET /events
                        └─ DB   music_events table
```

The plugin taps the same HLS segment stream as `SttManager` (via the shared `HlsSegmentFetcher` in `lcyt-rtmp`) and pipelines each segment's audio through a lightweight ffmpeg decode step followed by in-process signal processing.

### Client-side path

```
Browser microphone (getUserMedia)
      │
      ▼  (already set up in AudioPanel.jsx)
Web Audio API
  AudioContext → MediaStreamSource → AnalyserNode (fftSize 2048)
                                          │
                          getFloatFrequencyData()   ← per timer tick
                          getFloatTimeDomainData()
                                          │
                                          ▼
                               useMusicDetector (hook)
                               ├─ classifyFromFrequency() → label
                               └─ detectBpmFromPcm()      → BPM
                                          │
                               { label, bpm, confidence }
                                          │
                               captionContext.send(
                                 '<!-- sound:music --> <!-- bpm:128 -->'
                               )
                                          │
                                          ▼
                               SoundCaptionProcessor (server-side, same pipeline)
                               ├─ strip metacodes → nothing to YouTube
                               └─ SSE: sound_label / bpm_update → MusicChip, MusicPanel
```

The client-side detector runs entirely in the browser.  It **reuses the existing `analyserRef` from `AudioPanel`** — no second `getUserMedia` call is needed.  When the operator is not using the browser mic, `useMusicDetector` returns `{ available: false }` and only the server path operates.

---

## Signal Processing Approach

### Music / Speech / Silence Classification

A three-class classifier runs on each PCM frame window (~3–6 s, matching the HLS segment duration).  No machine-learning model is required; the following hand-crafted features are sufficient for broadcast use:

| Feature | Computation | Rationale |
|---|---|---|
| **RMS energy** | `sqrt(mean(x²))` | Separates silence from active audio |
| **Spectral centroid** | `Σ(f · magnitude) / Σ(magnitude)` | Music has a higher, more distributed centroid than speech |
| **Spectral flatness (Wiener entropy)** | `geometric_mean(magnitude) / arithmetic_mean(magnitude)` | Tonal music has low flatness; noise and speech have high flatness |
| **Zero-crossing rate (ZCR)** | Counts sign changes per second | Speech has mid-range ZCR; music tends lower; silence near zero |
| **Low-frequency energy ratio** | Energy below 300 Hz / total energy | Bass-heavy music scores high; speech scores lower |

**Decision rules (thresholds tuned empirically):**

```
if RMS < SILENCE_THRESHOLD  → label = 'silence'
else if spectral_flatness < FLATNESS_MUSIC_THRESHOLD
     AND zcr < ZCR_MUSIC_THRESHOLD                 → label = 'music'
else                                                → label = 'speech'
```

All thresholds are configurable via environment variables and per-key DB config.  The rules produce a label per segment; a state machine smooths rapid label changes (require N consecutive segments to confirm a transition).

### BPM Detection

BPM is estimated only when `label === 'music'`.  The algorithm:

1. **Onset detection** — compute a novelty function (first-order difference of the spectral flux) from overlapping short-time frames (~20 ms hop) of the PCM buffer.
2. **Autocorrelation** — compute the autocorrelation of the onset envelope over the range 40–200 BPM (lag range 0.3 s – 1.5 s at the analysis rate).
3. **Peak picking** — find the lag with the maximum autocorrelation; convert to BPM.
4. **Octave disambiguation** — if the second peak at double the BPM is within 80 % of the primary peak, prefer the doubled value (avoids half-time errors).
5. **Smoothing** — apply an exponential moving average (`α = 0.3`) across successive segment estimates to reduce jitter.

**Accuracy target:** ±3 BPM for typical electronic / pop music at 60–180 BPM.  Complex polyrhythm or very slow tempos may be unreliable; the API exposes a `confidence` field so callers can filter.

**No native dependencies:** All arithmetic runs in plain JavaScript using `Float32Array` typed arrays.  A fast Fourier transform (FFT) is required; we include a minimal radix-2 Cooley–Tukey implementation (~100 lines) rather than pulling in a large external library.  If the operator has `aubio` or `essentia` available, the adapter interface makes it trivial to swap in their output.

---

## Plugin Structure

```
packages/plugins/lcyt-music/
├── package.json
├── src/
│   ├── api.js                    ← initMusicControl(db, store) + createMusicRouters(db, auth)
│   │                               also exports createSoundCaptionProcessor()
│   ├── music-manager.js          ← MusicManager (EventEmitter): one session per API key
│   ├── sound-caption-processor.js ← createSoundCaptionProcessor(): strips <!-- sound:... -->
│   │                               and <!-- bpm:... --> metacodes; emits SSE events
│   ├── analyser/
│   │   ├── spectral-detector.js  ← feature extraction + label classifier
│   │   ├── bpm-detector.js       ← onset → autocorrelation → BPM
│   │   └── fft.js                ← minimal radix-2 FFT (Float32Array, no deps)
│   ├── pcm-extractor.js          ← ffmpeg stdin/stdout PCM pipeline (shared helper)
│   ├── db.js                     ← DB migrations + music_config/music_events helpers
│   └── routes/
│       ├── music.js              ← POST /music/start, POST /music/stop,
│       │                            GET /music/status, GET /music/:key/live (SSE, public)
│       └── music-config.js       ← GET/PUT /music/config (per-key settings)
└── test/
    ├── spectral-detector.test.js
    ├── bpm-detector.test.js
    ├── fft.test.js
    ├── sound-caption-processor.test.js
    └── music-manager.test.js
```

---

## `SoundCaptionProcessor`

**File:** `packages/plugins/lcyt-music/src/sound-caption-processor.js`

Analogous to `createDskCaptionProcessor` in `lcyt-dsk`.  Injected into `createCaptionsRouter` alongside the DSK processor.

```js
// Regex patterns
const SOUND_RE = /<!--\s*sound\s*:\s*(music|speech|silence)\s*-->/i;
const BPM_RE   = /<!--\s*bpm\s*:\s*(\d+)\s*-->/i;

/**
 * Create the sound caption processor function.
 *
 * @param {{ store: SessionStore, db: Database }} opts
 * @returns {(apiKey: string, text: string) => string}  Returns cleanText (metacodes stripped).
 */
export function createSoundCaptionProcessor({ store, db }) {
  return function processSoundCaption(apiKey, text) {
    const soundMatch = SOUND_RE.exec(text);
    const bpmMatch   = BPM_RE.exec(text);

    const cleanText = text
      .replace(SOUND_RE, '')
      .replace(BPM_RE, '')
      .trim();

    if (soundMatch) {
      const label = soundMatch[1];        // 'music' | 'speech' | 'silence'
      const bpm   = bpmMatch ? parseInt(bpmMatch[1], 10) : null;

      // Persist to DB
      insertMusicEvent(db, apiKey, { event_type: 'label_change', label, bpm });

      // Fire SSE on the session's existing /events stream
      const session = store?.getByApiKey?.(apiKey);
      if (session?.emitter) {
        session.emitter.emit('event', {
          type: 'sound_label',
          data: { label, bpm, confidence: null, ts: Date.now() },
        });
        if (bpm != null) {
          session.emitter.emit('event', {
            type: 'bpm_update',
            data: { bpm, confidence: null, ts: Date.now() },
          });
        }
      }
    }

    return cleanText;  // always "" for pure-metacode captions
  };
}
```

**Wiring in `createCaptionsRouter`:**

```js
// Applied in series after dskProcessor (both strip metacodes from caption.text):
if (soundProcessor) {
  for (const caption of resolvedCaptions) {
    caption.text = soundProcessor(session.apiKey, caption.text || '');
  }
}
```

**Wiring in `server.js`:**

```js
import { initMusicControl, createMusicRouters, createSoundCaptionProcessor } from 'lcyt-music';

const { musicManager } = await initMusicControl(db, store);
const soundProcessor = createSoundCaptionProcessor({ store, db });

// Pass to session routers alongside dskCaptionProcessor:
app.use(createSessionRouters(db, store, jwtSecret, auth, {
  relayManager,
  dskCaptionProcessor: _dskCaptionProcessor,
  soundCaptionProcessor: soundProcessor,
  resolveStorage,
}));

if (process.env.MUSIC_DETECTION_ACTIVE === '1') {
  const musicRouters = createMusicRouters(db, auth, musicManager);
  app.use('/music', musicRouters.musicRouter);
  app.use('/music', musicRouters.musicConfigRouter);
}
```

---

## `MusicManager`

**File:** `packages/plugins/lcyt-music/src/music-manager.js`

```js
export class MusicManager extends EventEmitter {
  // Start analysis for an API key.
  // Reuses the shared HlsSegmentFetcher from lcyt-rtmp if available;
  // falls back to its own internal fetcher instance.
  async start(apiKey, { streamKey } = {}) {}

  async stop(apiKey) {}

  isRunning(apiKey)   // → boolean
  getStatus(apiKey)   // → { running, label, bpm, confidence, startedAt, segmentsAnalysed, lastEventAt }
  async stopAll()

  // Internal events (consumed by the manager itself to inject metacodes):
  // 'label_change'  ({ apiKey, label, previous, confidence, bpm, timestamp })
  // 'bpm_update'    ({ apiKey, bpm, confidence, timestamp })
  // 'error'         ({ apiKey, error })
  // 'stopped'       ({ apiKey })
}
```

### Metacode injection

On every confirmed `label_change`, `MusicManager` injects a caption containing only metacodes into `session._sendQueue`:

```js
// In MusicManager._onLabelChange(apiKey, { label, bpm, confidence }):
const session = this.#store?.getByApiKey?.(apiKey);
if (!session) return;

// Build metacode string — never reaches YouTube (stripped by SoundCaptionProcessor)
let metacode = `<!-- sound:${label} -->`;
if (label === 'music' && bpm != null) {
  metacode += ` <!-- bpm:${Math.round(bpm)} -->`;
}

session._sendQueue = session._sendQueue.then(async () => {
  const seq = ++session.sequence;
  // Pass through captions pipeline; SoundCaptionProcessor strips codes & fires SSE.
  // Resolved cleanText will be "" → no YouTube delivery.
  await fanOutToTargets(session, seq, metacode, new Date().toISOString(), {});
});
```

### State machine

```
  IDLE ──start()──► RUNNING
    RUNNING ──stop() or error──► IDLE
    RUNNING ── consecutive segments ──► label stabilises ──► inject metacode into _sendQueue
```

A label change is confirmed only after `LABEL_CONFIRM_SEGMENTS` (default: 2) consecutive segments agree.  This prevents false transitions from a single anomalous segment.

---

## `SpectralDetector`

**File:** `packages/plugins/lcyt-music/src/analyser/spectral-detector.js`

```js
/**
 * @param {Float32Array} pcm  — mono s16le samples at SAMPLE_RATE Hz
 * @returns {{ label: 'music'|'speech'|'silence', confidence: number, features: object }}
 */
export function classify(pcm, opts = {}) {}
```

All feature computations use typed-array arithmetic (no FFT required for ZCR and RMS; FFT is used for spectral features).

---

## `BpmDetector`

**File:** `packages/plugins/lcyt-music/src/analyser/bpm-detector.js`

```js
/**
 * @param {Float32Array} pcm  — mono s16le samples
 * @returns {{ bpm: number, confidence: number } | null}
 *   Returns null when the signal is too short or confidence is too low.
 */
export function detectBpm(pcm, opts = {}) {}
```

---

## `PcmExtractor`

**File:** `packages/plugins/lcyt-music/src/pcm-extractor.js`

Thin wrapper around `ffmpeg` stdio pipes.  Accepts an fMP4 `Buffer` (the HLS segment), spawns ffmpeg, returns a `Float32Array` of normalised float samples (`[-1, 1]`) at the configured sample rate (default 22 050 Hz, mono).

```js
/**
 * @param {Buffer} mp4Buffer
 * @param {{ sampleRate: number, channels: number }} [opts]
 * @returns {Promise<Float32Array>}
 */
export async function extractPcm(mp4Buffer, opts = {}) {}
```

This is a standalone helper (not an EventEmitter).  It spawns ffmpeg, writes the buffer to stdin, reads stdout, and resolves with the typed array.  Errors (non-zero exit, empty output) are thrown so `MusicManager` can handle them gracefully.

---

## Database

**File:** `packages/plugins/lcyt-music/src/db.js`

```sql
-- Per-key analysis configuration
CREATE TABLE IF NOT EXISTS music_config (
  api_key               TEXT PRIMARY KEY,
  enabled               INTEGER NOT NULL DEFAULT 0,
  stream_key            TEXT,                -- NULL → use api_key as the MediaMTX path
  silence_threshold     REAL    NOT NULL DEFAULT 0.01,
  flatness_threshold    REAL    NOT NULL DEFAULT 0.4,
  zcr_threshold         REAL    NOT NULL DEFAULT 0.15,
  confirm_segments      INTEGER NOT NULL DEFAULT 2,
  bpm_enabled           INTEGER NOT NULL DEFAULT 1,
  bpm_min               INTEGER NOT NULL DEFAULT 40,
  bpm_max               INTEGER NOT NULL DEFAULT 200,
  auto_start            INTEGER NOT NULL DEFAULT 0,
  updated_at            INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

-- Event log (label transitions + BPM snapshots)
-- Populated by SoundCaptionProcessor when it processes <!-- sound:... --> metacodes.
CREATE TABLE IF NOT EXISTS music_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  api_key    TEXT    NOT NULL,
  event_type TEXT    NOT NULL,  -- 'label_change' | 'bpm_update'
  label      TEXT,              -- 'music' | 'speech' | 'silence'
  bpm        REAL,
  confidence REAL,
  ts         INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);
CREATE INDEX IF NOT EXISTS music_events_key_ts ON music_events(api_key, ts);
```

DB helpers:
```js
export function getMusicConfig(db, apiKey) {}
export function setMusicConfig(db, apiKey, patch) {}
export function insertMusicEvent(db, apiKey, event) {}
export function getRecentMusicEvents(db, apiKey, limit = 20) {}
```

---

## API Routes

### Session-level routes (require Bearer token)

```
POST /music/start         — start music detection for the session's API key
                            body: { streamKey? }
POST /music/stop          — stop music detection

GET  /music/status        — current detection state
                            → { running, label, bpm, confidence, startedAt, segmentsAnalysed }

GET  /music/config        — get per-key config
PUT  /music/config        — update per-key config
```

### Public per-key route (no auth, CORS `*`)

```
GET  /music/:key/live     — lightweight SSE stream for display widgets
                            (no auth; mirrors GET /viewer/:key pattern)
```

---

### SSE events on `GET /events` (the session SSE stream — new event types)

Music detection fires onto the **existing session `/events` SSE stream** via `SoundCaptionProcessor`, so the frontend only needs one SSE connection.

| Event | Payload |
|---|---|
| `sound_label` | `{ label: 'music'\|'speech'\|'silence', previous, confidence, ts }` |
| `bpm_update` | `{ bpm: number, confidence, ts }` |
| `music_started` | `{ streamKey }` — emitted on `POST /music/start` |
| `music_stopped` | `{}` — emitted on `POST /music/stop` |

### SSE events on `GET /music/:key/live` (public stream)

Same `sound_label` and `bpm_update` payloads; sourced from `SoundCaptionProcessor` via the `music_events` DB table.  Useful for display widgets (BPM counter in an overlay) that do not hold a session token.

---

## Auto-start on Publish

Extends the `on_publish` RTMP callback in `lcyt-rtmp` (same hook used by `SttManager`):

```js
const cfg = getMusicConfig(db, apiKey);
if (cfg?.auto_start && cfg?.enabled) {
  await musicManager.start(apiKey, cfg);
}
```

`on_publish_done` calls `musicManager.stop(apiKey)`.

---

## Integration with `lcyt-backend`

**`packages/lcyt-backend/src/server.js`:**

```js
import { initMusicControl, createMusicRouters } from 'lcyt-music';

const { musicManager } = await initMusicControl(db, store);
const musicRouters = createMusicRouters(db, auth, musicManager);
app.use('/music', musicRouters.musicRouter);
app.use('/music', musicRouters.musicConfigRouter);

// Graceful shutdown:
await musicManager.stopAll();
```

Pass `musicManager` to `initRtmpControl` so the `on_publish` / `on_publish_done`
hooks can call it (same pattern as `sttManager` auto-start):

```js
const rtmp = await initRtmpControl(db, store, { musicManager });
```

---

## Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `MUSIC_DETECTION_ACTIVE` | `0` | Set to `1` to enable the plugin routes and auto-start hooks |
| `MUSIC_SAMPLE_RATE` | `22050` | PCM sample rate for analysis (Hz) |
| `MUSIC_SILENCE_THRESHOLD` | `0.01` | RMS energy floor below which audio is silence |
| `MUSIC_FLATNESS_THRESHOLD` | `0.4` | Spectral flatness boundary — below = tonal/music, above = noisy/speech |
| `MUSIC_ZCR_THRESHOLD` | `0.15` | Zero-crossing rate boundary |
| `MUSIC_CONFIRM_SEGMENTS` | `2` | Consecutive segments required to confirm a label transition |
| `MUSIC_BPM_MIN` | `40` | Minimum BPM to consider |
| `MUSIC_BPM_MAX` | `200` | Maximum BPM to consider |
| `MUSIC_BPM_SMOOTHING` | `0.3` | EMA smoothing coefficient for BPM estimates |

All thresholds can be overridden per API key via `PUT /music/config`.

---

## Client-Side Browser Mic Detection (`lcyt-web`)

The browser path runs the same spectral and BPM algorithms as the server but uses the **Web Audio API** instead of ffmpeg for audio decoding and the built-in `AnalyserNode` FFT instead of the custom radix-2 implementation.

### Why the Web Audio API is a natural fit

`AudioPanel.jsx` already creates an `AnalyserNode` (`analyserRef`) the moment the operator opens the microphone for STT — it currently drives `AudioLevelMeter`.  Music detection can **attach to this same node** at no cost: no second `getUserMedia` call, no extra `AudioContext`, no extra permissions prompt.

```
AudioPanel
  MediaStreamSource → AnalyserNode (fftSize 2048)
                            │
                   ┌────────┴───────────┐
                   ▼                   ▼
           AudioLevelMeter        useMusicDetector  ← NEW
           (existing)             (new hook)
```

When the operator is **not** using the browser mic (server-STT mode or session not started), the client-side path is unavailable.  In that case `useMusicDetector` returns `{ available: false }` and the MusicChip falls back to showing the server-side status polled from `GET /music/status`.

### `useMusicDetector` hook

**File:** `packages/lcyt-web/src/hooks/useMusicDetector.js`

```js
/**
 * useMusicDetector
 *
 * Attaches to the AnalyserNode provided by AudioPanel (via analyserRef) and
 * runs spectral + BPM analysis on each analysis frame.
 *
 * @param {object} opts
 * @param {React.RefObject<AnalyserNode|null>} opts.analyserRef - ref from AudioPanel
 * @param {boolean}  [opts.enabled=false]          - master on/off switch
 * @param {boolean}  [opts.bpmEnabled=true]        - whether BPM estimation runs
 * @param {number}   [opts.intervalMs=500]         - analysis interval in ms
 * @param {number}   [opts.confirmFrames=4]        - frames before label transition fires
 * @param {number}   [opts.confidenceThreshold=0.5]
 * @param {function} [opts.onLabelChange]          - ({ label, previous, confidence, bpm })
 * @param {function} [opts.onBpmUpdate]            - ({ bpm, confidence })
 * @returns {{ label, bpm, confidence, available, running }}
 */
export function useMusicDetector({ analyserRef, enabled, bpmEnabled, intervalMs,
                                   confirmFrames, confidenceThreshold,
                                   onLabelChange, onBpmUpdate }) {}
```

**Behaviour:**

1. On mount (and when `enabled` changes to `true`), the hook starts a `setInterval` at `intervalMs` (default 500 ms).
2. Each tick reads frequency-domain and time-domain data from the analyser:
   ```js
   const freqData = new Float32Array(analyser.frequencyBinCount);
   analyser.getFloatFrequencyData(freqData);  // dB values per FFT bin

   const timeData = new Float32Array(analyser.fftSize);
   analyser.getFloatTimeDomainData(timeData); // normalised PCM [-1, 1]
   ```
3. Passes `freqData` to `classifyFromFrequency(freqData, sampleRate)` — a thin wrapper around the shared feature-extraction logic adapted to the Web Audio API's decibel frequency bins.
4. Passes `timeData` to `detectBpmFromPcm(timeData, sampleRate)` when `bpmEnabled`.
5. Applies the same `confirmFrames` state machine as the server path.
6. Fires `onLabelChange` and `onBpmUpdate` callbacks.
7. Returns the current `{ label, bpm, confidence, available, running }` for the UI.

**`available`** is `true` when `analyserRef.current` is non-null (mic is open). The hook never requests mic access itself.

### Shared analysis logic in `lcyt-web`

**File:** `packages/lcyt-web/src/lib/musicAnalysis.js`

Pure functions — no DOM or Node.js dependencies — so they can also be unit-tested with Vitest:

```js
/**
 * Classify frequency-domain data from Web Audio API AnalyserNode.
 * freqData: Float32Array of dB values (output of getFloatFrequencyData).
 * sampleRate: AudioContext.sampleRate (typically 44100 or 48000 Hz).
 */
export function classifyFromFrequency(freqData, sampleRate, opts = {})
  // → { label: 'music'|'speech'|'silence', confidence, features }

/**
 * Estimate BPM from a time-domain PCM buffer (getFloatTimeDomainData output).
 * pcm: Float32Array, normalised [-1, 1].
 * sampleRate: AudioContext.sampleRate.
 */
export function detectBpmFromPcm(pcm, sampleRate, opts = {})
  // → { bpm, confidence } | null
```

These are browser-side equivalents of the server-side `spectral-detector.js` and `bpm-detector.js`.  The algorithms are the same; the difference is that the Web Audio API delivers pre-computed frequency data (no FFT required in `classifyFromFrequency`), while `detectBpmFromPcm` runs the same onset-autocorrelation pipeline as the server.

### `localStorage` keys

New entries added to `KEYS.audio` in `storageKeys.js`:

| Key | Purpose | Default |
|---|---|---|
| `lcyt.audio.musicDetect` | Client-side music detection enabled | `'0'` |
| `lcyt.audio.musicDetectBpm` | BPM sub-feature enabled | `'1'` |
| `lcyt.audio.musicDetectThreshold` | Confidence threshold | `'0.5'` |
| `lcyt.audio.musicDetectInterval` | Analysis interval (ms) | `'500'` |

### `MusicPanel` component

**File:** `packages/lcyt-web/src/components/panels/MusicPanel.jsx`

Follows the same structure as `VadPanel` — receives props, renders settings fields:

```jsx
export function MusicPanel({
  source,               // 'client' | 'server' | 'both' — which path is active
  label,                // 'music' | 'speech' | 'silence' | null
  bpm,                  // number | null
  confidence,           // number | null
  available,            // boolean — mic is open (client path available)
  running,              // boolean
  enabled, onEnabledChange,
  bpmEnabled, onBpmEnabledChange,
  confidenceThreshold, onConfidenceThresholdChange,
  intervalMs, onIntervalMsChange,
  onStart, onStop,
}) {}
```

Settings rendered:

| Setting | Control | Notes |
|---|---|---|
| Detection source | radio: mic / server / both | `'mic'` requires mic to be open; greys out when `!available` |
| Enable music detection | toggle | |
| BPM detection | toggle | |
| Analysis interval | slider 200–2000 ms | client path only; server path uses HLS segment duration |
| Confidence threshold | slider 0–1 | |
| Current status | read-only label | `♪ 128 BPM` / `Speech` / `Silence` / `—` |
| Start / Stop | button | starts/stops whichever source(s) are configured |

### `MusicChip` in `StatusBar`

**File:** `packages/lcyt-web/src/components/MusicChip.jsx`

```
[ STT: google / en-US ]  [ ♪ 128 BPM ]
                               ↑
                    MusicChip — green when music,
                                grey/dash when speech/silence/inactive
```

- Listens to `sound_label` and `bpm_update` SSE events on the session `/events` stream.
- One chip handles both paths: shows `♪ <bpm> BPM` for music, a muted waveform icon for speech, a dash for silence.
- Clicking opens/scrolls to the `MusicPanel` in the Audio settings section.

### Metacode emission (client path)

When `useMusicDetector` confirms a label change, it calls `captionContext.send` with a metacode-only string:

```js
// In useMusicDetector, on confirmed label_change:
let metacode = `<!-- sound:${label} -->`;
if (label === 'music' && bpm != null) {
  metacode += ` <!-- bpm:${Math.round(bpm)} -->`;
}
captionContext.send(metacode);
```

The metacode is routed through the server's `SoundCaptionProcessor`, which strips it (cleanText = `""`) and fires `sound_label` / `bpm_update` SSE events.  Nothing reaches YouTube.  The frontend's `MusicChip` and `MusicPanel` update via the SSE events, giving a consistent single source of truth regardless of which analysis path produced the detection.

### `useMusic` hook (unified)

**File:** `packages/lcyt-web/src/hooks/useMusic.js`

A thin aggregator that merges client and server state into a single object for the `MusicPanel` and `MusicChip`.  Both paths produce `sound_label` / `bpm_update` SSE events on the same `/events` stream, so `useMusic` only needs to subscribe to those events once:

```js
export function useMusic({ analyserRef, sessionActive }) {
  // Client path — local analysis loop:
  const client = useMusicDetector({ analyserRef, enabled: clientEnabled, ... });

  // SSE listener for both paths (sound_label / bpm_update from GET /events):
  const [soundState, setSoundState] = useState({ label: null, bpm: null });
  useEffect(() => {
    // Subscribe to session SSE events of type 'sound_label' and 'bpm_update'
    // (uses the existing sessionContext.addEventListener or EventSource pattern)
  }, [sessionActive]);

  return {
    label:           soundState.label,
    bpm:             soundState.bpm,
    clientAvailable: client.available,
    clientRunning:   client.running,
  };
}
```

---

## UI Integration (lcyt-web) — Summary

A small `MusicChip` component appears in the `StatusBar` (alongside the existing STT chip):

```
[ STT: google / en-US ]  [ ♪ 128 BPM ]
```

- Shows the current `label` as an icon (`♪` for music, speech waveform for speech, dash for silence / not running).
- Shows BPM when `label === 'music'`.
- Listens to `sound_label` and `bpm_update` SSE events on the session `/events` stream (no separate polling needed).
- Clicking opens a collapsible **Music Detection** section in the Audio settings area.

### Settings panel additions

A new `MusicPanel` component (alongside `SttPanel`, `VadPanel`) with settings for both paths:

| Setting | Type | Default | Path |
|---|---|---|---|
| Detection source | radio: mic / server / both | mic (when available) | — |
| Enable music detection | toggle | off | both |
| BPM detection | toggle | on | both |
| Analysis interval | slider 200–2000 ms | 500 ms | client only |
| Confidence threshold | slider 0–1 | 0.5 | both |
| Auto-start on publish | toggle | off | server only |
| Start / Stop | button | — | both |

---

## Phases

### Phase 1 — Full frontend sound detection and UI (browser mic only)

**Goal:** Operators can see music/speech/silence detection and BPM in the UI using the browser microphone, without any server-side analysis.  The metacode pipeline (`SoundCaptionProcessor`) is also established in this phase so that Phase 2 (server-side HLS) can plug straight in.

**Backend (metacode processor only):**
- `sound-caption-processor.js` — `createSoundCaptionProcessor()`: strips `<!-- sound:... -->` and `<!-- bpm:... -->` metacodes, fires `sound_label` / `bpm_update` SSE events on `GET /events`, writes to `music_events` DB.
- Minimal `db.js` — `music_events` table only (no `music_config` needed until Phase 2).
- `packages/lcyt-backend/src/routes/session.js` — accept and apply `soundCaptionProcessor` in `createSessionRouters` / `createCaptionsRouter`.
- `packages/lcyt-backend/src/server.js` — wire `soundCaptionProcessor`.

**UI (lcyt-web) — shared analysis:**
- `src/lib/musicAnalysis.js` — pure JS `classifyFromFrequency()` (Web Audio API frequency bins) + `detectBpmFromPcm()` (onset-autocorrelation).

**UI (lcyt-web) — hooks:**
- `src/hooks/useMusicDetector.js` — attaches to `analyserRef`; runs analysis loop at configurable interval; on confirmed label change emits `<!-- sound:${label} -->` (and `<!-- bpm:N -->` for music) via `captionContext.send`.
- `src/hooks/useMusic.js` — subscribes to `sound_label` / `bpm_update` SSE events on the session stream; returns unified `{ label, bpm, clientAvailable, clientRunning }`.

**UI (lcyt-web) — components:**
- `src/components/MusicChip.jsx` — StatusBar chip: `♪ 128 BPM` / speech waveform / dash.
- `src/components/panels/MusicPanel.jsx` — settings panel: source selector, enable toggle, BPM toggle, confidence threshold, analysis interval, start/stop.
- `src/lib/storageKeys.js` — add `KEYS.audio.musicDetect*` keys.
- `src/locales/en.js` — i18n strings (`settings.music.*`).
- `packages/lcyt-web/src/components/AudioPanel.jsx` — increase `analyserRef` fftSize from 256 → 2048.

**Backend tests:**
- `test/sound-caption-processor.test.js` — metacode parsing, SSE event emission, cleanText = `""`.

**Frontend tests (Vitest):**
- `test/components/musicAnalysis.test.js` — `classifyFromFrequency` + `detectBpmFromPcm` unit tests.
- `test/components/useMusicDetector.test.jsx` — hook lifecycle, metacode emission on label change.

---

### Phase 2 — Server-side HLS detection

**Goal:** Add server-side analysis of HLS audio segments so music detection works for headless streams where no browser mic is available.

**Backend:**
- `fft.js` — radix-2 Cooley–Tukey FFT.
- `spectral-detector.js` — RMS, spectral centroid, spectral flatness, ZCR, low-freq ratio, `classify()`.
- `bpm-detector.js` — onset novelty function, autocorrelation, peak picking, octave disambiguation, smoothing.
- `pcm-extractor.js` — ffmpeg `s16le` pipe, `Float32Array` output.
- `music-manager.js` — wires `HlsSegmentFetcher` → `PcmExtractor` → `SpectralDetector` + `BpmDetector` → injects `<!-- sound:... --> <!-- bpm:N -->` metacodes into `session._sendQueue`.
- `music_config` DB table + `getMusicConfig` / `setMusicConfig` helpers.
- `api.js` — `initMusicControl()` + `createMusicRouters()` + exports `createSoundCaptionProcessor`.
- Routes: `POST /music/start`, `POST /music/stop`, `GET /music/status`, `GET /music/:key/live` (SSE, public), `GET/PUT /music/config`.
- `on_publish` / `on_publish_done` auto-start hooks in `lcyt-rtmp`.
- `server.js` — mount `/music` routes when `MUSIC_DETECTION_ACTIVE=1`.

**UI (lcyt-web):**
- Add `'server'` option to MusicPanel source selector (was mic-only in Phase 1).

**Backend tests:**
- `test/fft.test.js` — correctness against known transform values.
- `test/spectral-detector.test.js` — classify synthetic tonal, noisy, and silent PCM buffers.
- `test/bpm-detector.test.js` — detect BPM from synthetic click-track buffers at 60, 120, 140 BPM.
- `test/music-manager.test.js` — start/stop lifecycle, metacode injection into `_sendQueue`, error handling.

---

### Phase 3 — RTMP audio-source fallback

**Goal:** Support deployments without MediaMTX by adding a direct RTMP audio source.

**Backend:**
- `'rtmp'` audio source option in `MusicManager` (ffmpeg PCM pipe, same approach as `SttManager` rtmp path).
- `GET /music/:key/live` full implementation consuming `music_events` DB table.

---

### Phase 4 — Tuning, export, and advanced classifiers

**Goal:** Improve accuracy and add event history export.

**Backend:**
- `GET /music/events/history` — paginated list from `music_events` table.
- Threshold auto-calibration: a short training window at stream start that adapts to the ambient noise floor.
- Optional `MUSIC_CLASSIFIER_URL` HTTP hook for external classifiers (e.g., a TensorFlow.js model or a Python sidecar).

**UI (lcyt-web):**
- Simple event timeline in the `MusicPanel` showing the last N label changes with timestamps and BPM values.
- Client-side auto-calibration: the hook samples the first 5 s of mic audio to set a personalised silence threshold.

---

## Open Questions

1. **Shared `HlsSegmentFetcher`** (Phase 2): `SttManager` already owns one fetcher per key.  When both STT and music detection run concurrently, they would each poll the playlist independently.  Options: (a) expose the fetcher from `SttManager` and let `MusicManager` subscribe to the same segment events, or (b) accept the duplicate poll (low overhead — one extra HTTP request per segment per key).  Decision deferred to Phase 2 implementation.

2. **ffmpeg availability** (Phase 2): `PcmExtractor` requires ffmpeg.  If `FFMPEG_RUNNER=worker`, the local ffmpeg binary may not be present.  `MusicManager.start()` should probe for ffmpeg (reuse `probeFfmpegVersion()` from `lcyt-rtmp/src/stt-manager.js`) and emit a clear error if unavailable.

3. **HLS segment duration** (Phase 2): Shorter segments (3 s) improve reaction time but give less audio context for BPM estimation.  The recommended MediaMTX setting is `hlsSegmentDuration: 6s` (same as for STT), which gives a comfortable 3–4 beat window at most tempos.

4. **Classification accuracy** (Phase 4): The hand-crafted threshold classifier works well for clear music vs. clear speech but may misclassify music with vocal lines or rhythmic speech.  If accuracy is insufficient, a lightweight TensorFlow.js model (e.g., a port of YAMNet's top-level classifier) could be embedded in Phase 4 without native dependencies.

5. **Client-side `fftSize`**: `AudioPanel` currently creates the `AnalyserNode` with `fftSize = 256` (sufficient for the level meter).  Music classification needs more frequency resolution — `fftSize = 2048` is recommended.  `AudioPanel` must be updated to increase the fftSize (or create a second analyser node chained to the same source) so the level meter continues to work unchanged.

---

## Summary

| Aspect | Decision |
|---|---|
| Plugin name | `lcyt-music` |
| Communication mechanism | `<!-- sound:music\|speech\|silence -->` + `<!-- bpm:N -->` metacodes in caption pipeline |
| Signal stripping | `SoundCaptionProcessor` removes metacodes before YouTube delivery (cleanText = `""`) |
| SSE delivery | `sound_label` + `bpm_update` events on existing `GET /events` session stream |
| Phase 1 | Browser mic analysis + full UI (no server-side analysis) |
| Phase 2 | Server-side HLS analysis |
| Phase 3 | RTMP fallback |
| Phase 4 | Tuning, event history export, external classifier hook |
| Classification | Spectral features + threshold rules; no ML required in Phases 1–3 |
| BPM method | Autocorrelation of onset novelty function (both paths) |
| Native deps (server) | None — plain JavaScript + ffmpeg (already required by `lcyt-rtmp`) |
| Browser deps | Web Audio API only — built into all modern browsers |
| DB | `music_events` (Phase 1); `music_config` (Phase 2) |
| localStorage keys | `lcyt.audio.musicDetect*` (client path config) |
| Breaking changes | None — server plugin opt-in via `MUSIC_DETECTION_ACTIVE=1`; client hook only activates when `enabled=true` |

---

## Todo

### Phase 1 — Frontend sound detection and UI

**Backend (processor only)**
- [ ] `packages/plugins/lcyt-music/src/sound-caption-processor.js` — createSoundCaptionProcessor()
- [ ] `packages/plugins/lcyt-music/src/db.js` — `music_events` table migration + helpers
- [ ] `packages/plugins/lcyt-music/src/api.js` — exports createSoundCaptionProcessor + db init
- [ ] `packages/lcyt-backend/src/routes/session.js` — accept and apply `soundCaptionProcessor`
- [ ] `packages/lcyt-backend/src/server.js` — wire soundCaptionProcessor

**Backend tests**
- [ ] `packages/plugins/lcyt-music/test/sound-caption-processor.test.js`

**UI (lcyt-web) — shared analysis**
- [ ] `src/lib/musicAnalysis.js` — `classifyFromFrequency()` + `detectBpmFromPcm()`

**UI (lcyt-web) — hooks**
- [ ] `src/hooks/useMusicDetector.js` — analysis loop; emits `<!-- sound:... -->` metacodes via captionContext.send
- [ ] `src/hooks/useMusic.js` — SSE listener; unified state

**UI (lcyt-web) — components**
- [ ] `src/components/MusicChip.jsx` — StatusBar chip
- [ ] `src/components/panels/MusicPanel.jsx` — settings panel (mic path)
- [ ] `src/lib/storageKeys.js` — add `KEYS.audio.musicDetect*` keys
- [ ] `src/locales/en.js` — i18n strings (`settings.music.*`)
- [ ] `src/components/AudioPanel.jsx` — increase `analyserRef` fftSize to 2048

**Frontend tests (Vitest)**
- [ ] `test/components/musicAnalysis.test.js`
- [ ] `test/components/useMusicDetector.test.jsx`

---

### Phase 2 — Server-side HLS detection

**Backend**
- [ ] `packages/plugins/lcyt-music/package.json` — plugin manifest
- [ ] `packages/plugins/lcyt-music/src/analyser/fft.js`
- [ ] `packages/plugins/lcyt-music/src/analyser/spectral-detector.js`
- [ ] `packages/plugins/lcyt-music/src/analyser/bpm-detector.js`
- [ ] `packages/plugins/lcyt-music/src/pcm-extractor.js`
- [ ] `packages/plugins/lcyt-music/src/music-manager.js`
- [ ] `packages/plugins/lcyt-music/src/db.js` — add `music_config` table
- [ ] `packages/plugins/lcyt-music/src/routes/music.js` — start/stop/status/live routes
- [ ] `packages/plugins/lcyt-music/src/routes/music-config.js` — GET/PUT /music/config
- [ ] `packages/plugins/lcyt-music/src/api.js` — initMusicControl() + createMusicRouters()
- [ ] `packages/lcyt-backend/src/server.js` — mount /music routes when MUSIC_DETECTION_ACTIVE=1
- [ ] `packages/plugins/lcyt-rtmp` — on_publish auto-start hook

**Backend tests**
- [ ] `packages/plugins/lcyt-music/test/fft.test.js`
- [ ] `packages/plugins/lcyt-music/test/spectral-detector.test.js`
- [ ] `packages/plugins/lcyt-music/test/bpm-detector.test.js`
- [ ] `packages/plugins/lcyt-music/test/music-manager.test.js`

**UI (lcyt-web)**
- [ ] MusicPanel — add `'server'` option to source selector

---

### Phase 3 — RTMP audio-source fallback

**Backend**
- [ ] `'rtmp'` audio source in MusicManager (ffmpeg PCM pipe)
- [ ] `GET /music/:key/live` full implementation from `music_events` DB

---

### Phase 4 — Tuning and export

**Backend**
- [ ] `GET /music/events/history` — paginated event log
- [ ] Ambient noise floor auto-calibration window
- [ ] Optional `MUSIC_CLASSIFIER_URL` HTTP hook for external classifiers

**UI (lcyt-web)**
- [ ] Event timeline in MusicPanel
- [ ] Client-side auto-calibration (5 s silence sampling on mic open)
