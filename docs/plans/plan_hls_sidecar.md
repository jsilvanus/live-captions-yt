---
id: plan/hls-sidecar
title: "HLS Multilingual Caption Sidecar"
status: implemented
summary: "Rolling WebVTT subtitle segments sidecar for HLS stream; HLS.js player at /video/:key with CC language selection."
---

# PLAN.md — HLS Multilingual Caption Sidecar

## Goal

Add a multilingual HLS subtitle sidecar to `packages/lcyt-backend` that:

1. Converts real-time caption + translation cues into rolling WebVTT segment files on disk
2. Maintains a per-language HLS subtitle playlist (`.m3u8`) for each active language
3. Generates a master HLS manifest combining the existing delayed video stream with all subtitle tracks
4. Serves an HLS.js-based player page at `GET /video/:key` — public, CORS `*`, `iframe`-embeddable
5. Lets any website embed a fully-working multilingual video player with `<iframe src="https://api.lcyt.fi/video/myevent">`

---

## Background and Motivation

LCYT already:
- Sends captions in real time to YouTube (one language per YouTube target)
- Produces translations for all active languages simultaneously
- Delays the video stream ~30 s to let ASR finish, so captions and video arrive in sync at the viewer
- Runs its own FFmpeg/nginx-RTMP → HLS pipeline for the delayed stream (`/stream-hls/:key/…`)

What's missing: a user-selectable, embeddable multilingual player. YouTube only accepts one caption language per stream. The new sidecar solves this by writing an HLS subtitle sidecar in parallel with the existing video HLS pipeline, producing a master manifest that carries every translation as a selectable subtitle track.

---

## Architecture

### Data Flow

```
lcyt-web (streamer)
  └─▶ POST /captions { text, translations: { 'fi-FI': '...', 'de-DE': '...' } }
        └─▶ captions.js (async _sendQueue)
              └─▶ broadcastToViewers(viewerKey, { text, composedText, translations, timestamp, sequence })
                    ├─▶ SSE → GET /viewer/:key          (Android TV, embed widgets)   [existing]
                    └─▶ hlsSubsManager.addCue(...)       (per-language WebVTT writer)  [NEW]

Segment timer fires every 6 s per active viewer key:
  └─▶ _flush(viewerKey)
        └─▶ write /tmp/hls-subs/<key>/<lang>/seg<N>.vtt   for each language
              └─▶ update in-memory playlist per language

HTTP (public, CORS *, embeddable):
  GET /video/:key                            → HLS.js player HTML
  GET /video/:key/master.m3u8               → master HLS manifest (video + subs)
  GET /video/:key/subs/:lang/playlist.m3u8  → HLS subtitle playlist
  GET /video/:key/subs/:lang/seg:N.vtt      → WebVTT segment file
```

### Integration Point

The new `HlsSubsManager` is instantiated in `server.js` and injected into two places:

- `createViewerRouter(db, hlsSubsManager)` — calls `addCue()` inside `broadcastToViewers()`
- `createVideoRouter(db, hlsManager, hlsSubsManager)` — serves manifests + segments

No changes are needed to `captions.js` or `store.js`.

```
server.js
  ├─ hlsManager      (existing)  — ffmpeg RTMP → video segments
  ├─ hlsSubsManager  (NEW)       — caption cues → WebVTT segments
  ├─ /stream-hls  → createStreamHlsRouter(db, hlsManager)          [unchanged]
  ├─ /viewer      → createViewerRouter(db, hlsSubsManager)          [MODIFIED signature]
  └─ /video       → createVideoRouter(db, hlsManager, hlsSubsManager) [NEW]
```

---

## File Structure

All new code lives inside `packages/lcyt-backend/`:

