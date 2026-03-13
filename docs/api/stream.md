---
id: api/stream
title: "/stream — RTMP Relay Configuration"
methods: [POST, GET, PUT, DELETE]
auth: [bearer]
---

# /stream — RTMP Relay Configuration

Authenticated endpoints for managing per-key RTMP relay slots. The relay re-streams one incoming RTMP signal to up to **4 target destinations** simultaneously using a single ffmpeg process and the `tee` muxer.

**Authentication:** Bearer JWT (all routes)

The API key must have `relay_allowed = true` (set by an admin via `PATCH /keys/:key`).

Additionally, the `domain` registered when starting the session must be in the `ALLOWED_RTMP_DOMAINS` server allowlist (falls back to `ALLOWED_DOMAINS` if not separately configured).

---

## `POST /stream` — Create or Replace Relay Slot

Add a new relay destination or overwrite an existing slot.

**Authentication:** Bearer JWT

**Request**

```http
POST /stream
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{
  "slot": 1,
  "targetUrl": "rtmp://a.rtmp.youtube.com/live2",
  "targetName": "xxxx-xxxx-xxxx-xxxx",
  "captionMode": "http",
  "scale": "1280x720",
  "fps": 30,
  "videoBitrate": "3000k",
  "audioBitrate": "128k"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `slot` | `number` | No | Slot number (1–4). Defaults to `1` if omitted. |
| `targetUrl` | `string` | Yes | RTMP or RTMPS destination URL (must start with `rtmp`). For YouTube: `rtmp://a.rtmp.youtube.com/live2`. |
| `targetName` | `string` | No | Stream name / key appended to `targetUrl`. For YouTube this is the stream key. |
| `captionMode` | `string` | No | `'http'` (default) or `'cea708'`. Controls how captions are embedded. |
| `scale` | `string` | No | Output resolution as `WIDTHxHEIGHT` or `WIDTH:HEIGHT` (e.g. `"1280x720"`). Null/omitted = use original. |
| `fps` | `number` | No | Output frame rate (integer 1–120). Null/omitted = use original. |
| `videoBitrate` | `string` | No | Video bitrate (e.g. `"3000k"`, `"6M"`). Null/omitted = use original. |
| `audioBitrate` | `string` | No | Audio bitrate (e.g. `"128k"`, `"192k"`). Null/omitted = use original. |

> **Caption modes:** `http` sends captions via the YouTube HTTP POST ingestion API (the default). `cea708` embeds captions directly in the video stream via the CEA-708/608 standard — requires ffmpeg with libx264, eia608, and subrip support.
>
> **Transcoding:** Setting `scale`, `fps`, `videoBitrate`, or `audioBitrate` enables per-slot transcoding. CEA-708 mode takes priority over per-slot transcoding (they cannot be combined on the same key).

**Response — `201 Created`**

```json
{
  "ok": true,
  "relay": {
    "slot": 1,
    "target_url": "rtmp://a.rtmp.youtube.com/live2",
    "target_name": "xxxx-xxxx-xxxx-xxxx",
    "caption_mode": "http",
    "scale": null,
    "fps": null,
    "video_bitrate": null,
    "audio_bitrate": null
  }
}
```

**Error responses**

| Status | Reason |
|---|---|
| `400` | Invalid `targetUrl`, invalid slot number, or max 4 slots reached |
| `401` | Missing or invalid JWT |
| `403` | `relay_allowed` not set for this API key, or domain not in allowlist |

---

## `GET /stream` — Get All Slots

Return all configured relay slots, their running state, and the relay's active toggle.

**Authentication:** Bearer JWT

**Request**

```http
GET /stream
Authorization: Bearer <token>
```

**Response — `200 OK`**

```json
{
  "relays": [
    {
      "slot": 1,
      "target_url": "rtmp://a.rtmp.youtube.com/live2",
      "target_name": "xxxx-xxxx-xxxx-xxxx",
      "caption_mode": "http",
      "scale": null,
      "fps": null,
      "video_bitrate": null,
      "audio_bitrate": null
    }
  ],
  "runningSlots": [1],
  "active": true
}
```

| Field | Type | Description |
|---|---|---|
| `relays` | `array` | All configured relay slots (may be empty) |
| `runningSlots` | `array` | Slot numbers currently running in ffmpeg |
| `active` | `boolean` | Whether the relay is toggled on (may not match `runningSlots` if no stream is incoming) |

---

## `GET /stream/history` — Relay Usage History

Return completed RTMP stream records for this API key.

**Authentication:** Bearer JWT

**Request**

