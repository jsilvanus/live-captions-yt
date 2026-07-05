---
id: plan/mixer_feed_sources
title: "Mixer Feed Sources — Encoder & File Sources, Low-Latency Preview Tiles"
status: draft
summary: "Generalizes the LCYT software mixer's program bus beyond cameras to also accept an already-mixed external-encoder feed and a looping video file, and upgrades the mixer's own preview panel from static thumbnails to live low-res video (WHEP) for responsive switching feedback. Camera PTZ control is unchanged. Builds on the preview-transcode pipeline introduced in plan_monitors.md rather than duplicating it."
---

# Mixer Feed Sources — Encoder & File Sources, Low-Latency Preview Tiles

## Context

Today the LCYT software mixer's program bus (`prod_mixers` rows with `type='lcyt'`) only draws from cameras: `GET /production/mixers/:id/sources` (`packages/plugins/lcyt-production/src/routes/mixers.js:230-260`) queries `prod_cameras WHERE mixer_input IS NOT NULL`, and `LcytMixerPage.jsx` composites the active source client-side (HLS.js → canvas → WHIP egress). The user wants two more source kinds usable on that same program bus: an **already-mixed feed pushed in from the user's own external encoder/switcher** (so users can do their actual mixing in their own hardware and still get camera control + our egress/graphics pipeline), and a **looping video file** (e.g. a slate, count-in, or pre-recorded segment).

They also want the mixer's non-active preview tiles to show genuine lower-resolution *live video* rather than the current 5-second-polled static JPEG, while the active/PGM source's full-resolution compositing-and-egress path stays exactly as it is today. Camera PTZ control (bridge relay to AMX/Roland, etc.) is unrelated to and unaffected by this plan — it already works identically regardless of where mixing happens.

**This plan explicitly depends on `plan_monitors.md`**, which introduces `packages/plugins/lcyt-rtmp/src/preview-transcode-manager.js` (the ffmpeg-based low-res `{key}-preview` rendition, since MediaMTX itself cannot transcode/downscale). This plan does not duplicate that mechanism — it reuses the same manager and the same `{key}-preview` MediaMTX path convention, and simply adds a second consumption protocol (WHEP) on top once `webrtc: yes` is enabled.

## Important disambiguation

`prod_encoders` already exists (`packages/plugins/lcyt-production/src/db.js:47-57`, `routes/encoders.js`) for **hardware encoder control** (e.g. Matrox Monarch HD/HDx — an HTTP-API-driven box). The new "encoder" source type in this plan is a completely different, unrelated concept: a plain **ingest-only** feed (an already-mixed video signal with no control channel at all). Keep these clearly disambiguated in code comments and CLAUDE.md; do not merge or rename the existing table.

## 1. Data model

New table in `packages/plugins/lcyt-production/src/db.js`, same additive idiom as `plan_monitors.md`'s `prod_monitors`:

