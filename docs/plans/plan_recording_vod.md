---
id: plan/recording_vod
title: "Recording & VOD Pipeline — Stored Videos from Broadcasts"
status: implemented (phase 1, local-storage path only; S3 upload of recorded segments and the worker-daemon recorder = not built)
summary: "Backs the Assets page's 'Stored videos' card with a real recording pipeline. A broadcast can opt in to recording (`record_enabled`); when it goes live, its MediaMTX stream path is patched to record (MediaMtxClient.patchPath) to HLS VOD (fMP4), and a videos table indexes the result keyed to the broadcast. Playback is HLS in-browser via `GET /videos/:id/playlist.m3u8`. MediaMTX native recording is the phase-1 recorder (chosen as the first step); the worker-daemon ffmpeg recorder (which already does ffmpeg + S3 upload) is a phase-2 alternative behind a swappable recorder interface — not started. **Verified against current code (2026-07-20):** only the local-disk fallback path actually works end-to-end — MediaMTX always writes segments locally, and `startVideoRecording`/`finishVideoRecording` (`packages/lcyt-backend/src/db/videos.js`) mark `storage_type='s3'` whenever `isS3Enabled()`, but no watcher/uploader (the plan called for reusing worker-daemon's `createUploader`/`createS3UploadFn` or the lcyt-files S3 adapter) ever moves the recorded segments to S3 — that half of the architecture was never wired up, so an S3-configured deployment would 404 on playback. `docker/mediamtx.yml` also never gained the recording-defaults section this plan called for (recording is configured dynamically per-path via `patchPath` instead, so this is cosmetic, not functional)."
related: plan/assets_page, plan/broadcasts, plan/asset_backends, plan/mediamtx, plan/hls_sidecar, plan/cloudfleet
---

# Recording & VOD Pipeline — Stored Videos from Broadcasts

Backs the third placeholder card from `plan_assets_page.md` (Stored videos) with
a real recording/VOD pipeline. This is the largest missing backend piece for the
Assets experience and is deliberately its own plan.

## Motivation

Today the platform can produce live captions and stream them, but it has no
persisted, user-accessible record of a completed broadcast. That means a project
cannot:

- opt a specific broadcast into recording,
- keep a post-broadcast VOD for later playback,
- browse stored recordings from the Assets page,
- or tie a recording back to the broadcast that generated it.

This plan closes that gap by adding a storage-backed recording pipeline that is
opt-in per broadcast, works with no S3 configuration, and exposes recordings as
first-class assets.

## Scope

- Add a per-broadcast recording toggle (`record_enabled`) on broadcasts.
- Start recording for opted-in broadcasts via MediaMTX native recording.
- Persist recording metadata in a new `videos` table.
- Serve HLS VOD playlists and segments through the backend, with local storage as
the default and S3 as an optional transport.
- Surface recordings in the Assets page and on the broadcast detail view.

## Decisions (locked)

- **Recorder → MediaMTX native recording first**; worker-daemon ffmpeg recorder
  is a **later stage**. Both sit behind one swappable recorder interface.
- **Trigger → opt-in per broadcast.** Recording happens only for broadcasts that
  enabled it — no storing every ad-hoc/test cast.
- **Output → HLS VOD** (segmented fMP4 + playlist), streamable in-browser.
- **Storage → S3 when configured, local-disk fallback otherwise.** Recordings
  are **not** hard-tied to S3: MediaMTX always writes segments to a local record
  dir first; if S3 is configured they upload there, and if it isn't they stay on
  local disk and the backend serves them. This matches the existing file-storage
  default (`FILE_STORAGE` defaults to `local`) so recording works with no S3
  configured.

## Architecture

```
broadcast (record_enabled) ──live──▶ MediaMTX path patched: record=yes
        │                                     │
        │                         fMP4 segments written
        │                                     ▼
        │                          uploaded to S3 (HLS VOD prefix)
        ▼                                     ▼
   on session end ─────────────▶ videos row (status=ready, broadcast_id, playlist, duration, size)
                                              ▼
                              Assets "Stored videos" card + Broadcast detail
```

### Recorder (phase 1: MediaMTX)

MediaMTX records natively per-path. `MediaMtxClient` already exposes
`patchPath(name, config)` / `addPath` / `deletePath`
(`packages/plugins/lcyt-rtmp/src/mediamtx-client.js`), so enabling recording is a
config patch, not new transport code:

