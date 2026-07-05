---
id: plan/monitors
title: "Monitors — Confidence-Only Ingestion for Visual Monitoring"
status: draft
summary: "A new 'Monitor' concept: push- or pull-ingested feeds (e.g. a copy of the live YouTube output, a secondary encoder test pattern) shown to the operator purely for visual confidence-monitoring. Never part of a mixer's program bus, never composited, never egressed. Includes a dedicated Setup card, a low-res live-preview transcode pipeline (MediaMTX cannot downscale on its own), and a greyed-out reflection in the existing Ingestion card."
---

# Monitors — Confidence-Only Ingestion for Visual Monitoring

## Context

Operators often want a small preview of something that is *not* a production input: what YouTube is actually receiving right now, a secondary encoder's built-in test pattern, a colleague's confidence feed. Today there is nowhere to register this — the Setup page's "Ingestion" card (`packages/lcyt-web/src/components/setup-hub/SetupHubPage.jsx:49-55`) is a non-expandable placeholder (`status="partial"`, `statusLabel="Status only"`) that only reflects the existing RTMP feature flag, with no entity behind it.

This plan is deliberately scoped to **monitoring only** — a Monitor is never wired into a mixer's `mixer_input`, never composited, never sent to egress. That distinction is what keeps this plan small and independent of the mixer-sourcing work in `plan_mixer_feed_sources.md` (which reuses the preview mechanism built here, but is otherwise a separate concern).

