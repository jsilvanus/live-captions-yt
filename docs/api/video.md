---
id: api/video
title: "/video — Multilingual HLS Player & Subtitle Sidecar"
methods: [GET]
auth: [none]
---

# /video — Multilingual HLS Player & Subtitle Sidecar

A set of public endpoints that serve an embeddable HLS video player with multilingual subtitle tracks. The player combines the live video stream (from `/stream-hls`) with real-time WebVTT subtitle segments automatically generated from the captions and translations delivered to the associated viewer key.

**CORS:** `Access-Control-Allow-Origin: *` on all `/video/…` routes — embeddable anywhere with `<iframe>`.

**Authentication:** None — all endpoints are fully public.

**Rate limit:** 240 requests per minute per IP across all `/video/…` endpoints.

---

## How it works

When captions are sent to a **viewer target**, the backend:

1. Writes rolling 6-second **WebVTT segment files** to disk — one set per active language (original + each translation).
2. Maintains **in-memory HLS subtitle playlists** with `EXT-X-PROGRAM-DATE-TIME` headers so an HLS player can align subtitle cues to video frames by wall clock.
3. Generates a **master HLS manifest** on demand that includes the live video stream and all active subtitle tracks as `EXT-X-MEDIA TYPE=SUBTITLES` entries.

The viewer key used for `/video/:key` is the same key configured in the CC → Targets tab for a **viewer** target type — no additional setup is needed.

---

## `GET /video/:key` — Embeddable HLS Player Page

Returns a self-contained HTML page with an HLS.js video player. The player loads the master manifest and exposes all available subtitle languages through the browser's **native CC (closed captions) button** in the standard video controls. No custom language picker UI is needed — the browser handles it natively with full accessibility support.

**URL parameter**

| Parameter | Description |
|---|---|
| `:key` | Viewer / HLS key. Same key used for `/viewer/:key` and `/stream-hls/:key`. Must match `/^[a-zA-Z0-9_-]{3,}$/`. |

**Query parameters**

| Parameter | Values | Default | Description |
|---|---|---|---|
| `theme` | `dark`, `light` | `dark` | Colour scheme of the player page |

**Response — `200 OK`**

```
Content-Type: text/html; charset=utf-8
Cache-Control: no-cache, no-store
```

Returns a full HTML page. The player auto-starts when the stream is live. If the stream is not running, a "Stream not live" message is shown and the player retries automatically every 5 seconds.

**Embed example:**

```html
<iframe
  src="https://api.example.com/video/my-event-key"
  width="960" height="540"
  frameborder="0"
  allow="autoplay"
  allowfullscreen>
</iframe>
```

```html
<!-- Light theme -->
<iframe src="https://api.example.com/video/my-event-key?theme=light" ...></iframe>
```

---

## `GET /video/:key/master.m3u8` — Master HLS Manifest

Returns the HLS master manifest combining the live video stream with all active subtitle tracks. Each subtitle track appears as an `EXT-X-MEDIA TYPE=SUBTITLES` entry, one per active language.

**Response — `200 OK`**

```
Content-Type: application/vnd.apple.mpegurl
Cache-Control: no-cache, no-store
```

**Example response (two subtitle languages active):**

```plaintext
#EXTM3U
#EXT-X-VERSION:3

#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",LANGUAGE="original",NAME="Original",DEFAULT=YES,AUTOSELECT=YES,FORCED=NO,URI="subs/original/playlist.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",LANGUAGE="fi-FI",NAME="Finnish",DEFAULT=NO,AUTOSELECT=YES,FORCED=NO,URI="subs/fi-FI/playlist.m3u8"

#EXT-X-STREAM-INF:BANDWIDTH=2800000,CODECS="avc1.4d401f,mp4a.40.2",SUBTITLES="subs"
https://api.example.com/stream-hls/my-event-key/index.m3u8
```

If no subtitle languages have arrived yet, the manifest is returned without `EXT-X-MEDIA` entries (video-only). The player still works — subtitles appear as they are generated.

**Error responses**

| Status | Reason |
|---|---|
| `400` | Invalid key format |
| `404` | Video stream not live (`/stream-hls/:key` not running) |

---

## `GET /video/:key/subs/:lang/playlist.m3u8` — Subtitle Playlist

Returns the HLS subtitle playlist for a specific language. Polled by the HLS player every segment interval.

**URL parameters**

| Parameter | Description |
|---|---|
| `:key` | Viewer key |
| `:lang` | BCP-47 language tag (e.g. `fi-FI`, `de-DE`) or `original` for the source language |

**Response — `200 OK`**

```
Content-Type: application/vnd.apple.mpegurl
Cache-Control: no-cache, no-store
```

**Example response:**

