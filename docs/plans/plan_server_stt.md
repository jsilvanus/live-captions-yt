---
id: plan/server-stt
title: "Server-side Speech-to-Text (STT)"
status: draft
summary: "Server-side STT by fetching HLS audio segments directly from MediaMTX and posting them to pluggable STT provider adapters (whisper.cpp, Google Cloud STT, OpenAI-compatible Whisper); segment timestamps from the HLS playlist drive caption timing with no ffmpeg required for the default path."
---

# Server-side Speech-to-Text (STT)

**Scope:** New `SttManager` and `HlsSegmentFetcher` classes in `packages/plugins/lcyt-rtmp`; new `/stt` routes in `packages/lcyt-backend`; optional UI controls in `packages/lcyt-web`.

---

## Motivation

The existing STT integration is entirely browser-based — the browser captures the microphone, runs recognition, and POSTs final transcripts to the backend. Server-side STT removes the browser dependency entirely:

- The audio source is a live stream already flowing through MediaMTX.
- HLS segments are fetched directly and posted to the STT provider — no ffmpeg decode pipeline required.
- Timestamps come from the HLS playlist itself, not from a PCM buffer.
- Transcripts are delivered into the existing caption-send pipeline just like browser-originated text.
- Useful for: automated captioning of hardware streams (cameras, mixers, broadcast hardware), headless/unattended deployments, and scenarios where no operator browser is available.

---

## Architecture Overview

```
MediaMTX HLS
  /{streamKey}/index.m3u8   ←── HlsSegmentFetcher (polls playlist)
  /{streamKey}/seg001.ts         │
  /{streamKey}/seg002.ts         │  segment buffer + timestamp from #EXT-X-PROGRAM-DATE-TIME
                                 ▼
                            SttAdapter (pluggable)
                            ├─ WhisperHttpAdapter  (whisper.cpp HTTP server)
                            ├─ GoogleSttAdapter    (Google Cloud STT REST/gRPC)
                            └─ OpenAiAdapter       (OpenAI-compatible chunked REST)
                                 │
                            transcript events { text, timestamp }
                                 │
                                 ▼
                            session._sendQueue    (existing caption delivery)
                            ├─ YouTube targets
                            ├─ viewer targets
                            └─ generic targets
```