**Key technical fact this plan is built around:** MediaMTX is a pure relay/remuxer (RTMP↔HLS↔WebRTC) — it cannot transcode or downscale video. Its only built-in "smaller" output today is the single-frame JPEG thumbnail already used for camera previews (`packages/plugins/lcyt-rtmp/src/preview-manager.js`, `mediamtx-client.js`'s `getThumbnail`). A genuine lower-resolution *live video* monitor therefore requires an ffmpeg transcode step — this plan makes that step automatic per-monitor rather than something an operator has to wire up by hand.

## 1. Data model

New table in `packages/plugins/lcyt-production/src/db.js`, following the exact additive migration idiom already used there (`CREATE TABLE IF NOT EXISTS` + `PRAGMA table_info` + `ALTER TABLE ADD COLUMN`, see `db.js:7-81`):

```sql
CREATE TABLE IF NOT EXISTS prod_monitors (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  ingest_mode       TEXT NOT NULL DEFAULT 'push',  -- 'push' | 'pull'
  ingest_key        TEXT,                           -- MediaMTX path name (push mode)
  source_url        TEXT,                           -- external RTMP/RTSP/HLS URL (pull mode)
  preview_width     INTEGER,                        -- override; default from PREVIEW_TRANSCODE_WIDTH env
  preview_height    INTEGER,
  preview_bitrate   TEXT,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
```

`ingest_mode` is validated at the route layer (`MONITOR_INGEST_MODES = ['push', 'pull']`), matching how `CAMERA_CONTROL_TYPES`/`MIXER_TYPES` are validated in `routes/cameras.js:5`/`routes/mixers.js:10`. No `mixer_id`/`mixer_input` column exists on this table at all — structurally, a Monitor cannot be wired into a program bus, which is the whole point.

## 2. Backend

**New file `packages/plugins/lcyt-production/src/routes/monitors.js`** — CRUD router mirroring `routes/cameras.js`'s structure:
- `GET /production/monitors` — list, with `isLive` via `mediamtxClient.isPathPublishing(ingest_key)` (same pattern as `routes/mixers.js:244-246`).
- `GET /production/monitors/:id`
- `POST /production/monitors` — validates `ingest_mode`; for `pull`, requires `source_url`; for `push`, backend generates/accepts an `ingest_key`.
- `PUT /production/monitors/:id`
- `DELETE /production/monitors/:id` — tears down any dynamically-added pull path and the preview-transcode registration (§3).
- Mounted in `packages/plugins/lcyt-production/src/api.js` alongside the existing routers.

**Pull-mode ingest**: on create/update with `ingest_mode: 'pull'`, call `mediamtxClient.addPath(ingest_key, { source: source_url })` — MediaMTX natively supports pulling an external RTMP/RTSP/HLS source via the path-level `source` config key (the existing wildcard path already uses `source: publisher` for push; a URL value switches a path to pull). No ffmpeg is needed for the ingest step itself, only for the preview step below.

## 3. Low-res preview pipeline

**New file `packages/plugins/lcyt-rtmp/src/preview-transcode-manager.js`** (lives in `lcyt-rtmp`, which already owns MediaMTX-adjacent ffmpeg process lifecycle in `rtmp-manager.js`):

- `registerSource(key, {width, height, bitrate})` / `unregisterSource(key)`.
- On register: `mediamtxClient.addPath(key, { runOnReady: <cmd>, runOnReadyRestart: true, runOnNotReady: <cleanup cmd> })`. MediaMTX's own `runOnReady`/`runOnNotReady` path hooks (not currently used anywhere in `docker/mediamtx.yml` — only a commented-out `runOnPublish` example exists at lines 106-110) start/stop the transcode exactly when the source is actually live, with no local polling needed.
- The `runOnReady` command reads the source via RTSP (`rtsp://mediamtx:8554/{key}`, avoiding push/pull contention on the same path — the same rationale as the existing `outRtspUrl` pattern in `rtmp-manager.js:96-105`) and republishes a scaled/low-bitrate rendition to `rtmp://mediamtx:1935/{key}-preview`:
  ```
  ffmpeg -i rtsp://mediamtx:8554/{key} -vf scale={w}:{h} -c:v libx264 -preset ultrafast -tune zerolatency -b:v {bitrate} -c:a aac -b:a 64k -f flv rtmp://mediamtx:1935/{key}-preview
  ```
- Requires `rtsp: yes` in `docker/mediamtx.yml` (currently `no` at line 71) — internal-only, not exposed on any host port.
- Defaults via env vars: `PREVIEW_TRANSCODE_WIDTH` (default `640`), `PREVIEW_TRANSCODE_HEIGHT` (default `360`), `PREVIEW_TRANSCODE_BITRATE` (default `600k`); per-monitor override via the `preview_width`/`preview_height`/`preview_bitrate` columns.
- No local Node child-process tracking — MediaMTX supervises the `runOnReady` process itself.
- Consumed via HLS only in this plan (`GET /stream-hls/{key}-preview/index.m3u8`, existing route pattern) — Monitors are confidence-only, latency is not critical. (`plan_mixer_feed_sources.md` later enables WHEP globally and reuses this exact same `{key}-preview` path for low-latency mixer-source previews, with no changes required to this manager.)
- Wired into `packages/plugins/lcyt-production/src/routes/monitors.js`'s POST/PUT/DELETE handlers via an injected `previewTranscodeManager` (threaded through from `lcyt-backend/src/server.js`, instantiated once at the app-composition layer to respect the existing no-cross-plugin-dependency convention — `lcyt-production` keeps its own copy of `MediaMtxClient` specifically to avoid depending on `lcyt-rtmp`, per that file's header comment).

## 4. Frontend

**New files**: `packages/lcyt-web/src/components/setup-hub/MonitorsSection.jsx` + `packages/lcyt-web/src/components/ProductionMonitorsPage.jsx` (`MonitorsManager` + `MonitorForm`), mirroring `CameraForm`'s type-dropdown/conditional-fields pattern (`ProductionCamerasPage.jsx:70-101`): fields `name`, `ingestMode` (push|pull dropdown), conditional `sourceUrl` input for pull, read-only ingest key/RTMP URL display for push, plus optional `previewWidth`/`previewHeight`/`previewBitrate` override inputs (placeholder text shows the server default) — this is the "set the resolution we send to the web app user" requirement.

