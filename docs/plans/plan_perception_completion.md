---
title: Perception Completion â€” Real Detector, Feed Attribution, LLM Hand-off
status: implemented 2026-10-05 (phases 1-4: detector, tracker, attribution, reliability, LLM hand-off, crop auto-follow, status panel); not yet run against real hardware, a real fleet or real service footage
related: plan/video_perception, plan/compute_split, plan/ai_roles_framework, plan/vertical_crop, plan/ai_observability
---

# LCYT perception jobs: plan to complete them

Date: 2026-10-05. Status: approved by Juha 2026-10-05; Phase 1 (frame source, ONNX person detector, executor wiring, benchmark, worker image) implemented in the PR that added this file; Phases 2-4 pending.
Repo: jsilvanus/live-captions-yt. Builds on `docs/plans/plan_video_perception.md` (phases 1-3 shipped, real detector listed as "not done") and the fffleet move in PR #312.

## 1. Where we are (read from the code)

Pipeline today, end to end:

1. `lcyt-production/src/perception-manager.js` submits a `perception` stream job (fffleet when `FFFLEET_URL` is set, else orchestrator or worker daemon). One job per dedicated-feed camera, plus one shared-feed job per project for mixer-only cameras.
2. The job (`lcyt-compute/src/perception/job.js` and `runner.js`) polls a JPEG over HTTP from `/preview/:key/incoming` every `emitIntervalMs` (min 200 ms, default 1000 ms).
3. `stub-backend.js` returns a fake "person" box that sways with a sine wave, plus a fixed framing score of 0.7.
4. The job POSTs `{apiKey, cameraId|feedKind, ts, objects, framing, visible}` to `/api/v1/production/api/v1/perception/api/v1/ingest`.
5. `perception-aggregator.js` emits `camera.track_state` (per camera, feeds World State) and a project-level `track_state` (label union, what the cue engine reads). `shared-feed-resolver.js` re-tags shared-feed detections with the camera currently on program.

What is real: dispatch, contract, aggregation, resolver, cue and World State consumers. What is fake: the detector, the framing score, and (importantly) the frame rate.

## 2. Reading of the starting idea

"Fast box recognition on cameras" is the right v1 goal (person boxes plus tracking, per camera, local, no LLM per frame). One refinement: the bottleneck is not the detector, it is frame acquisition. The runner doc says the preview snapshot refreshes on `PREVIEW_INTERVAL_S` (default 5 s), so even a perfect detector would report a box that is up to 5 s old. "Fast" therefore needs a faster frame source first, and a detector second. I have not benchmarked either; the numbers in section 4 are estimates to be confirmed in phase 0.

## 3. Goals and non-goals

Goals
- Real person detection with stable track ids per camera, 5-10 detections/s per camera, boxes no older than about 300 ms at ingest.
- A real, rule-based framing score from box geometry.
- Reliable lifecycle: jobs start with the camera, survive backend restarts, and stale cameras do not stay "visible" forever.
- Consumers use the data: cues (`track:person` with region), World State, Production Assistant, and vertical crop auto-follow.

Non-goals (v1)
- No face recognition, no identifying individuals, no storing frames. See section 8.
- No active-speaker detection (needs pose/mouth or audio correlation; defer until a consumer asks).
- No new broker, no new director role (unchanged from plan_video_perception.md).
- No GPU requirement. GPU stays an optional speed-up.

## 4. Design

### 4.1 Frame source: decode the stream, stop polling JPEGs
Add `createFfmpegFrameSource({ url, fps, width })` next to `createHttpFrameSource`. It runs ffmpeg (via `spawnFfmpeg` in lcyt-compute) on the camera's stream with `-an -vf fps=N,scale=640:-2 -f rawvideo -pix_fmt rgb24 pipe:1`, and yields frames from stdout. Same `getFrame()` shape, so the runner contract does not change. Keep the HTTP JPEG source as the fallback and for the shared feed if the RTSP/RTMP URL is not reachable from the worker.

Open point carried from fffleet: a remote worker must be able to reach the stream URL (MediaMTX RTSP/RTMP). On the same host this is trivial; with remote workers it needs a reachable MediaMTX address or the JPEG fallback. This was never tested against a real remote fleet.