- On a `record_enabled` broadcast going **live**, patch its stream path:
  `record: yes`, `recordFormat: fmp4`, `recordPath`, `recordSegmentDuration`,
  `recordDeleteAfter` (0 = keep). `docker/mediamtx.yml` gains recording defaults
  (off globally; enabled per-path at runtime).
- Segments are written to the local record path. **Destination depends on
  storage config:**
  - **S3 configured** → watch the record dir and **upload** segments + a
    generated VOD playlist to an S3 HLS-VOD prefix (reuse the worker-daemon's
    `createUploader` / `createS3UploadFn`, or the `lcyt-files` S3 adapter).
    `videos.storage_type='s3'`, `storage_prefix`/`playlist_key` point at S3.
  - **No S3 (fallback)** → leave the VOD on local disk under a recordings dir
    (e.g. `RECORDINGS_DIR`, defaulting like `FILES_DIR`); the backend serves the
    playlist + segments directly. `videos.storage_type='local'`, `storage_prefix`
    is the local path.
    This selection reuses the **same storage-adapter abstraction as `lcyt-files`**
    (local/s3), so "record without S3" is the default, not a special case.
- On session **end**, finalize: stop recording (patch path back), ensure the last
  segments are uploaded (S3) or flushed (local), write the `videos` row
  (`status='ready'`, duration, size).

### Recorder (phase 2: worker-daemon ffmpeg) — later

The worker-daemon already runs ffmpeg jobs and uploads to S3
(`packages/lcyt-worker-daemon/src/index.js`, `s3-uploader.js`). A phase-2
recorder records the relay input to HLS VOD via an ffmpeg job and uploads the
same way. Both recorders implement one interface:

```
recorder.start(broadcast, streamPath) → recordingHandle
recorder.stop(recordingHandle)        → { s3Prefix, playlistKey, durationMs, sizeBytes }
```

so the backend calls the interface, not MediaMTX/ffmpeg directly, and the choice
is deployment config (`RECORDER=mediamtx|worker`).

## Schema

New `videos` table + one additive column on `broadcasts`.

```sql
CREATE TABLE IF NOT EXISTS videos (
  id            TEXT PRIMARY KEY,                 -- uuid
  api_key       TEXT NOT NULL,
  broadcast_id  TEXT,                             -- FK broadcasts.id (nullable; with autocreate, effectively always set)
  title         TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'recording',-- recording|processing|ready|failed
  storage_type  TEXT NOT NULL DEFAULT 'local',    -- local|s3 (matches lcyt-files default: local unless S3 configured)
  storage_prefix TEXT,                            -- S3 prefix, or local dir path, of the HLS VOD
  playlist_key  TEXT,                             -- object key / relative path of the VOD .m3u8
  duration_ms   INTEGER,
  size_bytes    INTEGER NOT NULL DEFAULT 0,
  started_at    TEXT,
  ended_at      TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_videos_api_key      ON videos(api_key);
CREATE INDEX IF NOT EXISTS idx_videos_broadcast_id ON videos(broadcast_id);
```

Additive to `plan_broadcasts.md`'s `broadcasts` table:

```sql
ALTER TABLE broadcasts ADD COLUMN record_enabled INTEGER NOT NULL DEFAULT 0;
```

`record_enabled` is the opt-in flag, editable from the broadcast (Setup/Assets or
the broadcast detail). Nullable `broadcast_id` on `videos` keeps ad-hoc
recordings valid, though with broadcast auto-create every recording has one.

## API surface