**New shared component** `packages/lcyt-web/src/components/shared/PreviewTile.jsx` — an HLS-mode live preview tile (extracts the existing `loadHlsForSource` logic from `LcytMixerPage.jsx:100-132`: dynamic `import('hls.js')`, native-HLS Safari fallback). Each Monitor row in `MonitorsManager` embeds one for at-a-glance live/dead status. (`plan_mixer_feed_sources.md` later adds a WHEP mode to this same component.)

**`SetupHubPage.jsx`**:
- Add `<MonitorsSection />` to the "Production devices" grid (near line 33-38, alongside `CameraSection`/`MixerSection`/`EncoderSection`/`BridgeSection`).
- Replace the placeholder Ingestion card (lines 49-55) with a real expandable card (`status="ready"`) listing existing ingestion (cameras with a `camera_key`, the existing RTMP feature-flag status) **plus** every `prod_monitors` row. Monitor rows render dimmed, reusing the existing `.setup-card--disabled`/`status="soon"` visual language from `packages/lcyt-web/src/styles/sidebar.css` (line ~2010/~2051) applied **per row** (the card itself is real/expandable now), showing the monitor's ingest key inline with a "Configured via Monitors card →" link to `/production/monitors`. `plan_mixer_feed_sources.md` later extends this same list with encoder/file mixer-source rows.

## 5. `CLAUDE.md` updates

- `packages/plugins/lcyt-production/CLAUDE.md` — add `prod_monitors` to the db.js description, `routes/monitors.js` to the source-files list.
- `packages/plugins/lcyt-rtmp/CLAUDE.md` — add `preview-transcode-manager.js`, document the `{key}-preview` path convention alongside the existing `{key}-out`/`{key}-t{i}`/`{key}-dsk` table.
- `packages/lcyt-web/CLAUDE.md` — add `MonitorsSection.jsx`, `ProductionMonitorsPage.jsx`, `shared/PreviewTile.jsx`, and the new `/production/monitors` route to the routing table.
- `docker/mediamtx.yml` — document the new `{key}-preview` convention in the existing path-naming comment block (lines 86-93).

## 6. Phased rollout

1. **DB + CRUD (push-mode only)** — `prod_monitors` table, `routes/monitors.js`, no preview pipeline yet (`previewHlsUrl` returns `null`). Setup card lists monitors, no live tile yet.
2. **Pull-mode ingest** — `mediamtxClient.addPath` with `source: url`; verify MediaMTX pulls an external stream without any ffmpeg involvement.
3. **Preview transcode pipeline** — `PreviewTranscodeManager`, `rtsp: yes` in `docker/mediamtx.yml`, `runOnReady`/`runOnNotReady` wiring.
4. **Frontend live tiles** — `PreviewTile.jsx` (HLS mode), wired into `MonitorsManager` and the Ingestion card.

## 7. Verification

- **Node tests** (`node:test`, `packages/plugins/lcyt-production/test/monitors.test.js`, `packages/plugins/lcyt-rtmp/test/preview-transcode-manager.test.js` mocking `MediaMtxClient`): CRUD/validation, pull-mode `addPath` call shape, `registerSource`/`unregisterSource` call `addPath`/`deletePath` with correct `runOnReady`/`runOnNotReady` commands, a command-injection safety test mirroring the existing `mediamtx-runOnPublish.safety.test.js` pattern.
- **Frontend tests** (Vitest): `PreviewTile.test.jsx` (HLS mode with mocked `Hls`), `MonitorForm.test.jsx` (conditional fields per `ingestMode`).
- **Manual**: create a push-mode monitor, push a test RTMP stream to it, confirm `{key}-preview` appears in `GET :9997/v3/paths/list` only while live; confirm HLS playback of `{key}-preview` at the configured resolution; create a pull-mode monitor against a public HLS URL, confirm MediaMTX pulls it with no ffmpeg process for ingest; confirm the Setup Ingestion card shows both monitors greyed out with their keys visible.