```plaintext
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:7
#EXT-X-MEDIA-SEQUENCE:40

#EXT-X-PROGRAM-DATE-TIME:2026-03-14T12:00:00.000Z
#EXTINF:6.000,
seg000040.vtt

#EXT-X-PROGRAM-DATE-TIME:2026-03-14T12:00:06.000Z
#EXTINF:6.000,
seg000041.vtt

#EXT-X-PROGRAM-DATE-TIME:2026-03-14T12:00:12.000Z
#EXTINF:6.000,
seg000042.vtt
```

- `EXT-X-TARGETDURATION` = segment duration + 1 second (per RFC 8216).
- `EXT-X-MEDIA-SEQUENCE` = index of the oldest segment in the rolling window.
- `EXT-X-PROGRAM-DATE-TIME` appears on every segment so the HLS player can align subtitle cues to video frames by wall clock, regardless of seek position within the DVR window.
- Empty segments (no cues during the interval) are included — the HLS spec forbids gaps in a live subtitle playlist.

**Error responses**

| Status | Reason |
|---|---|
| `400` | Invalid key or language tag format |
| `404` | Language not active yet or no segments written |

---

## `GET /video/:key/subs/:lang/:segment` — WebVTT Segment File

Returns a single WebVTT subtitle segment file.

**URL parameters**

| Parameter | Description |
|---|---|
| `:key` | Viewer key |
| `:lang` | BCP-47 language tag or `original` |
| `:segment` | Segment filename — must match `seg######.vtt` (6 zero-padded digits) |

**Response — `200 OK`**

```
Content-Type: text/vtt; charset=utf-8
Cache-Control: public, max-age=60
```

**Example WebVTT segment (with cues):**

```plaintext
WEBVTT

00:00:01.500 --> 00:00:04.000
Hello and welcome to the broadcast.

00:00:04.050 --> 00:00:06.000
Today we will be discussing...
```

**Example WebVTT segment (empty — no captions in this interval):**

```plaintext
WEBVTT
```

Cue timestamps are **relative to the segment start** as required by HLS WebVTT. The `EXT-X-PROGRAM-DATE-TIME` tag in the playlist maps each segment's relative timestamps back to wall-clock time.

**Security:** Path traversal is prevented — the resolved file path must be within `HLS_SUBS_ROOT`.

**Error responses**

| Status | Reason |
|---|---|
| `400` | Invalid key, language tag, or segment filename format |
| `404` | Segment file not found on disk |

---

## Subtitle Language Tags

The `original` track always contains the source-language caption text (the raw text typed or transcribed by the streamer). Additional tracks correspond to the BCP-47 language codes configured in the CC → Translation tab.

Common language tags:

| Tag | Language |
|---|---|
| `original` | Source language (original caption text) |
| `en` / `en-US` | English |
| `fi-FI` | Finnish |
| `de-DE` | German |
| `fr-FR` | French |
| `sv-SE` | Swedish |
| `es-ES` | Spanish |
| `ja-JP` | Japanese |
| `zh-CN` | Chinese (Simplified) |

---

## Browser Compatibility

| Browser | HLS method | Subtitle support |
|---|---|---|
| Chrome / Edge / Firefox | HLS.js (via CDN) | CC button shows subtitle track list |
| Safari (macOS / iOS) | Native HLS | CC button shows subtitle track list |
| Android Chrome | HLS.js | CC button shows subtitle track list |

All modern browsers with the native `<video>` controls will show the CC button and let the viewer select a language when at least one subtitle track is active.

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `HLS_SUBS_ROOT` | `/tmp/hls-subs` | Directory where WebVTT segment files are written. Each viewer key gets a subdirectory; each language gets a sub-subdirectory. |
| `HLS_SUBS_SEGMENT_DURATION` | `6` | Duration of each subtitle segment in seconds. |
| `HLS_SUBS_WINDOW_SIZE` | `10` | Number of segments kept per language in the rolling playlist window (older segments are evicted). |
| `BACKEND_URL` | _(derived from request)_ | Absolute URL of this backend. Used to build the video stream URL in the master manifest. Set this when the backend is behind a reverse proxy. |

---

## Storage and Cleanup

- WebVTT files are written to `${HLS_SUBS_ROOT}/<key>/<lang>/seg<N>.vtt`.
- Old segment files are automatically evicted from the rolling playlist window (controlled by `HLS_SUBS_WINDOW_SIZE`). The files remain on disk until `stopSubs()` is called or the server restarts.
- The `HLS_SUBS_ROOT` directory is **cleared on server startup** to remove files left over from a previous run.
- Subtitle tracking for a viewer key is automatically stopped after approximately `SESSION_TTL` ms (default 2 hours) of inactivity (no captions received).

---

## Relationship to Other Endpoints

| Endpoint | Relationship |
|---|---|
| [`GET /viewer/:key`](./viewer.md) | Same viewer key — the SSE stream for text-only clients (Android TV, custom overlays). `/video/:key` adds a video player on top of the same data feed. |
| [`GET /stream-hls/:key/*`](./stream-hls.md) | Provides the video stream referenced in the master manifest. Both must use the same key. |
