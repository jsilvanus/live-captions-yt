---
id: plan/saarnavideo_handoff
title: "Handoff to Saarnavideo and separate clean / DSK / program recordings"
status: in-progress
summary: "LCYT side built 2026-10-13 (recorder fix L0, feed model L1, program and DSK recording L2/L3, manifest/finalise/delivery L4/L5; Saarnavideo import on hold). Not verified against a real MediaMTX. Original plan text follows. Plan only, After a broadcast, LCYT hands the produced material (finished video files, captions, DSK event log, broadcast metadata) to Saarnavideo for editing. A versioned handoff manifest is the contract; media moves by S3 reference when both apps share a bucket, otherwise by signed-URL pull. In the same change the recorder stops saving only one feed: it records the clean feed (camera/mixer ingest), the DSK feed (graphics only) and the program feed (clean plus DSK, what went out) as separate files, so each can be edited later."
related: plan/recording_vod, plan/dsk_viewport_settings, plan/ingest_feeds, plan/broadcasts, plan/named_actions, plan/multi_instance, plan/multi_mediamtx
---

> **Implementation status (2026-10-13).** Built: L0 (#357), L1 `video_feeds` + `handoffs` tables and `RECORD_FEEDS`, L2 program recording (MediaMTX path `<key>-out`, no ffmpeg change needed), L3 DSK feed recording (path `<dsk app>/<key>`, chroma key kept in the feed meta) and the DSK change log from the event bus, L4 gap-aware parts, MP4 remux, caption alignment, manifest v1, signed downloads, L5 `POST /handoff`, `/handoff/:id/send`, `HANDOFF_AUTO_SEND`, and a button on the Stored videos page. Differences from the text below: delivery URLs are `https` download links (S3 stores redirect to presigned URLs; `s3://` references are not implemented); MP4 files are made at handoff time from the HLS VOD, not at recording time; program/dsk recording only covers the periods a composite or renderer stream was publishing, so feeds can have several `parts` with their own `startMs`; per-project opt-in is not built (env switch). Not done: real alpha DSK encode, markers, L6 delete-with-group and size estimate, a run against a real MediaMTX, and everything on the Saarnavideo side.

# Handoff to Saarnavideo and separate clean / DSK / program recordings

Companion plan in Saarnavideo: `docs/plans/lcyt-import.md`. The manifest in this document is the contract between the two; this repo owns it.

## Goal

1. After a stream ends, one action (manual, or automatic per project) makes the broadcast available in Saarnavideo as a project: video, captions, and the information needed to edit it (title, date, variables, markers).
2. While streaming with DSK graphics, keep three recordings instead of one, so a mistake on air (wrong lower third, typo, graphic left up too long) can be fixed in the edit.

## What exists today (checked in code, 2026-10-12)

- **One recording.** `startSessionRecording` (`packages/lcyt-backend/src/routes/live.js`) patches the MediaMTX path `<ingest_stream_key or apiKey>` with `record: yes, recordFormat: fmp4`. That path is the raw ingest, so today's recording is the **clean feed**, although the UI calls it "Recorded broadcast". Rows live in `videos`, upload to S3 via `syncVideoRecordingToStorage` when a recordings store exists (`packages/lcyt-backend/src/db/videos.js`).
- **DSK composite is done at egress.** `RtmpRelayManager` (`packages/plugins/lcyt-rtmp/src/rtmp-manager.js`) runs one ffmpeg per key: input 0 is the ingest, input 1 is the DSK renderer's RTMP push (`<DSK_RTMP_APP>/<key>`, optionally chroma-keyed by `buildDskCompositeFilter`) or static overlay images. Output goes to the relay targets, through MediaMTX paths `<key>-<suffix>` (`outPathName`) when a MediaMTX client is configured. That output is the **program feed**, and nothing records it.
- **The DSK feed already exists as a stream**, either the legacy per-key renderer push or a viewport stream `<key>__<viewport>` (`lcyt-dsk/src/stream-names.js`), but is never recorded. RTMP/h264 carries no alpha, so the live feed uses a key colour (`transparent + chromaKey`), or black with a warning (`resolveCaptureBackground`). The renderer itself has real alpha before encoding (PNG screenshots).
- **Captions** are files (`lcyt-files`), `shiftVttContent` already aligns archived VTT to a VOD timeline. Captions stay files (decision 2026-10-12, `plan_captions_in_db.md` is not pursued now).
- **Things to verify before building**: `ensureVideoArtifacts` writes a placeholder playlist and an empty `segment0.ts`, and `recordPath` is passed a directory, not a MediaMTX path template. `plan_recording_vod.md` itself says the S3 half was never wired. Phase L0 below starts by proving that one real recording yields a playable file; it may need to be repaired first.
- **Privacy bug to fix in passing:** `buildVideoStorageKey` uses `${apiKey}/${videoId}` as the S3 prefix. An API key is a credential. Any object key or path put in a manifest must not contain it (use the project id or slug).

## Decisions proposed (Juha to confirm or change)

1. **Three named feeds** with roles `clean`, `dsk`, `program`. Choice per project (and per broadcast override), default: record `clean` always, `program` and `dsk` whenever a DSK composite is active. If no DSK is active, `program` is an alias of `clean` (the manifest says so; no second file).
2. **The program recording is a tee output of the composite ffmpeg that already runs**, so no extra encode. Not derived later from clean + dsk, because the exact picture that went out (timing, encoding, delay) is worth keeping as a fallback.
3. **DSK is delivered two ways**, cheap one first:
   - an **event log** (`dsk-events.json`): every graphics change with wall time, template/graphic name, and variable values (from the `<!-- graphics:... -->` metacodes and manual overlay changes). Tiny, lets Saarnavideo rebuild or correct graphics in its own editor.
   - a **DSK video** with its keying information. First version: the same h264 keyed feed that composites on air, stored with the key colour/similarity/blend in the manifest. Open question: real alpha (VP9 `yuva420p` in WebM, or ProRes 4444) from the renderer's PNG frames, which removes colour fringes. Needs a CPU benchmark on the renderer host before choosing.
4. **Handoff by manifest.** One JSON file per handed-off broadcast, versioned (`version: 1`). Everything aligns to the **clean feed's t = 0** except media files that carry their own `offsetMs`.
5. **Two transports, one contract.**
   - *Shared S3*: LCYT writes media and manifest under a prefix; Saarnavideo references the objects (`s3://bucket/key`, which its media store already accepts) or copies them.
   - *No shared storage*: Saarnavideo pulls from LCYT with short-lived signed URLs (new `GET /api/v1/handoff/:id` plus per-file download). This is also the Windows / local-install case.
6. **Trigger**: a button "Send to Saarnavideo" on the Stored videos card / broadcast detail, and an opt-in "when a broadcast completes" setting that fires the same action (via the named-actions plugin, `plan_named_actions.md`, or directly from the broadcast-completed transition). LCYT pushes a small notification `{ manifestUrl }`; Saarnavideo fetches everything else. If Saarnavideo is unreachable the handoff stays "ready, not delivered" and can be retried.
7. **MP4 finalisation in LCYT.** MediaMTX writes fMP4 segments. A finalise step remuxes each feed (`-c copy`) to one faststart MP4 as an fffleet batch job (local fallback as everywhere else). Saarnavideo then never has to understand HLS/fMP4 segment trees.

## Manifest v1

```json
{
  "version": 1,
  "origin": { "system": "lcyt", "instance": "<INSTANCE_URL or id>", "projectId": "<project id, not the API key>", "broadcastId": "…", "videoId": "…" },
  "title": "Messu 2026-10-11",
  "startedAt": "2026-10-11T08:00:12.480Z",
  "endedAt": "2026-10-11T09:12:03.100Z",
  "feeds": [
    { "role": "clean",   "ref": "s3://bucket/handoff/<id>/clean.mp4",   "durationMs": 4310000, "width": 1920, "height": 1080, "fps": 25, "offsetMs": 0 },
    { "role": "program", "ref": "s3://bucket/handoff/<id>/program.mp4", "aliasOf": null, "durationMs": 4312000, "offsetMs": 1840 },
    { "role": "dsk",     "ref": "s3://bucket/handoff/<id>/dsk.mp4", "hasAlpha": false,
      "key": { "color": "0x00B140", "similarity": 0.3, "blend": 0.1 }, "offsetMs": 1840 }
  ],
  "captions": [
    { "language": "fi", "format": "vtt", "ref": "…/captions.fi.vtt", "origin": "stt|typed", "alignedTo": "clean" }
  ],
  "dskEvents": { "ref": "…/dsk-events.json" },
  "markers": [ { "atMs": 1234000, "kind": "cue", "label": "Evankeliumi" } ],
  "variables": { "title": "…", "date": "2026-10-11" }
}
```

Rules: refs are `s3://` URIs or HTTPS URLs; no API keys, stream keys or push URLs in the manifest; `variables` come from the broadcast record (free key/value, no church-specific names built in; Saarnavideo maps them to its project variables); `markers` come from the cue engine and metacode sections when present, and are optional; `aliasOf: "clean"` replaces `ref` when program equals clean.

## Time alignment

Each feed is recorded from its own MediaMTX path, so the files start at slightly different wall-clock moments and the program feed lags the clean feed by relay processing. Plan:
- Record each feed's first-frame wall-clock time (from MediaMTX segment names or the recorder's own start stamp) and compute `offsetMs` relative to the clean feed.
- Align captions to the clean feed with the existing `shiftVttContent`, so Saarnavideo takes them as is.
- If wall-clock offsets prove unreliable on the real stack, Saarnavideo gets an "auto sync" fallback (audio cross-correlation of program against clean). Described in the Saarnavideo plan.