```http
GET /stream/history
Authorization: Bearer <token>
```

**Response — `200 OK`**

```json
{
  "streams": [
    {
      "id": 1,
      "slot": 1,
      "targetUrl": "rtmp://a.rtmp.youtube.com/live2",
      "targetName": "xxxx-xxxx-xxxx-xxxx",
      "captionMode": "http",
      "startedAt": "2024-06-01T10:00:00.000Z",
      "endedAt": "2024-06-01T11:30:00.000Z",
      "durationMs": 5400000,
      "captionsSent": 180
    }
  ]
}
```

---

## `PUT /stream/active` — Toggle Relay On/Off

Enable or disable the relay fan-out for this API key. When enabled and nginx is actively publishing a stream, the relay starts immediately.

**Authentication:** Bearer JWT

**Request**

```http
PUT /stream/active
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{ "active": true }
```

| Field | Type | Required | Description |
|---|---|---|---|
| `active` | `boolean` | Yes | `true` to start fan-out, `false` to stop all ffmpeg processes |

**Behavior:**
- `active: true` — sets `relay_active = 1` in the database; if nginx is currently publishing for this key, immediately starts ffmpeg fan-out to all configured slots.
- `active: false` — sets `relay_active = 0`; stops all running ffmpeg processes. The incoming nginx stream stays alive (the publisher is not dropped).

**Response — `200 OK`**

```json
{ "ok": true, "active": true }
```

---

## `PUT /stream/:slot` — Update a Slot

Update the configuration for a specific, already-created slot. Uses the same field set as `POST /stream`. The slot must already exist; use `POST /stream` to create it first.

**Authentication:** Bearer JWT

**Request**

```http
PUT /stream/1
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{
  "targetUrl": "rtmp://a.rtmp.youtube.com/live2",
  "targetName": "zzzz-zzzz-zzzz-zzzz",
  "captionMode": "http"
}
```

**Response — `200 OK`** — Updated relay object (same shape as `POST /stream` response).

**Error responses**

| Status | Reason |
|---|---|
| `400` | Invalid field values |
| `404` | Slot not configured (use `POST /stream` to create it) |

---

## `DELETE /stream/:slot` — Remove a Slot

Remove a relay slot. If the relay is running, it is restarted with the remaining slots. If this was the last slot, ffmpeg stops entirely.

**Authentication:** Bearer JWT

**Request**

```http
DELETE /stream/1
Authorization: Bearer <token>
```

**Response — `200 OK`**

```json
{ "ok": true, "slot": 1, "deleted": true }
```

---

## `DELETE /stream` — Stop and Remove All Slots

Stop all relay processes, drop the nginx publisher (disconnecting the incoming RTMP stream), and delete all configured slots for this key.

**Authentication:** Bearer JWT

**Request**

```http
DELETE /stream
Authorization: Bearer <token>
```

**Response — `200 OK`**

```json
{ "ok": true, "deleted": 2 }
```

| Field | Type | Description |
|---|---|---|
| `deleted` | `number` | Number of slot configurations removed |

---

## Relay Architecture

```
Broadcaster (OBS, etc.)
        │
        ▼  RTMP
  nginx-rtmp server
        │  on_publish → POST /rtmp (starts fan-out if active)
        │
        ▼  local RTMP
  RtmpRelayManager (one ffmpeg per API key)
        │
        ├──► Slot 1 → rtmp://a.rtmp.youtube.com/live2/<key1>
        ├──► Slot 2 → rtmp://a.rtmp.youtube.com/live2/<key2>
        ├──► Slot 3 → rtmps://live.restream.io/live/<key>
        └──► Slot 4 → rtmp://custom.endpoint.example.com/live
```

Captions written via `POST /captions` are forwarded to the ffmpeg process stdin (CEA-708 mode) or sent directly to YouTube's HTTP ingestion API (`http` mode).

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `RTMP_RELAY_ACTIVE` | unset | Set to `1` to enable the RTMP relay subsystem. Without this, the relay manager is a no-op. |
| `ALLOWED_RTMP_DOMAINS` | (falls back to `ALLOWED_DOMAINS`) | Comma-separated domains that may use the `/stream` relay endpoints. Set to `*` to allow all. |
| `RTMP_APPLICATION` | unset | If set, the `/rtmp` nginx callback rejects requests where the RTMP `app` name does not match. |
| `RTMP_HOST` | `rtmp.lcyt.fi` | Hostname of the nginx-rtmp RTMP ingest. Reported in `GET /health` when relay is active. |
| `RTMP_APP` | `stream` | RTMP application name. Reported in `GET /health` when relay is active. |
