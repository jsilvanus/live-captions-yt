---
id: plan/vertical-crop
title: "Vertical Crop Output — Live-Repositionable Landscape→Portrait Crop"
status: in-progress
summary: "Adds a per-project cropped rendition of the landscape RTMP ingest (typically 16:9 → 9:16 vertical) produced by one long-running ffmpeg at the incoming resolution, published to a {key}-crop MediaMTX path and consumable by relay slots (sourceView: 'crop') and the HLS proxy. Crop positions are named presets organised into switchable preset SETS (banks) — with dedicated UI for editing positions per set (set selector, sources×sets overview grid, activate-set control) — shifted live via runtime ffmpeg filter commands (zmq), no process restart and no black gap, with optional animated transitions, and can automatically follow mixer program switches and camera PTZ preset recalls (camera 1/preset 1 → camera 2 → camera 1/preset 2, each with its own crop position)."
---

# Vertical Crop Output — Live-Repositionable Landscape→Portrait Crop

## Context

Productions increasingly need a **vertical (9:16) simulcast** of the same event that
is being streamed in landscape: YouTube Shorts–style live, TikTok Live, Instagram —
all RTMP targets the relay fan-out can already reach. Today the relay pipeline
(`packages/plugins/lcyt-rtmp/src/rtmp-manager.js`) can transcode per slot
(`scale`/`fps`/bitrate, Phase 7) but a naive `scale=1080:1920` squeezes or letterboxes
the picture. What is wanted is a **crop**: a 9:16 window cut out of the full-quality
landscape frame, like a virtual portrait camera inside the program feed.

Three hard requirements shape the design:

1. **Crop at incoming quality.** The crop window must be cut from the decoded frames
   of the raw ingest at its native resolution (e.g. a 608×1080 window out of
   1920×1080), *not* from an already-downscaled rendition such as `plan_monitors.md`'s
   low-res `{key}-preview`.
2. **Preset crop positions, switchable live.** The interesting subject moves when the
   mixer cuts: camera 1 on preset 1 needs the crop over the lectern, camera 2 needs it
   centred, camera 1 on preset 2 needs it over the piano. Each (source, PTZ-preset)
   combination can have its own crop position, and the active position must follow
   the production.
3. **No empty/black delay when the position shifts.** Restarting ffmpeg to change
   `crop=...:x:y` costs 1–3 s of dead air on the vertical output at exactly the moment
   the audience is watching a cut. Position changes must happen inside the running
   process.

## Approach in one paragraph

One long-running ffmpeg per api_key ("crop renderer") reads the raw ingest back from
MediaMTX over RTSP (same pattern as the CEA-708/DSK fan-out in `rtmp-manager.js`),
applies a named crop filter `crop@vcrop=W:H:x:y` (window size fixed at start, position
runtime-adjustable), optionally scales to the delivery size (default 1080×1920), and
pushes H.264/AAC back into MediaMTX on the **`{key}-crop`** path. Relay slots gain a
`sourceView` field (`'program'` default, `'crop'`) so any existing RTMP target can be
pointed at the vertical rendition; the existing `/stream-hls/:key/*` proxy serves it to
browsers as `{key}-crop` with zero new code. Crop *position* changes are delivered to
the running process as libavfilter **runtime commands** (`crop@vcrop x 656`) over the
ffmpeg `zmq` filter — the position takes effect on the next frame, so a preset switch
is glitch-free, and short eased interpolation gives an optional "camera pan" transition.
A `crop_source_map` table plus hooks in `lcyt-production`'s mixer-switch and
camera-preset routes make the active preset follow the program bus automatically.

## Why zmq commands (and the fallbacks)

ffmpeg's `crop` filter supports runtime commands for `x`/`y` (and `w`/`h`, which we
deliberately keep fixed — resizing the window mid-stream would change the scaler's
input and is not needed for "shift the crop position"). The supported ways to deliver
commands to a live process:

| Mechanism | Latency | Requirements | Verdict |
|---|---|---|---|
| `zmq` filter in the graph + ZeroMQ REQ client | next frame | ffmpeg built with `--enable-libzmq`; `zeromq` npm package (optional dep) | **Primary.** Purpose-built for exactly this; bind to `127.0.0.1` only. |
| `sendcmd` filter | n/a | command file parsed once at init | Rejected — not live. |
| Interactive stdin `c` commands | next frame | tty-ish stdin semantics | Rejected — fragile under `spawn`, breaks the runner abstraction, conflicts with the CEA-708 stdin SRT pipe convention. |
| Double-run + MediaMTX publisher swap (`overridePublisher`) | ~0.5–1 s splice | nothing special | **Fallback** when the ffmpeg build lacks `zmq`. Start a second renderer with the new x/y, let it take over `{key}-crop`, stop the old one. No black gap (the path always has a publisher) but a visible timestamp splice. |