`packages/lcyt-backend/src/routes/videos.js` (new), `auth`-guarded; data-access in
`src/db/videos.js` per the repo convention:

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/videos` | List (filter `?broadcastId=`, `?status=`) |
| `GET` | `/videos/:id` | Metadata + playback URL |
| `GET` | `/videos/:id/playlist.m3u8` | VOD playlist via backend; its segment URLs are direct signed S3/CDN links (decided) |
| `DELETE` | `/videos/:id` | Delete row + underlying VOD (S3 objects, or local files, under `storage_prefix`) |

## Frontend

- **Assets page** — the **Stored videos** card lists `videos` rows (title,
  duration, status), row → an HLS player; ties into the broadcast that produced
  it.
- **Broadcast detail** (`plan_broadcasts.md`) — shows the broadcast's recording
  inline, and a **Record this broadcast** toggle writing `record_enabled`.

## Implementation milestones

1. **Phase 1 (this plan's core):** MediaMTX recorder + S3 VOD upload + `videos`
   index + `record_enabled` opt-in + playback + Assets card.
2. **Phase 2 (later):** worker-daemon ffmpeg recorder behind the same interface.
3. **Deferred:** in-browser trimming/clipping, automatic transcodes/renditions,
   thumbnails-from-video (thumbnails come from the graphics editor — see
   `plan_asset_backends.md`).

## Repository touchpoints

- `packages/plugins/lcyt-rtmp/src/mediamtx-client.js` — patch path config for
  native recording.
- `packages/lcyt-backend/src/routes/live.js` — start/stop recording when a
  broadcast transitions live/completes.
- `packages/lcyt-backend/src/routes/videos.js` and `src/db/videos.js` — new
  recording metadata and playlist endpoints.
- `packages/lcyt-backend/src/db/schema.js` — `videos` table migration and
  `broadcasts.record_enabled` column.
- `docker/mediamtx.yml` — recording defaults and output path configuration.
- `packages/lcyt-web/src/components/AssetsPage.jsx` and broadcast detail UI —
  render the stored-video card and recording toggle.
- `packages/lcyt-worker-daemon/` — phase-2 ffmpeg-based recorder implementation.

## Open questions

- Should deletion of a broadcast archive the recording as well, or should the
  recording retain an independent lifecycle? The current decision is to keep the
  recording and null its link to the deleted broadcast.
- For local fallback playback, should the backend stream segments directly or use
  a small static-file route with caching headers? The plan assumes the backend
  serves them directly for now.
- Should the initial UI include a per-video status badge for `processing` while
  MediaMTX finalizes and uploads segments? A visible badge is likely useful even
  if the backend can expose a simple `status` field.

## Testing and acceptance criteria

- A broadcast with `record_enabled=1` starts recording when it becomes live.
- A completed recording produces a `videos` row with `status='ready'`, a playlist
  path, and a non-zero duration/size when the stream contains content.
- Local storage mode works without S3 configured; S3 mode uploads segments and
  playlist to the configured prefix.
- The Assets page lists the recording row and can open an HLS player for it.
- The broadcast detail view can toggle recording for the current broadcast.

## Cross-plan alignment

- **`plan_assets_page.md`** — flips the Stored videos placeholder to a real card.
- **`plan_broadcasts.md`** — adds `record_enabled`; `videos.broadcast_id` ties a
  recording to its broadcast (shown on the broadcast detail). Deleting a
  broadcast does not delete its videos (they carry their own lifecycle); confirm
  in the open questions.
- **`plan_mediamtx.md` / `plan_hls_sidecar.md`** — reuses the MediaMTX broker and
  the HLS + S3 segment machinery those plans established.
- **`plan_cloudfleet.md` / worker-daemon** — the phase-2 recorder path.

## Resolved (smaller) decisions

1. **Playback URL → backend playlist, storage-aware segments.** The VOD `.m3u8`
   playlist is always served via the backend (`GET /videos/:id/playlist.m3u8`,
   uniform auth). The segment URLs it references depend on `storage_type`:
   **S3** → **direct signed S3/CDN links** (low backend load, private-bucket
   safe); **local (fallback)** → backend-served segment files
   (`GET /videos/:id/seg/:name`, same auth). Either way recordings stay
   access-controlled — no public objects required.
2. **Retention → keep until manually deleted.** No auto-expiry/TTL and no
   periodic sweep — recordings live until a user deletes them, which removes the
   S3 objects. Consistent with the Broadcasts "no auto-purge" decision.
3. **Broadcast delete vs. its videos → keep the video, null the link.** When a
   broadcast is permanently deleted (after its cooling-off window), its
   `videos.broadcast_id` is set `NULL` (the recording survives, unassigned) —
   the same "produced content survives" rule as caption files. The recording is
   only removed by an explicit `DELETE /videos/:id`.

## Out of scope

- Live DVR / rewind during broadcast (this is post-broadcast VOD).
- Editing/clipping, multi-rendition transcoding, external ingest of arbitrary
  video files (the earlier "thin external-reference" option was not chosen).
