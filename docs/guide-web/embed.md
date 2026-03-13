---
title: Embedding lcyt-web in Another Site
order: 8
---

# Embedding lcyt-web in Another Site

lcyt-web ships **eight** standalone **embed widgets** that you can drop into any page as `<iframe>` elements. Each widget renders only a specific part of the UI, configured entirely through URL parameters — no React knowledge required on the host site.

---

## Overview

| Widget | Path | What it renders |
|--------|------|-----------------|
| **Audio capture** | `/embed/audio` | Microphone / speech recognition panel |
| **Input bar + log** | `/embed/input` | Text input field and sent-captions log (owns the session) |
| **Sent log only** | `/embed/sentlog` | Read-only delivery log (subscribes to a sibling widget's session) |
| **Simple file drop** | `/embed/file-drop` | Drop one file → send lines one by one (owns the session) |
| **Full file UI** | `/embed/files` | Complete file manager: tabs, drop zone, caption view, input bar, sent log |
| **Settings** | `/embed/settings` | Connection credentials, theme, and CC targets (General + CC tabs) |
| **RTMP relay** | `/embed/rtmp` | RTMP relay slot management widget |
| **Viewer** | `/embed/viewer` | Read-only live caption viewer for audience members |

---

## Live iframe examples

Open any widget in a standalone iframe preview (opens a new window):

<p><a href="/embed/audio" target="_blank" rel="noopener">Audio capture example</a></p>
<p><a href="/embed/input" target="_blank" rel="noopener">Input + log example</a></p>
<p><a href="/embed/sentlog" target="_blank" rel="noopener">Sent log example</a></p>
<p><a href="/embed/file-drop" target="_blank" rel="noopener">File drop example</a></p>
<p><a href="/embed/files" target="_blank" rel="noopener">Files manager example</a></p>
<p><a href="/embed/settings" target="_blank" rel="noopener">Settings example</a></p>
<p><a href="/embed/rtmp" target="_blank" rel="noopener">RTMP relay example</a></p>
<p><a href="/embed/viewer" target="_blank" rel="noopener">Viewer example</a></p>

---

## URL Parameters

All embed pages share these common URL parameters:

| Param | Description | Default |
|-------|-------------|---------|
| `server` | Backend relay URL | _(empty — prompts user to connect)_ |
| `apikey` | LCYT API key | _(empty)_ |
| `theme` | `dark` or `light` | `dark` |

When both `server` and `apikey` are present the widget connects automatically on load.

> `EmbedSentLogPage` (`/embed/sentlog`) does not connect to the backend itself and therefore ignores `server` and `apikey`. It receives those from a sibling widget on the same page via `BroadcastChannel`.

---

## Widget Details

### `/embed/audio` — Audio Capture Widget

Renders the full `AudioPanel` (microphone button, interim text, VAD, translation pipeline). Owns the backend session when `server` + `apikey` are supplied.

```html
<iframe
  src="https://your-lcyt-host/embed/audio?server=https://api.example.com&apikey=YOUR_KEY&theme=dark"
  allow="microphone"
  style="width:100%; height:220px; border:none;">
</iframe>
```

> The `allow="microphone"` attribute is **required** for speech recognition to work inside an iframe.

---

### `/embed/input` — Input Bar + Sent Log Widget

Renders a text caption input field at the bottom and a scrollable sent-captions log above it. Owns its own backend session.

```html
<iframe
  src="https://your-lcyt-host/embed/input?server=https://api.example.com&apikey=YOUR_KEY&theme=dark"
  style="width:100%; height:320px; border:none;">
</iframe>
```

---

### `/embed/sentlog` — Sent Log Widget (read-only)

Renders only the sent-captions log. Does **not** own a session. Instead, it receives the session JWT token and caption texts from a sibling `/embed/audio` or `/embed/input` widget on the same host page via the browser's [`BroadcastChannel`](https://developer.mozilla.org/en-US/docs/Web/API/BroadcastChannel) API, then opens its own independent `EventSource` connection to `/events` on the backend to receive real-time delivery confirmations.

```html
<iframe
  src="https://your-lcyt-host/embed/sentlog?theme=dark"
  style="width:100%; height:320px; border:none;">
</iframe>
```

**Requirement:** At least one other embed widget (`/embed/audio`, `/embed/input`, `/embed/file-drop`, or `/embed/files`) must be present on the same host page and connected to the backend.

---

### `/embed/file-drop` — Simple File Drop Widget

The minimal caption-from-file widget. **Phase 1** shows a large drag-and-drop zone (click to browse is also supported). Drop one `.txt` file and **Phase 2** immediately shows the player:

- The **current line** is displayed prominently in the centre of the widget.
- **◀ Prev**, **Send**, **▶ Next** buttons control navigation and delivery.
- Keyboard shortcuts work without clicking buttons: `↑` / `↓` to move, `Enter` to send and advance.
- A **✕ reset** link in the header returns to Phase 1 to load a different file.
- The connection status dot in the header shows whether the backend relay is connected.

Send delivers the current line to YouTube and automatically advances the pointer to the next line.

```html
<iframe
  src="https://your-lcyt-host/embed/file-drop?server=https://api.example.com&apikey=YOUR_KEY&theme=dark"
  style="width:100%; height:280px; border:none;">
</iframe>
```

---

### `/embed/files` — Full File Management Widget

Renders the complete file-based captioning workflow from the main app, without the status bar, settings modals, or audio panel:

- **FileTabs** row at the top — switch between open files, add new files, toggle drop zone.
- **DropZone** — collapsible drag-and-drop file loader (auto-hides once a file is loaded).
- **CaptionView** — scrollable line list with the active pointer highlighted; supports raw text editing.
- **InputBar** — text input with batch mode, translation, and all keyboard shortcuts.
- **Sent log panel** — togglable delivery log (✓✓ button in the toolbar); starts visible by default.

Line double-click in CaptionView sends that line immediately via the InputBar, exactly as in the main app.

```html
<iframe
  src="https://your-lcyt-host/embed/files?server=https://api.example.com&apikey=YOUR_KEY&theme=dark"
  style="width:100%; height:640px; border:none;">
</iframe>
```

To start with the sent log panel hidden, add `&sentlog=0` to the URL.

---

### `/embed/settings` — Settings Widget

Renders the Settings panel as a standalone widget. Provides the **General** tab (backend URL, API key, stream key, theme) and the **CC** tab (caption targets, STT language, translation settings). The widget connects automatically if credentials are present in the URL.

```html
<iframe
  src="https://your-lcyt-host/embed/settings?server=https://api.example.com&apikey=YOUR_KEY&theme=dark"
  style="width:100%; height:480px; border:none;">
</iframe>
```

Useful for building custom operator dashboards where settings management and captioning are in separate panels.

---

### `/embed/rtmp` — RTMP Relay Widget

Renders the RTMP relay slot management UI as a standalone widget. Shows the relay active toggle, configured slots, RTMP ingest address, and per-slot advanced options (scale, FPS, bitrate, caption mode).

```html
<iframe
  src="https://your-lcyt-host/embed/rtmp?server=https://api.example.com&apikey=YOUR_KEY&theme=dark"
  style="width:100%; height:320px; border:none;">
</iframe>
```

Requires an active backend connection and `relay_allowed` on the API key.

---

### `/embed/viewer` — Caption Viewer Widget

Renders a read-only live caption display for audience members. Connects directly to the backend's public `GET /viewer/:key` SSE endpoint — no API key or JWT required.

```html
<iframe
  src="https://your-lcyt-host/embed/viewer?key=my-event-key&server=https://api.example.com&theme=dark"
  style="width:100%; height:200px; border:none;">
</iframe>
```

**URL parameters specific to `/embed/viewer`:**

| Param | Description | Default |
|-------|-------------|---------|
| `key` | Viewer key configured by the streamer | _(required)_ |
| `server` | Backend URL | _(required)_ |
| `theme` | `dark` or `light` | `dark` |

This widget does **not** need `apikey` or a session — it is intended for the audience, not the operator. The `server` and `key` parameters are required; the widget shows a "waiting for stream" state until captions arrive.

The full-screen version (non-embed) is available at `/view/:key?server=<backendUrl>`.

---

## Cross-Widget Communication

When widgets are spread across different parts of the same host page they coordinate using the browser's `BroadcastChannel` API (channel name: `'lcyt-embed'`). All iframes must be served from the **same origin** (the same lcyt-web deployment URL) for `BroadcastChannel` to work — this is a browser security requirement.

### Message types

| Type | Direction | Payload |
|------|-----------|---------|
| `lcyt:session` | audio/input → sentlog | `{ token, backendUrl }` — sent on connect and in response to `lcyt:request_session` |
| `lcyt:caption` | audio/input → sentlog | `{ requestId, text, timestamp }` — sent for each caption dispatched to the backend |
| `lcyt:request_session` | sentlog → audio/input | _(no payload)_ — sent on mount so a late-joining sentlog gets the token |

The sentlog widget also opens its own `EventSource` to `GET /events?token=...` on the backend to receive `caption_result` and `caption_error` events independently, without going through the session-owning widget.

---

## Splitting the UI Across a Host Page

A common integration pattern is to place each widget in a different region of the host page:

```html
<!-- Left sidebar: microphone -->
<div id="sidebar-left">
  <iframe
    src="https://your-lcyt-host/embed/audio?server=https://api.example.com&apikey=YOUR_KEY"
    allow="microphone"
    style="width:100%; height:240px; border:none;">
  </iframe>
</div>

<!-- Main content: text input -->
<div id="main-input">
  <iframe
    src="https://your-lcyt-host/embed/input?server=https://api.example.com&apikey=YOUR_KEY"
    style="width:100%; height:300px; border:none;">
  </iframe>
</div>

<!-- Right sidebar: delivery log (read-only, no credentials needed) -->
<div id="sidebar-right">
  <iframe
    src="https://your-lcyt-host/embed/sentlog"
    style="width:100%; height:400px; border:none;">
  </iframe>
</div>
```

> Only one widget should own the session at a time. If both `/embed/audio` and `/embed/input` are on the page with the same credentials they will each start a separate session — captions from one will not appear in the other's log unless you use `/embed/sentlog` (which listens to all sibling broadcasts). For a split audio + log layout, use `/embed/audio` as the session owner and `/embed/sentlog` for the delivery log.

---

## CORS Configuration

The backend must accept requests from the origin of the host page (not the lcyt-web origin). Configure the `ALLOWED_DOMAINS` environment variable on the backend to include the host site's domain:

```
ALLOWED_DOMAINS=lcyt.fi,www.lcyt.fi,yoursite.com,www.yoursite.com
```

The embed widgets themselves are served from the lcyt-web origin and communicate with the backend using the API key — the CORS domain is the domain registered when the API key was created, which must match the `domain` field sent in `POST /live`.

---

## Listening for postMessage Events (Optional)

All embed pages that own a session (`/embed/audio`, `/embed/input`) are ready for future `postMessage` integration with the host page. Currently, the `BroadcastChannel` mechanism handles cross-widget communication automatically. If you need the host page itself to react to caption events you can listen on the `BroadcastChannel` from a host-page script:

```js
const ch = new BroadcastChannel('lcyt-embed');
ch.onmessage = (ev) => {
  if (ev.data.type === 'lcyt:caption') {
    console.log('Caption sent:', ev.data.text);
  }
  if (ev.data.type === 'lcyt:session') {
    console.log('Session token received');
  }
};
```

> Note: `BroadcastChannel` only works between same-origin contexts. The host page script must be served from the **same origin as the embed iframes** (i.e., the lcyt-web deployment URL), or you must use the iframes' own `postMessage` API relayed through the parent page.
