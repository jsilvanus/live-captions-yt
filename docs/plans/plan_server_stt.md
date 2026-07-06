---
id: plan/server-stt
title: "Server-side Speech-to-Text (STT)"
status: implemented
summary: "Phases 1–4 fully implemented and verified against the actual code (2026-07-06 — the Todo checklist below was badly stale before this pass, showing only Phase 1 checked when everything through Phase 4 was already built): HlsSegmentFetcher, GoogleSttAdapter (REST + gRPC with auto-restart), WhisperHttpAdapter, OpenAiAdapter, ffmpeg RTMP/WHEP PCM fallback, confidence filtering, empty-segment skip, punctuation normalisation, /stt/* routes, StatusBar STT chip (with mode), and a live server-transcript panel built into AudioPanel.jsx. 835 lcyt-backend + 107 lcyt-rtmp tests pass. Only Phase 5 (multi-language source/target routing, drafted 2026-07-06) remains — not yet implemented."
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

### Phase 5 — Multi-language source/target routing

**Added 2026-07-06, not yet implemented.** Goal: let an operator quickly switch the active *source* (recognition) language from a predefined list during a live production, and independently route each *target* (translation) language to a specific delivery destination — including a destination dedicated to a particular screen/monitor — while keeping today's YouTube "original on one line, translation on the next" behavior available per destination rather than as one global flag. Applies identically whether the transcript comes from server-side STT (this doc) or the existing browser-based STT (`plan_stt.md`'s WebKit/Cloud engines) — **this phase does not make STT server-only**; both origins are expected to keep working side by side.

**Builds on, does not replace**, the already-implemented `translation_targets` / `translation_vendor_config` / `caption_targets` tables (`plan_selfservice_config_backend.md` §1) — no new "languages" table from scratch, two additive columns plus a real fan-out pipeline change.

> Note found while drafting this: `plan_selfservice_config_backend.md`'s "Implementation status" note currently says the Languages/translation card has no frontend consumer yet ("still the pre-existing plain link-out card"). That's now stale on both counts — a real Languages Setup Hub card exists, but as of this writing it was built against the old **localStorage** `lib/translationConfig.js` instead of the already-implemented `GET/PUT /translation/config*` routes described in that same doc. That's a bug to fix independently of this phase, tracked in `docs/TODO.md`/a follow-up session, not folded into the schema changes below.

#### Source language: predefined list + fast switch

Today `stt_config.language` is a single free-text BCP-47 string (`packages/plugins/lcyt-rtmp/src/db.js`), edited via `SttPanel`'s plain text input — one language, no predefined list, no quick-switch affordance; changing it means opening the full STT settings dialog.

- New `stt_source_languages` table: `{ api_key, lang (BCP-47), label?, sort_order }` — the project's curated list of languages the operator expects to switch between during a service/event (e.g. "usually English, sometimes Finnish for the visiting choir"). A table, not a JSON column, for consistency with `translation_targets`'s existing list-per-key pattern and to allow per-entry labels/ordering.
- `stt_config.language` keeps its existing shape and meaning — the single **currently active** source language. Nothing about `SttManager`'s or the adapters' consumption of it changes.
- New lightweight endpoint, distinct from the full `PUT /stt/config`: `POST /stt/config/source-language { lang }` — validates `lang` is in the project's predefined list, updates `stt_config.language`, and restarts recognition with the new language if STT is currently running (Google/Whisper/OpenAI all take `language` as a start-time parameter, not a live one). This is the shape a live quick-toggle control calls — a full settings round-trip is the wrong tool for "the choir just switched to Finnish, flip it now."
- Applies to browser STT too: `AudioPanel`'s own language selector should read from this same server-persisted predefined list once it exists, rather than maintaining its own separate one — one shared list, two recognition engines.

#### Target languages: route to a specific delivery destination

