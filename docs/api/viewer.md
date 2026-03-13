---
id: api/viewer
title: "/viewer — Public Viewer SSE Stream"
methods: [GET]
auth: [none]
---

# /viewer — Public Viewer SSE Stream

A public, unauthenticated Server-Sent Events endpoint that broadcasts live captions to audience members. This is the backend counterpart of the **viewer target type** — when a streamer configures a viewer target in the CC → Targets tab, every caption they send is relayed to all SSE clients subscribed on the matching viewer key.

**CORS:** `Access-Control-Allow-Origin: *` — open to all origins.

---

## `GET /viewer/:key` — Subscribe to Live Captions

Open a persistent SSE connection to receive captions as they arrive.

**Authentication:** None

**URL parameter**

| Parameter | Description |
|---|---|
| `:key` | The viewer key configured by the streamer. Must be at least 3 characters: letters (a–z, A–Z), digits (0–9), hyphens (`-`), or underscores (`_`). |

**Request**

```http
GET /viewer/my-event-key
Accept: text/event-stream
```

**Response — `200 OK`** (streaming, `Content-Type: text/event-stream`)

The connection stays open until the client disconnects. A heartbeat comment (`:heartbeat`) is sent every 25 seconds to keep the connection alive through proxies.

---

### SSE Events

#### `connected`

Sent immediately after the connection is established.

```
event: connected
data: {"ok":true}
```

---

#### `caption`

Sent each time the streamer delivers a caption to this viewer key.

```
event: caption
data: {"text":"Hello, world!","composedText":"Hello, world!<br>Hei, maailma!","sequence":7,"timestamp":"2024-01-01T12:00:00.000","translations":{"fi-FI":"Hei, maailma!"},"captionLang":"fi-FI","showOriginal":true}
```

| Field | Type | Description |
|---|---|---|
| `text` | `string` | Original caption text |
| `composedText` | `string \| undefined` | Composed text after translation (what YouTube received). Contains `<br>` if `showOriginal` is true. |
| `sequence` | `number` | Caption sequence number |
| `timestamp` | `string \| undefined` | ISO timestamp when the caption was sent |
| `translations` | `object \| undefined` | Map of BCP-47 language code → translated text |
| `captionLang` | `string \| undefined` | Active translation language, if set |
| `showOriginal` | `boolean \| undefined` | Whether the original was combined with the translation |

---

## Key Format

Viewer keys must match `/^[a-zA-Z0-9_-]{3,}$/`. Invalid keys return `400 Bad Request`.

---

## Browser Example

```js
const es = new EventSource('https://api.example.com/viewer/my-event-key');

es.addEventListener('connected', () => {
  console.log('Viewer connected');
});

es.addEventListener('caption', (e) => {
  const { text, composedText, timestamp } = JSON.parse(e.data);
  // composedText contains the final displayed text (original + translation if showOriginal)
  document.getElementById('captions').textContent = composedText ?? text;
});
```

---

## Configuring a Viewer Target

The streamer configures a viewer target in the web app's CC → Targets tab (or via `POST /live` with a `viewer` target in the `targets` array — see [Session Management](./sessions.md)).

**`POST /live` example:**

```json
{
  "apiKey": "your-api-key",
  "domain": "https://your-app.example.com",
  "targets": [
    {
      "id": "viewer-main",
      "type": "viewer",
      "viewerKey": "my-event-key"
    }
  ]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | Yes | Client-assigned identifier |
| `type` | `string` | Yes | Must be `"viewer"` |
| `viewerKey` | `string` | Yes | Key that viewers subscribe to at `GET /viewer/:key` |

---

## Viewer Pages

The web app ships two built-in viewer display pages:

| Path | Description |
|---|---|
| `/view/:key?server=<backendUrl>` | Full-screen viewer page. Shows the current caption prominently and maintains a dimmed history list. |
| `/embed/viewer?key=<key>&server=<backendUrl>` | Embeddable iframe viewer widget. Accepts `theme=dark\|light`. |

Both pages connect to `GET /viewer/:key` internally.

---

## Statistics

The backend records viewer opens for usage tracking:

- **Anonymous daily stat** — incremented for every new SSE connection regardless of ownership.
- **Per-key stat** — if the viewer key is currently owned by an active session, the open is attributed to that API key.

These appear in `GET /stats` as `viewerStats` (per-key, per-viewer-key breakdowns) and in `GET /usage` as aggregated anonymous counts.