## Phases

**L0. Prove the recorder (before anything else).** One real run on the Windows stack: record a test stream, confirm a playable file in `RECORDINGS` and in S3, fix the playlist/placeholder/`recordPath` and the S3 sync gaps, and change the storage key so it no longer contains the API key. Tests: unit for key building; a MediaMTX-backed run is manual (never run in CI).

**L1. Feed model.** Add `feed_role` (`clean|program|dsk`) and `group_id` to `videos` (additive, Prisma on both dialects, SQLite and Postgres), per-project `record_feeds` setting, and rename the UI label. One `videos` row per feed, grouped per broadcast. The recorder interface from `plan_recording_vod.md` (`recorder.start/stop`) gets a `role` argument.

**L2. Program recording.** In `RtmpRelayManager`, when a composite is active, add one more tee output to a MediaMTX path `<key>-program-rec` and record that path; stop and finalise with the relay. Covers both the static-overlay and RTMP-source DSK branches. Skip when there is no DSK (alias). Constraint to document: not available in the plain-tee fallback without a MediaMTX client.

**L3. DSK recording.** (a) `dsk-events.json` writer in the DSK caption processor and overlay-change path, with wall-clock stamps; (b) record the DSK stream path (`<key>` push or `<key>__<viewport>`), storing key parameters; (c) only after the benchmark, optional alpha encode in the renderer and fffleet executor. Per-key ownership under multi-instance follows the relay owner (L4 of `plan_multi_instance.md`); the shared `GRAPHICS_DIR` requirement from #355 applies to event replay as well.

