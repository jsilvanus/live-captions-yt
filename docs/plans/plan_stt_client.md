---
id: plan/stt-client
title: "Client-side Speech-to-Text (STT)"
status: implemented
summary: "Browser-based speech capture in lcyt-web: WebKit (Web Speech API) and Google Cloud STT engines, client-side VAD, translation pipeline, MCP speech sessions, and embed widget."
---

# Speech-to-Text (STT) Integration

**Scope:** `packages/lcyt-web` — `AudioPanel`, `SpeechCapturePage`, `EmbedAudioPage`; `packages/lcyt-mcp-sse` — speech session routes.

---

## Overview

All STT happens in the browser. The backend receives final transcript text — it is never involved in audio capture or recognition. Two recognition engines are available; the user picks one in the CC → STT settings tab.

| Engine | How it works | Credentials needed |
|---|---|---|
| **webkit** (default) | Native browser `SpeechRecognition` API (Chrome, Edge, Safari) | None |
| **cloud** | `MediaRecorder` → 5-second WEBM\_OPUS chunks → Google Cloud Speech-to-Text REST API | Google OAuth 2.0 token |

Engine choice and all STT settings persist in `localStorage`.

---

## Key Source Files

| File | Purpose |
|---|---|
| `src/components/AudioPanel.jsx` | Main STT component — mic capture, recognition, metering, translation, sending |
| `src/lib/sttConfig.js` | STT preference helpers (engine, language, cloud config, VAD flag) |
| `src/lib/translate.js` | Translation engine dispatch (`translateText`, `translateAll`) |
| `src/lib/translationConfig.js` | Translation target config helpers (localStorage) |
| `src/lib/googleCredential.js` | Google OAuth2 token fetch and caching |
| `src/contexts/AudioContext.jsx` | Shared audio state + imperative handles (toggle, utteranceEndClick) |
| `src/components/SpeechCapturePage.jsx` | Standalone MCP speech session page (`/mcp/:sessionId`) |
| `src/components/EmbedAudioPage.jsx` | Embeddable mic widget (`/embed/audio`) |
| `packages/lcyt-mcp-sse/src/speech.js` | Server-side STT chunk receiver for MCP sessions |

---

## AudioPanel

`AudioPanel` is the central component. It is a `forwardRef` component (~950 lines) that manages the full lifecycle from microphone access to caption delivery.

### WebKit engine

```
SpeechRecognition (continuous, interimResults: true except on mobile)
  onresult
    ├─ interim text → setInterimText()   [UI display only]
    └─ final text   → pushFinalTranscript(text, utteranceStartRef)
  onend
    └─ restart after 100 ms              [survives silence pauses]
  onerror
    └─ 'no-speech' silently ignored
```

`lastFinalRef` deduplicates rapid back-to-back `onresult` finals (mobile WebKit issue).

### Cloud engine

```
getUserMedia({ audio: true })
  └─ MediaRecorder (5 s chunks, WEBM_OPUS)
       └─ blobToBase64()
            └─ POST speech.googleapis.com/v1/speech:recognize
                  config: { encoding: WEBM_OPUS, sampleRateHertz: 48000,
                             languageCode, model, enableAutomaticPunctuation,
                             profanityFilter }
                  └─ results[0].alternatives[0].transcript
                       └─ pushFinalTranscript()
```

Chunks are scheduled recursively (`scheduleNextChunk`). The OAuth token is fetched once and cached in `oauthRef` until expiry.

### Utterance lifecycle

1. First interim or final text arrives → `utteranceStartRef` captures an ISO timestamp (`YYYY-MM-DDTHH:MM:SS.mmm`, no trailing Z).
2. Optional auto-end timer shows a countdown overlay; expiry calls `recognition.stop()`.
3. "End utterance" button forces finalization immediately with a brief flash visual.
4. `pushFinalTranscript(text, ts)` trims the text, runs translations (if enabled), then calls `sendTranscript`.

### Audio metering

Web Audio API pipeline: `MediaStream → AudioContext → AnalyserNode → getFloatTimeDomainData()`. RMS energy is drawn onto a canvas element at animation-frame rate.

### Client-side VAD (optional)

Enabled by `lcyt:client-vad` in localStorage. A 50 ms polling loop reads the analyser; sustained silence beyond `lcyt:client-vad-silence-ms` (default 500 ms) triggers `recognition.stop()`, which auto-restarts after a 1 s grace period. Threshold is configurable via `lcyt:client-vad-threshold` (default 0.01).

### Imperative handle (forwardRef)

| Method | Effect |
|---|---|
| `toggle()` | Start / stop listening |
| `holdStart(e)` | Hold-to-steal mic lock (activates after 2 s) |
| `holdEnd()` | Release soft mic lock |
| `holdSpeakStart(e)` | Hold-to-speak (press to listen) |
| `holdSpeakEnd()` | Release to stop |
| `utteranceEndClick()` | Force-end current utterance |

### Soft mic lock (collaborative)

`AudioPanel` uses `session.claimMic()` / `session.releaseMic()` and watches `session.micHolder`. When another client steals the lock, the component auto-stops listening.

---

## STT Configuration (`sttConfig.js`)

All values stored in `localStorage`:

