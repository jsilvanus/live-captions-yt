# Egress outputs: edit per output, not per feed (plan, 2026-10-19)

Status: draft (2026-10-19), reviewed with Juha in the project thread. Nothing built. Follows the feeds and devices split (PRs 1 to 9).

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

## 5. Risks and open questions

- Chained steps add latency (each hop is an RTSP read plus an encode); needs a measurement on the Windows stack. Crop on top of a DSK output re-encodes twice.
- Alpha does not survive H.264/RTMP, so a viewport used as an overlay must use its chroma-key settings (as today).
- Open: audio from a separate feed can drift against the video (different clocks); first version has no sync offset, add one (`audio_offset_ms`) if the Windows test shows drift.
- Open: should the old `sourceView` slots be migrated automatically or kept as a shim for one release? Proposal: migrate at startup, keep the column for rollback.
- Nothing here is verified against a real MediaMTX or fleet.