Confirmed by reading the actual fan-out code (`packages/lcyt-backend/src/routes/captions.js` + `src/caption-files.js`'s `composeCaptionText`): today exactly **one** language is embedded in live caption delivery at a time — whichever enabled `translation_targets` row has `target='captions'` — and `composeCaptionText(text, captionLang, translations, showOriginal)` produces one string that the `extraTargets` fan-out loop sends *identically* to every configured `caption_targets` row (YouTube, generic, and viewer targets alike). Other translation entries (`target='file'`/`'backend-file'`) do already get their own per-language output, but only as saved files, never as live delivery to a specific destination.

- Extend `translation_targets`: add a nullable `caption_target_id TEXT REFERENCES caption_targets(id) ON DELETE SET NULL`. When set, that translation row is routed to *that specific* caption target's live delivery instead of the shared default — e.g. a Spanish `translation_targets` row with `caption_target_id` pointing at a `viewer`-type caption target whose URL is displayed on a side-stage monitor, independent of whatever the main YouTube stream is showing.
- `target`'s existing enum (`'captions'|'file'|'backend-file'`) keeps its current meaning for rows with no `caption_target_id` set — fully backward compatible, no change to any existing row's behavior.
- **Per-destination original+translation composition, generalized:** `show_original` is currently one global flag on `translation_vendor_config`, applied to whichever single language is embedded everywhere. Once different languages can each go to a different destination, "original above translation" needs to be a per-routed-target choice — e.g. the English-original YouTube target might want it on (bilingual captions) while a dedicated Spanish viewer monitor wants translation-only. Move `show_original` from `translation_vendor_config` (global) onto each `translation_targets` row, defaulting existing rows to the prior global value on migration.
- **Fan-out change in `captions.js`:** for each `caption_targets` row, resolve whether an enabled `translation_targets` row has `caption_target_id` pointing at it; if so, compose *that* row's own text (`composeCaptionText(text, thatRow.lang, translations, thatRow.showOriginal)`) instead of the shared default before sending. Targets with no dedicated translation-target keep receiving today's default composed text, unchanged.

#### Server-side translation for server-STT transcripts

Translation happens entirely client-side today: `lib/translate.js` (called from `AudioPanel.jsx`) computes the full `translations: { lang: text }` map in the browser and sends it *already translated* as part of the caption payload the backend receives. `SttManager`'s transcript pipeline (`_onTranscript` → `fanOutToTargets`) has no equivalent step — server-STT transcripts arrive as plain `{ text, timestamp }` with no translation map, and nothing in that path could add one today.

- New server-side translation call, reusing the same vendor set conceptually (MyMemory/Google/DeepL/LibreTranslate) but invoked from Node rather than the browser — `translation_vendor_config` already stores the project's chosen vendor + credentials server-side, so the config half of this exists; only the actual outbound HTTP call needs a server-side equivalent of `lib/translate.js`. Module placement (`lcyt-rtmp`, next to `SttManager`, vs. `lcyt-agent`, which already owns other server-side external-API integration) is an open question below, not a re-derivation of the client file.
- `SttManager._onTranscript`: before calling `fanOutToTargets`, if any enabled `translation_targets` rows exist for the project, translate the transcript into each row's `lang` and build the same `translations: { lang: text }` shape the browser path already produces. The (possibly per-target-aware, per the section above) fan-out logic then behaves identically regardless of which STT origin produced the text.
- This explicitly does not replace or disable browser-based STT — `plan_stt.md`'s WebKit/Cloud engines are unaffected and keep computing their own client-side translations exactly as today. This phase only brings the server-STT path to the same translation capability, so choosing server-side STT doesn't mean losing multi-language output.

**UI (lcyt-web):**
- StatusBar (or wherever the live quick-toggle control ends up) gets a compact source-language switcher reading the predefined list, calling `POST /stt/config/source-language` — separate from, and faster than, opening Setup Hub's STT card.
- The Languages Setup Hub card (once fixed to use `/translation/config*`, see the note above) gains a destination picker per target-language row: the existing `'captions'|'file'|'backend-file'` choices, plus "a specific caption target" listing the project's configured `caption_targets` by name — and a per-row `showOriginal` toggle replacing today's single global one.

---

## Open Questions

1. **Google STT fMP4 encoding label**: The REST API `encoding` field does not list `MP4` as a named value. In practice, fMP4 audio (AAC in MP4 container) is submitted with `encoding: MP4A` or by omitting the encoding field and letting the API auto-detect. Needs a quick test against the live API to confirm the correct value before Phase 1 ships.

2. **Simultaneous browser + server STT**: Both write into the same `_sendQueue` — safe for ordering but could interleave output. A session flag `serverSttActive` could block browser sends while server STT is running. Defer decision to Phase 1 implementation.

3. **streamKey vs apiKey**: `stt_config.stream_key` is nullable; when null, `apiKey` is used as the MediaMTX HLS path. This matches the existing `RadioManager` convention.

4. **Google gRPC optional dep**: `@google-cloud/speech` pulls in native gRPC bindings. Dynamic import with a clear "install @google-cloud/speech to use grpc mode" error. Only required for Phase 4.

5. **Predefined source-language list storage** (Phase 5): separate `stt_source_languages` table vs. a JSON array column on `stt_config`. Leaning table, per the reasoning in Phase 5 above — revisit if the list turns out to need no per-entry metadata beyond a bare code.

6. **Server-side translation module placement** (Phase 5): `lcyt-rtmp` (co-located with `SttManager`, but a media-relay plugin making external translation-vendor HTTP calls is a bit of a reach) vs. `lcyt-agent` (already the home for server-side external API integration, currently LLM/embedding-focused, not translation-vendor-focused) vs. a new small shared module. Decide before implementation starts.

7. **Restart-on-source-switch cost** (Phase 5): switching the active source language mid-show restarts the STT adapter (all three providers take `language` at start time only). Confirm the gap is acceptable for live use — likely yes, given segment-based recognition already has natural pauses between chunks — or find a lower-disruption path if not.

8. **`caption_target_id` cascade behavior** (Phase 5): recommend `ON DELETE SET NULL` on `translation_targets.caption_target_id` — deleting a caption target should fall a translation row back to default routing, not silently delete the translation config itself.

---

## Todo

### Phase 1 — HLS + Google STT

**Backend**
- [x] `packages/plugins/lcyt-rtmp/src/hls-segment-fetcher.js` — HlsSegmentFetcher class
- [x] `packages/plugins/lcyt-rtmp/src/stt-adapters/google-stt.js` — GoogleSttAdapter (REST, fMP4)
- [x] `packages/plugins/lcyt-rtmp/src/stt-manager.js` — SttManager (HLS path only)
- [x] `packages/plugins/lcyt-rtmp/src/db.js` — add `stt_config` migration + `getSttConfig`/`setSttConfig` helpers
- [x] `packages/plugins/lcyt-rtmp/src/api.js` — export `sttManager` + `getSttConfig`/`setSttConfig` from `initRtmpControl`
- [x] `packages/lcyt-backend/src/routes/stt.js` — `/stt` Express router (start, stop, status, config, events)
- [x] `packages/lcyt-backend/src/server.js` — mount `/stt` router, inject `sttManager`
- [x] `packages/plugins/lcyt-rtmp/src/routes/radio.js` — `on_publish` / `on_publish_done` auto-start hooks
- [x] Add `hlsVariant: fmp4` note to `docker/mediamtx.yml` and deployment docs
- [ ] Verify Google STT fMP4 encoding label against live API (see open question 1)

**Tests**
- [x] `packages/plugins/lcyt-rtmp/test/hls-segment-fetcher.test.js` — 8 tests
- [x] `packages/plugins/lcyt-rtmp/test/google-stt.test.js` — 8 tests
- [x] `packages/plugins/lcyt-rtmp/test/stt-manager.test.js` — 12 tests
- [x] `packages/lcyt-backend/test/stt.test.js` — 15 tests (start/stop/status/config CRUD, SSE events, auth)

**UI**
- [x] `packages/lcyt-web/src/components/StatusBar.jsx` — server-STT chip (provider / language / active state, polls every 10 s)
- [x] `packages/lcyt-web/src/hooks/useSession.js` — `getSttStatus()` method added
- [x] `packages/lcyt-web/src/styles/components.css` — `.status-bar__stt-chip` styles

---

### Phase 2 — Additional STT providers

**Backend**
- [x] `packages/plugins/lcyt-rtmp/src/stt-adapters/whisper-http.js` — WhisperHttpAdapter (fMP4 HLS path)
- [x] `packages/plugins/lcyt-rtmp/src/stt-adapters/openai.js` — OpenAiAdapter (fMP4 HLS path)
- [x] `SttManager` — provider dispatch on `google`/`whisper_http`/`openai`

**Tests**
- [x] `WhisperHttpAdapter` unit tests (part of the rtmp plugin's passing suite)
- [x] `packages/plugins/lcyt-rtmp/test/openai-stt.test.js`

**UI**
- [x] `SttPanel.jsx`: provider dropdown, language field — config-only (verified, no separate
      auto-start toggle or Start/Stop button; STT actually starts via the
      `on_publish`/`on_publish_done` RTMP hooks per the Auto-start section
      above, and the Setup Hub `SttSection` card just edits/saves config —
      a simpler realization of this item than originally written, not a gap)
- [x] `StatusBar` chip (shows provider/mode/language; no separate settings link — the Setup Hub STT card is the config surface)

---

### Phase 3 — RTMP / WHEP fallback

**Backend**
- [x] `SttManager` — ffmpeg PCM pipe path for `audioSource: 'rtmp'` and `'whep'`, piping to `adapter.write()`
- [x] ffmpeg version probe on `SttManager` init; warns if < 6.1 (WHEP unavailable)
- [x] `audio_source` field on `stt_config`, exposed via `PUT /stt/config`

**Tests**
- [x] `packages/plugins/lcyt-rtmp/test/stt-manager-rtmp.test.js`

**UI**
- [x] Audio source selector in `SttPanel.jsx` (HLS/RTMP/WHEP)
- [ ] Warning badge next to WHEP if backend reports ffmpeg < 6.1 — backend already reports `ffmpegVersion`/`whepAvailable` via `getStatus()`; unconfirmed whether the frontend surfaces it as a visible badge yet

---

### Phase 4 — gRPC streaming + quality controls

**Backend**
- [x] `GoogleSttAdapter` — gRPC streaming mode (`GOOGLE_STT_MODE=grpc`), proactive auto-restart at 4.5 min
- [x] Confidence threshold filtering (`confidenceThreshold` plumbed through `SttManager`/adapters)
- [x] Empty-segment skip (minimum segment byte-size check in `google-stt.js`)
- [x] Punctuation normalisation helper (`google-stt.js`)
- [x] `GET /stt/events` SSE endpoint (mounted, consumed by `AudioPanel.jsx`)

**Tests**
- [x] `packages/plugins/lcyt-rtmp/test/google-stt.test.js` covers gRPC/quality-control paths
- [x] `packages/lcyt-backend/test/stt.test.js` + `test/integration/stt-integration.test.js` cover SSE `/stt/events`

**UI**
- [x] Live transcript panel — built into `AudioPanel.jsx`'s `engine === 'server'` mode (`serverTranscripts` state, `.server-transcript-panel`), not a separate component as originally sketched, but the same capability
- [x] Confidence threshold slider in `SttPanel.jsx`
- [x] StatusBar chip shows mode (e.g. `STT: google/gRPC / fi-FI`)

---

### Phase 5 — Multi-language source/target routing

**Backend**
- [ ] Fix `LanguagesManager`/`LanguagesPage.jsx` to use `GET/PUT /translation/config*` instead of localStorage `lib/translationConfig.js` (independent bug, tracked here since Phase 5's UI work depends on it either way)
- [ ] `stt_source_languages` table + CRUD (or JSON column, per Open Question 5) — predefined per-project source-language list
- [ ] `POST /stt/config/source-language { lang }` — fast active-language switch, validates against the predefined list, restarts STT if running
- [ ] `translation_targets`: add nullable `caption_target_id`, migrate `show_original` from `translation_vendor_config` onto each row
- [ ] `packages/lcyt-backend/src/routes/captions.js` fan-out: per-`caption_targets`-row resolution of a routed `translation_targets` entry before composing/sending
- [ ] Server-side translation module (placement per Open Question 6) + wire into `SttManager._onTranscript` before `fanOutToTargets`

**Tests**
- [ ] `translation-config.js` — `caption_target_id`/per-row `show_original` CRUD, `ON DELETE SET NULL` behavior
- [ ] `captions.js` fan-out — per-target routed translation composition, unrouted targets keep default behavior
- [ ] Server-side translation module — mocked vendor HTTP calls, `SttManager` integration

**UI**
- [ ] StatusBar (or live operate surface) source-language quick-switcher
- [ ] Languages Setup Hub card: per-target-language destination picker (caption target list) + per-row `showOriginal` toggle
- [ ] `AudioPanel`'s browser-STT language selector reads the same predefined source-language list
