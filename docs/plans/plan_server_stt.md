---
id: plan/server-stt
title: "Server-side Speech-to-Text (STT)"
status: draft
summary: "Server-side audio capture from MediaMTX (RTMP, HLS, or WebRTC/WHEP) piped through ffmpeg into pluggable STT provider adapters (whisper.cpp, Google Cloud STT, OpenAI-compatible Whisper); transcripts delivered into the existing caption pipeline without any browser involvement."
---

# Server-side Speech-to-Text (STT)

**Scope:** New `SttManager` class in `packages/plugins/lcyt-rtmp`; new `/stt` routes in `packages/lcyt-backend`; optional UI controls in `packages/lcyt-web`.

---

## Motivation

The existing STT integration is entirely browser-based — the browser captures the microphone, runs recognition, and POSTs final transcripts to the backend. Server-side STT removes the browser dependency entirely:

- The audio source is a live stream already flowing through MediaMTX.
- The server captures, decodes, and recognises the audio using a pluggable provider.
- Transcripts are delivered into the existing caption-send pipeline just like browser-originated text.
- Useful for: automated captioning of hardware streams (cameras, mixers, broadcast hardware), headless/unattended deployments, and scenarios where no operator browser is available.

---

## Architecture Overview

```
MediaMTX                  SttManager (per API key)
  RTMP  ─┐
  HLS   ─┼──► ffmpeg ──► PCM 16 kHz mono (stdout pipe)
  WHEP  ─┘                    │
                              ▼
                         SttAdapter (pluggable)
                         ├─ WhisperHttpAdapter  (whisper.cpp HTTP server)
                         ├─ GoogleSttAdapter    (REST chunked or gRPC streaming)
                         └─ OpenAiAdapter       (chunked REST, OpenAI-compatible)
                              │
                         transcript events
                              │
                              ▼
                         session._sendQueue    (existing caption delivery)
                         ├─ YouTube targets
                         ├─ viewer targets
                         └─ generic targets
```

---

## Audio Source

MediaMTX exposes three egress protocols, all accessible to ffmpeg. The choice is a deployment configuration decision — there is no preferred or fallback hierarchy; all three are first-class options.

### RTMP

```
rtmp://127.0.0.1:1935/{RTMP_APP}/{streamKey}
```

Connects directly to the RTMP mux inside MediaMTX. Latency matches the ingest latency (~1–3 s end-to-end). Works as long as the stream is publishing to MediaMTX over RTMP.

### HLS

```
http://127.0.0.1:8080/{streamKey}/index.m3u8
```

MediaMTX generates HLS segments natively. Standard HLS adds one segment duration of latency (typically 2–6 s). MediaMTX also supports **Low-Latency HLS (LL-HLS)**, which reduces this to ~1–2 s. Use when RTMP is not available or when HLS is the only egress configured.

### WebRTC / WHEP

```
http://127.0.0.1:8889/{streamKey}/whep
```

MediaMTX exposes a WHEP (WebRTC HTTP Egress Protocol) endpoint. ffmpeg 6.1+ includes a built-in WHEP input demuxer — no native Node.js WebRTC dependency is required:

```sh
ffmpeg -i 'http://127.0.0.1:8889/{streamKey}/whep' ...
```

WHEP gives the lowest end-to-end latency (~200–500 ms). Requires ffmpeg ≥ 6.1 and MediaMTX's WebRTC port to be accessible from the backend host.

### ffmpeg decode command (all sources)

```sh
ffmpeg -i <source_url> \
  -vn \
  -af "aresample=16000,aformat=sample_fmts=s16:channel_layouts=mono" \
  -f s16le \
  pipe:1
```

Raw PCM output on stdout: 16-bit signed little-endian, 16 000 Hz, 1 channel. This is the universal format accepted by all major STT APIs.

---

## SttManager

**File:** `packages/plugins/lcyt-rtmp/src/stt-manager.js`

One `SttManager` instance is shared across all API keys (singleton, created by `initRtmpControl`). It manages per-key STT sessions internally.

### Public API

```js
// Start STT for an API key. Config is per-key; falls back to global defaults.
await sttManager.start(apiKey, {
  provider,       // 'whisper_http' | 'google' | 'openai'
  language,       // BCP-47 (default: 'en-US')
  audioSource,    // 'rtmp' | 'hls' | 'whep'  (default: 'rtmp')
  streamKey,      // MediaMTX path (default: apiKey)
  vadSilenceMs,   // silence gap that ends an utterance (default: 1000)
  chunkDurationMs // max audio chunk length for batch providers (default: 5000)
})

// Stop STT for an API key.
await sttManager.stop(apiKey)

// Check if STT is running for an API key.
sttManager.isRunning(apiKey)    // → boolean

// Status info for an API key.
sttManager.getStatus(apiKey)    // → { running, provider, language, startedAt, segmentsSent, lastTranscript }

// Stop all active STT sessions.
await sttManager.stopAll()
```

### Events (EventEmitter)