```
packages/lcyt-backend/
├── src/
│   ├── hls-subs-manager.js          NEW  WebVTT segment writer + in-memory playlist manager
│   ├── routes/
│   │   ├── viewer.js                MOD  accept hlsSubsManager param; call addCue() in broadcastToViewers()
│   │   ├── video.js                 NEW  GET /video/:key — player, master manifest, subs serving
│   │   └── stream-hls.js                 unchanged
│   └── server.js                    MOD  instantiate HlsSubsManager; register /video router
└── test/
    └── hls-subs-manager.test.js     NEW  unit tests for the subs manager
```

No new npm packages are required. Everything uses Node.js stdlib (`node:fs/promises`, `node:path`, `node:timers`).

---

## Key Design Decisions

### 1. Where to Integrate

**Decision: inside `lcyt-backend`, not a separate service.**

Rationale:
- The translation data is already present in the viewer broadcast payload — no round-trip needed.
- The existing HLS video infrastructure (`hls-manager.js`, `stream-hls.js`) lives here; the master manifest must reference both.
- Single deployment unit, no inter-process coordination.
- The `hls_enabled` column on `api_keys` already gates the feature at the DB level.

### 2. Segment Duration

**Decision: 6-second segments, 10-segment rolling window.**

- 6 s > 4 s video segments, ensuring each subtitle segment cleanly covers at least one video segment worth of content without splitting cues mid-segment.
- 10 segments = 60 s of subtitle history always available — enough for HLS players to seek back within the DVR window.
- Empty segments (no cues in window) **must** be written — the HLS spec forbids gaps in a live subtitle playlist. An empty WebVTT file (`WEBVTT\n`) satisfies this.
- Configurable via `HLS_SUBS_SEGMENT_DURATION` and `HLS_SUBS_WINDOW_SIZE` env vars.

### 3. Timestamp Alignment

**Decision: use `#EXT-X-PROGRAM-DATE-TIME` in subtitle playlists.**

FFmpeg inserts `EXT-X-PROGRAM-DATE-TIME` into the video playlist (wall-clock time of each segment). By matching this in the subtitle playlist, HLS.js aligns subtitle cues to video frames automatically, regardless of segment boundary offsets.

Cue timestamps within a segment are expressed relative to the segment's wall-clock start:
```
cueStart = abs_caption_timestamp_ms - segmentStartMs
cueEnd   = cueStart + DEFAULT_CUE_DURATION_MS   (default 3500 ms, or next cue start − 50 ms)
```

### 4. Language Tags and File Paths

The `translations` object from the viewer broadcast uses BCP-47 tags (`fi-FI`, `de-DE`).
The original caption text is stored under the tag `'original'`.

For file paths, BCP-47 tags are used verbatim (e.g., `fi-FI/`) because Linux filesystems are case-sensitive and `fi-FI` is unambiguous. HLS `EXT-X-MEDIA` `LANGUAGE=` attributes use the same tag.

Human-readable language names for the player UI are resolved from a small built-in map covering the ~20 most common locales. Unknown tags fall back to the BCP-47 tag itself.

### 5. Storage Layout

```
${HLS_SUBS_ROOT}/            default: /tmp/hls-subs
└── <viewerKey>/
    ├── original/
    │   ├── seg000042.vtt
    │   └── seg000043.vtt
    ├── fi-FI/
    │   ├── seg000042.vtt
    │   └── seg000043.vtt
    └── de-DE/
        └── ...
```

Playlists are held **in memory** (never written to disk) and served on demand. Only `.vtt` segment files are written to disk.

Cleanup: `stopSubs(viewerKey)` removes the key's directory. Called automatically when a viewer key loses its last active session (tracked in `viewer.js`). A startup sweep removes orphaned dirs older than `SESSION_TTL`.

### 6. Master Manifest (generated on-the-fly)