`probeFfmpeg()` (`rtmp-manager.js`) is extended to also detect the `zmq` filter
(`ffmpeg -hide_banner -filters` contains ` zmq `), reported as `caps.hasZmq`. The
manager exposes which mode it is in via `GET /crop/status` (`repositionMode:
'live' | 'restart'`) so the UI can warn when only the fallback is available.
`docker/lcyt-ffmpeg/` gets `--enable-libzmq` (or the distro package `libzmq3-dev`)
so containerised deployments always get live mode.

## 1. Data model (lcyt-rtmp `db.js`, additive migrations)

```sql
-- Per-project crop output config (one row per api_key)
CREATE TABLE IF NOT EXISTS crop_config (
  api_key         TEXT PRIMARY KEY,
  enabled         INTEGER NOT NULL DEFAULT 0,      -- start renderer on publish
  aspect_w        INTEGER NOT NULL DEFAULT 9,      -- crop window aspect
  aspect_h        INTEGER NOT NULL DEFAULT 16,
  out_w           INTEGER,                         -- delivery scale, NULL = no scale
  out_h           INTEGER,                         --   (default 1080x1920 in code)
  video_bitrate   TEXT,                            -- e.g. '4500k', NULL = codec default
  follow_program  INTEGER NOT NULL DEFAULT 1,      -- auto-apply crop_source_map
  transition_ms   INTEGER NOT NULL DEFAULT 0       -- default eased pan duration; 0 = cut
);

-- Named crop positions. x/y are stored NORMALISED (0..1 of the max travel range)
-- so presets survive an input-resolution change (720p rehearsal → 1080p show).
CREATE TABLE IF NOT EXISTS crop_presets (
  id          TEXT PRIMARY KEY,
  api_key     TEXT NOT NULL,
  name        TEXT NOT NULL,
  x_norm      REAL NOT NULL DEFAULT 0.5,           -- 0 = left edge, 1 = right edge
  y_norm      REAL NOT NULL DEFAULT 0.0,           -- 0 = top, 1 = bottom
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (api_key, name)
);

-- Preset sets ("banks"): a named grouping of crop positions, so one production
-- can keep several complete position layouts — e.g. "Sermon", "Concert",
-- "Panel" — and switch which set is active as a whole. crop_presets rows
-- belong to a set; the source-map resolves within the ACTIVE set only.
CREATE TABLE IF NOT EXISTS crop_preset_sets (
  id          TEXT PRIMARY KEY,
  api_key     TEXT NOT NULL,
  name        TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (api_key, name)
);
-- crop_presets gains: set_id TEXT REFERENCES crop_preset_sets(id) ON DELETE CASCADE
-- crop_config  gains: active_set_id TEXT (NULL = the implicit default set)

-- Production-follow mapping: which preset to activate when the program source
-- (and optionally that camera's PTZ preset) changes. Most-specific row wins:
-- (mixer_input + camera_preset) beats (mixer_input) beats nothing.
CREATE TABLE IF NOT EXISTS crop_source_map (
  id             TEXT PRIMARY KEY,
  api_key        TEXT NOT NULL,
  mixer_id       TEXT,                             -- prod_mixers.id (lcyt-production)
  mixer_input    INTEGER,                          -- program bus input number
  camera_id      TEXT,                             -- prod_cameras.id
  camera_preset  INTEGER,                          -- PTZ preset number
  preset_id      TEXT NOT NULL REFERENCES crop_presets(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_crop_source_map_key ON crop_source_map(api_key);
```

Source-map rows reference presets, and presets live in sets — so mapping "camera 1 /
preset 2 → crop position C" once per set gives each set its own complete follow
behaviour. Activating a different set (e.g. between event segments) instantly changes
what every subsequent program switch resolves to, and re-applies the active source's
position from the new set (a live, gapless shift like any other preset activation).

Pixel values are derived at runtime: `cropW = round_even(inH * aspect_w / aspect_h)`
(clamped to `inW`), `cropH = inH`, `x = round_even(x_norm * (inW - cropW))`,
`y = round_even(y_norm * (inH - cropH))`. For the canonical 16:9→9:16 case `y` travel
is zero and presets are effectively a horizontal slider, but the schema doesn't assume
that (a 4:3 source cropped to 9:16 has vertical travel too).

