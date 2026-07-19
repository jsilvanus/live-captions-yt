---
id: plan/mixer_feed_sources
title: "Mixer Feed Sources — Looping File Sources & Low-Latency Preview Tiles"
status: draft
summary: "Adds a looping-video-file source type to the LCYT software mixer's program bus, and upgrades the mixer's own preview panel from static thumbnails to live low-res video (WHEP) for responsive switching feedback. Camera PTZ control is unchanged. The previously-planned 'encoder' (already-mixed external feed) source type is dropped from this plan entirely — it's now covered by plan_ingest_feeds.md's prod_cameras control_type:'rtmp', which the mixer's existing sources query already picks up with zero changes."
---

# Mixer Feed Sources — Looping File Sources & Low-Latency Preview Tiles

## Context

Today the LCYT software mixer's program bus (`prod_mixers` rows with `type='lcyt'`) only draws from cameras: `GET /production/mixers/:id/sources` (`packages/plugins/lcyt-production/src/routes/mixers.js:230-260`) queries `prod_cameras WHERE mixer_input IS NOT NULL`, and `LcytMixerPage.jsx` composites the active source client-side (HLS.js → canvas → WHIP egress). The user wanted two more source kinds usable on that same program bus: an **already-mixed feed pushed in from the user's own external encoder/switcher**, and a **looping video file** (e.g. a slate, count-in, or pre-recorded segment).

**Reconciliation with `plan_ingest_feeds.md` (2026-07-18):** this plan originally modeled both of those as a new `prod_mixer_feed_sources` table with `source_type: 'encoder' | 'file'`. Working out `plan_ingest_feeds.md` (a generalization of RTMP ingestion to arbitrary named feeds, motivated by an unrelated egress-routing need) surfaced that its `control_type: 'rtmp'` addition to `prod_cameras` — a named, ingest-only feed with `camera_key` for its MediaMTX path and an optional `mixer_input` — is exactly this plan's "encoder" concept, arrived at independently from the other direction. There is no reason to keep two tables for the same thing:

