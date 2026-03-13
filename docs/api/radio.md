---
id: api/radio
title: "/radio — Audio-Only HLS Streaming"
methods: [GET, POST]
auth: [none]
---

# /radio — Audio-Only HLS Streaming

Endpoints for serving an audio-only HLS stream derived from the incoming RTMP signal. Suitable for embedding a live audio feed (radio) in any web page.

The API key must have `radio_enabled = true` (set by an admin via `PATCH /keys/:key`).

---

## Public Streaming Endpoints

These endpoints are public (no authentication). CORS headers are set according to the per-key `embed_cors` setting (defaults to `*`).

All HLS file serving endpoints are **rate-limited to 120 requests per minute per IP**.

---

### `GET /radio/:key/index.m3u8` — HLS Playlist

Return the live audio-only HLS playlist.

**Request**

```http
GET /radio/my-api-key/index.m3u8
```

**Response — `200 OK`**

```
Content-Type: application/vnd.apple.mpegurl
Cache-Control: no-cache, no-store
```

Returns `404` if the stream is not currently live.

---

### `GET /radio/:key/:segment` — HLS Segment

Fetch a specific audio segment. Only filenames matching `seg00000.ts` through `seg99999.ts` are accepted.

**Request**

```http
GET /radio/my-api-key/seg00001.ts
```

**Response — `200 OK`**

```
Content-Type: video/mp2t
Cache-Control: public, max-age=60
```

---

### `GET /radio/:key/player.js` — Embeddable Audio Player

Returns a self-contained vanilla-JavaScript HLS audio player snippet. Include it as a `<script>` tag to embed the live audio in any web page.

**Request**

```http
GET /radio/my-api-key/player.js
```

**Response — `200 OK`**

```
Content-Type: text/javascript; charset=utf-8
Cache-Control: public, max-age=3600
```

**Usage:**

```html
<!-- Optional: pre-create a container -->
<div id="radio-my-api-key"></div>

<!-- Load the player — self-contained, no dependencies required -->
<script src="https://api.example.com/radio/my-api-key/player.js"></script>
```

The snippet creates an `<audio>` element inside the container. On browsers without native HLS support it loads `hls.js` from CDN automatically.

**Error responses**

| Status | Reason |
|---|---|
| `400` | Invalid key format or invalid segment name |
| `404` | Stream not live or segment not found |
| `429` | Rate limit exceeded |

---

## nginx-rtmp Callbacks

These endpoints are called by nginx-rtmp, not by browsers. Access should be restricted at the network level.

### `POST /radio` — Single-URL Style

```http
POST /radio
Content-Type: application/x-www-form-urlencoded

call=publish&name=my-api-key
```

### `POST /radio/on_publish`

```http
POST /radio/on_publish
Content-Type: application/x-www-form-urlencoded

name=my-api-key
```

### `POST /radio/on_publish_done`

```http
POST /radio/on_publish_done
Content-Type: application/x-www-form-urlencoded

name=my-api-key
```

**Behavior:**
- `publish` — starts an ffmpeg process that extracts audio from the RTMP stream and writes audio-only HLS files under `$RADIO_HLS_ROOT/<key>/`. Returns `403` if `radio_enabled` is not set.
- `publish_done` — stops the ffmpeg radio process for the key.

---

## nginx-rtmp Configuration Example

```nginx
application radio {
  live on;

  on_publish      http://127.0.0.1:3000/radio/on_publish;
  on_publish_done http://127.0.0.1:3000/radio/on_publish_done;
}
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `RADIO_HLS_ROOT` | `/data/radio` | Directory where audio HLS playlists and segments are written. Each key gets its own subdirectory. |
| `RADIO_LOCAL_RTMP` | `rtmp://127.0.0.1:1935` | Local nginx-rtmp base URL. Used by the radio manager to pull the stream. |
| `BACKEND_URL` | _(derived from request)_ | Used to build absolute stream URLs in `player.js`. |