Runner changes: drop-oldest backpressure (if detection is slower than the frame rate, skip frames rather than queue), a separate `detectFps` (default 5) and `emitIntervalMs`, and `capturedAt` stamped when the frame is decoded, not when the result is posted.

### 4.2 Detector: ONNX in Node, behind the existing `detect()` interface
Recommendation: `onnxruntime-node` running a small COCO detector, loaded lazily so installs without it still work. Same Node/ESM stack as the rest of the repo, no Python sidecar. Python or a sidecar container stays possible later because only `backend.detect(frame)` is the contract.

Model choice needs a licence decision (open question 1): the popular Ultralytics YOLOv8/11 weights are AGPL-3.0, which is a problem for a repo with no declared licence (`package.json` has an empty `license`). Apache-2.0 options: YOLOX-nano/tiny, or RT-DETR/D-FINE for higher accuracy. Recommendation: YOLOX-tiny ONNX at 416 or 640 input, person class (plus a short allow-list: person only in v1). Expected CPU cost is tens of milliseconds per frame on a modern core; to be measured in phase 0.

Backend selection is explicit: `PERCEPTION_BACKEND=onnx|stub`. If `onnx` is requested and the model or runtime is missing, the job fails with a clear error. It never silently falls back to the stub (the stub fooling a cue rule in production is worse than no data). Model file: baked into a worker image variant, or fetched once to a worker-local cache (fffleet already has an input cache); path via `PERCEPTION_MODEL_PATH`.

### 4.3 Tracker
Implement ByteTrack-style tracking in plain JS (Kalman filter plus Hungarian/greedy IoU association, about 300 lines, no native dependency). Output keeps ids stable across frames so "person 3 is still in shot" is meaningful. Unit-testable with synthetic box sequences.

### 4.4 Framing score (rule-based)
From normalised boxes of the main subject: horizontal centring, headroom above the top box, subject height as a fraction of frame, cut-off at the frame edges. Output `{score 0-1, notes}`; weights in one config object. No learned model.

### 4.5 Contract changes (ingest v2, backwards compatible)
Add: `seq`, `capturedAt`, `frame: {w, h}`, `latencyMs`, and `objects[].trackId`. Boxes stay normalised 0-1. The aggregator then:
- derives `region` (left / centre / right and top / middle / bottom thirds) from the box and puts it on `track_state` labels. The cue engine already accepts `region?`, so `track:person` rules can be region-aware without cue-engine changes;
- passes bbox, trackIds and framing through to the World State camera entry (today only labels and a score are kept);
- drops out-of-order frames by `seq`.

### 4.6 Staleness and lifecycle (gaps in today's code)
1. The aggregator never expires a camera. If a job dies, that camera stays `visible: true` and its labels stay in the cue union forever. Add a sweeper: no ingest for `3 x emitInterval` (min 5 s) marks the camera `visible: false` and re-emits `track_state`.
2. `perception-manager` keeps running jobs in an in-memory map. After a backend restart, jobs keep running on the fleet but become unstoppable and may be started twice. On boot, list fleet jobs labelled `purpose: perception` for each owner and re-adopt them.
3. Auto-start: start the per-camera job when the camera's feed starts publishing and stop it when it stops (today it is manual start/stop routes). Controlled by a per-camera `perception_enabled` flag.
4. Shared feed race: the resolver tags a detection with the camera on program when the detection arrives, not when the frame was captured. With 5 s old frames this was tolerable; with fast frames a switch can mis-attribute a frame. Use `capturedAt` against the switch timestamp and drop frames captured within a small guard window after a switch.

### 4.7 Security
`internalToken` (the shared `BACKEND_INTERNAL_TOKEN`) is currently placed in the job spec, so every worker that runs a job sees the global ingest secret. Replace with a per-job token (HMAC of jobId, or a random token stored with the job) that is only valid for that job's camera and project. Also keep fffleet `owner: apiKey` scoping.

### 4.8 Consumers
- Cues: `track:person` with region, and cooldown guidance in docs (already load-bearing at these rates).
- World State / Production Assistant: `cameras[id].subjects`, framing score, and `camera.best_framing_changed` (the plan lists this topic; confirm it is actually emitted, I did not verify).
- Vertical crop auto-follow: map the main subject's box centre to a crop position and feed it to `CropManager` (opt-in, rate-limited and smoothed so the crop does not jitter). This is the highest-value consumer for "fast boxes" and the one that needs the latency target.
- Observability: plan_ai_observability Stage 3 box overlay on the camera preview, plus a small status panel (detect fps, latency, dropped frames, last error) on ProductionCamerasPage.

