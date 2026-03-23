---
id: plan/captions
title: "Caption Sending Pipeline"
status: implemented
summary: "End-to-end caption delivery: input sources, composition, target fan-out, sequence tracking, clock sync, and SSE result reporting."
---

# Plan: Caption Sending Pipeline

## Summary

This document describes how captions travel from input (text, speech, file) through the relay backend to YouTube and all other configured targets. It covers session setup, sequence tracking, NTP-style clock sync, caption composition, target fan-out, and SSE result reporting.

---

## 1. Session Lifecycle

Before any captions can be sent a **session** must be established.

### 1.1 Client-Side (`BackendCaptionSender`)

`packages/lcyt/src/backend-sender.js`

```js
const sender = new BackendCaptionSender({ backendUrl, apiKey });
await sender.start({ targets });   // POST /live → session JWT
await sender.sync();               // NTP clock sync (see §4)
```

`start()` sends:
```json
{ "apiKey": "…", "domain": "https://app.lcyt.fi", "targets": [ … ] }
```

Receives:
```json
{ "token": "<JWT>", "sessionId": "…", "sequence": 0, "syncOffset": 0, "startedAt": 1234567890 }
```

The returned `token` is a HS256 JWT with payload `{ sessionId, apiKey }`, signed by the server's `JWT_SECRET`.

### 1.2 Server-Side Session Storage (`store.js`)

`packages/lcyt-backend/src/store.js`

Each session object:

```js
{
  sessionId,        // SHA-256(apiKey:streamKey:domain) first 16 hex chars
  apiKey,
  streamKey,        // empty string in target-array mode
  domain,
  sender,           // YoutubeLiveCaptionSender | null (null in target-array mode)
  extraTargets,     // [{ id, type, sender, viewerKey, url, headers }]
  token,            // JWT string
  startedAt,        // Date.now() at session creation
  lastActivity,     // updated on every caption
  sequence,         // current monotonic sequence number
  syncOffset,       // ms offset applied to relative timestamps
  emitter,          // EventEmitter — routes SSE events to connected clients
  _sendQueue,       // Promise chain — serialises concurrent sends
}
```

`sessionId` is deterministic: recreating a session with the same API key, stream key, and domain reuses the previous session (and inherits the last sequence number from the DB).

### 1.3 SSE Connection (`GET /events`)

`packages/lcyt-backend/src/routes/events.js`

After `start()`, the client opens an EventSource:
```
GET /events
Authorization: Bearer <token>
```

Server responds with:
```
Content-Type: text/event-stream

event: connected
data: {"sessionId":"…","micHolder":null}
```

A 25-second `heartbeat` comment keeps the connection alive through proxies. On session expiry the server emits `session_closed` and closes the stream.

---

## 2. Caption Input Sources

### 2.1 Manual Text Entry

`packages/lcyt-web/src/components/InputBar.jsx`

User types in the text input and presses Enter (or the Send button). Calls:
```js
session.send(text, timestamp, { translations, captionLang, showOriginal, codes })
```

### 2.2 Speech-to-Text

`packages/lcyt-web/src/components/AudioPanel.jsx`

Two engines are supported (configurable in Settings → CC → Microphone):
- **WebKit** — browser `SpeechRecognition` API (free, on-device or browser-cloud)
- **Google Cloud STT** — streaming gRPC-based STT via WebSocket proxy

**Interim results** are shown live in the UI but not sent.

**Final results** trigger the translation pipeline (§5) then `session.send()`.

A configurable **batch interval** (0–20 s) can queue multiple final transcripts locally and flush them together as a `sendBatch()` call, trading latency for request count.

### 2.3 File Playback

`packages/lcyt-web/src/hooks/useFileStore.js`

Caption files (YouTube format or plain text) are loaded and played back line-by-line. Each line is sent as a single caption. The pointer advances automatically on send.

### 2.4 CLI Input

`packages/lcyt-cli/src/interactive-ui.js` and `packages/lcyt-cli/bin/lcyt`

Modes:
- **Full-screen blessed UI** — interactive text input with preview pane
- **Interactive line-by-line** (`-i`) — stdin-based
- **Single caption** — `lcyt "text"`
- **Batch from file** — `/load <file>` in the full-screen UI