```sql
CREATE TABLE IF NOT EXISTS prod_mixer_feed_sources (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  source_type         TEXT NOT NULL,               -- 'encoder' | 'file'
  ingest_key          TEXT NOT NULL,                 -- MediaMTX path name
  ingest_mode         TEXT NOT NULL DEFAULT 'push',  -- 'push' | 'managed'  ('managed' = file only)
  mixer_id            TEXT NOT NULL REFERENCES prod_mixers(id) ON DELETE CASCADE,
  mixer_input         INTEGER NOT NULL,               -- program-bus input slot, required (unlike prod_monitors)
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

Unlike `plan_monitors.md`'s `prod_monitors`, `mixer_id`/`mixer_input` are `NOT NULL` here — every row in this table exists *because* it's wired into a program bus; that is the entire reason this table is separate from `prod_monitors` (which structurally cannot have either). `source_type: 'encoder'` only ever uses `ingest_mode: 'push'`; `source_type: 'file'` may use `push` (user runs their own external loop into our ingest key — no backend process) or `managed` (backend spawns/supervises the loop, §3).

`lcyt-files` (`packages/plugins/lcyt-files/`) has no generic media-asset table suited to an arbitrary uploaded video file — only `caption_files` (text-format-oriented) and `icons` (images). Rather than overload either, `prod_feed_source_files` (owned by `lcyt-production`) stores the reference and delegates byte storage to `lcyt-files`' existing storage adapter (`initFilesControl(db)` → `{ storage, resolveStorage }`) under a fixed `_production-feeds` pseudo-namespace, reusing the adapter's `openRead`/`openAppend` interface as-is (documented in `lcyt-files/CLAUDE.md`).

## 2. Backend

**New file `packages/plugins/lcyt-production/src/routes/mixer-feed-sources.js`** — CRUD mirroring `routes/cameras.js`, scoped to a parent mixer (`/production/mixers/:mixerId/feed-sources`): `GET`/`POST`/`PUT /:id`/`DELETE /:id`. Validates `source_type` ∈ `{encoder,file}`, `ingest_mode` per type. Delete tears down any managed-file loop and the preview-transcode registration.

**Generalize `GET /production/mixers/:id/sources`** (`routes/mixers.js:230-260`): union the existing camera query with `SELECT * FROM prod_mixer_feed_sources WHERE mixer_id = ? ORDER BY sort_order, created_at`, merge and sort by `mixerInput`. Response gains a `sourceKind` discriminator (`camera`|`encoder`|`file`) and `previewHlsUrl`/`previewWhepUrl` (in addition to the existing full-res `hlsUrl`, which stays reserved for the active/PGM source only). Rename the id field `cameraId` → `sourceId` (its only consumer, `LcytMixerPage.jsx`, is updated in lockstep, §4).

**Reuse `PreviewTranscodeManager`** from `plan_monitors.md` unchanged — call `registerSource`/`unregisterSource` from this plan's CRUD handlers exactly as `plan_monitors.md`'s `routes/monitors.js` does. No manager code changes are required for HLS; WHEP support is a MediaMTX-config-level change (§3), not a per-source manager change, since MediaMTX remuxes whatever's published at `{key}-preview` into every enabled output protocol simultaneously.

**File ingestion, managed mode**: `POST /production/mixers/:mixerId/feed-sources/:id/managed-file` (multipart upload) writes via `lcyt-files`' storage adapter under the `_production-feeds` namespace, records a `prod_feed_source_files` row. An internal streaming route `GET .../managed-file` resolves and pipes the stored file (same pattern as `lcyt-files/src/routes/files.js:192-199`), storage-backend-agnostic (local/S3/WebDAV) without teaching ffmpeg storage credentials. The managed loop itself is a small extension of `PreviewTranscodeManager` (or a sibling class in the same file): `startManagedFileLoop(key, {resolvedInputUrl})` / `stopManagedFileLoop(key)`, using `createFfmpegRunner()` from `lcyt-backend/ffmpeg` (already used by `rtmp-manager.js`):
```
ffmpeg -stream_loop -1 -re -i http://127.0.0.1:{port}/production/mixers/{mixerId}/feed-sources/{id}/managed-file -c copy -f flv rtmp://mediamtx:1935/{ingest_key}
```
falling back to re-encode (`-c:v libx264 -preset veryfast -c:a aac`) if stream-copy fails, supervised/restarted on crash, stopped on delete.

**New WHEP proxy routes** in `routes/mixers.js`, mirroring the existing WHIP proxy exactly (`routes/mixers.js:281-337`): `POST/PATCH/DELETE /production/mixers/:id/sources/:sourceId/whep` — proxy SDP through the backend to `{mediamtxWebrtcBase}/{key}-preview/whep` so the browser never talks to MediaMTX directly (same as WHIP today).

## 3. MediaMTX / infra config

- `docker/mediamtx.yml`: `webrtc: no` → `yes` (line 74) — this is the only change needed to make every existing `{key}-preview` path (including ones from `plan_monitors.md`) additionally available over WHEP; no per-source manager change required.
- `docker-compose.yml`: pin `bluenviron/mediamtx:latest` (line 105) to a specific version tag before relying on WHEP behavior — exact semantics have shifted across MediaMTX releases. No new host port mapping needed (the backend proxies WHEP through its own routes, same as WHIP).

## 4. Frontend

**`LcytMixerPage.jsx`**: replace the thumbnail-polling block (lines 32-95, `thumbUrls`/`thumbTimersRef`) with `<PreviewTile protocol="whep">` per source, extending the `PreviewTile.jsx` shared component from `plan_monitors.md` with a WHEP mode: `RTCPeerConnection` with `recvonly` transceivers (`addTransceiver('video', {direction:'recvonly'})` / `addTransceiver('audio', {direction:'recvonly'})`), POST the offer to the new WHEP proxy route, attach the inbound `MediaStream` to a `<video>` — the read-side mirror of the existing WHIP publish code already in this file (`~222-285`). Keep the full-res HLS `<video>`/canvas/WHIP compositing path (`~100-140`, `~189-217`, `~222-295`) for the active/PGM source **completely unchanged**. Rename `cameraId` → `sourceId` throughout the internal `videoRefs`/`hlsRefs`/`gainNodesRef` maps to match the generalized `/sources` response. `cutTo` (`~300-307`) and the switch endpoint are unchanged — `mixerInput` semantics don't change for encoder/file sources.

**New Setup UI**: a feed-source management panel for encoder/file mixer sources — either a new `MixerFeedSourcesSection.jsx` or folded into the existing `MixerSection.jsx`'s expanded mixer detail view (per-mixer source list + add source form, type dropdown `encoder|file` with conditional fields: `file` gets an upload widget + push/managed mode toggle).

**Ingestion card** (`SetupHubPage.jsx`, upgraded by `plan_monitors.md`): extend the existing list with encoder/file mixer-source rows (name, type, ingest key, live status) alongside cameras and monitors.

## 5. `CLAUDE.md` updates

- `packages/plugins/lcyt-production/CLAUDE.md` — add `prod_mixer_feed_sources`/`prod_feed_source_files`, `routes/mixer-feed-sources.js`, the encoder-vs-`prod_encoders` naming caveat.
- `packages/plugins/lcyt-rtmp/CLAUDE.md` — note the managed-file-loop addition to `preview-transcode-manager.js` (if it lands there).
- `packages/plugins/lcyt-files/CLAUDE.md` — one-paragraph cross-reference to the `_production-feeds` pseudo-namespace usage.
- `packages/lcyt-web/CLAUDE.md` — update `PreviewTile.jsx`'s entry (WHEP mode added), new feed-source Setup UI.

## 6. Phased rollout

1. **DB + feed-source CRUD (push-mode only)** — `prod_mixer_feed_sources`, `routes/mixer-feed-sources.js`, generalized `/sources` union, `sourceId` rename. No preview upgrade yet (thumbnails stay as-is, just field-renamed).
2. **WHEP enablement** — `webrtc: yes` + version pin, WHEP proxy routes. Verify via direct `curl`/a manual WHEP test page before touching `LcytMixerPage.jsx`.
3. **Mixer UI live tiles** — `PreviewTile.jsx` WHEP mode, `LcytMixerPage.jsx` sidebar switched from thumbnails to live previews.
4. **File ingestion** — `prod_feed_source_files`, upload + internal streaming proxy route, managed ffmpeg loop with copy→transcode fallback.

## 7. Verification

- **Node tests**: CRUD/validation for `mixer-feed-sources.js`; sources-union correctness (camera + encoder + file rows, correct `sourceKind`, ordering) in `mixers.test.js`; managed-file-loop start/stop/restart tests.
- **Frontend tests** (Vitest): `PreviewTile` WHEP-mode negotiation with a mocked `RTCPeerConnection`; feed-source form conditional fields.
- **Manual**: push a test RTMP stream to a new encoder-type feed source wired to `mixer_input`, confirm it appears in `/sources` with a `previewWhepUrl`; open the Mixer page and confirm the sidebar tile is live low-res video over WHEP while CUT still switches the unchanged full-res PGM/egress path; upload a file, set it to managed mode, confirm it loops indefinitely and restarts after a killed ffmpeg process; confirm the Setup Ingestion card lists the new encoder/file sources alongside cameras and monitors.