### 4.9 Cleanup
Once no deployment uses the orchestrator or worker daemon (already pending Juha's go, see fffleet-direct-jobs memory), remove the old perception dispatch branches, and the CONSIDER.md duplication note for perception dispatch goes away with them.

## 5. Feed attribution and camera scope (added 2026-10-05)

Today the Tracker and Describer roles (`lcyt-agent/src/vision-role-manager.js`) are project-scoped: one session per `apiKey:role`, one frame source (`/preview/:apiKey/incoming`, the project's shared feed), and their events (`tracker_update`, `describer_update`) carry no camera id. The perception path has the shared-feed resolver, but only for perception jobs and only through mixer program-change signals. This section makes "which camera or mixer input is this frame from" a first-class, separate step that every consumer shares.

### 5.1 Principle: attribution is separate from detection
Knowing the source of a frame must work even when no perception compute exists. So a small **feed attributor** produces a tag for every frame stream, and detectors, the Describer and the Tracker all just read the tag.

```
source tag = { feedKind: 'dedicated' | 'shared',
               cameraId | null, mixerId | null, input | null,
               confidence 0-1, method: 'feed-key' | 'mixer-signal' | 'visual-match' | 'operator' | 'unknown',
               since }
```
`unknown` is a real value. Nothing may guess a camera; downstream roles then run project-scoped exactly as today.

### 5.2 How the source is determined (in priority order)
1. **Dedicated feed:** the feed's `cameraKey` maps to a camera id. Certain, nothing to compute.
2. **Shared feed with mixer or PTZ signals:** the existing `onProgramChanged` and `onCameraPresetRecalled` callbacks. Use the frame's `capturedAt` against the switch time and ignore frames inside a short guard window after a switch, because a frame captured just before the cut must not be tagged with the new camera.
3. **Shared feed with no usable signals (feed only, hardware switcher, signal lost):** visual attribution. Detect a scene cut (cheap frame difference), then match the new frame against per-camera and per-preset reference images the operator captures once (the cameras route already has thumbnail capture). v1 matching is a perceptual hash plus colour histogram on a tiny grayscale frame; if the best match is not clear enough, ask the Describer (VLM) "which of these labelled reference shots is this?" using the camera labels from the camera metadata. Hysteresis and a confidence threshold prevent flicker; below the threshold the tag is `unknown`.
4. **Operator override:** a "this is camera N" action, which holds until the next cut.

"Which mixer is on the feed" is the same mechanism one level up: the tag carries `mixerId` and `input`, so a feed that is a mixer's program output resolves to a mixer input, and from there to a camera through the camera's `mixer_id` and `mixer_input` mapping.

### 5.3 Where it runs, with and without compute
The attributor is cheap (a tiny decode at 1-2 fps, a hash compare), so it is its own small job type that can always run locally in the backend, with ffmpeg through `spawnFfmpeg`, and does not need a perception worker. When a perception job exists for the feed, it uses the same tag instead of recomputing, and for visual attribution it can reuse its decoded frames.

| Mode | Perception compute | Mixer signals | Result |
|---|---|---|---|
| A | yes | n/a (dedicated feeds) | boxes, tracks, framing per camera |
| B | yes | yes | shared-feed boxes, tagged by the resolver |
| C | yes | no | shared-feed boxes, tagged by visual match |
| D | no | either | no boxes; Describer and Tracker get attributed frames |
| E | no | no | roles run project-scoped as today, camera `unknown` |

Limit in modes D and E: with only the 5 s preview JPEG, attribution lags short cuts. If the backend host can decode the stream locally, the 1-2 fps attributor removes that lag.

### 5.4 Event contract: promote the program-change signal
The perception plan recommended promoting `onProgramChanged` and `onCameraPresetRecalled` to EventBus events once a second consumer appeared. There are now three (crop follow, the shared-feed resolver, the attributor). Add `feed.source_changed` (payload is the source tag) and have `DeviceRegistry` publish it, keeping the old callbacks working. This also removes the resolver's private copy of the camera lookup.

### 5.5 Camera scope for the vision roles
- Session key becomes `apiKey:cameraId:role` where a camera id exists, and `apiKey:role` otherwise (unchanged).
- Events gain `cameraId` and the source confidence: `describer_update` and `tracker_update` for a shared feed get tagged at frame capture time, not at result time.
- On a shared feed, one Describer session follows the feed and tags its output with whatever camera was on at capture, so "camera 3 shows the choir, singing" is stored per camera in World State.
- The prompt gets the camera's label, zone and overlap links (already stored on `prod_cameras`), so the model is told what the camera usually shows.

## 6. Hand-off from perception to the LLM roles (added 2026-10-05)

### 6.1 Frame provider instead of every role polling
Introduce a `FrameProvider` interface for the vision roles: `getFrame() -> { jpeg, capturedAt, source }`. Two implementations: the existing preview poll (kept, with the attribution tag added) and a **perception hand-off** provider. A perception job already decodes the stream, so on request it posts a JPEG (about 640 px wide) to a new `POST /production/perception/frame`, authenticated with the per-job token and rate-limited. The backend keeps only the latest frame per camera in memory, and no frames are written to disk. Result: each camera is decoded once, and the Describer sees the same frame, with the same camera attribution, that the detector saw.

### 6.2 Triggers instead of blind sampling
The perception job (or the aggregator, from the stream of detections) emits **interest events**: a person enters or leaves, a track is stable for N seconds, the framing score drops, a scene cut or a source change. These call the Describer or Tracker with the attributed frame, plus the detector's boxes and track ids as hints in the prompt. The existing timed sampling stays as the slow baseline, so mode D (no compute) behaves as today but with attribution.

### 6.3 Roles split cleanly
- **Detector (local):** persons, boxes, track ids, framing. Fast, no LLM.
- **Tracker role (VLM):** only for what the detector cannot do. Given the detector's track ids as candidates, it labels them (for example "speaker", "choir member", "the person in the white alb"), and the labels stick to the track id until the track is lost. The old free-form bbox mode remains for non-person targets.
- **Describer (VLM):** the scene-level description and the segment guess, now per camera.
- All VLM calls still go through the provider registry, so Ollama, a bridge-relayed local model or a cloud model are interchangeable, and no per-frame LLM call is made.

### 6.4 Consumers
World State merges detector, attribution and VLM output per camera. The Production Assistant gets a richer picture but no new trigger mechanism. Cue rules can mix a `track:` leaf with a describer-derived condition because both now carry the same camera tag.

## 7. Phases

Phase 0: measure (small, do first)
- Fixture clips of a church service (public or synthetic), a benchmark script: decode fps and per-frame latency for candidate models on CPU, with and without ONNX threads.
- Output: numbers that confirm or change the targets in section 3 and the model choice.

Phase 1: real frame source and ONNX detector
- `createFfmpegFrameSource`, backpressure, `capturedAt`, `PERCEPTION_BACKEND`, onnx backend, optional dependency, worker image variant with model.
- Tests: unit with a recorded model output, e2e with a fixture video through an in-process fffleet local executor (existing pattern from `perception-executor.test.js`).
- Acceptance: a fixture with one moving person yields a box within a stated IoU of ground truth at 5 detections/s.

Phase 2: tracker, framing score, contract v2
- JS ByteTrack, framing rules, `trackId`/`seq`/`capturedAt`/`frame`, aggregator region derivation and pass-through to World State.
- Acceptance: stable id across a scripted crossing; `track:person` region rule fires in a backend test.

Phase 2b: feed attribution (IMPLEMENTED: per-preset thumbnails, matcher, backend attributor, routes, resolver; camera-scoped vision roles; Describer output into World State per camera is left for 3b) (can start in parallel with Phase 1; useful without any detector)
- Per-preset reference thumbnails (see decision 7), source tag type, `feed.source_changed` EventBus event published by `DeviceRegistry`, attributor job (cut detection, reference capture, hash match, hysteresis, operator override), resolver switched to capture-time tagging.
- Camera scope for the vision roles: session keys, `cameraId` on events, camera label in the prompt.
- Acceptance: scripted cuts between fixture clips are attributed correctly with and without mixer signals; an unmatched shot yields `unknown`, not a guess; no flicker on a held shot.

Phase 2 status: implemented 2026-10-05 on the Phase 1 branch (JS tracker with Hungarian matching and a weak-detection second pass, rule-based framing score, `capturedAt` ordering and boxes, tracks and framing in World State and `camera.track_state`, `label@place` cue patterns). Ids stay stable through crossings in tests; no real-service footage yet, so tracker and framing thresholds are untuned.

Phase 3: reliability (IMPLEMENTED 2026-10-05: staleness sweeper, per-job HMAC ingest token, job record + re-adoption by resubmitting the same fleet job id, auto-start/stop reconciler with per-camera and shared-feed switches, capture-time guard from the attributor. Not yet exercised against a real fleet or media server.)
- Staleness sweeper, job re-adoption on boot, auto-start/stop by feed, per-job ingest token, shared-feed capture-time guard.
- Acceptance: kill the worker mid-job and see `visible: false` within the timeout; restart the backend and see no duplicate or orphaned job.

Phase 3b: LLM hand-off (IMPLEMENTED 2026-10-05 without the frame upload route and without a `FrameProvider` interface, per decision 8: interest events trigger the Describer/Tracker, detector hints go into their prompts, Tracker objects bind to track ids and named roles flow back into cue labels; Describer text into World State per camera is still open)
- `FrameProvider` interface, perception frame upload route with per-job token, interest events, detector hints in the Describer and Tracker prompts, Tracker labels bound to track ids.
- Acceptance: with a perception job running, Describer calls use the job's frame and camera tag and fire on a scripted person-entry event; with no job, behaviour matches today plus the attribution tag.

Phase 4: consumers and UI (IMPLEMENTED 2026-10-05: opt-in crop auto-follow, Production Assistant scene summary, overlay with detector boxes and source badge, camera status panel with `GET /production/perception/overview`, `docs/PERCEPTION.md`. The church-data-protection pass on the privacy text is still open.)
- Vertical crop follow (opt-in, smoothed), Production Assistant context, observability overlay, camera status panel, docs and `CLAUDE.md` updates, plan_video_perception.md status.

Phases 1-3b are the core and could be separate PRs; phase 4 can be split by consumer. Phase 0 gates the model decision.

## 8. Risks
- CPU budget: 10 cameras at 5 fps on one small VM may not fit. Mitigations: lower detect fps for cameras not on program, fleet slots per job, optional GPU.
- Remote workers reaching the stream URLs (untested with a real fleet).
- Model licence (section 4.2).
- False positives in dark or crowded scenes: confidence threshold and minimum track age before a label enters the cue union; tune on real service footage.
- Native dependency (`onnxruntime-node`) on worker images, Windows and ARM.

## 9. Privacy (church context)
A camera feed in a worship service can reveal who attends and, by inference, religious belief, which is special-category data under GDPR. Plan: detect generic `person` boxes only, no face or identity features, no frame storage or logging (debug frame dumps opt-in, local, off by default), no per-person history beyond the live track id, and a short note in the operator docs so congregations can mention it in their privacy notice. Worth a pass with the church-data-protection skill before phase 4's consumers ship.

## 10. Decisions and open questions

Decided by Juha, 2026-10-05:
1. Apache-2.0 detector (YOLOX or RT-DETR), no AGPL YOLO weights.
2. Detector runtime: ONNX in the Node worker. A sidecar can replace it later because only `detect()` is the contract.
3. Target 5 detections/s, boxes under about 300 ms old per camera.
4. Person only in v1.
5. Vertical-crop auto-follow is the first consumer.
6. The stub detector is for tests and demos only; production jobs fail loudly instead of faking data.
7. Reference shots for feed-only attribution are per camera and per preset, taken with LCYT's existing hold-a-preset-button screenshot gesture. Finding (code read 2026-10-05): that gesture does not record per preset today. `PresetButton` in `lcyt-web/.../workspace/panes/index.jsx` calls `captureThumbnail(camera)` without the preset id, and the backend stores one file per camera (`camera-thumbnail.js`, `thumbnailPath(cameraId)`), so holding any preset overwrites the camera's single thumbnail. Needed change (Phase 2b): send `presetId`, store `<cameraId>-<presetId>.jpg` with a per-preset captured-at, keep the camera-level image as fallback, and show the captured marker per preset instead of per camera.
8. No frame upload in v1: the Describer keeps fetching the preview JPEG and the trigger carries a timestamp. The `FrameProvider` interface lets an upload provider be added later.