- **The `'encoder'` source type is dropped from this plan entirely.** An already-mixed external feed is now just a `prod_cameras` row with `control_type: 'rtmp'` and `mixer_input` set — created via the existing camera form, ingested via `plan_ingest_feeds.md` §2a's `feed-rtmp` router, and it **already appears** in `GET /production/mixers/:id/sources` today with no query change, since that endpoint has never filtered on `control_type`.
- **Live vs. on-program stays correctly separated** — see `plan_ingest_feeds.md`'s note on this: an `'rtmp'`-type camera's live/publishing state (tracked by `feed-rtmp`'s `on_publish`/`on_publish_done`) is independent of whether it's the mixer's active source, and `crop_source_map`/`resolveCropPresetForSource()`'s existing `mixer_input`-tier follow behavior already handles this correctly for any camera regardless of `control_type` — no new plumbing needed for crop-follow to work with these feeds.
- **What's left, and stays in this plan:** the `'file'` (looping video) source type — genuinely distinct, since it needs its own storage-backed asset and a managed ffmpeg loop rather than an external push — and the WHEP live-preview-tile upgrade for the mixer's sidebar.

**The dependency on a "preview-transcode pipeline" from `plan_monitors.md` in this plan's earlier draft was wrong and has been removed.** That plan (since renamed/rewritten to `plan_ingest_feeds.md`) never actually specified a `PreviewTranscodeManager`, a downscaled `{key}-preview` MediaMTX rendition, or a `PreviewTile.jsx` component — its own text explicitly said "no preview pipeline, downscaler, or live tile" is in scope there. That was a stale/aspirational cross-reference to content that was never written. **This plan now owns building that preview-transcode/WHEP pipeline itself** — see §3 and the phased rollout below, which now includes standing it up rather than reusing it.

Camera PTZ control (bridge relay to AMX/Roland, etc.) is unrelated to and unaffected by this plan — it already works identically regardless of where mixing happens.

## Important disambiguation

`prod_encoders` already exists (`packages/plugins/lcyt-production/src/db.js:47-57`, `routes/encoders.js`) for **hardware encoder control** (e.g. Matrox Monarch HD/HDx — an HTTP-API-driven box). That table is unrelated to, and unaffected by, both this plan and `plan_ingest_feeds.md`'s `control_type: 'rtmp'` cameras (a plain ingest-only feed with no control channel). Keep these clearly disambiguated in code comments and CLAUDE.md — an operator might colloquially call an `'rtmp'`-type camera fed from their external switcher "an encoder feed," but it shares no code or table with `prod_encoders`.

## 1. Data model

New table in `packages/plugins/lcyt-production/src/db.js`, scoped now to file sources only:

```sql
CREATE TABLE IF NOT EXISTS prod_mixer_feed_sources (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  ingest_key          TEXT NOT NULL,                 -- MediaMTX path name
  ingest_mode         TEXT NOT NULL DEFAULT 'push',  -- 'push' | 'managed'
  mixer_id            TEXT NOT NULL REFERENCES prod_mixers(id) ON DELETE CASCADE,
  mixer_input         INTEGER NOT NULL,               -- program-bus input slot, required
  sort_order          INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_prod_mixer_feed_sources_mixer ON prod_mixer_feed_sources(mixer_id, mixer_input);

CREATE TABLE IF NOT EXISTS prod_feed_source_files (
  feed_source_id      TEXT PRIMARY KEY REFERENCES prod_mixer_feed_sources(id) ON DELETE CASCADE,
  storage_namespace   TEXT NOT NULL DEFAULT '_production-feeds',
  stored_key          TEXT NOT NULL,
  original_filename   TEXT,
  mime_type           TEXT,
  size_bytes          INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
```

The `source_type` discriminator from the earlier draft is dropped — every row here is a file source now, so it would only ever hold one value. `mixer_id`/`mixer_input` stay `NOT NULL`: every row in this table exists *because* it's wired into a program bus, unlike `prod_cameras`, which can hold un-mixed, un-egressed feeds (monitors) with no `mixer_input` at all. `ingest_mode: 'push'` (user runs their own external loop into our ingest key — no backend process) or `'managed'` (backend spawns/supervises the loop, §2).

`lcyt-files` (`packages/plugins/lcyt-files/`) has no generic media-asset table suited to an arbitrary uploaded video file — only `caption_files` (text-format-oriented) and `icons` (images). Rather than overload either, `prod_feed_source_files` (owned by `lcyt-production`) stores the reference and delegates byte storage to `lcyt-files`' existing storage adapter (`initFilesControl(db)` → `{ storage, resolveStorage }`) under a fixed `_production-feeds` pseudo-namespace, reusing the adapter's `openRead`/`openAppend` interface as-is (documented in `lcyt-files/CLAUDE.md`).

## 2. Backend

**New file `packages/plugins/lcyt-production/src/routes/mixer-feed-sources.js`** — CRUD mirroring `routes/cameras.js`, scoped to a parent mixer (`/production/mixers/:mixerId/feed-sources`): `GET`/`POST`/`PUT /:id`/`DELETE /:id`. Validates `ingest_mode` ∈ `{push,managed}`. Delete tears down any managed-file loop and the preview-transcode registration (§3).

**`GET /production/mixers/:id/sources` needs only one change now**, not the full union rework the earlier draft called for: it already returns `'rtmp'`-type cameras (the former "encoder" case) for free. Add a second union leg for `prod_mixer_feed_sources` (file rows only): `SELECT * FROM prod_mixer_feed_sources WHERE mixer_id = ? ORDER BY sort_order, created_at`, merged and sorted by `mixerInput` alongside the camera query. Response gains a `sourceKind` discriminator (`camera`|`file` — a camera row's own `controlType` field, already returned today, further distinguishes PTZ/webcam/`rtmp` for any UI that wants to hide PTZ chrome for ingest-only feeds) and `previewHlsUrl`/`previewWhepUrl` (in addition to the existing full-res `hlsUrl`, which stays reserved for the active/PGM source only). Rename the id field `cameraId` → `sourceId` (its only consumer, `LcytMixerPage.jsx`, is updated in lockstep, §4).

**Push-mode file ingest reuses `plan_ingest_feeds.md` §2a's `feed-rtmp` resolver**, extended with a second lookup: try `prod_cameras WHERE camera_key = ?` first, fall back to `prod_mixer_feed_sources WHERE ingest_key = ?` — same single nginx-rtmp app, same `on_publish`/`on_publish_done`/live-tracking shape, just two tables it can resolve against instead of one.

**New preview-transcode pipeline (new scope, not reused from elsewhere — see Context).** MediaMTX cannot itself downscale/transcode, so a low-res preview rendition needs a small manager, e.g. `packages/plugins/lcyt-rtmp/src/preview-transcode-manager.js`: for each source registered via `registerSource(key)`, spawn/supervise an ffmpeg reading the source's full-res MediaMTX path (RTSP, same pattern `crop-manager.js`/`rtmp-manager.js` already use) and republishing a downscaled `{key}-preview` rendition to its own MediaMTX path. `unregisterSource(key)` stops it. Called from this plan's mixer/camera source CRUD (both camera-backed and file-backed sources register here) — **not** from `plan_ingest_feeds.md`, which has no preview-tile concept in its own scope.

**New WHEP proxy routes** in `routes/mixers.js`, mirroring the existing WHIP proxy exactly (`routes/mixers.js:281-337`): `POST/PATCH/DELETE /production/mixers/:id/sources/:sourceId/whep` — proxy SDP through the backend to `{mediamtxWebrtcBase}/{key}-preview/whep` so the browser never talks to MediaMTX directly (same as WHIP today).

**File ingestion, managed mode**: `POST /production/mixers/:mixerId/feed-sources/:id/managed-file` (multipart upload) writes via `lcyt-files`' storage adapter under the `_production-feeds` namespace, records a `prod_feed_source_files` row. An internal streaming route `GET .../managed-file` resolves and pipes the stored file (same pattern as `lcyt-files/src/routes/files.js:192-199`), storage-backend-agnostic (local/S3/WebDAV) without teaching ffmpeg storage credentials. The managed loop itself is a small extension of `PreviewTranscodeManager` (or a sibling class in the same file): `startManagedFileLoop(key, {resolvedInputUrl})` / `stopManagedFileLoop(key)`, using `createFfmpegRunner()` from `lcyt-backend/ffmpeg` (already used by `rtmp-manager.js`):
```
ffmpeg -stream_loop -1 -re -i http://127.0.0.1:{port}/production/mixers/{mixerId}/feed-sources/{id}/managed-file -c copy -f flv rtmp://mediamtx:1935/{ingest_key}
```
falling back to re-encode (`-c:v libx264 -preset veryfast -c:a aac`) if stream-copy fails, supervised/restarted on crash, stopped on delete.

## 3. MediaMTX / infra config

- `docker/mediamtx.yml`: `webrtc: no` → `yes` (line 74) — needed for WHEP consumption of `{key}-preview` renditions. No per-source manager change beyond what §2's new `PreviewTranscodeManager` already does — MediaMTX remuxes whatever's published at `{key}-preview` into every enabled output protocol simultaneously.
- `docker-compose.yml`: pin `bluenviron/mediamtx:latest` (line 105) to a specific version tag before relying on WHEP behavior — exact semantics have shifted across MediaMTX releases. No new host port mapping needed (the backend proxies WHEP through its own routes, same as WHIP).

## 4. Frontend

**`LcytMixerPage.jsx`**: replace the thumbnail-polling block (lines 32-95, `thumbUrls`/`thumbTimersRef`) with `<PreviewTile protocol="whep">` per source, via a new `PreviewTile.jsx` shared component (new — not inherited, see Context) with a WHEP mode: `RTCPeerConnection` with `recvonly` transceivers (`addTransceiver('video', {direction:'recvonly'})` / `addTransceiver('audio', {direction:'recvonly'})`), POST the offer to the new WHEP proxy route, attach the inbound `MediaStream` to a `<video>` — the read-side mirror of the existing WHIP publish code already in this file (`~222-285`). Keep the full-res HLS `<video>`/canvas/WHIP compositing path (`~100-140`, `~189-217`, `~222-295`) for the active/PGM source **completely unchanged**. Rename `cameraId` → `sourceId` throughout the internal `videoRefs`/`hlsRefs`/`gainNodesRef` maps to match the generalized `/sources` response. `cutTo` (`~300-307`) and the switch endpoint are unchanged — `mixerInput` semantics don't change for file sources, and `'rtmp'`-type camera sources already switch exactly like any other camera today.

**New Setup UI**: a feed-source management panel for file mixer sources only now — either a new `MixerFeedSourcesSection.jsx` or folded into the existing `MixerSection.jsx`'s expanded mixer detail view (per-mixer file-source list + add source form: upload widget + push/managed mode toggle). `'rtmp'`-type camera sources are managed entirely through the existing camera form (`plan_ingest_feeds.md` §3) — no duplicate creation flow here.

**Ingestion card** (`SetupHubPage.jsx`'s `IngestionSection.jsx`, generalized by `plan_ingest_feeds.md`): extend the existing camera-row list with `prod_mixer_feed_sources` file-source rows (name, ingest key, live status) alongside cameras — `'rtmp'`-type cameras already appear there via `plan_ingest_feeds.md`'s own work, nothing further needed for those.

## 5. `CLAUDE.md` updates

- `packages/plugins/lcyt-production/CLAUDE.md` — add `prod_mixer_feed_sources`/`prod_feed_source_files`, `routes/mixer-feed-sources.js`, the `prod_encoders` naming caveat, and a note that "encoder"-style sources now live in `plan_ingest_feeds.md`'s camera model.
- `packages/plugins/lcyt-rtmp/CLAUDE.md` — new `preview-transcode-manager.js` entry; the managed-file-loop addition; `feed-rtmp`'s dual-table resolver (cameras + mixer feed sources) once `plan_ingest_feeds.md`'s router lands.
- `packages/plugins/lcyt-files/CLAUDE.md` — one-paragraph cross-reference to the `_production-feeds` pseudo-namespace usage.
- `packages/lcyt-web/CLAUDE.md` — new `PreviewTile.jsx` entry (WHEP mode), new file-source Setup UI.

## 6. Phased rollout

1. **File-source CRUD (push-mode only)** — `prod_mixer_feed_sources` (file-only shape), `routes/mixer-feed-sources.js`, `/sources` union's second leg, `sourceId` rename. No preview upgrade yet (thumbnails stay as-is, just field-renamed). Depends on `plan_ingest_feeds.md` Phase 2 (the shared `feed-rtmp` router) for push-mode ingest.
2. **Preview-transcode pipeline** — `PreviewTranscodeManager`, `{key}-preview` MediaMTX rendition, wired into both camera and file source CRUD. New scope (see Context) — not reused from anywhere.
3. **WHEP enablement** — `webrtc: yes` + version pin, WHEP proxy routes. Verify via direct `curl`/a manual WHEP test page before touching `LcytMixerPage.jsx`.
4. **Mixer UI live tiles** — `PreviewTile.jsx` WHEP mode, `LcytMixerPage.jsx` sidebar switched from thumbnails to live previews.
5. **File ingestion, managed mode** — `prod_feed_source_files`, upload + internal streaming proxy route, managed ffmpeg loop with copy→transcode fallback.

## 7. Verification

- **Node tests**: CRUD/validation for `mixer-feed-sources.js` (file-only now); sources-union correctness (camera incl. `'rtmp'`-type + file rows, correct `sourceKind`, ordering) in `mixers.test.js`; `PreviewTranscodeManager` register/unregister + supervised-restart tests; managed-file-loop start/stop/restart tests.
- **Frontend tests** (Vitest): `PreviewTile` WHEP-mode negotiation with a mocked `RTCPeerConnection`; file-source form conditional fields (push vs. managed).
- **Manual**: confirm an `'rtmp'`-type camera with `mixer_input` set already appears in `/sources` with no changes needed on this plan's side (regression check against `plan_ingest_feeds.md`'s work). Create a file source, upload a video, set it to managed mode, confirm it loops indefinitely and restarts after a killed ffmpeg process. Open the Mixer page and confirm the sidebar tile is live low-res video over WHEP for both camera and file sources, while CUT still switches the unchanged full-res PGM/egress path. Confirm the Setup Ingestion card lists file sources alongside cameras.