The CLI uses `YoutubeLiveCaptionSender` directly (not via the relay backend).

### 2.5 MCP Tools

`packages/lcyt-mcp-stdio/src/server.js` and `packages/lcyt-mcp-sse/src/server.js`

AI assistants call the `send_caption` or `send_batch` MCP tools. These create a `BackendCaptionSender` session internally and call `sender.send()`.

---

## 3. Caption Composition

Before delivery the backend composes the final text that YouTube receives.

`packages/lcyt-backend/src/caption-files.js` — `composeCaptionText(text, captionLang, translations, showOriginal)`

| Condition | Composed text |
|-----------|--------------|
| No translation | `text` |
| Translation, `showOriginal = true` | `text + '\n' + translations[captionLang]` |
| Translation, `showOriginal = false` | `translations[captionLang]` |

The `<br>` separator is a literal newline in the YouTube caption payload. YouTube renders it as a line break in the closed-caption display. The viewer SSE payload uses the string `"<br>"` as a separator so clients can split it correctly.

---

## 4. Sequence Tracking and Clock Sync

### 4.1 Sequence Numbers

YouTube's caption ingestion API uses monotonically increasing sequence numbers per stream key. The backend maintains:

- **In-memory** (`session.sequence`) — incremented on every successful send.
- **Persisted** (`api_keys.last_sequence` in SQLite) — written on session close and periodically; allows a new session to resume from the correct number.

The `_sendQueue` Promise chain (per session) serialises concurrent POSTs so no two sends share a sequence number.

Sequence rules:
- Increments only on HTTP 2xx responses from YouTube.
- Failed sends do not increment (same sequence is retried).
- Users can reset via `PATCH /live` with `{ sequence: 0 }`.

### 4.2 NTP-Style Clock Sync

`packages/lcyt/src/sender.js` — `sync()` method

YouTube rejects captions with timestamps more than 60 seconds outside the server's clock window. The `sync()` method corrects for client–server clock drift:

```
T1 = Date.now()         ← before heartbeat POST
     POST heartbeat      → YouTube responds with serverTimestamp
T2 = Date.now()         ← after heartbeat POST

localMidpoint = (T1 + T2) / 2
syncOffset    = serverTime − localMidpoint   (ms; positive = server ahead)
```

After sync, `_now()` returns `Date.now() + syncOffset` everywhere a timestamp is auto-generated.

The web UI auto-syncs on connect and re-syncs every 30 seconds via the health-check loop. The CLI calls `sync()` once after `start()`.

### 4.3 Relative Timestamps

Clients can send a relative `time` field (ms since session start) instead of an absolute timestamp:

```
absoluteTimestamp = session.startedAt + time + session.syncOffset
```

This is useful for file playback where timestamps are pre-computed relative to the session.

---

## 5. Backend Caption Processing (`POST /captions`)

`packages/lcyt-backend/src/routes/captions.js`

### Request shape

```http
POST /captions
Authorization: Bearer <token>
Content-Type: application/json

{
  "captions": [
    {
      "text": "Hello, world!",
      "timestamp": "2026-03-23T12:00:00.000",   // optional; auto-generated if absent
      "time": 5000,                               // optional relative ms (overrides timestamp)
      "translations": { "fi-FI": "Hei, maailma!" },
      "captionLang": "fi-FI",
      "showOriginal": true,
      "codes": { "section": "2", "speaker": "alice" }
    }
  ]
}
```

### Response

```json
{ "ok": true, "requestId": "<uuid>" }
```

HTTP 202 is returned immediately. The actual YouTube result arrives asynchronously on the `/events` SSE stream.

### Processing steps (per batch)

1. **Auth** — validate session JWT Bearer.
2. **Enqueue on `_sendQueue`** — wait for any in-flight send to complete.
3. **Timestamp resolution** — apply `time`→absolute conversion if needed.
4. **DSK metacode extraction** — strip `<!-- graphics:… -->` comments from text; trigger DSK SSE events (§8).
5. **Caption composition** — `composeCaptionText()` produces the string sent to YouTube.
6. **Backend file writing** (if enabled per API key) — append original + all translations to open file handles.
7. **CEA-708 injection** (if RTMP relay running in CEA mode) — write caption text to ffmpeg SRT pipe.
8. **Primary sender** (if `session.sender` is non-null) — `sender.send(composedText, timestamp)`.
9. **Target fan-out** — send to all `session.extraTargets` (see §6).
10. **SSE result emission** — emit `caption_result` or `caption_error` on `session.emitter`.