```js
sttManager.on('transcript', ({ apiKey, text, isFinal, confidence, timestamp, provider }))
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
  ffmpegHandle,   // FfmpegRunner handle
  adapter,        // SttAdapter instance
  startedAt,      // ISO timestamp
  segmentsSent,   // counter
  lastTranscript, // { text, timestamp }
  stopped,        // boolean
}
```

---

## STT Provider Adapters

**Directory:** `packages/plugins/lcyt-rtmp/src/stt-adapters/`

All adapters implement the same interface:

```js
class SttAdapter extends EventEmitter {
  // Called once: adapter sets up connection, buffers, etc.
  async start({ language, ...opts }) {}

  // Called with each raw PCM chunk (Buffer, s16le 16kHz mono).
  write(pcmChunk) {}

  // Flush any buffered audio, wait for final transcripts, then clean up.
  async stop() {}

  // Events emitted:
  // 'transcript' { text, isFinal, confidence, timestamp }
  // 'error'      { error }
}
```

### WhisperHttpAdapter (`stt-adapters/whisper-http.js`)

Connects to a running [whisper.cpp HTTP server](https://github.com/ggerganov/whisper.cpp/tree/master/examples/server).

- Accumulates PCM into a rolling buffer.
- On silence detection (energy below threshold for `vadSilenceMs` ms) OR when buffer reaches `chunkDurationMs`, encodes the chunk as WAV in memory.
- `POST {WHISPER_HTTP_URL}/inference` with `multipart/form-data` audio file + language param.
- Parses response `{ text }` and emits `transcript`.
- The server loads the model once and handles concurrent requests; the adapter retries connection on startup with exponential backoff.
- Supports Finnish (`fi`) and all other Whisper-supported languages.

**Environment variables:**

| Variable | Default | Purpose |
|---|---|---|
| `WHISPER_HTTP_URL` | — | whisper.cpp server base URL (e.g. `http://localhost:8080`) |
| `WHISPER_HTTP_MODEL` | (server default) | Model name sent in request (optional) |

### GoogleSttAdapter (`stt-adapters/google-stt.js`)

Uses Google Cloud Speech-to-Text v1. Supports Finnish (`fi-FI`) and 125+ languages.

**REST mode (simpler, higher latency):**

- Same buffer/silence strategy as WhisperHttpAdapter.
- `POST https://speech.googleapis.com/v1/speech:recognize` with inline base64 PCM audio.

**Streaming gRPC mode (low latency):**

- Opens a bidirectional gRPC stream via the `@google-cloud/speech` Node.js client.
- Sends `StreamingRecognizeRequest` with PCM audio as it arrives.
- Emits `transcript` on `is_final: true` results.
- Automatically restarts the stream on the 5-minute Google API limit.

**Environment variables:**

| Variable | Default | Purpose |
|---|---|---|
| `GOOGLE_APPLICATION_CREDENTIALS` | — | Path to service account JSON |
| `GOOGLE_STT_KEY` | — | API key for REST fallback |
| `GOOGLE_STT_MODE` | `rest` | `rest` or `grpc` |

### OpenAiAdapter (`stt-adapters/openai.js`)

Uses OpenAI's [Whisper API](https://platform.openai.com/docs/guides/speech-to-text) (`/v1/audio/transcriptions`), or any OpenAI-compatible endpoint (local whisper-openai-server, Ollama, Azure OpenAI).

- Batch-only (no true streaming).
- Accumulates PCM to WAV; POSTs on silence or max chunk size.
- `multipart/form-data` with `model`, `language`, audio file.
- Emits `transcript` with `isFinal: true` for each response.
- Supports Finnish (`fi`) via Whisper's multilingual models.

**Environment variables:**

| Variable | Default | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | — | OpenAI API key (or local server key) |
| `OPENAI_STT_MODEL` | `whisper-1` | Model name |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | Override for local or Azure endpoints |

---

## Transcript → Caption Delivery

When a `transcript` event fires, `SttManager` looks up the active backend session for the API key from the `SessionStore`:

```js
// Pseudo-code inside SttManager._onTranscript()
const session = store.getByApiKey(apiKey)
if (!session) return  // no active session — discard

const text = transcript.text.trim()
if (!text) return

session._sendQueue.add(async () => {
  const seq = ++session.sequence
  await fanOutToTargets(session, seq, text, transcript.timestamp, {})
})
```

This reuses the same `_sendQueue` serialisation that browser-originated captions use, ensuring sequence numbers stay monotonic even when server STT and browser input are used simultaneously.

---

## Database

New table `stt_config` (in `packages/plugins/lcyt-rtmp/src/db.js` migrations):

```sql
CREATE TABLE IF NOT EXISTS stt_config (
  api_key           TEXT PRIMARY KEY,
  provider          TEXT NOT NULL DEFAULT 'whisper_http',
  language          TEXT NOT NULL DEFAULT 'en-US',
  audio_source      TEXT NOT NULL DEFAULT 'rtmp',
  stream_key        TEXT,           -- NULL means use api_key as the MediaMTX path
  auto_start        INTEGER NOT NULL DEFAULT 0,
  vad_silence_ms    INTEGER NOT NULL DEFAULT 1000,
  chunk_duration_ms INTEGER NOT NULL DEFAULT 5000,
  created_at        INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  updated_at        INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);
```

`auto_start = 1`: when MediaMTX fires the `on_publish` callback for this key, the backend automatically calls `sttManager.start()`.

---

## API Routes

Mounted at `/stt` in `packages/lcyt-backend/src/routes/stt.js`. All endpoints require the standard session Bearer token (`Authorization: Bearer <session-token>`).

```
GET  /stt/status           — current STT session state for the authenticated API key
POST /stt/start            — start STT (body: { provider?, language?, audioSource?, streamKey? })
POST /stt/stop             — stop STT
GET  /stt/events           — SSE stream of transcript events (Bearer or ?token=)
GET  /stt/config           — get per-key STT config from DB
PUT  /stt/config           — update per-key STT config (body: any stt_config fields)
```

### SSE events (on `GET /stt/events`)

| Event | Payload |
|---|---|
| `connected` | `{ apiKey, provider, language }` |
| `transcript` | `{ text, isFinal, confidence, timestamp, provider }` |
| `stt_started` | `{ provider, language, audioSource }` |
| `stt_stopped` | `{ apiKey }` |
| `stt_error` | `{ error }` |

---

## Auto-start on Publish

The existing `on_publish` RTMP callback is extended:

```js
// After registering the publisher in the DB / managers:
const cfg = db.getSttConfig(apiKey)
if (cfg?.auto_start) {
  await sttManager.start(apiKey, cfg)
}
```

Similarly, `on_publish_done` calls `sttManager.stop(apiKey)`.

---

## Environment Variables

Global defaults (overridden per key via `PUT /stt/config`):

| Variable | Default | Purpose |
|---|---|---|
| `STT_PROVIDER` | `whisper_http` | Default provider: `whisper_http` \| `google` \| `openai` |
| `STT_DEFAULT_LANGUAGE` | `en-US` | Default recognition language (BCP-47) |
| `STT_AUDIO_SOURCE` | `rtmp` | Default audio source: `rtmp` \| `hls` \| `whep` |
| `STT_CHUNK_DURATION_MS` | `5000` | Max audio chunk length for batch providers |
| `STT_VAD_SILENCE_MS` | `1000` | Silence gap (ms) that ends an utterance |
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

### Phase 1 — Core pipeline (MVP)

- `SttManager` with RTMP pull via ffmpeg.
- `WhisperHttpAdapter` (silence-based chunking, WAV encoding in memory, HTTP POST).
- DB migration for `stt_config`.
- `/stt` routes: `status`, `start`, `stop`, `config`.
- Integration with `_sendQueue` for transcript delivery.
- `on_publish` auto-start hook.

**Deliverable:** Fully headless Finnish/multilingual captioning from an RTMP stream using a local whisper.cpp server.

### Phase 2 — All three audio sources + cloud providers

- HLS and WHEP audio sources in `SttManager` (ffmpeg WHEP input requires ffmpeg ≥ 6.1; probe version on startup and warn if unavailable).
- `GoogleSttAdapter` (REST mode first; gRPC streaming as a follow-up).
- `OpenAiAdapter` (chunked REST, OpenAI-compatible endpoint support).

### Phase 3 — SSE transcript stream + UI

- `GET /stt/events` SSE endpoint.
- lcyt-web: STT status indicator in `StatusBar` (shows "Server STT: whisper / fi-FI").
- lcyt-web: `EmbedSettingsPage` CC tab — new "Server STT" section for provider, language, audio source, and auto-start toggle.
- lcyt-web: `GET /stt/status` polled or SSE-driven for real-time state.

### Phase 4 — Quality controls

- Confidence threshold filtering (discard low-confidence segments).
- Punctuation normalisation for providers that don't punctuate.
- Per-key silence sensitivity and chunk duration configurable at runtime via `PUT /stt/config`.

---

## Key Files to Create / Modify

| Action | File | Notes |
|---|---|---|
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

1. **Simultaneous browser + server STT**: Should they be allowed to co-exist on the same session? Currently both would write into the same `_sendQueue`, which is safe but could produce interleaved output. A mutex flag (`serverSttActive`) on the session could prevent browser sends while server STT is running.

2. **streamKey vs apiKey for MediaMTX path**: In the current radio/HLS flow the MediaMTX path is derived from `apiKey`. For RTMP relay scenarios the user configures an explicit `streamKey`. The `stt_config.stream_key` column is nullable; when null, use `apiKey` as the MediaMTX path.

3. **VAD strategy**: Simple energy-based silence detection inside the adapter is sufficient for phase 1. A more sophisticated approach (e.g. Silero VAD via onnxruntime) could be added later for noisy environments.

4. **ffmpeg WHEP availability**: The WHEP input demuxer (`-f rtc` / `whep://`) was added in ffmpeg 6.1 as an experimental feature. `SttManager` should probe the ffmpeg version and enabled protocols at startup and log a warning (not an error) if WHEP is unavailable, falling back to RTMP or HLS for that session.

5. **Google gRPC dependency**: `@google-cloud/speech` pulls in gRPC native bindings. Make this an optional peer dependency — the adapter catches the `require()` failure and throws a clear error ("install @google-cloud/speech to use the google provider") rather than crashing the server.