## 2. CropManager (`packages/plugins/lcyt-rtmp/src/crop-manager.js`)

New manager following the plugin's existing manager idiom (constructor takes
`{ mediamtxClient, ffmpegCaps }`, `start/stop/stopAll/isRunning`, wired in
`api.js`'s `initRtmpControl()` and returned alongside the others).

**Process:** built with `createFfmpegRunner()` (so `FFMPEG_RUNNER=docker|worker`
deployments keep working):

```
ffmpeg -rtsp_transport tcp -i rtsp://127.0.0.1:8554/{key}
  -filter_complex "[0:v]crop@vcrop={cropW}:{cropH}:{x0}:{y0},scale={outW}:{outH},zmq=bind_address=tcp\\://127.0.0.1\\:{port}[v]"
  -map "[v]" -map 0:a
  -c:v libx264 -preset veryfast -tune zerolatency -b:v {bitrate}
  -c:a copy
  -f flv rtmp://127.0.0.1:1935/{key}-crop
```

Notes:
- Input is the **raw ingest path** — full incoming quality, one decode. The RTSP
  read-back (rather than a second RTMP pull) matches the fan-out convention and the
  now-enabled `rtsp: yes` in `docker/mediamtx.yml`.
- The output URL is bare `{key}-crop` (no RTMP app prefix) — MediaMTX path names are
  the full URL path (same fix as `outRtmpUrl()`).
- `zmq` sits at the graph tail; its bind port is per-process, allocated from
  `CROP_ZMQ_PORT_BASE` (default 5560) upward, bound to `127.0.0.1` **only**.
- Input resolution (`inW`/`inH`) is taken from `MediaMtxClient.getPath(name).tracks`
  when available, else a one-shot `ffprobe`. If the publisher restarts with a new
  resolution the renderer is restarted with recomputed pixel geometry (the normalised
  presets make this transparent).
- `veryfast` rather than `ultrafast`: this output is audience-facing on short-form
  platforms; the preset is a config knob if CPU-bound.

**Live reposition:**

```js
async applyPosition(apiKey, { xNorm, yNorm, transitionMs })
```
- clamps to `[0,1]`, converts to even pixel offsets;
- `transitionMs === 0` (or fallback mode): a single `crop@vcrop x <px>` + `y <px>`
  command pair — the shift lands on the next frame;
- `transitionMs > 0` and live mode: an interpolation ticker (~30 ms steps, cubic
  ease-in-out) sends a short burst of commands, producing a smooth virtual pan —
  useful when the crop moves *within* one shot rather than on a cut;
- commands go over a per-process ZeroMQ REQ socket (optional `zeromq` dependency,
  lazily imported exactly like `@google-cloud/speech` in `google-stt.js`; if the
  import fails, mode degrades to `restart`);
- in `restart` fallback mode: spawn renderer B with the new position pushing to the
  same `{key}-crop` path (path pre-configured with `overridePublisher: yes` via
  `_upsertPath`), wait for B's publish to be ready (`isPathPublishing`), then stop A.
  The path is never publisher-less, so downstream players see a splice, not black.

**Lifecycle:** started from the `/rtmp` on_publish callback when
`crop_config.enabled` (exactly parallel to the relay fan-out block in
`routes/rtmp.js`), stopped on publish_done; also start/stoppable explicitly via the
routes below. The renderer keeps the last-applied position across source restarts
(persist `last_x_norm`/`last_y_norm` in memory, fall back to the first preset).

**Consumption:**
- **Relay slots** (`stream_relays` table + `routes/stream.js`): new nullable column
  `source_view TEXT DEFAULT 'program'` (`'program' | 'crop'`). In
  `RtmpRelayManager.start()`, slots with `sourceView === 'crop'` are registered as a
  runOnPublish fan-out on `{key}-crop` instead of `{key}` (plain-relay branch; a
  crop-view slot never participates in CEA-708/transcode/DSK modes — the crop
  renderer already re-encodes). This is how a vertical YouTube/TikTok RTMP target is
  configured with zero new delivery code.
- **Browsers**: `GET /stream-hls/{key}-crop/index.m3u8` already passes `HLS_KEY_RE`
  and proxies to MediaMTX — the vertical preview in the web UI is free.
- **Thumbnails**: `GET /preview/{key}-crop/incoming.jpg` likewise.

## 3. HTTP API (`packages/plugins/lcyt-rtmp/src/routes/crop.js`, session Bearer)