```m3u8
#EXTM3U
#EXT-X-VERSION:3

#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",LANGUAGE="original",NAME="Original",DEFAULT=YES,AUTOSELECT=YES,FORCED=NO,URI="subs/original/playlist.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",LANGUAGE="fi-FI",NAME="Finnish",DEFAULT=NO,AUTOSELECT=YES,FORCED=NO,URI="subs/fi-FI/playlist.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",LANGUAGE="de-DE",NAME="German",DEFAULT=NO,AUTOSELECT=YES,FORCED=NO,URI="subs/de-DE/playlist.m3u8"

#EXT-X-STREAM-INF:BANDWIDTH=2800000,CODECS="avc1.4d401f,mp4a.40.2",SUBTITLES="subs"
/stream-hls/<key>/index.m3u8
```

- If the video stream is not running (`hlsManager.isRunning(key) === false`), return 404.
- If no subtitle languages are active yet, emit the manifest without `EXT-X-MEDIA` lines and without `SUBTITLES=` on the stream-inf.
- `BANDWIDTH` is hard-coded to a typical value; adding ffprobe inspection is noted as future work.

### 7. Player Page

- Served from an inline HTML template in `video.js` (no separate static file needed at this size).
- Loads **hls.js 1.5.15** from jsDelivr CDN (same version as the existing `stream-hls` player snippet).
- Points at `/video/:key/master.m3u8`.
- **No custom language selector UI.** HLS.js wires subtitle tracks from the master manifest directly to the `<video>` element's `textTracks` API. The browser's **native CC button** in the standard video controls then exposes all languages for user selection — no extra JavaScript or UI needed.
- Safari/iOS use native HLS and get the same CC button behaviour for free.
- `?theme=light` query param switches to a light colour scheme; default is dark.
- No `X-Frame-Options` header → embeddable anywhere.
- CORS `*` on all `/video/…` routes.
- Minimal CSS; responsive (`width: 100%; max-width: 960px`).

> **Why native CC?** The browser already presents a polished, accessible, localised CC picker (language names, keyboard nav, screen reader support). Building a custom `<select>` on top of it would be redundant and worse UX. HLS.js takes care of the plumbing; the browser takes care of the UI.

### 8. Security

- Key validation: `/^[a-zA-Z0-9_-]{3,}$/` (same regex as viewer and HLS video keys).
- Path traversal guard: `resolve(requestedPath).startsWith(resolve(HLS_SUBS_ROOT) + sep)` on every segment file serve.
- Language tag validation: `/^[a-zA-Z0-9_-]{2,20}$/` before use in file paths.
- No authentication required (`/video/…` is fully public by design).
- Rate limiting: 120 req/min/IP (reuse existing `hlsRateLimit` from `stream-hls.js`).

---

## Module API: `hls-subs-manager.js`

```js
export class HlsSubsManager {
  constructor({ subsRoot, segmentDuration, windowSize } = {})

  // Buffer a caption cue for the given viewer key and language.
  // Called from viewer.js after broadcastToViewers().
  // - viewerKey: e.g. 'myevent'
  // - lang:      BCP-47 tag, e.g. 'fi-FI', or 'original' for the source language
  // - text:      plain caption text for this language
  // - timestamp: ISO string from the caption payload ('YYYY-MM-DDTHH:MM:SS.mmm')
  addCue(viewerKey, lang, text, timestamp)

  // Return the active language tags for a viewer key. [] if none.
  getLanguages(viewerKey)          // → string[]

  // Return HLS subtitle playlist m3u8 string for a language, or null if not found.
  getPlaylist(viewerKey, lang)     // → string | null

  // Stop tracking a viewer key and delete its segment files.
  stopSubs(viewerKey)              // → Promise<void>

  // Stop all keys (call on graceful shutdown).
  stopAll()                        // → Promise<void>
}
```

Internal per-key state structure:
```js
{
  timer:        NodeJS.Timeout | null,
  segmentStart: number,              // Date.now() ms at start of current window
  segmentIndex: number,              // counter for segment filenames (monotonic)
  pendingCues:  Map<lang, Cue[]>,    // cues buffered for the current window
  langs:        Map<lang, {
    sequence:   number,              // EXT-X-MEDIA-SEQUENCE (oldest seg in window)
    segments:   string[],            // rolling list of filenames (max windowSize)
    segTimes:   number[],            // wall-clock ms for EXT-X-PROGRAM-DATE-TIME
  }>,
}
```

