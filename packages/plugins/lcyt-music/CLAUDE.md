# `packages/plugins/lcyt-music` — Music Detection Plugin (v0.1.0)

Audio classification and BPM estimation plugin. Detects when music is playing in audio streams (server-side HLS or client-side browser mic) and emits metacode signals that feed into the caption pipeline. Both paths classify audio into `music / speech / silence` and estimate BPM. Imported by `lcyt-backend` as `lcyt-music`.

**Main entry:** `src/api.js`
**Usage in lcyt-backend:**
```js
import { initMusicControl, createSoundCaptionProcessor, createMusicRouters } from 'lcyt-music';

const { musicManager } = await initMusicControl(db, store);
const soundProcessor = createSoundCaptionProcessor({ store, db });
// Inject soundProcessor into captions route to handle <!-- sound:... --> and <!-- bpm:... --> metacodes

// Opt-in server-side analysis routes:
if (process.env.MUSIC_DETECTION_ACTIVE === '1') {
  app.use('/music', ...createMusicRouters(db, auth, musicManager));
}
// In graceful shutdown: await musicManager.stopAll();
```

**Environment variables:**
| Variable | Purpose | Default |
|---|---|---|
| `MUSIC_DETECTION_ACTIVE` | Set to `1` to mount the `/music` server-side analysis routes | unset (routes not mounted) |

**Source files (`src/`):**
- `api.js` — `initMusicControl(db, store)` → `{ musicManager }` (null without a store) + `createSoundCaptionProcessor({ store, db })` + `createMusicRouters(db, auth, musicManager)` → router array.
- `music-manager.js` — `MusicManager`: per-key server-side analysis sessions over HLS audio; drives the analyser chain and feeds results into the sound processor. `stopAll()` for graceful shutdown.
- `sound-caption-processor.js` — `SoundCaptionProcessor`: extracts `<!-- sound:... -->` and `<!-- bpm:... -->` metacodes from caption text, updates per-API-key sound state, emits `sound_label` and `bpm_update` SSE events, returns clean text (always empty for pure metacode captions).
- `hls-segment-fetcher.js` / `pcm-extractor.js` / `wav-encoder.js` — HLS segment download, PCM audio extraction, and WAV encoding for the analysis pipeline.
- `analyser/spectral-detector.js` / `analyser/bpm-detector.js` / `analyser/fft.js` — spectral music/speech/silence classification and BPM estimation.
- `analyser/external-classifier.js` — optional external HTTP classifier hook.
- `routes/music.js` — `GET /music/status`, `POST /music/start`, `POST /music/stop`, `GET /music/events/history` (Bearer token), `GET /music/:key/live` (public SSE).
- `routes/music-config.js` — `GET/PUT /music/config` per-key detector settings (Bearer token).
- `db.js` — `sound_state` table (current `{ label, bpm, confidence, ts }` per key), `music_events` history table, and `music_config` per-key server-side detector settings.

**Sound metacode syntax (frontend inline markers):**
```
<!-- sound:music -->              audio is music
<!-- sound:speech -->             audio is speech (or mixed/predominantly speech)
<!-- sound:silence -->            audio is silent
<!-- bpm:128 -->                  current BPM estimate (integer; only emitted when label=music)
```

**Audio sources (two independent paths):**
| Path | Audio source | Where it runs | Use case |
|---|---|---|---|
| **Server-side** | HLS segments (MediaMTX fMP4) | `lcyt-music` Node.js plugin | Headless/hardware streams; no browser required |
| **Client-side** | Browser microphone | `lcyt-web` (Web Audio API) | Operator using browser mic for STT |

**SSE events on `GET /events` (new event types):**
- `sound_label` — `{ label: 'music'\|'speech'\|'silence', previous, confidence, ts }`
- `bpm_update` — `{ bpm: number, confidence, ts }`

**Use cases:**
- Mute STT during music (suppress low-confidence transcripts when music detected)
- Signal music presence via metacodes so DSK overlays/viewer pages can react
- BPM display for producers timing cuts/graphics to the beat
- Production cue light in control UI showing musical segment in progress

**Tests:** `packages/plugins/lcyt-music/test/*.test.js` — uses `node:test`.
