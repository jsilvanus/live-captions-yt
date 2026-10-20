# Egress outputs: edit per output, not per feed (plan, 2026-10-19)

Status: planning complete (2026-10-19), waiting for Juha's go. Nothing built; no code PR is started until Juha says so. Follows the feeds and devices split (PRs 1 to 9).

## 1. Model

- **Ingest (Feeds card)** is only the list of what comes in: raw streams, no processing settings. This stays as built.
- **Egress (Outputs)** defines what goes out and how it is edited. An **output** is a named pipeline:
  `source -> [DSK viewports] -> [crop] -> destinations`.
  - source: a feed, or another output (so Vertical can reuse Program's picture instead of mixing twice).
  - DSK: zero or more viewports composited on the source, each with its own chroma key and size (the viewport already owns those settings, `display_settings_json.stream`).
  - crop: optional vertical (or other aspect) crop with presets, source map and production-follow.
  - destinations: relay targets (YouTube, Facebook, custom RTMP), today's relay slots.
- **Mixing** stays in the mixer. The ATEM output or the LCYT software mixer (browser canvas, WHIP to the mixer's `output_key`) arrives as one feed. An output never mixes by itself. Limit: the LCYT mixer needs an open browser tab; a server-side mixer on the fleet is separate, later work.
- **Use case:** two cameras -> mixer -> feed "Program". Output "Program" = feed Program + DSK -> YouTube landscape. Output "Vertical" = output Program + crop -> YouTube vertical. Both run at once.

## 2. What exists today (verified in code)

- Crop: `CropManager` has one session per api key, reads `rtsp://.../<apiKey>`, writes `<apiKey>-crop`; `crop_config`, presets, preset sets and source map are keyed by api key.
- DSK composite: `RtmpRelayManager._dskState` is one entry per api key, composited inside the relay's own ffmpeg onto `<apiKey>`; the DSK stream it reads is `dsk/<apiKey>`. At most one `composite` viewport per key (`demoteOtherCompositeViewports`).
- DSK viewports already render their own streams `<key>__<viewport>` (own Chromium page or fleet `dsk` job), with chromaKey, outputDimensions and push targets. Viewport streams are excluded from the composite.
- Relay slots (`rtmp_relays`) pick a source: program (raw api-key path), crop (`<apiKey>-crop`) or a named feed (`sourceFeedId`, raw only); fan-out is one ffmpeg tee per source path.

## 3. Changes

1. **Data.** New `outputs` table: id, owner_api_key, name, source_type (`feed`|`output`), source_id, `dsk` (JSON list of viewport names), `crop_enabled`, sort_order. Crop config, preset sets and source map get an `output_id` (null = the project's old crop, migrated to an output named "Vertical" on the main feed). `rtmp_relays` gets `source_output_id`.
2. **Processing steps as MediaMTX paths.** Each active output step writes its own path: `out-<id>-dsk` (feed + viewports composited), `out-<id>-crop`. A step is one ffmpeg run through the existing fleet/spawn runner (`FFMPEG_RUNNER`), supervised like the fan-out (`FanoutSupervisor` pattern). Chaining = reading the previous step's path. Only steps that have settings run; a plain feed output is just a fan-out as today.
3. **DSK composite moves out of the relay process** into the step above, reading `dsk/<apiKey>__<viewport>` streams. The legacy single composite viewport keeps working for existing projects (becomes the DSK of the migrated main output).
4. **CropManager** sessions are keyed by output id instead of api key; source path = the output's source; production-follow resolves outputs whose source feed is linked to the camera that went on program.
5. **Relay manager.** A slot's source is `sourceOutputId` (new) | `sourceFeedId` | legacy `sourceView`. The fan-out registers the output's final path.
6. **API.** `GET/POST/PATCH/DELETE /outputs`, crop and DSK settings under `/outputs/:id/...`; `/crop/*` and DSK composite routes keep working for the migrated main output.
7. **UI.** Egress card lists outputs: source picker, DSK viewport multi-select, crop toggle with link to the Crop page (feed/output picker there), destinations as today's slots. Feeds card unchanged.
8. **Limits.** Cap derived steps per project (`MAX_OUTPUT_STEPS`, default 4) so a mistake cannot start unlimited ffmpeg runs; fleet `requires` for libx264.

## 3b. Audio (decided by Juha, 2026-10-19)

Audio streams are ingest too: a feed can be audio only, video only, or both (`prod_feeds.media` = `av` default | `audio` | `video`). Many audio feeds may exist, but **one audio source is placed into an output for now**.

Output audio setting (`audio_source`): `source` (default: the source's own audio) or `feed:<id>` (an audio feed). Case 1, an audio stream replaces all sound, is exactly this: the output takes the video of its source and the audio of the chosen audio feed (ffmpeg `-map` from two inputs, no mixing).

Cases 2 to 4 are **mixer behaviour**, not output behaviour; they come with the mixer work:
2. the mixer takes sound from each video while that video is on (audio follows video);
3. the mixer takes sound from only one chosen feed;
4. the mixer does 2 or 3 and layers extra audio on top.
The mixer's result still arrives as one feed with audio, so an output needs nothing new for them.

Scheduled for later, not in the five PRs: a server-side mixer (video and audio, on the fleet) and an audio mixer (front end and server) that lets an output take several audio inputs. Until then the output model keeps `audio_source` a single value so it can later become a list without a data migration problem (stored as JSON).

## 4. PR order (sequential)

1. Plan + data model (`outputs` with `audio_source`, `prod_feeds.media`, `output_id` columns, migration of the existing crop to an output). No behaviour change.
2. Crop per output (CropManager keyed by output, step path, production-follow by feed link).
3. DSK step per output (composer reading viewport streams; legacy composite migrated).
4. Relay slots source from outputs; fan-out of step paths; audio replace (video of the source + audio of an audio feed).
5. UI: outputs list, DSK/crop pickers, feed/output picker on Crop page and DSK control.

## 5. Concrete design (checked against the code on main, 2026-10-19)

### 5.1 Schema (both Prisma schemas, `sqlite/schema.sql`, new `postgres/migrations/0010_outputs.sql`)

- `outputs`: `id` TEXT pk, `owner_api_key`, `name`, `source_type` (`feed`|`output`), `source_id`, `dsk_json` (JSON array of viewport names, default `[]`), `crop_enabled` (0/1), `audio_source` (JSON, default `"source"`; later `{"feed":"<id>"}`, later a list), `enabled`, `sort_order`, `created_at`. Index on `owner_api_key`.
- `prod_feeds.media` TEXT default `av` (`av|audio|video`).
- `crop_config`: today `api_key` is the primary key, so a per-output config needs a new key. Add `output_id` (nullable) and a unique index on `output_id`; the old row (`output_id` NULL) stays the project's legacy config and is the migration source. Same `output_id` column on `crop_preset_sets`, `crop_presets` (their unique indexes are on `api_key, name`; widen to include `output_id`) and `crop_source_map`.
- `rtmp_relays.source_output_id` TEXT NULL. `source_view` and `source_feed_id` stay.
- Cycle guard: an output whose source is an output must not reach itself; reject on write and cap chain depth at 3.

### 5.2 Step runner

One new `OutputStepManager` in `lcyt-rtmp`, modelled on `FanoutSupervisor` (restart with backoff, one ffmpeg per step, runs through `createFfmpegRunner` so spawn and fleet both work). Per output it computes the needed steps from its settings:

- `dsk` step (when `dsk_json` is non-empty): inputs = source path + each `dsk/<apiKey>__<viewport>` stream, chroma key from the viewport's `display_settings_json.stream.chromaKey`, writes `out-<id>-dsk`.
- `crop` step (when `crop_enabled`): wraps the existing `CropManager` renderer, input = previous step path or the source, writes `out-<id>-crop`.
- audio: when `audio_source` is a feed, the last step (or a plain remux step if there is none) maps video from the chain and audio from the audio feed; `-map` only, no mixing. When there is no video-processing step and audio is `source`, no step runs.
- The output's final path is the last step's path, or the source path when no step is needed.
- Order is always source, DSK, crop, because the DSK is authored at the source's frame size; a crop-then-DSK order is not offered.

### 5.3 Migration (at startup, idempotent, in one transaction per project)

1. Per project with a main feed: create output "Program" (source = main feed, `dsk_json` = the legacy composite viewport if one exists, `crop_enabled` 0).
2. Per project with `crop_config.enabled` or presets: create output "Vertical" (source = output Program, `crop_enabled` per the old row) and copy config, preset sets, presets and source map to it with `output_id` set. Old rows are kept for rollback.
3. `rtmp_relays` with `source_view = 'program'` get `source_output_id` = Program, `'crop'` = Vertical, `source_feed_id` slots are untouched. `source_view` is kept for one release.
4. Legacy `/crop/*` routes and the composite DSK routes resolve to Vertical and Program respectively, so existing clients and the web UI keep working until PR 5 moves them.

### 5.4 API

`GET/POST/PATCH/DELETE /api/v1/outputs`, `PUT /outputs/:id/crop`, `/outputs/:id/crop/presets|preset-sets|source-map`, `PUT /outputs/:id/dsk`, `PUT /outputs/:id/audio`, `GET /outputs/:id/status` (step states, final path, running ffmpeg). Same auth and project scoping as `/relay`. Route handlers delegate to `src/db/outputs.js` (repo convention). Relay slot routes accept `sourceOutputId`.

### 5.5 Settings

`MAX_OUTPUT_STEPS` (default 4 per project) in `settings/registry.js`; the limit counts steps, not outputs, and a start beyond it is refused with a readable error and an event. Fleet jobs get `requires` for `encoder:libx264` (plus `filter:colorkey`/`filter:chromakey` for the DSK step).

### 5.6 Tests and verification

- Unit: cycle/depth guard, step planning from output settings (which steps, which paths), ffmpeg arg building for the DSK and audio-map steps, migration idempotence (run twice = same rows), legacy route resolution.
- Integration: `OutputStepManager` with a fake runner (same pattern as the fan-out supervisor tests), crop session keyed by output id, relay slot with `sourceOutputId`.
- Both schemas: SQLite and the Postgres CI job (set explicit test timeouts; the Postgres job has had flaky failures, report unrelated ones and do not retry blindly).
- Manual (Windows stack, Juha): landscape + vertical to YouTube at once, chain latency, audio replace, drift.
- Docs updated per PR: `packages/lcyt-backend/CLAUDE.md`, `lcyt-rtmp/CLAUDE.md`, `lcyt-dsk/CLAUDE.md`, `docs/PLANS.md`, `docs/API` entries.

### 5.7 Decisions taken in this plan (change them if you disagree)

- Old `sourceView` slots: migrated automatically at startup, column kept for one release as rollback.
- Output chain order is fixed (source, DSK, crop); an output may have at most one crop.
- Several composite viewports on one output are allowed (all keyed onto it in `dsk_json` order); the "one composite per key" rule only stays for the legacy single-viewport path.
- No sync offset in the first version (see risks).

## 6. Risks and open questions

- Chained steps add latency (each hop is an RTSP read plus an encode); needs a measurement on the Windows stack. Crop on top of a DSK output re-encodes twice. Mitigation if too slow: a combined DSK+crop single-ffmpeg step for the common case (later, only if measured).
- Alpha does not survive H.264/RTMP, so a viewport used as an overlay must use its chroma-key settings (as today).
- Audio from a separate feed can drift against the video (different clocks); the first version has no sync offset, add `audio_offset_ms` if the Windows test shows drift.
- Production-follow now resolves by feed link; an output whose source is another output follows through to the root feed. Needs a test with two cameras and the ATEM/LCYT mixer.
- The LCYT mixer needs an open browser tab; if it closes, the Program feed stops and every output built on it stops with it (server-side mixer is separate, later work).
- Multi-instance: the step owner follows the same per-key ownership as the relay/crop owner (`INSTANCE_URL`, `CLUSTER_PROCESS_OWNERSHIP`); outputs must start on the owner instance. Not verified.
- Nothing here is verified against a real MediaMTX or fleet.

## 7. Not in scope (scheduled for later)

Server-side mixer (video and audio, on the fleet), audio mixer (front end and server, several audio inputs per output), audio sync offset, combined DSK+crop step, outputs that mix two feeds themselves.

## 8. One broadcast, three views (added 2026-10-20)

Case (Juha): the same program is sent out as (A) a general view to YouTube, (B) a view with a sign-language interpreter video overlaid for deaf viewers, (C) a view with another audio track for simultaneous interpretation into another spoken language. This is the reason outputs exist, so it is the test of the model. Result: A and C fit the five PRs as planned; B needs one new layer kind; captions need per-output language; sync needs the delay that section 6 left out.

### 8.1 The three outputs in the model

| Output | Source | Layers | Audio (`audio_source`) | Destination |
|---|---|---|---|---|
| A General | feed Program | DSK as today | `source` | YouTube stream key 1 |
| B Sign language | feed Program | DSK + PiP (picture-in-picture, e.g. interpreter or close shot) | `source` | YouTube stream key 2 |
| C Interpreted | feed Program | DSK as today | `{feed: interpreter-audio}` | YouTube stream key 3 |

All three read the same Program feed; they differ only in what is added or replaced, which is why they must be outputs and not feed settings. Each destination is its own YouTube broadcast and stream key: to my knowledge YouTube Live carries one audio track per broadcast (several audio tracks exist for uploaded videos, not live; to be checked before the build), so a language is a separate broadcast, not a track.

### 8.2 Audio inputs

- C is exactly case 1 of section 3b (one audio feed replaces all sound); no mixer is needed. The interpreter's audio arrives as a feed with `media = audio` (RTMP/WHIP from the interpreter's booth or a browser). Several interpreter feeds (one per language) are just several audio feeds, each chosen by its own output. That already fits "many audio inputs, one placed per output".
- What the single-valued `audio_source` cannot do: C with the original sound kept low under the interpreter ("bed", mixer mode 4), or an interpreter who is switched on only while speaking. Both are mixer or audio-mixer work (section 7). The stored JSON can grow to `{main, bed: {source, gain}}` without a migration.
- Sync is the real problem, and it moves from "later" to "needed". An interpreter speaks (or signs) a few seconds behind the speaker, so C's audio lags the picture and B's sign video lags the speech. Either the viewer lives with it, or the output delays its source (video and original audio) by `delay_ms` so the interpretation lands closer to the picture. Add `outputs.delay_ms` (default 0, per output, so A stays live while C is delayed). Buffering several seconds of live video in an ffmpeg step is not free (memory, restart loses the buffer); this needs measuring on the Windows stack before promising it. Alternative if it is too heavy: delay at the feed (a delayed copy path of Program) and let C and B read that.
- Audio must be present for the overlay in B: the PiP's own audio is dropped (`-map` only the base audio); a signing interpreter has no voice track to mix.

### 8.3 Video: the picture-in-picture layer (B)

The DSK viewport model renders HTML graphics, with chroma key for transparency. A live video of a person is not a graphic, so do not push it through Chromium. Future work, to be implemented later (Juha, 2026-10-20). Add a second layer kind, called **PiP** in the UI and API (not "interpreter": the same layer serves a close shot or any second camera), to the same step, in one ffmpeg run, no extra hop:

- `outputs.pip_json`: `[{ feedId, x, y, w, h, maskAssetId?, frameAssetId?, shape?: 'rect'|'rounded'|'circle', radius? }]` with fractions of the frame (0..1), so it follows the output size. The PiP source is a normal feed (interpreter, close shot, any camera). **Shape = premade PNGs (decided 2026-10-20).** `maskAssetId` is a PNG with alpha (for example a white circle on transparent) from the project's assets: the step centre-crops the feed to the mask's aspect, scales it to the box and uses the mask's alpha as the PiP's alpha (`alphamerge`). `frameAssetId` is an optional PNG (ring, logo border) overlaid on top in the same step. The built-in `circle` and `rounded` shapes generate a default mask PNG once, so no upload is needed. Keep the PNG at least as large as the box on screen (about 640x640 for a 1080p frame) so the edge does not go soft; feather the edge in the PNG. No chroma key and no per-pixel maths. H.264 carries no alpha, but the mask is applied inside the filter graph before encoding. Not yet run against real ffmpeg on a fleet worker; check `alphamerge` there when building. A `geq` computed mask stays as a fallback only.
- A vertical crop of B must keep the PiP inside the crop (chain order already puts the crop last; the crop presets would need a keep-out region or the PiP is placed relative to the cropped frame, a second PiP set per output). Open question; B vertical is not in the first version.
- Common practice for accessibility is a picture at least about a sixth of the frame width, kept clear of the captions at the bottom; set the default to a bottom-left or bottom-right box with the default CC area free (to be checked with the church's accessibility guidance, not assumed).

### 8.4 Captions

What exists (checked in code): one caption stream per project; STT has one audio source (`hls`, `rtmp` or `whep`) and one language per project; the translation path already turns a transcript into each enabled target's language (`stt-manager.js`, `captionLang`, `translations`, `showOriginal`); targets (`caption_targets`) carry a language and a kind (youtube stream key, viewer, generic); a relay slot's `caption_mode` is `http` or `cea708`.

What the three views mean:

- A and B: captions in the source language (Finnish) on their stream keys. For B this is not optional in practice: deaf viewers need captions as well as the sign video. Same caption payload, two YouTube targets.
- C: viewers hear another language, so the captions on that stream key should be in that language. Two ways, both useful: (1) translate the source transcript (exists, fast, follows the speaker, not the interpreter), (2) run STT on the interpreter's audio feed with that language (matches what is heard; lags and is condensed, as interpretation is). First version: (1); (2) comes with STT per audio feed.
- The gap is the link between a caption target and an output. Today a target is a project-wide thing, so every target receives the same payload. Add `caption_targets.output_id` (NULL = every output, today's behaviour) and let the target's language decide which translation it takes. The Outputs card then shows, per destination, "captions: Finnish / Swedish via translation / none".
- Source-language choice per output is not needed; the language belongs to the target.
- Burned-in captions for B (instead of or in addition to YouTube CC) would be a DSK viewport that renders live caption text. Not checked whether a DSK template can bind to live captions; list it as an option, YouTube CC stays the default. CEA-708 is per relay slot and stays so.
- STT audio source: with several audio feeds the STT must say which one it listens to. Today `audioSource` is about transport (`hls`/`rtmp`/`whep`), not which feed. Add an optional feed (default: Program) so a second STT session can follow an interpreter feed later; one session per project stays the first version.

### 8.5 What changes in the PR order

The five PRs stay as built (A and C work with them today). New, after PR 5, each its own small PR:

6. Picture-in-picture layer in the DSK step (`pip_json`, one ffmpeg run, UI: feed picker plus position on the Outputs card).
7. Caption targets per output (`caption_targets.output_id`, language per target, Outputs card shows it).
8. `outputs.delay_ms` and the sync measurement; decide there between step buffer and delayed feed path.
9. (Later, with the mixers) STT per audio feed; audio bed under the interpreter; interpreter switch.

### 8.6 Risks specific to this case

- Three outputs from one Program means three re-encodes plus three RTMP uploads; check fleet capacity and the project's `MAX_OUTPUT_STEPS` (A with a DSK and B with PiP are one step each, C needs a remux step for the audio map, so three steps, under the default cap of 4 only if nothing else runs).
- Interpreter feed drops: B must fall back to the plain program (no overlay) and C to the source audio, not stop; decide the fallback per output.
- Delayed interpretation and live CC drift apart on C if captions are translated from the speaker; accepted in the first version, noted for the viewer-facing description of the stream.
- Nothing here is verified against a real MediaMTX, fleet or YouTube.