```
GET    /crop/config                — config + { running, repositionMode, inW, inH, cropW, cropH }
PUT    /crop/config                — { enabled?, aspectW?, aspectH?, outW?, outH?, videoBitrate?, followProgram?, transitionMs? }
GET    /crop/presets               — list (?setId= filter; default: active set)
POST   /crop/presets               — { name, xNorm, yNorm, setId?, sortOrder? }
PUT    /crop/presets/:id           — update
DELETE /crop/presets/:id           — delete (cascades crop_source_map rows)
POST   /crop/presets/:id/activate  — { transitionMs? } → applyPosition; remembers active preset
GET/POST/PUT/DELETE /crop/sets[/:id] — preset-set (bank) CRUD; POST supports
                                       { cloneFromSetId? } to duplicate a whole set
POST   /crop/sets/:id/activate     — make this set active; re-resolves and applies
                                       the current program source's position from it
POST   /crop/position              — { xNorm, yNorm, transitionMs? } — free positioning (drag UI)
GET    /crop/status                — { running, activePresetId, xNorm, yNorm, repositionMode }
GET/POST/DELETE /crop/source-map[/:id] — follow-program mapping CRUD
```

Mounted in `createRtmpRouters()` / `lcyt-backend/src/server.js` under `/crop`
alongside the other RTMP routers (gated by `RTMP_RELAY_ACTIVE=1`). Feature-gated on a
new `crop` project feature code (registered in `FEATURE_DEPS`, dependent on `ingest`)
when `FEATURE_GATE_ENFORCE=1` — same pattern as `ingest` in `routes/ingestion.js`.

## 4. Production follow (mixer & PTZ integration)

`lcyt-production` must not import `lcyt-rtmp`; use the repo's setter-injection
convention (cf. `sttManager.setDeliveryHelpers()`):

- `lcyt-production` exports `registry.onProgramChanged(cb)` — invoked by
  `POST /production/mixers/:id/switch/:inputNumber` (`routes/mixers.js:124-160`)
  after a successful `registry.switchSource()`, with
  `{ apiKey, mixerId, inputNumber }` — and `registry.onCameraPresetRecalled(cb)`
  from `POST /production/cameras/:id/preset/:preset`, with
  `{ apiKey, cameraId, preset }`. (Switches performed outside LCYT — on the
  physical mixer panel — are only visible if a tally/status poll exists; that is
  Roland-adapter work explicitly out of scope for v1 and the reason manual
  `POST /crop/presets/:id/activate` and cue/action triggers exist.)
- `lcyt-backend/src/server.js` wires both callbacks to
  `cropManager.applyForSource(apiKey, { mixerId, inputNumber, cameraId, cameraPreset })`,
  which (when `crop_config.follow_program`) resolves the most-specific
  `crop_source_map` row — `(camera_id, camera_preset)` match beats
  `(mixer_id, mixer_input)` match — and activates its preset with the configured
  `transition_ms`. The manager tracks the last program input and each camera's
  last-recalled PTZ preset so "camera 1 back on program, now on preset 2" resolves
  correctly regardless of whether the preset was recalled while off-program.
- **Named Actions / cues:** register a `crop_preset` fire in the `lcyt-actions`
  registry (and a matching tool in `lcyt-tools`), so `@name` macros, cue rules, and
  the AI Production Assistant can drive the crop like everything else.

## 5. Web UI (`packages/lcyt-web`)

- **Settings → CC/Egress area**: "Vertical crop" card — enable toggle, aspect/output
  size, bitrate, default transition, follow-program toggle.
- **Preset editor**: over the existing incoming-preview thumbnail
  (`/preview/:key/incoming.jpg`), render a draggable 9:16 rectangle; drag emits
  throttled `POST /crop/position` (live WYSIWYG when the stream is up), "Save as
  preset" persists `x_norm`/`y_norm`. A row of preset buttons calls
  `POST /crop/presets/:id/activate` — this is also the operator's manual switcher.
- **Preset-set (bank) UI — explicit requirement.** Crop positions must be editable
  and browsable *per set*, not as one flat list:
  - a **set selector** (tabs or dropdown) at the top of the crop editor — every
    preset shown/edited below belongs to the selected set; "New set", "Duplicate
    set" (clone all positions as a starting point), "Rename", "Delete";
  - a **set overview grid**: rows = sources (mixer inputs / camera+PTZ-preset
    combos from the source map), columns = sets; each cell shows that source's
    crop position in that set as a mini-thumbnail (the 9:16 rectangle drawn over a
    scaled preview frame). Clicking a cell opens the draggable editor for exactly
    that (source, set) pair — this is where "camera 1 preset 1 / camera 2 /
    camera 1 preset 2, each with different positions" is authored at a glance;
  - an **"Activate set" control** on the operate surface (Broadcast page) next to
    the preset switcher, calling `POST /crop/sets/:id/activate`, with the active
    set clearly badged so the operator always knows which bank the follow logic is
    drawing from.