---

## 6. Target Fan-Out

`packages/lcyt-backend/src/routes/captions.js` and `store.js`

### 6.1 YouTube target (`type: 'youtube'`)

Config: `{ type: 'youtube', streamKey: '…', enabled: true }`

One `YoutubeLiveCaptionSender` per target. Sends the composed text (with translation if configured) directly to:

```
POST http://upload.youtube.com/closedcaption?cid=<streamKey>&seq=<n>
Content-Type: text/plain

2026-03-23T12:00:00.000 [region:reg1#cue1]
Hello, world!
Hei, maailma!
```

Sequence numbers are synthesised by the backend in target-array mode.

### 6.2 Viewer target (`type: 'viewer'`)

Config: `{ type: 'viewer', viewerKey: 'main', enabled: true }`

Broadcasts via `broadcastToViewers(viewerKey, payload)` to all SSE clients connected on `GET /viewer/:viewerKey` (public endpoint, no auth, CORS `*`).

Payload:
```json
{
  "text": "Hello, world!",
  "composedText": "Hello, world!\n<br>Hei, maailma!",
  "sequence": 42,
  "timestamp": "2026-03-23T12:00:00.000",
  "translations": { "fi-FI": "Hei, maailma!" },
  "codes": { "section": "2", "speaker": "alice" }
}
```

Also feeds the HLS subtitle sidecar (`HlsSubsManager`) so subtitle tracks appear in the HLS player at `/video/:key`.

### 6.3 Generic target (`type: 'generic'`)

Config: `{ type: 'generic', url: 'https://…', headers: { … }, enabled: true }`

HTTP POST (JSON) to a user-configured endpoint:

```json
{
  "source": "https://app.example.com",
  "sequence": 42,
  "captions": [
    {
      "text": "Hello, world!",
      "composedText": "Hello, world!\n<br>Hei, maailma!",
      "timestamp": "2026-03-23T12:00:00.000",
      "translations": { "fi-FI": "Hei, maailma!" },
      "captionLang": "fi-FI",
      "showOriginal": true,
      "codes": { "section": "2" }
    }
  ]
}
```

Custom headers are merged in for authentication or routing.

---

## 7. SSE Result Events (`GET /events`)

`packages/lcyt-backend/src/routes/events.js`

All events are emitted on `session.emitter` and forwarded to the authenticated EventSource connection.

| Event | Payload | Trigger |
|-------|---------|---------|
| `connected` | `{ sessionId, micHolder }` | On SSE open |
| `caption_result` | `{ requestId, sequence, statusCode, serverTimestamp, count? }` | YouTube returned 2xx |
| `caption_error` | `{ requestId, error, statusCode, sequence? }` | YouTube returned non-2xx or network error |
| `mic_state` | `{ holder: clientId \| null }` | Soft mic lock claimed or released |
| `session_closed` | `{}` | Session TTL expired or server shutdown |

Client-side handling in `useSession.js`:
```js
es.addEventListener('caption_result', e => {
  const { requestId, sequence } = JSON.parse(e.data);
  setSequence(sequence);
  onCaptionResult?.(data);   // updates sent log
});
es.addEventListener('caption_error', e => {
  onCaptionError?.(data);    // shows error toast
});
```

---

## 8. DSK Graphics Metacodes

`packages/plugins/lcyt-dsk/src/caption-processor.js`

Caption text may contain HTML-comment metacodes that control the DSK overlay without being sent to YouTube. They are stripped before composition.

```
<!-- graphics:logo,banner -->               all viewports: logo + banner (absolute)
<!-- graphics[vertical-left]:stanza -->     only the vertical-left viewport
<!-- graphics:+logo -->                     delta: add logo to active set
<!-- graphics:-banner -->                   delta: remove banner from active set
<!-- graphics[v1,v2]: -->                   clear v1 and v2
```

The processor emits a `graphics` SSE event on `GET /dsk/:apikey/events` so overlay pages update in real time.

---

## 9. Soft Mic Lock

`packages/lcyt-backend/src/routes/mic.js`

