# `packages/plugins/lcyt-music` — Music Detection Plugin (v0.1.0)

Audio classification and BPM estimation plugin. Detects when music is playing in audio streams (server-side HLS or client-side browser mic) and emits metacode signals that feed into the caption pipeline. Both paths classify audio into `music / speech / silence` and estimate BPM. Imported by `lcyt-backend` as `lcyt-music`.

**Main entry:** `src/api.js`
**Usage in lcyt-backend:**
```js
import { initMusicControl, createSoundCaptionProcessor } from 'lcyt-music';

const { musicManager } = await initMusicControl(db);
const soundProcessor = createSoundCaptionProcessor({ store, db, musicManager });
// Inject soundProcessor into captions route to handle <!-- sound:... --> and <!-- bpm:... --> metacodes
```

**Source files (`src/`):**
- `api.js` — `initMusicControl(db)` + `createSoundCaptionProcessor()`.
- `sound-caption-processor.js` — `SoundCaptionProcessor`: extracts `<!-- sound:... -->` and `<!-- bpm:... -->` metacodes from caption text, updates per-API-key sound state, emits `sound_label` and `bpm_update` SSE events, returns clean text (always empty for pure metacode captions).
- `db.js` — `sound_state` table with indexes on `api_key`. Stores current `{ label, bpm, confidence, ts }` per key.

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
