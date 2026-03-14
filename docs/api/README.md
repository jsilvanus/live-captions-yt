---
id: api/readme
title: "lcyt-backend API Reference"
---

# lcyt-backend API Reference

`lcyt-backend` is an Express.js HTTP relay server that sits between your client applications and YouTube Live. Clients authenticate with API keys and JWTs; the backend sends captions to YouTube on their behalf and streams delivery results back via SSE.

**Default port:** `3000`

---

## Contents

- [Authentication](#authentication)
- [Environment Variables](#environment-variables)
- [Endpoints](#endpoints)
  - [Sessions — `/live`, `/sync`](#sessions)
  - [Captions — `/captions`, `/events`](#captions)
  - [Files — `/file`](#files)
  - [API Keys — `/keys`](#keys)
  - [Statistics — `/stats`, `/usage`](#stats)
  - [Health — `/health`, `/contact`](#health)
  - [RTMP Relay — `/stream`, `/rtmp`](#rtmp-relay)
  - [Viewer — `/viewer`](#viewer)
  - [Video Player — `/video`](#video-player)
  - [HLS Streaming — `/stream-hls`, `/radio`](#hls-streaming)
  - [Preview — `/preview`](#preview)
  - [DSK Overlay — `/dsk`, `/dsk-rtmp`](#dsk-overlay)
  - [Images — `/images`](#images)
  - [Icons — `/icons`](#icons)
  - [YouTube OAuth — `/youtube`](#youtube-oauth)

---

## Authentication

The API uses two independent authentication mechanisms depending on the endpoint.

### Bearer JWT (session-level)

Most endpoints require a `Authorization: Bearer <token>` header.

Obtain a token by registering a session:
```http
POST /live
Content-Type: application/json

{ "apiKey": "...", "domain": "https://your-app.example.com", "targets": [...] }
```

`streamKey` is **optional** — it exists for backward compatibility with single-target deployments. In the recommended target-array mode, omit `streamKey` and pass all YouTube stream keys inside the `targets` array instead.

Response:
```json
{ "token": "<JWT>", "sessionId": "...", "sequence": 0, "syncOffset": 0 }
```

Use the returned `token` in subsequent requests:
```http
Authorization: Bearer <JWT>
```

Alternatively, for SSE connections, pass the token as a query parameter:
```
GET /events?token=<JWT>
```

### Admin API Key (server-level)

Admin routes (`/keys`, `GET /usage` without `USAGE_PUBLIC`) require:
```http
X-Admin-Key: <ADMIN_KEY>
```

The `ADMIN_KEY` value is set via the server environment variable. If `ADMIN_KEY` is not configured, all admin routes return `503 Service Unavailable`.

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `JWT_SECRET` | auto-generated | HS256 signing secret for JWTs. **Always set this in production.** |
| `ADMIN_KEY` | none | API key for admin endpoints. Admin routes are disabled if not set. |
| `PORT` | `3000` | HTTP server port |
| `DB_PATH` | `./lcyt-backend.db` | Path to the SQLite database file |
| `SESSION_TTL` | `7200000` | Session idle timeout in milliseconds (default 2 hours) |
| `CLEANUP_INTERVAL` | `300000` | Session cleanup sweep interval in milliseconds (default 5 minutes) |
| `REVOKED_KEY_TTL_DAYS` | `30` | Days before revoked API keys are purged from the database |
| `REVOKED_KEY_CLEANUP_INTERVAL` | `86400000` | Revoked key cleanup interval in milliseconds (default 24 hours) |
| `ALLOWED_DOMAINS` | `lcyt.fi,www.lcyt.fi` | Comma-separated list of domains allowed to access `GET /usage` without an admin key (when `USAGE_PUBLIC` is set) |
| `USAGE_PUBLIC` | unset | If set to any value, `GET /usage` is accessible without authentication |
| `STATIC_DIR` | none | Directory to serve as static files |
| `FREE_APIKEY_ACTIVE` | unset | If set to `1`, enables the free-tier key self-service endpoint (`POST /keys?freetier`) |
| `FILES_DIR` | `/data/files` | Base directory for backend caption file saving. Each API key gets its own subdirectory. Requires `backend_file_enabled` on the key. |
| `CONTACT_NAME` | none | Name returned by `GET /contact` |
| `CONTACT_EMAIL` | none | Email returned by `GET /contact` |
| `CONTACT_PHONE` | none | Phone number returned by `GET /contact` |
| `CONTACT_WEBSITE` | none | Website URL returned by `GET /contact` |
| `RTMP_RELAY_ACTIVE` | unset | Set to `1` to enable the RTMP relay subsystem (`/rtmp`, `/stream`). |
| `RTMP_APPLICATION` | unset | If set, the `/rtmp` callback rejects requests where the RTMP `app` name does not match. |
| `RTMP_HOST` | `rtmp.lcyt.fi` | Hostname of the nginx-rtmp ingest server. Reported in `GET /health` when relay is active. |
| `RTMP_APP` | `stream` | RTMP application name for the main relay. Reported in `GET /health`. |
| `ALLOWED_RTMP_DOMAINS` | _(falls back to `ALLOWED_DOMAINS`)_ | Comma-separated domains allowed to use `/stream` relay endpoints. Set to `*` to allow all. |
| `BACKEND_URL` | _(derived from request)_ | Absolute URL of this backend. Used to build embed URLs in player snippets. |
| `GRAPHICS_ENABLED` | unset | Set to `1` to enable `POST /images` (DSK image upload). |
| `GRAPHICS_DIR` | `/data/images` | Base directory for DSK image storage. |
| `GRAPHICS_MAX_FILE_BYTES` | `5242880` (5 MB) | Maximum size per uploaded image. |
| `GRAPHICS_MAX_STORAGE_BYTES` | `52428800` (50 MB) | Maximum total image storage per API key. |
| `ICONS_DIR` | `/data/icons` | Base directory for branding icon storage. |
| `HLS_ROOT` | `/data/hls` | Directory where HLS playlists and segments are written for `/stream-hls`. |
| `RADIO_HLS_ROOT` | `/data/radio` | Directory where audio-only HLS playlists and segments are written for `/radio`. |
| `HLS_SUBS_ROOT` | `/tmp/hls-subs` | Directory where WebVTT subtitle segment files are written for `/video`. |
| `HLS_SUBS_SEGMENT_DURATION` | `6` | Subtitle segment length in seconds. |
| `HLS_SUBS_WINDOW_SIZE` | `10` | Number of subtitle segments kept per language in the rolling playlist window. |
| `RADIO_LOCAL_RTMP` | `rtmp://127.0.0.1:1935` | Local nginx-rtmp base URL used by the radio manager. |
| `PREVIEW_ROOT` | `/data/preview` | Directory where JPEG stream thumbnails are stored. |
| `DSK_LOCAL_RTMP` | `rtmp://127.0.0.1:1935` | Local nginx-rtmp base URL for the DSK ingest application. |
| `DSK_RTMP_APP` | `dsk` | nginx-rtmp application name for DSK RTMP ingest. |
| `YOUTUBE_CLIENT_ID` | none | Google OAuth 2.0 client ID — enables `GET /youtube/config`. |
| `TRUST_PROXY` | `true` | Express `trust proxy` setting. Set to `0` to disable, or a number for hop count. |

---

## CORS

CORS is handled dynamically:

- **`POST /live`**, **`GET /health`**, **`GET /contact`** — open to all origins
- **`POST /keys?freetier`** — open to all origins (if `FREE_APIKEY_ACTIVE=1`)
- **`GET /viewer/:key`** — open to all origins (`*`)
- **`GET /video/:key/…`** — open to all origins (`*`)
- **`GET /stream-hls/:key/*`**, **`GET /radio/:key/*`** — open to origins matching the per-key `embedCors` setting (defaults to `*`)
- **`GET /preview/:key/*`**, **`GET /images/:id`**, **`GET /icons/:id`**, **`GET /dsk/:key/*`** — open to all origins (`*`)
- **Authenticated routes** — only the `domain` registered in the session is allowed
- **Admin routes** — no CORS headers (intended for server-side use only)

---

## Error Responses

All endpoints return errors as JSON:

```json
{ "error": "Human-readable description" }
```

| Status | Meaning |
|---|---|
| `400` | Bad request / validation failure |
| `401` | Missing or invalid authentication |
| `403` | Valid credentials but insufficient permission |
| `404` | Resource not found |
| `409` | Conflict (e.g. duplicate session) |
| `429` | Usage limit exceeded |
| `503` | Admin endpoint disabled (no `ADMIN_KEY` configured) |

---

## Database Schema

The SQLite database contains the following tables:

| Table | Purpose |
|---|---|
| `api_keys` | Registered API keys with owner, limits, expiry, flags (`backend_file_enabled`, `relay_allowed`, `radio_enabled`, `hls_enabled`, `graphics_enabled`), `cea708_delay_ms`, `embed_cors`, and persisted sequence counter |
| `caption_usage` | Daily per-key caption counts |
| `session_stats` | Completed session telemetry |
| `caption_errors` | Caption delivery failure log |
| `auth_events` | Authentication and usage events |
| `domain_hourly_stats` | Per-domain aggregated caption statistics |
| `sessions` | Persistent session metadata for survival across server restarts |
| `caption_files` | Metadata for caption/translation files saved on the backend |
| `rtmp_relays` | Per-key RTMP relay slot configuration (targetUrl, targetName, captionMode, scale, fps, video/audio bitrate) |
| `rtmp_stream_stats` | Per-stream RTMP relay statistics (start/end time, duration, captions sent) |
| `rtmp_anon_daily_stats` | Anonymous daily RTMP relay aggregates by endpoint type and caption mode |
| `images` | DSK overlay image metadata (shorthand, filename, MIME type, size) |
| `icons` | Viewer branding icon metadata (filename, MIME type, size) |
| `viewer_key_daily_stats` | Per-API-key, per-viewer-key daily viewer opens |
| `viewer_anon_daily_stats` | Anonymous daily viewer open counts |

Additive migrations run automatically on startup.

---

## RTMP Relay

The RTMP relay re-streams one incoming RTMP signal to up to 4 destinations simultaneously using ffmpeg. It requires `RTMP_RELAY_ACTIVE=1` and a configured nginx-rtmp server.

| Endpoint | Purpose |
|---|---|
| [`POST/GET/PUT/DELETE /stream`](./stream.md) | Authenticated relay slot CRUD (requires `relay_allowed` on the key) |
| [`POST /rtmp`](./rtmp-callbacks.md) | nginx-rtmp publish/publish_done callbacks |

---

## Viewer

The viewer system broadcasts live captions to audience members via a public SSE endpoint.

| Endpoint | Purpose |
|---|---|
| [`GET /viewer/:key`](./viewer.md) | Public SSE stream — subscribe to live captions for a viewer key |

---

## Video Player

An embeddable HLS.js player that combines the live video stream with multilingual real-time subtitle tracks generated from caption data. No authentication required; CORS `*`.

| Endpoint | Purpose |
|---|---|
| [`GET /video/:key`](./video.md) | HLS.js player page — iframe-embeddable, supports `?theme=dark\|light` |
| [`GET /video/:key/master.m3u8`](./video.md) | HLS master manifest (video + all active subtitle tracks) |
| [`GET /video/:key/subs/:lang/playlist.m3u8`](./video.md) | HLS subtitle playlist for a specific language |
| [`GET /video/:key/subs/:lang/:seg.vtt`](./video.md) | WebVTT subtitle segment file |

---

## HLS Streaming

HLS streaming converts incoming RTMP streams to HLS for browser playback. Requires ffmpeg.

| Endpoint | Purpose |
|---|---|
| [`GET /stream-hls/:key/*`](./stream-hls.md) | Video+audio HLS stream (playlist, segments, embeddable player) |
| [`POST /stream-hls[/on_publish[_done]]`](./stream-hls.md) | nginx-rtmp callbacks |
| [`GET /radio/:key/*`](./radio.md) | Audio-only HLS stream (playlist, segments, embeddable player) |
| [`POST /radio[/on_publish[_done]]`](./radio.md) | nginx-rtmp callbacks |

---

## Preview

| Endpoint | Purpose |
|---|---|
| [`GET /preview/:key/incoming.jpg`](./preview.md) | Latest JPEG thumbnail of the incoming RTMP stream |

---

## DSK Overlay

The Downstream Keyer (DSK) system overlays graphics on the relayed video stream using caption metadata.

| Endpoint | Purpose |
|---|---|
| [`GET /dsk/:apikey/images`](./dsk.md) | List images available for the DSK page |
| [`GET /dsk/:apikey/events`](./dsk.md) | Public SSE stream of graphics events |
| [`POST /dsk-rtmp[/on_publish[_done]]`](./dsk.md) | nginx-rtmp callbacks for DSK RTMP ingest |

---

## Images

| Endpoint | Purpose |
|---|---|
| [`POST /images`](./images.md) | Upload a DSK overlay image (auth required; `GRAPHICS_ENABLED=1`) |
| [`GET /images`](./images.md) | List images for the authenticated key |
| [`GET /images/:id`](./images.md) | Serve image bytes publicly (no auth) |
| [`DELETE /images/:id`](./images.md) | Delete an image |

---

## Icons

| Endpoint | Purpose |
|---|---|
| [`POST /icons`](./icons.md) | Upload a branding icon (PNG or SVG) |
| [`GET /icons`](./icons.md) | List icons for the authenticated key |
| [`GET /icons/:id`](./icons.md) | Serve icon bytes publicly (no auth) |
| [`DELETE /icons/:id`](./icons.md) | Delete an icon |

---

## YouTube OAuth

| Endpoint | Purpose |
|---|---|
| [`GET /youtube/config`](./youtube.md) | Return the server's YouTube OAuth client ID for client-side GIS sign-in |
