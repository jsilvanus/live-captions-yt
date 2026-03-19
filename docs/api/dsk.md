---
id: api/dsk
title: "/dsk — DSK Overlay, /dsk-rtmp — DSK RTMP Ingest"
methods: [GET, POST]
auth: [none]
---

# /dsk — DSK Overlay

Public endpoints that power the **Downstream Keyer (DSK)** overlay page (`/dsk/:apikey` in lcyt-web). The DSK page displays a green-screen-keyed graphics overlay driven by caption metadata.

**Authentication:** None (public — the API key is in the URL path, not used as a secret).

---

## `GET /dsk/:apikey/images` — List DSK Images

Return all images available for this API key (uploaded via [`POST /images`](./images.md)).

**Request**

```http
GET /dsk/my-api-key/images
```

**Response — `200 OK`**

```json
{
  "images": [
    {
      "id": 1,
      "shorthand": "logo",
      "mimeType": "image/png",
      "url": "/images/1"
    }
  ]
}
```

| Field | Type | Description |
|---|---|---|
| `id` | `number` | Image identifier |
| `shorthand` | `string` | Short label used to reference the image in caption metadata |
| `mimeType` | `string` | MIME type (`image/png`, `image/webp`, or `image/svg+xml`) |
| `url` | `string` | Public URL for fetching the image bytes (see [`GET /images/:id`](./images.md)) |

Returns `404` if the API key does not exist or is not active.

---

## `GET /dsk/:apikey/events` — DSK SSE Event Stream

Open a persistent Server-Sent Events connection to receive DSK graphics events triggered by caption metadata codes (e.g. `<!-- graphics: logo1,logo2 -->`).

**Authentication:** None

**Request**

```http
GET /dsk/my-api-key/events
Accept: text/event-stream
```

**Response — `200 OK`** (streaming, `Content-Type: text/event-stream`)

A heartbeat comment (`: heartbeat`) is sent every 25 seconds.

### SSE Events

#### `connected`

```
event: connected
data: {"apiKey":"my-api-key"}
```

#### `graphics`

Emitted when the streamer sends a caption containing a `<!-- graphics: ... -->` metadata code.

```
event: graphics
data: {"names":["logo","banner"],"apiKey":"my-api-key"}
```

| Field | Type | Description |
|---|---|---|
| `names` | `array` | List of active shorthand names. An empty array clears all overlays. |
| `apiKey` | `string` | The API key that owns this DSK channel |

The DSK page renders the named images as layers (stacked in array order) over a transparent/green-screen background.

---

## Element id uniqueness

Templates contain per-layer element `id` properties used by the renderer and the live broadcast API to target individual layers for updates. To avoid live-data mixing between templates, element `id` values must be unique across all templates for the same API key. When a template is created or updated, the server validates that no other template owned by the same API key contains any of the same element ids; the API will return `409 Conflict` with details about overlapping ids if a clash is detected.

Clients (the graphics editor) should either generate globally-unique ids when creating layers, or query existing templates before renaming an element and warn the user (or auto-suffix the id) when a conflict would arise.


# /dsk-rtmp — DSK RTMP Ingest Callbacks

nginx-rtmp callbacks for the DSK application. When a broadcaster publishes an RTMP stream to `rtmp://<server>/dsk/<apiKey>`, the relay process for that key is restarted with the DSK stream composited as an overlay using ffmpeg's `overlay` filter.

**Authentication:** None (nginx is the caller — restrict at the network level).

---

## `POST /dsk-rtmp` — Single-URL Style

```http
POST /dsk-rtmp
Content-Type: application/x-www-form-urlencoded

call=publish&name=my-api-key
```

or

```
call=publish_done&name=my-api-key
```

## `POST /dsk-rtmp/on_publish`

```http
POST /dsk-rtmp/on_publish
Content-Type: application/x-www-form-urlencoded

name=my-api-key
```

## `POST /dsk-rtmp/on_publish_done`

```http
POST /dsk-rtmp/on_publish_done
Content-Type: application/x-www-form-urlencoded

name=my-api-key
```

**Behavior:**
- `publish` — sets the DSK RTMP source URL to `<DSK_LOCAL_RTMP>/<DSK_RTMP_APP>/<apiKey>` and restarts the relay process with the DSK stream composited on top.
- `publish_done` — clears the DSK RTMP source and restarts the relay without the overlay.

DSK compositing is best-effort — if the relay process fails to restart, the backend returns `200` anyway so nginx allows the publish.

---

## nginx-rtmp Configuration Example

```nginx
application dsk {
  live on;

  on_publish      http://127.0.0.1:3000/dsk-rtmp/on_publish;
  on_publish_done http://127.0.0.1:3000/dsk-rtmp/on_publish_done;
}
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `DSK_LOCAL_RTMP` | `rtmp://127.0.0.1:1935` | Local nginx-rtmp base URL for the DSK application. Falls back to `RADIO_LOCAL_RTMP` if not set. |
| `DSK_RTMP_APP` | `dsk` | nginx-rtmp application name for DSK ingest. Must match the nginx config. |