- **Source-map editor**: table binding mixer inputs / camera+preset combos to crop
  presets (scoped to the selected set; the overview grid above is its visual form).
- **Vertical monitor**: an HLS.js tile playing `/stream-hls/{key}-crop/index.m3u8`.

## 6. Ops / environment

| Env var | Purpose | Default |
|---|---|---|
| `CROP_ZMQ_PORT_BASE` | first localhost port for per-process zmq bind | `5560` |
| `CROP_OUTPUT_DEFAULT` | delivery size when `out_w/out_h` NULL | `1080x1920` |

- `docker/lcyt-ffmpeg/Dockerfile`: add libzmq so `hasZmq` is true in containers.
- `PORTS.md`: document the `CROP_ZMQ_PORT_BASE` range (loopback only, never exposed).
- `docker/mediamtx.yml` path-naming comment: add `{key}-crop`.

## 7. Testing

- **Geometry unit tests** (pure): aspect→pixel derivation, even rounding, clamping,
  normalised↔pixel round-trip across resolution changes, ease interpolation steps.
- **Manager tests** with `FFMPEG_RUNNER=worker` + mock daemon (pattern established in
  `test/rtmp-manager-restart.test.js`): start/stop lifecycle, restart-fallback
  publisher swap ordering (B publishing before A stops), no state wipe on restart.
- **Route tests** with in-memory SQLite (pattern: `test/stream.test.js`): CRUD,
  activate, feature gate, source-map resolution specificity.
- **Follow tests**: fake registry callbacks → correct preset chosen for the
  camera-1/preset-2 scenario from the requirements.
- Manual verification recipe in the plan's implementation PR: `ffmpeg -re -i
  testsrc2` publish → activate presets while watching `{key}-crop` HLS — confirm no
  black frames on switch (live mode) and splice-only (fallback mode).

## Phases

1. **Static crop rendition** ✅ (implemented 2026-07-13) — schema (`crop_config`,
   `crop_presets`, `crop_preset_sets`, `crop_source_map` in
   `packages/plugins/lcyt-rtmp/src/db/crop.js`), CropManager
   (`src/crop-manager.js`) started/stopped from the `/rtmp` publish callbacks,
   `{key}-crop` path, relay `source_view` column + crop-slot fan-out in
   `rtmp-manager.js`, `/crop` router (`src/routes/crop.js`) mounted by
   lcyt-backend, `crop` feature code (dep: `ingest`).
2. **Live reposition** ✅ core (implemented 2026-07-13) — `hasZmq` probe in
   `probeFfmpeg()`, lazy-imported `zeromq` REQ client (optional dep — absence
   downgrades to restart mode), `applyPosition` with clamped instant moves +
   eased transitions, restart fallback (position carried across the swap),
   `/crop/position`, `/crop/presets/:id/activate`, `/crop/sets/:id/activate`
   (re-applies the same-named preset from the new set), `/crop/status`.
   Remaining from this phase: the `overridePublisher` pre-config on the
   `{key}-crop` path for a cleaner splice in restart mode.
3. **Web UI** — settings card, draggable preset editor, preset switcher, the
   preset-set UI (set selector, duplicate-set, sources×sets overview grid,
   operate-surface "Activate set" control), vertical monitor tile.
4. **Production follow** — `crop_source_map` + registry callbacks + server wiring +
   `crop_preset` named-action/cue/tool registration.
5. **Ops & polish** — ffmpeg image libzmq, docs (CLAUDE.md files, PORTS.md,
   mediamtx.yml comment), feature-gate registration, test coverage summary update.

## Open questions

- Multiple simultaneous crop renditions per key (e.g. 9:16 *and* 1:1)? Schema is
  one-row-per-key today; going multi-rendition would move `crop_config` to
  one-row-per-rendition with `{key}-crop-{slug}` paths. Deferred until needed.
- Should the crop follow *tally* (mixer-initiated switches on the panel) rather than
  only LCYT-initiated switches? Requires Roland/OBS tally polling in the adapters —
  tracked as a follow-up, not v1 (see §4).
- Audio for short-form platforms is passed through (`-c:a copy`); if a target
  requires specific AAC profiles the per-slot `audioBitrate` idiom can be reused.