For collaborative broadcasting where multiple users share a session, a soft mic lock prevents accidental simultaneous sending:

```http
POST /mic
Authorization: Bearer <token>
{ "action": "claim", "clientId": "<uuid>" }
```

The current holder is broadcast via `mic_state` SSE to all clients on the same session. Only the holder typically sends captions; the UI dims the input for other clients.

---

## 10. Batch Sending

### Via `sendBatch()` (backend)

```http
POST /captions
{ "captions": [ { "text": "…" }, { "text": "…" }, { "text": "…" } ] }
```

All captions in the array are sent sequentially to YouTube within a single queued job. One `requestId` covers all of them. The SSE result carries `count: N`.

### Via `construct()` + `sendBatch()` (sender)

`packages/lcyt/src/backend-sender.js`

```js
sender.construct('Line 1');
sender.construct('Line 2');
const result = await sender.sendBatch();  // flushes queue
```

### Audio batch interval

`AudioPanel.jsx` can queue final STT transcripts for up to 20 seconds and flush them together. Reduces request count at the cost of added latency before delivery.

---

## 11. Direct Sender (No Relay)

`packages/lcyt/src/sender.js` — `YoutubeLiveCaptionSender`

When used directly (CLI, MCP, Python library), captions are posted straight to YouTube with no relay layer:

```
POST http://upload.youtube.com/closedcaption?cid=<streamKey>&seq=<n>&tl=<ts>
Content-Type: text/plain; charset=utf-8

2026-03-23T12:00:00.000 [region:reg1#cue1]
Caption text here
```

Sequence tracking, clock sync, and timestamp formatting are handled identically to the relay path.

---

## 12. Python Library

`python-packages/lcyt/lcyt/sender.py`

Feature-complete Python equivalent. Key difference: numeric timestamps `>= 1000` are treated as **seconds** (not milliseconds as in Node.js). ISO string format is identical: `YYYY-MM-DDTHH:MM:SS.mmm` (no trailing `Z`).

```python
from lcyt import YoutubeLiveCaptionSender
sender = YoutubeLiveCaptionSender(stream_key='…', region='us1')
sender.start()
sender.sync()
sender.send('Caption text')
```

---

## Files Referenced

| File | Role |
|------|------|
| `packages/lcyt/src/sender.js` | Core direct sender; `sync()`, `send()`, `sendBatch()`, `heartbeat()` |
| `packages/lcyt/src/backend-sender.js` | Relay sender; wraps the backend API |
| `packages/lcyt-backend/src/store.js` | In-memory session store; `_sendQueue`, `emitter`, `extraTargets` |
| `packages/lcyt-backend/src/routes/live.js` | `POST /live` — session creation and target registration |
| `packages/lcyt-backend/src/routes/captions.js` | `POST /captions` — processing, composition, fan-out |
| `packages/lcyt-backend/src/routes/events.js` | `GET /events` — SSE result stream |
| `packages/lcyt-backend/src/routes/viewer.js` | `GET /viewer/:key` — public viewer SSE broadcast |
| `packages/lcyt-backend/src/caption-files.js` | `composeCaptionText()`, `formatVttTime()`, `buildVttCue()` |
| `packages/lcyt-backend/src/hls-subs-manager.js` | WebVTT segment writer for HLS subtitle sidecar |
| `packages/lcyt-web/src/hooks/useSession.js` | React hook; session lifecycle, SSE listener |
| `packages/lcyt-web/src/components/InputBar.jsx` | Manual text input |
| `packages/lcyt-web/src/components/AudioPanel.jsx` | STT capture and batch queueing |
| `packages/lcyt-web/src/hooks/useFileStore.js` | Caption file playback |
| `packages/lcyt-cli/bin/lcyt` | CLI entry point |
| `packages/lcyt-cli/src/interactive-ui.js` | Full-screen blessed terminal UI |
| `packages/plugins/lcyt-dsk/src/caption-processor.js` | Graphics metacode extractor |
| `packages/lcyt-mcp-stdio/src/server.js` | MCP stdio server |
| `packages/lcyt-mcp-sse/src/server.js` | MCP SSE server |
| `python-packages/lcyt/lcyt/sender.py` | Python sender |
| `python-packages/lcyt/lcyt/backend_sender.py` | Python relay sender |
