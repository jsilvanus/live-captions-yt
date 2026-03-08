---
title: Embedding lcyt-web in Another Site
order: 8
---

# Embedding lcyt-web in Another Site

lcyt-web ships three standalone **embed widgets** that you can drop into any page as `<iframe>` elements. Each widget renders only a specific part of the UI, configured entirely through URL parameters — no React knowledge required on the host site.

---

## Overview

| Widget | Path | What it renders |
|--------|------|-----------------|
| **Audio capture** | `/embed/audio` | Microphone / speech recognition panel |
| **Input bar + log** | `/embed/input` | Text input field and sent-captions log (owns the session) |
| **Sent log only** | `/embed/sentlog` | Read-only delivery log (subscribes to a sibling widget's session) |

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

**Requirement:** At least one other embed widget (`/embed/audio` or `/embed/input`) must be present on the same host page and connected to the backend.

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