| Key | Default | Description |
|---|---|---|
| `lcyt-stt-engine` | `webkit` | Active engine (`webkit` or `cloud`) |
| `lcyt-stt-lang` | `en-US` | BCP-47 recognition language |
| `lcyt-stt-config` | `{}` | Google Cloud options: `{ model, punctuation, profanity }` |
| `lcyt-stt-local` | `false` | Client-side VAD enabled |

Supported languages: 30 BCP-47 locales (`en-US`, `en-GB`, `es-ES`, `es-MX`, `fr-FR`, `de-DE`, `it-IT`, `pt-BR`, `pt-PT`, `ja-JP`, `ko-KR`, `zh-CN`, `zh-TW`, `ar-SA`, `hi-IN`, `ru-RU`, `nl-NL`, `pl-PL`, `sv-SE`, `da-DK`, `fi-FI`, `nb-NO`, `tr-TR`, `id-ID`, `th-TH`, `vi-VN`, `uk-UA`, `cs-CZ`, `ro-RO`, `hu-HU`).

Google Cloud models: `latest_long` (default), `latest_short`, `telephony`, `video`, `medical_dictation`.

---

## Translation Pipeline

After a final transcript is produced, `translateAll()` runs all enabled translation targets in parallel (`Promise.allSettled`).

### Vendors

| Vendor | Auth | Notes |
|---|---|---|
| **MyMemory** | None (free) | `api.mymemory.translated.net/get` |
| **Google Cloud Translate** | API key | `translation.googleapis.com/v2/translate` |
| **DeepL** | API key (free or paid tier) | `api-free.deepl.com` or `api.deepl.com` |
| **LibreTranslate** | Optional API key | Configurable base URL (self-hosted or SAAS) |

`toLang2()` strips region codes to 2-char ISO 639-1 where APIs require it. Translation is skipped when source and target resolve to the same base language.

### Target types

| Target | Behaviour |
|---|---|
| `captions` | Translated text injected alongside original caption text sent to YouTube |
| `file` | Appended to a local file via the File System Access API (VTT or YouTube format) |
| `backend-file` | Forwarded to the backend for server-side `/file` storage |

The `captionLang` (the single `captions`-type target language) and `showOriginal` flag are passed through to `session.send()`.

---

## Send Pipeline

```
pushFinalTranscript(text, utteranceStart)
  └─ translateAll()
       └─ sendTranscript(text, timestamp, translationsMap, captionLang)
            ├─ batchInterval > 0 → session.construct(text, timestamp, opts)
            └─ batchInterval = 0 → session.send(text, timestamp, opts)
```

`timestamp` is `utteranceStart` adjusted by:
- User-configured transcription offset (`lcyt:audio-transcription-offset`, seconds)
- NTP sync offset (`session.syncOffset`)

`opts` passed to `session.send()`:
```js
{ translations, captionLang, showOriginal }
```

---

## MCP Speech Sessions (`SpeechCapturePage`)

Route: `/mcp/:sessionId`

A self-contained page (no SessionContext, no relay backend) used by the `lcyt-mcp-sse` server to open a browser-based STT session from an AI assistant.

### URL parameters

| Param | Purpose |
|---|---|
| `server` | MCP server base URL |
| `lang` | Recognition language (BCP-47) |
| `label` | Optional session label shown in UI |
| `silence` | Silence timeout before auto-end (ms) |

### Flow

1. AI tool call `start_speech_session` → server allocates `sessionId` and returns a browser URL.
2. User opens URL in browser, clicks **Start**.
3. Web Speech API (WebKit only) streams interim text, commits finals.
4. Each final → `POST {server}/stt/{sessionId}/chunk  { text, isFinal: true, timestamp }`.
5. Server forwards chunk to YouTube via the connected MCP session's sender.
6. User clicks **Stop** or silence timeout fires → `POST {server}/stt/{sessionId}/done`.
7. AI tool call `get_speech_transcript` unblocks and returns full transcript.

### Server-side routes (`lcyt-mcp-sse/src/speech.js`)

| Route | Handler |
|---|---|
| `POST /stt/:sessionId/chunk` | `handleChunk()` — resets silence timer, sends caption |
| `POST /stt/:sessionId/done` | `handleSttDone()` — finalizes session, resolves waiters |

---

## Embed Widget (`EmbedAudioPage`)

Route: `/embed/audio?server=&apikey=&theme=`

Wraps `AudioPanel` inside `AppProviders` with `embed: true`. Auto-connects when credentials are in URL params. Broadcasts JWT token on `BroadcastChannel('lcyt-embed')` (`lcyt:session`) so a sibling `/embed/sentlog` iframe can subscribe to delivery results without owning the session.

```html
<iframe
  src="https://your-host/embed/audio?server=https://api.lcyt.fi&apikey=KEY"
  allow="microphone">
</iframe>
```

---

## AudioContext

`src/contexts/AudioContext.jsx` provides shared state to components that need to reflect or control audio without receiving the `AudioPanel` ref directly:

```js
const { listening, interimText, utteranceActive,
        utteranceTimerRunning, utteranceTimerSec,
        toggle, utteranceEndClick } = useAudioContext()
```

`AudioPanel` writes into this context; `ControlsPanel`, `InputBar`, and `MobileAudioBar` read from it.
