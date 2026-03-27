---
id: plan/music
title: "Music Detection Plugin (`lcyt-music`)"
status: draft
summary: "Separate plugin for detecting when music is playing and estimating BPM. Two analysis paths: server-side (HLS segments via lcyt-music plugin) and client-side (browser mic via Web Audio API in lcyt-web). No song identification. Events feed into the caption pipeline and are exposed via SSE."
---

# Music Detection Plugin (`lcyt-music`)

**Status:** Draft  
**Scope:** New plugin `packages/plugins/lcyt-music`; new `/music` routes in `packages/lcyt-backend`; client-side detection in `packages/lcyt-web` using the browser microphone via Web Audio API.

---

## Motivation

Live-caption operators often want to know whether the audio currently coming from the microphone or flowing through the RTMP stream is speech, silence, or music.  Key use cases:

- **Mute captions during music** — avoid STT garbage when a song or background track plays.
- **Insert a music annotation** — send a caption like `♪ Music ♪` when music is detected, so the transcript record is complete.
- **Production cue light** — surface a visual indicator in the control UI so operators know a musical segment is in progress.
- **BPM display** — useful for broadcast producers timing cuts or graphics transitions to the beat.

What is explicitly **out of scope**:

- Song title / artist identification (no Shazam-style fingerprinting).
- Copyright detection or content matching.
- Lyrics recognition (use the STT pipeline for that).

---

## Architecture Overview

There are **two independent analysis paths** that share the same feature-extraction logic and produce the same events:

| Path | Audio source | Where it runs | When to use |
|---|---|---|---|
| **Server-side** | HLS segments (MediaMTX fMP4) | `lcyt-music` Node.js plugin | Headless / hardware streams; no browser required |
| **Client-side** | Browser microphone | `lcyt-web` (Web Audio API) | Operator is already using the browser mic for STT |

Both paths classify audio into `music / speech / silence` and estimate BPM.  They can run simultaneously but independently — a client that switches from browser STT to server STT can continue to receive music detection events from either source without reconfiguring.

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
                        ├─ SSE  GET /music/:key/events
                        ├─ optional caption injection  POST /captions
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
                          getFloatFrequencyData()   ← per animation frame or timer
                          getFloatTimeDomainData()
                                          │
                                          ▼
                               useMusicDetector (hook)
                               ├─ SpectralDetector (JS port)  → label
                               └─ BpmDetector     (JS port)   → BPM
                                          │
                               { label, bpm, confidence }
                                          │
                               ┌──────────┴────────────────┐
                               ▼                           ▼
                       MusicChip (StatusBar)      caption injection
                       MusicPanel (settings)      (optional "♪" caption)
```

The client-side detector runs entirely in the browser.  It **reuses the existing `analyserRef` from `AudioPanel`** — no second `getUserMedia` call is needed.  When the operator is in server-STT mode (no mic open), the client-side detector is unavailable and the server-side path is used instead.

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
│   ├── api.js                  ← initMusicControl(db, store) + createMusicRouters(db, auth)
│   ├── music-manager.js        ← MusicManager (EventEmitter): one session per API key
│   ├── analyser/
│   │   ├── spectral-detector.js  ← feature extraction + label classifier
│   │   ├── bpm-detector.js       ← onset → autocorrelation → BPM
│   │   └── fft.js                ← minimal radix-2 FFT (Float32Array, no deps)
│   ├── pcm-extractor.js        ← ffmpeg stdin/stdout PCM pipeline (shared helper)
│   ├── db.js                   ← DB migrations + music_config/music_events helpers
│   └── routes/
│       ├── music.js            ← GET /music/:key/status, GET /music/:key/events (SSE),
│       │                          POST /music/:key/start, POST /music/:key/stop
│       └── music-config.js     ← GET/PUT /music/config (per-key settings)
└── test/
    ├── spectral-detector.test.js
    ├── bpm-detector.test.js
    ├── fft.test.js
    └── music-manager.test.js
```

---

## `MusicManager`

**File:** `packages/plugins/lcyt-music/src/music-manager.js`