**L4. Finalise and manifest.** fffleet remux job per feed, caption alignment, manifest builder (pure function with a schema, versioned), storage under `handoff/<groupId>/`, `GET /api/v1/handoff/:groupId` and signed per-file URLs. Manifest schema and fixtures are the shared test artefact; Saarnavideo vendors a copy of the schema.

**L5. Delivery.** "Send to Saarnavideo" action and the on-complete setting. Settings: Saarnavideo base URL and a token. Saarnavideo today only has a shared `ACCESS_SECRET` (cookie / `x-access-secret` / bearer), so v1 uses that as the bearer; a dedicated import token is a Saarnavideo follow-up. Secrets live in encrypted project settings, never in the manifest or logs.

**L6. Housekeeping.** Retention stays "until deleted manually". Add a delete-with-group action and a storage-size estimate (three feeds are roughly three times the disk of today). Document the extra load on the MediaMTX host and S3.

## Tests

Manifest schema and builder unit tests; fixture-based finalise test with generated ffmpeg clips (clean, green-keyed DSK, composite); caption alignment test; routes for handoff with fake S3 (the repo already has fake-S3 helpers); a contract test that validates the Saarnavideo fixture against the same schema. Never run against real MediaMTX, a real fleet or a real church service. Fixtures use synthetic text only (no real transcripts or personal names).

## Risks and open questions

- **Disk and bandwidth** triple with three feeds; MediaMTX recording at 4 s segments on one host (see `plan_multi_mediamtx.md`).
- **Alpha vs key colour** for the DSK feed (benchmark, quality, whether Saarnavideo needs alpha at all or only events).
- **Data protection:** recordings and transcripts of worship services can reveal religious belief and show identifiable people. Handoff must be explicit per project (off by default), documented in the privacy notes, and the signed URLs short-lived.
- **Do we need the DSK video at all** if the event log can re-create graphics in Saarnavideo? Proposed: keep both until Saarnavideo's graphic mapping (its phase S4) is proven.
- **Multi-instance:** the instance that owns the relay must be the one that finalises the program feed; the clean feed's recording follows the MediaMTX host.
- **Deleting a broadcast** keeps its videos (existing decision); the group follows the same rule.

## Out of scope

Editing or clipping inside LCYT, multi-rendition transcodes, pushing finished edits back from Saarnavideo to LCYT, live (during-stream) sharing.