For non-HLS sources (RTMP, WHEP), `SttManager` falls back to an ffmpeg PCM pipe — see [Fallback: ffmpeg pipe](#fallback-ffmpeg-pipe).

---

## HLS Segment Fetcher

**File:** `packages/plugins/lcyt-rtmp/src/hls-segment-fetcher.js`

The core of the HLS path. Polls the MediaMTX playlist, detects new segments, fetches their raw bytes, and extracts the wall-clock timestamp for each.

### Playlist polling

- GET `{hlsBase}/{streamKey}/index.m3u8` every ~2 s (or half the segment duration).
- Track `#EXT-X-MEDIA-SEQUENCE` to identify new segments since the last poll.
- On each new segment:
  - Determine its wall-clock start time:
    - If `#EXT-X-PROGRAM-DATE-TIME` is present, use it for the first segment in the window; subsequent segments' timestamps = programDateTime + accumulated `#EXTINF` durations.
    - If absent, fall back to `Date.now()` at fetch time.
  - GET the segment URL and collect the response body as a `Buffer`.
  - Emit `segment` event: `{ buffer, timestamp, duration, url, index }`.

### Why this is better than ffmpeg piping

- No ffmpeg process, no PCM decode, no WAV encoding in memory, no stdout pipe.
- Timestamps come from the HLS playlist — the most accurate source available.
- HLS segment duration is the natural utterance boundary. No VAD, no `vadSilenceMs`, no `chunkDurationMs` config.
- Segment duration is set in MediaMTX's config (`hlsSegmentDuration`), not in LCYT code.
- The fetcher is a plain Node.js HTTP client loop — simple, testable, no native deps.

### Events (EventEmitter)

```js
fetcher.on('segment', ({ buffer, timestamp, duration, url, index }))
fetcher.on('error',   ({ error }))
fetcher.on('stopped', ())
```

---

## SttManager

**File:** `packages/plugins/lcyt-rtmp/src/stt-manager.js`

One `SttManager` instance is shared across all API keys (singleton, created by `initRtmpControl`). It manages per-key STT sessions internally.

### Public API

```js
await sttManager.start(apiKey, {
  provider,     // 'whisper_http' | 'google' | 'openai'
  language,     // BCP-47 (default: 'en-US')
  audioSource,  // 'hls' | 'rtmp' | 'whep'  (default: 'hls')
  streamKey,    // MediaMTX path (default: apiKey)
})

await sttManager.stop(apiKey)
sttManager.isRunning(apiKey)   // → boolean
sttManager.getStatus(apiKey)   // → { running, provider, language, startedAt, segmentsSent, lastTranscript }
await sttManager.stopAll()
```

### Events (EventEmitter)

```js
sttManager.on('transcript', ({ apiKey, text, confidence, timestamp, provider }))
sttManager.on('error',      ({ apiKey, error }))
sttManager.on('stopped',    ({ apiKey }))
```

### Per-key session state (internal)

```js
{
  apiKey,
  provider,
  language,
  audioSource,
  streamKey,
  fetcher,        // HlsSegmentFetcher instance (HLS path)
  ffmpegHandle,   // FfmpegRunner handle (RTMP/WHEP path only)
  adapter,        // SttAdapter instance
  startedAt,      // ISO timestamp
  segmentsSent,   // counter
  lastTranscript, // { text, timestamp }
}
```

---

## STT Provider Adapters

**Directory:** `packages/plugins/lcyt-rtmp/src/stt-adapters/`

All adapters implement the same interface. For the HLS path, `sendSegment` is called once per HLS segment. For the ffmpeg fallback path, `write` is called with PCM chunks and the adapter handles its own buffering.

```js
class SttAdapter extends EventEmitter {
  async start({ language, ...opts }) {}

  // HLS path: called once per segment with raw audio buffer and its playlist timestamp.
  async sendSegment(buffer, { timestamp, duration }) {}

  // ffmpeg fallback path: called with raw PCM chunks (s16le 16kHz mono).
  write(pcmChunk) {}

  async stop() {}

  // Events:
  // 'transcript' { text, confidence, timestamp }
  // 'error'      { error }
}
```

### WhisperHttpAdapter (`stt-adapters/whisper-http.js`)

Connects to a running [whisper.cpp HTTP server](https://github.com/ggerganov/whisper.cpp/tree/master/examples/server).

**HLS path:**
- `POST {WHISPER_HTTP_URL}/inference` with the raw `.ts` segment buffer as `multipart/form-data`.
- whisper.cpp uses ffmpeg internally and accepts MPEG-TS directly.
- Uses the segment's playlist timestamp as the caption timestamp.

**ffmpeg fallback path:**
- Accumulates PCM into a rolling buffer.
- Encodes each filled buffer as a WAV in memory and POSTs it.

Supports Finnish (`fi`) and all other Whisper-supported languages.

| Variable | Default | Purpose |
|---|---|---|
| `WHISPER_HTTP_URL` | — | whisper.cpp server base URL (e.g. `http://localhost:8080`) |
| `WHISPER_HTTP_MODEL` | (server default) | Model name sent in request (optional) |

### GoogleSttAdapter (`stt-adapters/google-stt.js`)

Uses Google Cloud Speech-to-Text v1. Supports Finnish (`fi-FI`) and 125+ languages.

**HLS path:**

Google STT does not accept MPEG-TS directly. Options:

1. **ffmpeg per-segment remux** (simplest): spawn a short-lived ffmpeg to extract AAC from the `.ts` buffer to an in-memory `.m4a` or raw `flac`/`wav`, then POST. Single-segment ffmpeg invocations are fast (~100 ms) and stateless.
2. **fMP4 output from MediaMTX**: configure MediaMTX to produce fMP4 segments (`.m4s`). fMP4 audio (`mp4a`) is accepted by Google as `mp4`/`m4a`. Eliminates per-segment ffmpeg.

The adapter supports both; option 2 is preferred when MediaMTX is configured for fMP4.

**REST mode:** `POST https://speech.googleapis.com/v1/speech:recognize` with base64 audio.

**gRPC streaming mode:** bidirectional stream via `@google-cloud/speech`; restarts automatically at the 5-minute API limit.

| Variable | Default | Purpose |
|---|---|---|
| `GOOGLE_APPLICATION_CREDENTIALS` | — | Path to service account JSON |
| `GOOGLE_STT_KEY` | — | API key for REST fallback |
| `GOOGLE_STT_MODE` | `rest` | `rest` or `grpc` |

`@google-cloud/speech` is an **optional peer dependency** — the adapter catches the import failure and throws a descriptive error rather than crashing the server.

### OpenAiAdapter (`stt-adapters/openai.js`)

Uses OpenAI's [Whisper API](https://platform.openai.com/docs/guides/speech-to-text) (`/v1/audio/transcriptions`), or any OpenAI-compatible endpoint (local whisper-openai-server, Ollama, Azure OpenAI).

**HLS path:**
- POST the raw `.ts` segment buffer as `multipart/form-data` with filename `segment.ts`.
- OpenAI accepts `mp3`, `mp4`, `mpeg`, `mpga`, `m4a`, `wav`, `webm` — but `.ts` (MPEG-TS) is usually accepted in practice. If rejected, configure MediaMTX for fMP4 output (`segment.mp4`).
- Uses the segment's playlist timestamp as the caption timestamp.

Supports Finnish (`fi`) via Whisper's multilingual models.

| Variable | Default | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | — | OpenAI API key (or local server key) |
| `OPENAI_STT_MODEL` | `whisper-1` | Model name |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | Override for local or Azure endpoints |

---

## Fallback: ffmpeg pipe

For `audioSource: 'rtmp'` or `audioSource: 'whep'`, there are no natural segments or playlist timestamps. `SttManager` falls back to the original ffmpeg PCM pipe approach:

```sh
# RTMP
ffmpeg -i rtmp://127.0.0.1:1935/{app}/{streamKey} \
  -vn -af "aresample=16000,aformat=sample_fmts=s16:channel_layouts=mono" \
  -f s16le pipe:1

# WHEP (ffmpeg ≥ 6.1)
ffmpeg -i http://127.0.0.1:8889/{streamKey}/whep \
  -vn -af "aresample=16000,aformat=sample_fmts=s16:channel_layouts=mono" \
  -f s16le pipe:1
```

In this path, adapters use `write(pcmChunk)` instead of `sendSegment()`, and handle their own silence/chunk buffering. The HLS path is preferred for all deployments that have MediaMTX.

---

## Transcript → Caption Delivery

```js
// Inside SttManager._onTranscript()
const session = store.getByApiKey(apiKey)
if (!session) return  // no active session — discard

const text = transcript.text.trim()
if (!text) return

session._sendQueue.add(async () => {
  const seq = ++session.sequence
  await fanOutToTargets(session, seq, text, transcript.timestamp, {})
})
```

Reuses the same `_sendQueue` serialisation as browser-originated captions, keeping sequence numbers monotonic.

---

## Database

New table `stt_config` (added to `packages/plugins/lcyt-rtmp/src/db.js` migrations):

```sql
CREATE TABLE IF NOT EXISTS stt_config (
  api_key      TEXT PRIMARY KEY,
  provider     TEXT NOT NULL DEFAULT 'whisper_http',
  language     TEXT NOT NULL DEFAULT 'en-US',
  audio_source TEXT NOT NULL DEFAULT 'hls',
  stream_key   TEXT,         -- NULL → use api_key as the MediaMTX path
  auto_start   INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  updated_at   INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);
```

`vad_silence_ms` and `chunk_duration_ms` are removed — segment boundaries replace them for the HLS path.

---

## API Routes

Mounted at `/stt` in `packages/lcyt-backend/src/routes/stt.js`. All endpoints require the standard session Bearer token.

```
GET  /stt/status    — current STT session state for the authenticated API key
POST /stt/start     — start STT (body: { provider?, language?, audioSource?, streamKey? })
POST /stt/stop      — stop STT
GET  /stt/events    — SSE stream of transcript events (Bearer or ?token=)
GET  /stt/config    — get per-key STT config from DB
PUT  /stt/config    — update per-key STT config
```

### SSE events (on `GET /stt/events`)

| Event | Payload |
|---|---|
| `connected` | `{ apiKey, provider, language }` |
| `transcript` | `{ text, confidence, timestamp, provider }` |
| `stt_started` | `{ provider, language, audioSource }` |
| `stt_stopped` | `{ apiKey }` |
| `stt_error` | `{ error }` |

---

## Auto-start on Publish

The existing `on_publish` RTMP callback is extended:

```js
const cfg = db.getSttConfig(apiKey)
if (cfg?.auto_start) {
  await sttManager.start(apiKey, cfg)
}
```

`on_publish_done` calls `sttManager.stop(apiKey)`.

---

## Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `STT_PROVIDER` | `whisper_http` | Default provider: `whisper_http` \| `google` \| `openai` |
| `STT_DEFAULT_LANGUAGE` | `en-US` | Default recognition language (BCP-47) |
| `STT_AUDIO_SOURCE` | `hls` | Default audio source: `hls` \| `rtmp` \| `whep` |
| `WHISPER_HTTP_URL` | — | whisper.cpp HTTP server URL |
| `WHISPER_HTTP_MODEL` | — | Whisper model name (optional) |
| `GOOGLE_APPLICATION_CREDENTIALS` | — | Google service account JSON path |
| `GOOGLE_STT_KEY` | — | Google API key (REST fallback) |
| `GOOGLE_STT_MODE` | `rest` | `rest` or `grpc` |
| `OPENAI_API_KEY` | — | OpenAI API key |
| `OPENAI_STT_MODEL` | `whisper-1` | OpenAI Whisper model name |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | OpenAI-compatible base URL |

---

## Implementation Phases

### Phase 1 — HLS segment fetch + Whisper (MVP)

- `HlsSegmentFetcher`: playlist poll, new-segment detection, timestamp extraction, segment buffer fetch.
- `SttManager` wiring fetcher → adapter → transcript → `_sendQueue`.
- `WhisperHttpAdapter`: direct MPEG-TS segment POST to whisper.cpp server.
- DB migration for `stt_config`.
- `/stt` routes: `start`, `stop`, `status`, `config`.
- `on_publish` auto-start hook.

**Deliverable:** Fully headless Finnish/multilingual captioning from any MediaMTX stream with no ffmpeg in the hot path.

### Phase 2 — Cloud providers + ffmpeg fallback

- `GoogleSttAdapter` (REST + optional fMP4 path; gRPC streaming as follow-up).
- `OpenAiAdapter` (chunked REST, OpenAI-compatible endpoints).
- ffmpeg PCM pipe fallback for RTMP and WHEP sources.
- WHEP: probe ffmpeg version on startup; warn if < 6.1.

### Phase 3 — SSE transcript stream + UI

- `GET /stt/events` SSE endpoint.
- lcyt-web: Server STT status indicator in `StatusBar`.
- lcyt-web: Server STT config section in `EmbedSettingsPage` CC tab (provider, language, audio source, auto-start toggle).

### Phase 4 — Quality controls

- Confidence threshold filtering (discard low-confidence segments).
- Punctuation normalisation for providers that omit it.
- Skip silent/empty segments before sending to the STT API (energy check on the buffer).

---

## Key Files to Create / Modify

| Action | File | Notes |
|---|---|---|
| Create | `packages/plugins/lcyt-rtmp/src/hls-segment-fetcher.js` | HLS playlist poll + segment fetch |
| Create | `packages/plugins/lcyt-rtmp/src/stt-manager.js` | SttManager class |
| Create | `packages/plugins/lcyt-rtmp/src/stt-adapters/whisper-http.js` | WhisperHttpAdapter |
| Create | `packages/plugins/lcyt-rtmp/src/stt-adapters/google-stt.js` | GoogleSttAdapter |
| Create | `packages/plugins/lcyt-rtmp/src/stt-adapters/openai.js` | OpenAiAdapter |
| Create | `packages/lcyt-backend/src/routes/stt.js` | /stt Express router |
| Modify | `packages/plugins/lcyt-rtmp/src/db.js` | Add stt_config migration |
| Modify | `packages/plugins/lcyt-rtmp/src/api.js` | Export sttManager from initRtmpControl |
| Modify | `packages/lcyt-backend/src/server.js` | Mount /stt router, pass sttManager |
| Modify | `packages/lcyt-backend/src/routes/radio.js` | on_publish auto-start hook |
| Modify | `packages/lcyt-web/src/components/StatusBar.jsx` | Server STT status indicator |

---

## Open Questions

1. **MPEG-TS vs fMP4 segments**: MediaMTX can output either. fMP4 (`.m4s`) is more widely accepted by STT APIs. Should the plan recommend a specific MediaMTX `hlsVariant` setting, or handle both transparently by sniffing the segment URL extension?

2. **Simultaneous browser + server STT**: Both write into the same `_sendQueue` — safe for ordering but could produce interleaved output. A mutex flag (`serverSttActive`) on the session could block browser sends while server STT is running.

3. **streamKey vs apiKey for MediaMTX path**: `stt_config.stream_key` is nullable; when null, use `apiKey` as the MediaMTX HLS path. This matches the existing convention in `RadioManager`.

4. **Google gRPC dependency**: `@google-cloud/speech` pulls in native gRPC bindings. Optional peer dep — fail with a clear error message if not installed.

5. **Empty segment handling**: Short silence periods still produce audio segments. A lightweight energy check (sum of absolute sample values) on the decoded PCM — or simply checking the segment file size against a threshold — can skip blank segments before sending to the STT API, saving cost and avoiding spurious transcripts.
