---
id: plan/server-stt
title: "Server-side Speech-to-Text (STT)"
status: draft
summary: "Server-side STT by fetching fMP4 HLS audio segments directly from MediaMTX and posting them to pluggable STT provider adapters (Google Cloud STT, whisper.cpp, OpenAI-compatible Whisper); segment timestamps from the HLS playlist drive caption timing with no ffmpeg required for the default path."
---

# Server-side Speech-to-Text (STT)

**Scope:** New `HlsSegmentFetcher` and `SttManager` in `packages/plugins/lcyt-rtmp`; new `/stt` routes in `packages/lcyt-backend`; UI additions in `packages/lcyt-web`.

---

## Motivation

The existing STT is entirely browser-based. Server-side STT removes the browser dependency:

- Audio source is a live fMP4 HLS stream already flowing through MediaMTX.
- Segments are fetched directly as HTTP requests and posted to the STT provider — no ffmpeg decode pipeline.
- Timestamps come from the HLS playlist itself (`#EXT-X-PROGRAM-DATE-TIME`).
- HLS segment duration is the natural utterance boundary — no VAD, no manual chunk sizing.
- Transcripts are delivered into the existing caption-send pipeline like any other caption source.
- Useful for: automated captioning of hardware streams, headless deployments, unattended operation.

---

## Architecture Overview

```
MediaMTX (fMP4 HLS output)
  /{streamKey}/index.m3u8        ←── HlsSegmentFetcher (polls playlist)
  /{streamKey}/init.mp4               │
  /{streamKey}/seg001.mp4             │  Buffer + timestamp (from EXT-X-PROGRAM-DATE-TIME)
  /{streamKey}/seg002.mp4             │
                                      ▼
                                 SttAdapter
                                 ├─ GoogleSttAdapter  [Phase 1]
                                 ├─ WhisperHttpAdapter [Phase 2]
                                 └─ OpenAiAdapter      [Phase 2]
                                      │
                                 { text, timestamp }
                                      │
                                      ▼
                                 session._sendQueue
                                 ├─ YouTube targets
                                 ├─ viewer targets
                                 └─ generic targets
```