---

## WebVTT Segment Format

Segment with cues:
```
WEBVTT

00:00:01.500 --> 00:00:04.000
Tervetuloa kirkolliskokoukseen

00:00:04.100 --> 00:00:06.000
Welcome to the church assembly
```

Empty segment (no cues in window — required to avoid playlist gaps):
```
WEBVTT
```

- Timestamps are relative to `segmentStartMs`.
- `cueEnd` = next cue's `cueStart − 50 ms`, capped at segment duration.
- Cue identifiers are omitted (not required by HLS WebVTT).

---

## HLS Subtitle Playlist Format

```m3u8
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

- `EXT-X-TARGETDURATION` = `segmentDuration + 1` (per RFC 8216 §4.3.3.1).
- `EXT-X-MEDIA-SEQUENCE` = index of the oldest segment in the window.
- `EXT-X-PROGRAM-DATE-TIME` on every segment (required for wall-clock alignment with video).
- Playlist is regenerated in-memory on every `GET /video/:key/subs/:lang/playlist.m3u8` request.

---

## New Routes: `GET /video/…`

| Method | Path | Response | CORS |
|--------|------|----------|------|
| `GET` | `/video/:key` | HLS.js player HTML | `*` |
| `GET` | `/video/:key/master.m3u8` | Master HLS manifest | `*` |
| `GET` | `/video/:key/subs/:lang/playlist.m3u8` | Subtitle HLS playlist | `*` |
| `GET` | `/video/:key/subs/:lang/:segment` | WebVTT segment file | `*` |
| `OPTIONS` | `/video/:key/…` | CORS preflight 204 | `*` |

All responses: `Cache-Control: no-cache, no-store` for playlists and player; `Cache-Control: public, max-age=60` for segment files.

---

## Environment Variables

| Variable | Purpose | Default |
|---|---|---|
| `HLS_SUBS_ROOT` | Directory for WebVTT segment files | `/tmp/hls-subs` |
| `HLS_SUBS_SEGMENT_DURATION` | Segment length in seconds | `6` |
| `HLS_SUBS_WINDOW_SIZE` | Number of segments to keep per language | `10` |

---

## Implementation Phases

### Phase 1 — `HlsSubsManager` core

Files: `src/hls-subs-manager.js`, `test/hls-subs-manager.test.js`

- Constructor: read env vars, initialise per-key state map
- `addCue()`: validate key/lang/timestamp; start timer on first cue; buffer cue in `pendingCues`
- Segment timer: call `_flush(viewerKey)` every `segmentDuration` seconds
- `_flush()`: for each language, build WebVTT text from pending cues → write `seg<N>.vtt` → update `langs` rolling window → advance `segmentIndex`
- `_buildWebVTT(cues, segStartMs)`: format timestamps relative to segment start; compute cue end times
- `_buildPlaylist(langState)`: generate m3u8 string from rolling segment list
- `getLanguages()`, `getPlaylist()`, `stopSubs()`, `stopAll()`
- Unit tests covering: empty segments, cue timestamp math, rolling window eviction, playlist format

### Phase 2 — Viewer route integration

File: `src/routes/viewer.js`

- Add `hlsSubsManager` parameter to `createViewerRouter(db, hlsSubsManager)`
- Extend `broadcastToViewers(viewerKey, data, hlsSubsManager)` (or call directly after broadcast):
  - For each key in `data.translations`: `hlsSubsManager.addCue(viewerKey, lang, text, data.timestamp)`
  - For the original text: `hlsSubsManager.addCue(viewerKey, 'original', data.text, data.timestamp)`
- Call `hlsSubsManager.stopSubs(key)` when the last SSE client disconnects from a viewer key (already tracked in `viewerSubs` — when `clients.size === 0` after remove)

File: `src/server.js`

- Import and instantiate `HlsSubsManager`
- Pass it to `createViewerRouter` and `createVideoRouter`
- Call `hlsSubsManager.stopAll()` in graceful shutdown handler

### Phase 3 — `/video` routes

File: `src/routes/video.js`

- `createVideoRouter(db, hlsManager, hlsSubsManager)` factory
- `GET /video/:key` — inline HTML template with `KEY` and `BACKEND_URL` substituted
- `GET /video/:key/master.m3u8` — build manifest string from `hlsManager.isRunning()` + `hlsSubsManager.getLanguages()`
- `GET /video/:key/subs/:lang/playlist.m3u8` — return `hlsSubsManager.getPlaylist(key, lang)` or 404
- `GET /video/:key/subs/:lang/:segment` — validate filename (`/^seg\d{6}\.vtt$/`), serve file with path-traversal guard
- CORS `*` + rate limiting on all routes

### Phase 4 — Player HTML

Inline in `video.js` (template literal):

- `<video>` element, `controls`, `autoplay="false"`
- HLS.js from jsDelivr CDN (version 1.5.15, matching `stream-hls.js`)
- `hls.loadSource('/video/:key/master.m3u8')`; `hls.attachMedia(video)`
- HLS.js automatically maps `EXT-X-MEDIA TYPE=SUBTITLES` tracks onto the `<video>` element's native `textTracks` — the **browser's own CC button** handles language selection with no custom UI
- Set `hls.subtitleDisplay = true` so HLS.js renders the active subtitle track into the video; the CC button controls which track is active
- CSS: dark theme default, `?theme=light` override, `max-width: 960px`, mobile-safe viewport meta
- Short "Stream not live" overlay when video errors with `MEDIA_ATTACH_ERROR` or `FATAL`

### Phase 5 — Cleanup and polish

- Startup sweep: on `server.js` init, remove `/tmp/hls-subs/*` dirs older than `SESSION_TTL`
- Graceful shutdown: `hlsSubsManager.stopAll()` alongside existing `hlsManager.stopAll()`
- `CLAUDE.md` update: add `HLS_SUBS_ROOT` to env var table; add `/video/:key` to routes table
- Manual test matrix: Firefox (hls.js path), Safari (native HLS), mobile Chrome

---

## Open Questions / Future Work

| Item | Notes |
|---|---|
| **Source language tag** | The viewer payload has no explicit `sourceLang` field. Using `'original'` as the key is safe and unambiguous. Passing the actual BCP-47 source tag (e.g. `'en'`) requires either a session config lookup or an extra field on the broadcast payload — defer to a follow-up PR. |
| **Video CODECS string** | The master manifest hard-codes `avc1.4d401f,mp4a.40.2` (H.264 Baseline + AAC). This covers all OBS/hardware encoder defaults. Add ffprobe detection as an optional enhancement later. |
| **Subtitle-only mode** | If no video stream is running, still serve subtitle playlists (useful for testing captioning without video). The master manifest can reference a dummy stream-inf pointing at a non-live video URL — the player will show an error for video but subtitles remain accessible. |
| **CEA-708 embedding** | Future: embed captions directly into `.ts` segments via ffmpeg `mov_text`/`cea608` — enables closed-caption rendering on devices that don't support WebVTT sidecar (e.g. Smart TVs). Out of scope here. |
| **Rate limit tuning** | 120 req/min/IP was designed for video segments. Subtitle playlists are polled at the same frequency; the limit covers both. Monitor in production and tune if needed. |
| **Horizontal scaling** | `HlsSubsManager` state is in-process. Fine for the current single-VPS deployment. For multi-instance, move segment files to shared storage (NFS/S3) and playlist state to Redis. |