```js
export class MusicManager extends EventEmitter {
  // Start analysis for an API key.
  // Reuses the shared HlsSegmentFetcher from lcyt-rtmp if available;
  // falls back to its own internal fetcher instance.
  async start(apiKey, { streamKey, provider, language } = {}) {}

  async stop(apiKey) {}

  isRunning(apiKey)   // → boolean
  getStatus(apiKey)   // → { running, label, bpm, confidence, startedAt, segmentsAnalysed, lastEventAt }
  async stopAll()

  // Events:
  // 'label_change'  ({ apiKey, label, previous, confidence, timestamp })
  // 'bpm_update'    ({ apiKey, bpm, confidence, timestamp })
  // 'error'         ({ apiKey, error })
  // 'stopped'       ({ apiKey })
}
```

### State machine

```
  IDLE ──start()──► RUNNING
    RUNNING ──stop() or error──► IDLE
    RUNNING ── consecutive segments ──► label stabilises ──► emit label_change
```

A label change is emitted only after `LABEL_CONFIRM_SEGMENTS` (default: 2) consecutive segments agree.  This prevents false transitions from a single anomalous segment.

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
  inject_caption        INTEGER NOT NULL DEFAULT 0,  -- 1 = send "♪ Music ♪" captions
  caption_text_music    TEXT    NOT NULL DEFAULT '♪',
  caption_text_speech   TEXT    NOT NULL DEFAULT '',  -- empty = no caption on speech
  bpm_enabled           INTEGER NOT NULL DEFAULT 1,
  bpm_min               INTEGER NOT NULL DEFAULT 40,
  bpm_max               INTEGER NOT NULL DEFAULT 200,
  auto_start            INTEGER NOT NULL DEFAULT 0,
  updated_at            INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

-- Event log (label transitions + BPM snapshots)
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

GET  /music/events        — SSE stream of label/BPM events (Bearer or ?token=)
GET  /music/config        — get per-key config
PUT  /music/config        — update per-key config
```

### Public per-key route (no auth, CORS `*`)

```
GET  /music/:key/live     — lightweight SSE stream for display widgets
                            same events as /music/events but keyed by API key, no auth