RTMP and WHEP sources use an ffmpeg PCM pipe fallback — see [Phase 3](#phase-3--rtmpwhep-fallback).

---

## MediaMTX Configuration

MediaMTX must be configured to output **fMP4 HLS segments** (`.mp4` instead of `.ts`). fMP4 is accepted directly by Google Cloud STT, OpenAI, and whisper.cpp.

In `mediamtx.yml`:

```yaml
hlsVariant: fmp4          # produce .mp4 segments instead of .ts
hlsSegmentDuration: 6s    # adjust to taste; longer = more context per STT call
```

The segment duration is the only tuning knob for utterance granularity.

---

## HlsSegmentFetcher

**File:** `packages/plugins/lcyt-rtmp/src/hls-segment-fetcher.js`

Polls the MediaMTX HLS playlist, detects new segments, and emits them with accurate wall-clock timestamps.

### Behaviour

- GET `{hlsBase}/{streamKey}/index.m3u8` at a configurable interval (default: half the segment duration, minimum 1 s).
- Track `#EXT-X-MEDIA-SEQUENCE` to identify new segments since the last poll.
- Timestamp derivation:
  - `#EXT-X-PROGRAM-DATE-TIME` gives the wall-clock time of the first segment in the window.
  - Each subsequent segment's timestamp = programDateTime + sum of preceding `#EXTINF` durations.
  - If `#EXT-X-PROGRAM-DATE-TIME` is absent, fall back to `Date.now()` at fetch time.
- For each new segment: GET the URL, collect body as a `Buffer`, emit `segment`.
- Handles playlist gaps (stream offline) by retrying with exponential backoff.

### Events

```js
fetcher.on('segment', ({ buffer, timestamp, duration, url, index }))
fetcher.on('error',   ({ error }))
fetcher.on('stopped', ())
```

---

## SttManager

**File:** `packages/plugins/lcyt-rtmp/src/stt-manager.js`

Singleton created by `initRtmpControl`. Manages one STT session per API key.

### Public API

```js
await sttManager.start(apiKey, {
  provider,     // 'google' | 'whisper_http' | 'openai'
  language,     // BCP-47 (default: 'en-US')
  audioSource,  // 'hls' | 'rtmp' | 'whep'  (default: 'hls')
  streamKey,    // MediaMTX path (default: apiKey)
})

await sttManager.stop(apiKey)
sttManager.isRunning(apiKey)
sttManager.getStatus(apiKey)  // → { running, provider, language, startedAt, segmentsSent, lastTranscript }
await sttManager.stopAll()
```

### Events

```js
sttManager.on('transcript', ({ apiKey, text, confidence, timestamp, provider }))
sttManager.on('error',      ({ apiKey, error }))
sttManager.on('stopped',    ({ apiKey }))
```

---

## STT Provider Adapters

**Directory:** `packages/plugins/lcyt-rtmp/src/stt-adapters/`

Common interface:

```js
class SttAdapter extends EventEmitter {
  async start({ language, ...opts }) {}

  // HLS path: called once per fMP4 segment.
  async sendSegment(buffer, { timestamp, duration }) {}

  // ffmpeg fallback path (RTMP/WHEP): called with raw PCM chunks (s16le 16kHz mono).
  write(pcmChunk) {}

  async stop() {}

  // Events:
  // 'transcript' { text, confidence, timestamp }
  // 'error'      { error }
}
```

### GoogleSttAdapter

[Phase 1] Google Cloud Speech-to-Text v1. Supports Finnish (`fi-FI`) and 125+ languages.

**HLS path:** POST the fMP4 segment buffer to `https://speech.googleapis.com/v1/speech:recognize` as base64-encoded audio with `encoding: MP4` (or `encoding: LINEAR16` after a ffmpeg-free remux is confirmed unnecessary — to be verified against the API). The `#EXT-X-PROGRAM-DATE-TIME`-derived timestamp is used directly.

**gRPC streaming mode** (Phase 4): bidirectional stream via `@google-cloud/speech`; auto-restarts at the 5-minute API limit.

| Variable | Default | Purpose |
|---|---|---|
| `GOOGLE_APPLICATION_CREDENTIALS` | — | Service account JSON path |
| `GOOGLE_STT_KEY` | — | API key for REST fallback |
| `GOOGLE_STT_MODE` | `rest` | `rest` or `grpc` |

`@google-cloud/speech` is an optional peer dependency; the adapter fails with a clear message if not installed.

### WhisperHttpAdapter

[Phase 2] Connects to a running [whisper.cpp HTTP server](https://github.com/ggerganov/whisper.cpp/tree/master/examples/server).

**HLS path:** POST the fMP4 segment buffer to `{WHISPER_HTTP_URL}/inference` as `multipart/form-data` with filename `segment.mp4`. whisper.cpp accepts MP4 directly. Uses playlist timestamp.

**ffmpeg fallback path:** accumulate PCM → encode as WAV in memory → POST.

| Variable | Default | Purpose |
|---|---|---|
| `WHISPER_HTTP_URL` | — | whisper.cpp server URL |
| `WHISPER_HTTP_MODEL` | (server default) | Model name (optional) |

### OpenAiAdapter

[Phase 2] OpenAI Whisper API or any compatible endpoint (local whisper-openai-server, Ollama, Azure).

**HLS path:** POST the fMP4 segment buffer to `/v1/audio/transcriptions` as `multipart/form-data` with filename `segment.mp4`. Uses playlist timestamp.

| Variable | Default | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | — | API key |
| `OPENAI_STT_MODEL` | `whisper-1` | Model name |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | Override for local/Azure endpoints |

---

## Transcript → Caption Delivery

```js
// SttManager._onTranscript()
const session = store.getByApiKey(apiKey)
if (!session) return

const text = transcript.text.trim()
if (!text) return

session._sendQueue.add(async () => {
  const seq = ++session.sequence
  await fanOutToTargets(session, seq, text, transcript.timestamp, {})
})
```

Reuses `_sendQueue` to keep sequence numbers monotonic alongside any concurrent browser-originated captions.

---

## Database

New table `stt_config` added to `packages/plugins/lcyt-rtmp/src/db.js` migrations:

```sql
CREATE TABLE IF NOT EXISTS stt_config (
  api_key      TEXT PRIMARY KEY,
  provider     TEXT NOT NULL DEFAULT 'google',
  language     TEXT NOT NULL DEFAULT 'en-US',
  audio_source TEXT NOT NULL DEFAULT 'hls',
  stream_key   TEXT,         -- NULL → use api_key as the MediaMTX path
  auto_start   INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  updated_at   INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);
```

---

## API Routes

Mounted at `/stt` in `packages/lcyt-backend/src/routes/stt.js`. All endpoints require the standard session Bearer token.

```
GET  /stt/status    — current STT state for the authenticated API key
POST /stt/start     — start STT (body: { provider?, language?, audioSource?, streamKey? })
POST /stt/stop      — stop STT
GET  /stt/events    — SSE stream of transcript events (Bearer or ?token=)
GET  /stt/config    — get per-key STT config from DB
PUT  /stt/config    — update per-key STT config
```

### SSE events (`GET /stt/events`)

| Event | Payload |
|---|---|
| `connected` | `{ apiKey, provider, language }` |
| `transcript` | `{ text, confidence, timestamp, provider }` |
| `stt_started` | `{ provider, language, audioSource }` |
| `stt_stopped` | `{ apiKey }` |
| `stt_error` | `{ error }` |

---

## Auto-start on Publish

The `on_publish` RTMP callback is extended:

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
| `STT_PROVIDER` | `google` | Default provider: `google` \| `whisper_http` \| `openai` |
| `STT_DEFAULT_LANGUAGE` | `en-US` | Default recognition language (BCP-47) |
| `STT_AUDIO_SOURCE` | `hls` | Default audio source: `hls` \| `rtmp` \| `whep` |
| `GOOGLE_APPLICATION_CREDENTIALS` | — | Google service account JSON path |
| `GOOGLE_STT_KEY` | — | Google API key (REST) |
| `GOOGLE_STT_MODE` | `rest` | `rest` or `grpc` |
| `WHISPER_HTTP_URL` | — | whisper.cpp HTTP server URL |
| `WHISPER_HTTP_MODEL` | — | Whisper model name (optional) |
| `OPENAI_API_KEY` | — | OpenAI API key |
| `OPENAI_STT_MODEL` | `whisper-1` | Model name |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | OpenAI-compatible base URL |

---

## Phases

---

### Phase 1 — HLS + Google STT

**Goal:** Headless captioning from any MediaMTX stream using Google Cloud STT. No ffmpeg in the hot path.

**Backend:**
- `HlsSegmentFetcher`: playlist poll, EXT-X-MEDIA-SEQUENCE tracking, EXT-X-PROGRAM-DATE-TIME timestamp derivation, segment buffer fetch.
- `SttManager`: wires fetcher → adapter → transcript → `_sendQueue`.
- `GoogleSttAdapter`: REST mode, fMP4 segment POST, Finnish and multilingual support.
- DB migration for `stt_config`.
- `/stt` routes: `start`, `stop`, `status`, `config`.
- `on_publish` / `on_publish_done` auto-start hook.

**UI (lcyt-web):**
- `StatusBar`: small server-STT chip — shows provider and language when active (e.g. "STT: google / fi-FI"), greyed out when inactive. No new page or modal.

---

### Phase 2 — Additional STT providers

**Goal:** Support local/self-hosted STT without a Google dependency.

**Backend:**
- `WhisperHttpAdapter`: fMP4 segment POST to whisper.cpp HTTP server.
- `OpenAiAdapter`: fMP4 segment POST to any OpenAI-compatible `/v1/audio/transcriptions` endpoint.

**UI (lcyt-web):**
- Server STT section in **Settings modal** (or `EmbedSettingsPage` CC tab):
  - Provider dropdown: Google / Whisper / OpenAI-compatible.
  - Language selector (reuse existing BCP-47 list from `sttConfig.js`).
  - Auto-start toggle.
  - Start / Stop button (if session is active).
- StatusBar chip links/opens to this settings section.

---

### Phase 3 — RTMP / WHEP fallback

**Goal:** Support audio sources where HLS is not available.

**Backend:**
- `SttManager` ffmpeg PCM pipe path for `audioSource: 'rtmp'` and `audioSource: 'whep'`.
- WHEP requires ffmpeg ≥ 6.1; probe version on startup, log warning if unavailable.
- All three adapters implement `write(pcmChunk)` for the fallback path, with internal silence-based buffering (energy threshold) and a max chunk duration cap.
- DB: add `audio_source` selector and expose via `PUT /stt/config`.

**UI (lcyt-web):**
- Audio source selector in the Server STT settings section: HLS / RTMP / WHEP.
- Show a warning badge next to WHEP if the backend reports ffmpeg < 6.1.

---

### Phase 4 — gRPC streaming + quality controls

**Goal:** Lower recognition latency and filter low-quality output.

**Backend:**
- `GoogleSttAdapter` gRPC streaming mode (`GOOGLE_STT_MODE=grpc`): bidirectional stream, interim results discarded, finals emitted. Auto-restart at 5-minute API limit.
- Confidence threshold filtering: configurable minimum confidence; segments below threshold are discarded and logged.
- Empty-segment skip: lightweight energy check (RMS of decoded PCM, or segment file-size floor) before sending to the API, to avoid billing for silence.
- Punctuation normalisation for providers that omit it.
- `GET /stt/events` SSE endpoint for live transcript monitoring.

**UI (lcyt-web):**
- Live transcript panel (collapsible, in `SentPanel` area or a new tab) fed by `GET /stt/events` — shows rolling server-STT transcripts with timestamps.
- Confidence threshold slider in settings.
- Mode indicator in StatusBar chip: "STT: google/gRPC / fi-FI".

---

## Open Questions

1. **Google STT fMP4 encoding label**: The REST API `encoding` field does not list `MP4` as a named value. In practice, fMP4 audio (AAC in MP4 container) is submitted with `encoding: MP4A` or by omitting the encoding field and letting the API auto-detect. Needs a quick test against the live API to confirm the correct value before Phase 1 ships.

2. **Simultaneous browser + server STT**: Both write into the same `_sendQueue` — safe for ordering but could interleave output. A session flag `serverSttActive` could block browser sends while server STT is running. Defer decision to Phase 1 implementation.

3. **streamKey vs apiKey**: `stt_config.stream_key` is nullable; when null, `apiKey` is used as the MediaMTX HLS path. This matches the existing `RadioManager` convention.

4. **Google gRPC optional dep**: `@google-cloud/speech` pulls in native gRPC bindings. Dynamic import with a clear "install @google-cloud/speech to use grpc mode" error. Only required for Phase 4.

---

## Todo

### Phase 1 — HLS + Google STT

**Backend**
- [ ] Add `hlsVariant: fmp4` note to `docker/mediamtx.yml` and deployment docs
- [ ] `packages/plugins/lcyt-rtmp/src/hls-segment-fetcher.js` — HlsSegmentFetcher class
- [ ] `packages/plugins/lcyt-rtmp/src/stt-adapters/google-stt.js` — GoogleSttAdapter (REST, fMP4)
- [ ] `packages/plugins/lcyt-rtmp/src/stt-manager.js` — SttManager (HLS path only)
- [ ] `packages/plugins/lcyt-rtmp/src/db.js` — add `stt_config` migration
- [ ] `packages/plugins/lcyt-rtmp/src/api.js` — export `sttManager` from `initRtmpControl`
- [ ] `packages/lcyt-backend/src/routes/stt.js` — `/stt` Express router (start, stop, status, config)
- [ ] `packages/lcyt-backend/src/server.js` — mount `/stt` router, inject `sttManager`
- [ ] `packages/lcyt-backend/src/routes/radio.js` — `on_publish` / `on_publish_done` auto-start hooks
- [ ] Verify Google STT fMP4 encoding label against live API (see open question 1)

**Tests**
- [ ] `HlsSegmentFetcher` unit tests: mock HTTP, playlist parsing, timestamp derivation, new-segment detection, retry on gap
- [ ] `GoogleSttAdapter` unit tests: mock Google STT API, segment POST, transcript event
- [ ] `SttManager` integration tests: start/stop, `_sendQueue` delivery, auto-start hook
- [ ] `/stt` route tests: start/stop/status/config CRUD, auth

**UI**
- [ ] `packages/lcyt-web/src/components/StatusBar.jsx` — server-STT chip (provider / language / active state)

---

### Phase 2 — Additional STT providers

**Backend**
- [ ] `packages/plugins/lcyt-rtmp/src/stt-adapters/whisper-http.js` — WhisperHttpAdapter (fMP4 HLS path)
- [ ] `packages/plugins/lcyt-rtmp/src/stt-adapters/openai.js` — OpenAiAdapter (fMP4 HLS path)
- [ ] `SttManager` — add `whisper_http` and `openai` to provider dispatch

**Tests**
- [ ] `WhisperHttpAdapter` unit tests: mock whisper.cpp server, multipart POST, transcript
- [ ] `OpenAiAdapter` unit tests: mock OpenAI endpoint, multipart POST, transcript

**UI**
- [ ] Server STT settings section in Settings modal: provider dropdown, language selector, auto-start toggle, Start/Stop button
- [ ] `StatusBar` chip links to settings section

---

### Phase 3 — RTMP / WHEP fallback

**Backend**
- [ ] `SttManager` — ffmpeg PCM pipe path for `audioSource: 'rtmp'` and `'whep'`
- [ ] All three adapters — implement `write(pcmChunk)` + internal silence-buffer logic
- [ ] Probe ffmpeg version on `SttManager` init; warn if < 6.1 (WHEP unavailable)
- [ ] DB: expose `audio_source` field via `PUT /stt/config`

**Tests**
- [ ] `SttManager` RTMP/WHEP path: mock ffmpeg runner, PCM chunk flow, stop/cleanup

**UI**
- [ ] Audio source selector in Server STT settings: HLS / RTMP / WHEP
- [ ] Warning badge next to WHEP if backend reports ffmpeg < 6.1

---

### Phase 4 — gRPC streaming + quality controls

**Backend**
- [ ] `GoogleSttAdapter` — gRPC streaming mode (`GOOGLE_STT_MODE=grpc`), auto-restart at 5 min limit
- [ ] Confidence threshold filtering (configurable minimum; discard + log below-threshold segments)
- [ ] Empty-segment skip (energy / file-size floor check before API call)
- [ ] Punctuation normalisation helper for providers that omit it
- [ ] `GET /stt/events` SSE endpoint

**Tests**
- [ ] `GoogleSttAdapter` gRPC tests: mock `@google-cloud/speech` client, streaming flow, auto-restart
- [ ] SSE `/stt/events` route tests

**UI**
- [ ] Live transcript panel in lcyt-web (fed by `GET /stt/events`): rolling server-STT transcripts with timestamps, collapsible
- [ ] Confidence threshold slider in Server STT settings
- [ ] StatusBar chip: show mode (rest/gRPC) alongside provider and language