```

This mirrors the pattern of `GET /viewer/:key` and allows a read-only display widget
(e.g., a BPM counter in a streaming overlay) to subscribe without a session token.

---

### SSE events (`GET /music/events` and `GET /music/:key/live`)

| Event | Payload |
|---|---|
| `connected` | `{ apiKey, label, bpm }` |
| `label_change` | `{ label, previous, confidence, timestamp }` |
| `bpm_update` | `{ bpm, confidence, timestamp }` |
| `music_started` | `{ streamKey }` |
| `music_stopped` | `{ apiKey }` |
| `music_error` | `{ error }` |

---

## Caption Injection

When `inject_caption = 1` in `music_config`, `MusicManager` pushes a caption into `session._sendQueue` on every `label_change` event:

```js
// label: 'music'   → caption_text_music   (default "♪")
// label: 'speech'  → caption_text_speech  (default "", skipped)
// label: 'silence' → nothing sent
```

The caption is delivered through the standard `fanOutToTargets` path — it appears in the YouTube stream and any viewer/generic targets.  The operator can customise the text per key via `PUT /music/config`.

This behaviour is off by default (`inject_caption = 0`).

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
| `lcyt.audio.musicDetectInject` | Send caption on music start | `'0'` |
| `lcyt.audio.musicDetectText` | Caption text for music | `'♪'` |
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
  injectCaption, onInjectCaptionChange,
  captionText, onCaptionTextChange,
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
| Inject caption on music start | toggle | |
| Caption text | text input | e.g. `♪` or `[Music]` |
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

- Reads state from a `useMusicDetector` hook (client path) and/or polls `GET /music/status` (server path).
- One chip handles both paths: shows `♪ <bpm> BPM` for music, a muted waveform icon for speech, a dash for silence.
- Clicking opens/scrolls to the `MusicPanel` in the Audio settings section.

### Caption injection (client path)

When `injectCaption` is `true` and a `label_change` event fires in the client-side detector:

```js
// In useMusicDetector, on confirmed label_change:
if (injectCaption && label === 'music') {
  captionContext.send(captionText || '♪');
}
```

`captionContext.send` is the same function used by the input bar — the injected caption flows through the full target fan-out (YouTube, viewer, generic) exactly as if the operator had typed it.

The `speech` and `silence` transitions deliberately send **nothing** by default (configurable via `captionText` for those labels in a future enhancement).

### `useMusic` hook (unified)

**File:** `packages/lcyt-web/src/hooks/useMusic.js`

A thin aggregator that merges client and server state into a single object for the `MusicPanel` and `MusicChip`:

```js
export function useMusic({ analyserRef, sessionActive }) {
  // Client path:
  const client = useMusicDetector({ analyserRef, enabled: clientEnabled, ... });

  // Server path (polling + SSE):
  const [serverStatus, setServerStatus] = useState(null);
  // polls GET /music/status every 5 s when sessionActive

  return {
    label:      client.available && clientEnabled ? client.label : serverStatus?.label ?? null,
    bpm:        client.available && clientEnabled ? client.bpm   : serverStatus?.bpm   ?? null,
    confidence: ...
    clientAvailable: client.available,
    clientRunning:   client.running,
    serverRunning:   serverStatus?.running ?? false,
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
- Aggregates state from **both paths** via `useMusic` — client path is preferred when the mic is open; server path is the fallback.
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
| Inject caption on music start | toggle | off | both |
| Caption text for music | text | `♪` | both |
| Auto-start on publish | toggle | off | server only |
| Start / Stop | button | — | both |

---

## Phases

### Phase 1 — Core detection (server-side only)

**Goal:** Reliable music/speech/silence labelling from HLS segments with no UI.

**Backend:**
- `fft.js` — radix-2 FFT helper (tests first).
- `spectral-detector.js` — RMS, spectral centroid, spectral flatness, ZCR, low-freq ratio, classify().
- `bpm-detector.js` — onset novelty function, autocorrelation, peak picking, octave disambiguation, smoothing.
- `pcm-extractor.js` — ffmpeg `s16le` pipe, `Float32Array` output.
- `music-manager.js` — wires `HlsSegmentFetcher` → `PcmExtractor` → `SpectralDetector` + `BpmDetector` → events. State machine with `LABEL_CONFIRM_SEGMENTS`.
- `db.js` — `music_config` + `music_events` migrations and helpers.
- `api.js` — `initMusicControl()` + `createMusicRouters()`.
- Routes: `POST /music/start`, `POST /music/stop`, `GET /music/status`, `GET /music/events` (SSE), `GET/PUT /music/config`.
- `on_publish` / `on_publish_done` auto-start hooks in `lcyt-rtmp`.
- `server.js` — mount `/music` routes when `MUSIC_DETECTION_ACTIVE=1`.

**Tests:**
- `test/fft.test.js` — correctness against known transform values.
- `test/spectral-detector.test.js` — classify synthetic tonal, noisy, and silent PCM buffers.
- `test/bpm-detector.test.js` — detect BPM from synthetic click-track buffers at 60, 120, 140 BPM.
- `test/music-manager.test.js` — start/stop lifecycle, label_change events, error handling.

---

### Phase 2 — Caption injection + UI (server path) + client-side browser mic

**Goal:** Operator-facing controls, optional caption annotation, and real-time browser mic analysis.

**Backend:**
- Caption injection path (`inject_caption` config flag).
- `GET /music/:key/live` public SSE route.

**UI (lcyt-web) — shared infrastructure:**
- `src/lib/musicAnalysis.js` — pure JS ports of `classifyFromFrequency` and `detectBpmFromPcm` (Web Audio API input variant).
- `src/hooks/useMusicDetector.js` — attaches to `analyserRef`; runs analysis loop; fires `onLabelChange`/`onBpmUpdate`.
- `src/hooks/useMusic.js` — aggregates client + server state.

**UI (lcyt-web) — components:**
- `src/components/MusicChip.jsx` — StatusBar music/BPM chip (reads `useMusic`).
- `src/components/panels/MusicPanel.jsx` — full settings panel (both paths), `source` selector.
- `src/lib/storageKeys.js` — add `KEYS.audio.musicDetect*` keys.
- `src/locales/en.js` — i18n strings for all music detection UI labels.

**Tests (Vitest):**
- `test/components/musicAnalysis.test.js` — `classifyFromFrequency` with synthetic tonal and noisy arrays; `detectBpmFromPcm` with click-track PCM.
- `test/components/useMusicDetector.test.jsx` — hook lifecycle: disabled when `analyserRef` is null, fires callbacks on label change.

---

### Phase 3 — Tuning, export, and advanced classifiers

**Goal:** Improve accuracy and add event history export.

**Backend:**
- `GET /music/events/history` — paginated list from `music_events` table.
- Threshold auto-calibration: a short training window at stream start that adapts to the ambient noise floor.
- Optional integration point for external classifiers (e.g., a TensorFlow.js model or a Python sidecar) via a configurable `MUSIC_CLASSIFIER_URL` HTTP hook.

**UI (lcyt-web):**
- Simple event timeline in the `MusicPanel` showing the last N label changes with timestamps and BPM values.
- Client-side auto-calibration: the hook samples the first 5 s of mic audio to set a personalised silence threshold.

---

## Open Questions

1. **Shared `HlsSegmentFetcher`**: `SttManager` already owns one fetcher per key.  When both STT and music detection run concurrently for the same key, they would each poll the playlist independently.  Options: (a) expose the fetcher from `SttManager` and let `MusicManager` subscribe to the same segment events, or (b) accept the duplicate poll (low overhead — one extra HTTP request per segment per key).  Decision deferred to implementation.

2. **ffmpeg availability**: `PcmExtractor` requires ffmpeg.  If `FFMPEG_RUNNER=worker`, the local ffmpeg binary may not be present.  `MusicManager.start()` should probe for ffmpeg (reuse `probeFfmpegVersion()` from `lcyt-rtmp/src/stt-manager.js`) and emit a clear error if unavailable.

3. **HLS segment duration**: Shorter segments (3 s) improve reaction time but give less audio context for BPM estimation.  The recommended MediaMTX setting is `hlsSegmentDuration: 6s` (same as for STT), which gives a comfortable 3–4 beat window at most tempos.

4. **Live RTMP fallback**: Phase 1 uses the HLS path only.  A `'rtmp'` audio source option (using the same ffmpeg PCM pipe approach as `SttManager`) can be added in Phase 2 for deployments without MediaMTX.

5. **Classification accuracy**: The hand-crafted threshold classifier works well for clear music vs. clear speech but may misclassify music with vocal lines or rhythmic speech.  If accuracy is insufficient, a lightweight TensorFlow.js model (e.g., a port of YAMNet's top-level classifier) could be embedded in Phase 3 without native dependencies.

6. **Client-side `fftSize`**: `AudioPanel` currently creates the `AnalyserNode` with `fftSize = 256` (sufficient for the level meter).  Music classification needs more frequency resolution — `fftSize = 2048` is recommended.  `AudioPanel` must be updated to increase the fftSize (or create a second analyser node chained to the same source) so the level meter continues to work unchanged.

7. **Concurrent client + server**: If both paths are enabled and running simultaneously, `useMusic` must resolve conflicts.  Recommended policy: prefer the client label when `client.available && client.confidence > server.confidence`, otherwise use the server label.  The `source` setting in `MusicPanel` lets the operator override this automatically.

---

## Summary

| Aspect | Decision |
|---|---|
| Plugin name | `lcyt-music` |
| Server audio source | HLS (Phase 1); RTMP fallback (Phase 2) |
| Client audio source | Browser mic via existing `AnalyserNode` in `AudioPanel` |
| Classification | Spectral features + threshold rules; no ML required in Phases 1–2 |
| BPM method | Autocorrelation of onset novelty function (both paths) |
| Native deps (server) | None — plain JavaScript + ffmpeg (already required by `lcyt-rtmp`) |
| Browser deps | Web Audio API only — built into all modern browsers |
| Shared analysis code | Server: `lcyt-music/src/analyser/`; Client: `lcyt-web/src/lib/musicAnalysis.js` |
| Caption injection | Off by default; configurable text; works on both paths |
| DB | Two new tables: `music_config`, `music_events` (server path only) |
| localStorage keys | `lcyt.audio.musicDetect*` (client path config) |
| Breaking changes | None — server plugin is opt-in via `MUSIC_DETECTION_ACTIVE=1`; client hook only activates when `enabled=true` |

---

## Todo

### Phase 1 — Core detection (server-side)

**Backend**
- [ ] `packages/plugins/lcyt-music/package.json` — plugin manifest
- [ ] `packages/plugins/lcyt-music/src/analyser/fft.js` — radix-2 Cooley–Tukey FFT
- [ ] `packages/plugins/lcyt-music/src/analyser/spectral-detector.js` — feature extraction + classify()
- [ ] `packages/plugins/lcyt-music/src/analyser/bpm-detector.js` — onset → autocorrelation → BPM
- [ ] `packages/plugins/lcyt-music/src/pcm-extractor.js` — ffmpeg PCM pipe helper
- [ ] `packages/plugins/lcyt-music/src/music-manager.js` — MusicManager EventEmitter
- [ ] `packages/plugins/lcyt-music/src/db.js` — migrations + helpers
- [ ] `packages/plugins/lcyt-music/src/routes/music.js` — start/stop/status/events routes
- [ ] `packages/plugins/lcyt-music/src/routes/music-config.js` — GET/PUT /music/config
- [ ] `packages/plugins/lcyt-music/src/api.js` — initMusicControl() + createMusicRouters()
- [ ] `packages/lcyt-backend/src/server.js` — mount /music routes when MUSIC_DETECTION_ACTIVE=1
- [ ] `packages/plugins/lcyt-rtmp/src/routes/radio.js` — on_publish auto-start hook for music

**Tests**
- [ ] `packages/plugins/lcyt-music/test/fft.test.js`
- [ ] `packages/plugins/lcyt-music/test/spectral-detector.test.js`
- [ ] `packages/plugins/lcyt-music/test/bpm-detector.test.js`
- [ ] `packages/plugins/lcyt-music/test/music-manager.test.js`

---

### Phase 2 — Caption injection + UI (server) + client-side browser mic

**Backend**
- [ ] Caption injection path in MusicManager (`inject_caption` flag)
- [ ] `GET /music/:key/live` public SSE route

**UI (lcyt-web) — shared analysis**
- [ ] `src/lib/musicAnalysis.js` — `classifyFromFrequency()` + `detectBpmFromPcm()` (Web Audio API input)

**UI (lcyt-web) — hooks**
- [ ] `src/hooks/useMusicDetector.js` — attaches to analyserRef; analysis loop; label/BPM callbacks
- [ ] `src/hooks/useMusic.js` — aggregates client + server state; resolves conflicts

**UI (lcyt-web) — components**
- [ ] `src/components/MusicChip.jsx` — StatusBar chip (both paths)
- [ ] `src/components/panels/MusicPanel.jsx` — full settings panel with source selector
- [ ] `src/lib/storageKeys.js` — add `KEYS.audio.musicDetect*` keys
- [ ] `src/locales/en.js` — i18n strings (`settings.music.*`)
- [ ] `packages/lcyt-web/src/components/AudioPanel.jsx` — increase `analyserRef` fftSize to 2048

**Tests (Vitest)**
- [ ] `test/components/musicAnalysis.test.js` — classifyFromFrequency + detectBpmFromPcm unit tests
- [ ] `test/components/useMusicDetector.test.jsx` — hook lifecycle tests

---

### Phase 3 — Tuning and export

**Backend**
- [ ] `GET /music/events/history` — paginated event log
- [ ] Ambient noise floor auto-calibration window
- [ ] Optional `MUSIC_CLASSIFIER_URL` HTTP hook for external classifiers

**UI (lcyt-web)**
- [ ] Event timeline in MusicPanel
- [ ] Client-side auto-calibration (5 s silence sampling on mic open)
