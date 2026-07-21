---
status: implemented
summary: "Phase-planning pass for docs/plans/ROADMAP.md's Lane 9 (plan_video_perception.md Phases 1-3), produced 2026-07-20 per ROADMAP's own note that this is the biggest single scope item in Tier 2 and needs a /phase-planning pass before dispatch, not a single-shot agent lane. Turns the plan's high-level 'Suggested phase order' into concrete, package-grounded phases/streams/sync points, verified against current source (prod_cameras migration pattern in lcyt-production/src/db.js, EventBus in lcyt/src/event-bus.js, RolesBus in lcyt-agent, CueEngine's already-inert track_state listener in lcyt-cues, worker-daemon's single hardcoded ffmpeg job type). One correction to ROADMAP's Lane 9 package tag: World State + its new tables belong in lcyt-agent as ROADMAP says, but the camera/preset metadata columns belong in lcyt-production (prod_cameras is owned there) — Phase 1 is two-package, not one. Confirms Phase 1 has no blocker and Phase 3's dependency (plan_vertical_crop.md Phase 4's onProgramChanged/onCameraPresetRecalled) is now available as plain callbacks in lcyt-production's DeviceRegistry — EventBus promotion is recommended before Phase 3, not a hard blocker. **All three phases dispatched and shipped 2026-07-20/21** — see 'Implementation notes' at the end of this file for what shipped, what deviated from the plan (Haiku's Phase 1 used a module singleton instead of the repo's DI convention, caught and fixed in review; the EventBus-promotion sub-step of Phase 3 was skipped entirely, not just made optional), and what's left (the real CV model, deliberately not this pass's job)."
---

# Phase Plan: Video Perception — Phases 1-3 (`ROADMAP.md` Lane 9)

Source: `docs/plans/plan_video_perception.md` (full spec, §1-3 and "Suggested phase order") +
`docs/plans/ROADMAP.md`'s Lane 9 entry. This document turns that plan's three-item phase
order into concrete, file-grounded phases/streams for dispatch, verified against the
current source tree on 2026-07-20 (not just the plan file, which occasionally names a
mechanism — "EventBus promotion", "camera-scoping" — that turns out to already exist,
already be wired, or not yet exist in the form assumed; see corrections below).

Out of scope for this document: `plan_video_perception.md` Phase 4/5 concepts (those
belong to `plan_vertical_crop.md` and are already landed per ROADMAP's "Recently closed"
section) and all of `plan_ai_observability.md` (separate plan, separate dispatch).

---

## Corrections / clarifications to ROADMAP's Lane 9 tag

ROADMAP.md tags Lane 9 as "(`lcyt-agent` + new tables, isolated)". Verified against
source, this is accurate for World State but incomplete for the camera-metadata half:

1. **Camera/preset metadata (plan §3) is a `lcyt-production` change, not `lcyt-agent`.**
   `prod_cameras` and its `control_config.presets` JSON live in
   `packages/plugins/lcyt-production/src/db.js` (`runMigrations()`, idempotent
   `CREATE TABLE IF NOT EXISTS` + sequential `PRAGMA table_info` / `ALTER TABLE ADD
   COLUMN` guards, e.g. `camera_key` L71-74, `owner_api_key` L97-100). `label`/`zone`/
   `overlaps_with`/`alternate_for` is one more such guard block, appended after the
   existing ones — same package, same style, not `lcyt-agent`.
2. **World State (plan §2) is the genuinely new `lcyt-agent` + new-tables piece** ROADMAP's
   tag refers to. No existing module owns "fuse camera/describer/STT state into a
   versioned per-project snapshot" today — closest precedent is
   `packages/plugins/lcyt-agent/src/vision-role-manager.js`'s in-memory `Map` keyed by
   `${apiKey}:${roleCode}` (`_key()`, L48-49) and `status()` snapshot getter
   (L135-136), and `roles-bus.js`'s thin wrapper over the shared `EventBus`
   (`addSubscriber`/`emit`, L29/L52) — both good shapes to mimic, both already in
   `lcyt-agent`. `GET /scene/state` should live there too, alongside the vision-role
   routes, not as a new top-level `lcyt-backend` route.
3. **`plan_vertical_crop.md` Phase 4's callbacks exist but are still plain arrays, not
   EventBus events.** `packages/plugins/lcyt-production/src/registry.js`:
   `DeviceRegistry.onProgramChanged` (L102) / `onCameraPresetRecalled` (L131) are
   confirmed plain listener-array callbacks. A comment at L76-80 already flags this
   exact promotion as pending "once a second consumer needs the same signal
   (`plan_video_perception.md`)" — this plan is that second consumer. Phase 3 below
   treats the promotion as a recommended sub-step, not a hard blocker (the plain
   callback API is usable today).
4. **`packages/plugins/lcyt-cues/src/cue-processor.js` already has a wired-but-inert
   listener** for exactly the project-level `track_state` event this plan must
   produce: `createTrackerCueListener()`/`_attachTrackerListener()` (~L235-275) call
   `engine.evaluateTrackerEvent(session.apiKey, state)` (L271) whenever `track_state`
   fires on `session.emitter`. This is good news for Phase 2 — no `lcyt-cues` code
   needs to change, only get a real event to consume — but confirms nothing in the
   repo emits it yet (doc comment at L238-244 says so explicitly).
5. **`lcyt-worker-daemon` has exactly one job type today (ffmpeg), and it's not
   dispatched by a `plan.type` switch — it's unconditional.** `POST /jobs`
   (`packages/lcyt-worker-daemon/src/index.js` L200-238) always calls
   `createFfmpegRunner(...)` at L238. There is no job-type registry to extend — one
   needs to be introduced, not just added to. Flagged as a Phase 2 risk item below,
   not a small task.

---

## Overview

Three phases, two packages in Phase 1 (`lcyt-production` + `lcyt-agent`), one package
plus a new Docker image in Phase 2 (`lcyt-worker-daemon` + `lcyt-orchestrator`, new
non-ffmpeg job type), and a small cross-package wiring phase 3. The critical path is
**Phase 1 → Phase 2's runner-interface spike → Phase 2's job-type plumbing** — Phase 2
is where real risk lives: it is the only phase requiring an actual CV model (YOLO-family
detector + ByteTrack per the plan's "default stack, swappable" recommendation) running
somewhere, and `lcyt-worker-daemon` is a plain Node/Express process with zero ML
dependencies today (`package.json`: express, `@aws-sdk/client-s3`, `mime`,
`prom-client` — nothing CV-shaped). Phase 3 is comparatively small and can slot in
after Phase 2 lands, or run partly in parallel with Phase 2's later streams since it
touches different files (`lcyt-production/src/registry.js`, a small new
resolver module) — see Phase 3's own dependency note.

**Biggest risk, called out early per this skill's "fail fast" principle:** the CV
runner's actual runtime/language is an open question the source plan deliberately
punts ("implementation detail for whoever builds this"). Don't let that ambiguity
survive into Phase 2 — resolve it with a throwaway interface-only spike *before*
committing to the job-type plumbing, so a wrong runtime guess doesn't get baked into
the orchestrator wiring. See Phase 2, Stream A.

---

## Dependency Map

```
Phase 1A (lcyt-production: camera/preset metadata columns)  ─┐
Phase 1B (lcyt-agent: World State skeleton + GET /scene/state)─┴─► sync ─► Phase 2
                                                                              │
Phase 2A (runner interface + stub backend, resolves runtime choice) ────────┤
Phase 2B (worker-daemon job-type registry + orchestrator plumbing)  ◄───────┤ (needs 2A's decision)
Phase 2C (aggregator: per-camera → track_state + camera.track_state)◄───────┤ (needs 2A+2B running end-to-end)
                                                                              │
                                                                              ▼
Phase 3 (shared-feed resolver: DeviceRegistry callbacks → feed→camera tagging)
   optionally preceded by: EventBus promotion of onProgramChanged/onCameraPresetRecalled
```

Phase 1A and 1B share no files — true parallel. Phase 2's streams are **not** fully
parallel: 2B and 2C both depend on 2A's runtime decision landing first (even as a
stub), because they need a real process boundary (in-process module vs. subprocess vs.
sidecar container) to build against. Phase 3 depends on Phase 2C existing
(`camera.track_state` must be flowing) to be testable end-to-end, but its own code
(the resolver) can be written against 2A/2B's interfaces slightly earlier if someone
wants to parallelize aggressively — not recommended given the team-size implied by
"two haiku subagents"; treat Phase 3 as strictly after Phase 2 for a small dispatch.

---

## Phase 1: Schema + Camera Metadata + World State Skeleton

**Mode:** Parallel (2 streams)
**Depends on:** none
**Goal:** `prod_cameras`/presets carry `label`/`zone`/`overlaps_with`/`alternate_for`;
`GET /scene/state` returns a real (empty/idle) `SceneState` snapshot shape; no
perception producer yet — this phase is intentionally cheap and low-risk to ship ahead
of Phase 2, exactly as the source plan recommends.

### Stream A — Camera/preset metadata (`lcyt-production`)
- `packages/plugins/lcyt-production/src/db.js`: append one more migration guard block
  to `runMigrations()` (after the existing `owner_api_key` block, L97-100) adding
  `label TEXT`, `zone TEXT` columns to `prod_cameras`, plus `overlaps_with`/
  `alternate_for` — these are cross-camera+preset links, so store as a JSON array
  column (`overlap_links TEXT`, following the existing `control_config` JSON-column
  convention) rather than a join table; presets already live inside
  `control_config.presets[]`, so per-preset `label`/`overlaps_with` extends that same
  JSON shape, not a new table.
- `packages/plugins/lcyt-production/src/crud.js` + `routes/cameras.js`: accept/return
  the new fields on camera create/update; extend preset create/update the same way.
- `packages/lcyt-web`: extend the existing camera/preset config UI (wherever
  `control_config.presets` is currently edited in the Production settings tab) with
  `label`/`zone`/`overlaps_with` fields — small form additions, no new page.
- Tests: extend `packages/plugins/lcyt-production`'s existing camera CRUD test file
  with cases for the new fields (migration idempotency, round-trip through the route).

### Stream B — World State skeleton (`lcyt-agent`)
- New module `packages/plugins/lcyt-agent/src/scene-state.js`: in-memory
  `Map<apiKey, SceneState>` (mirror `vision-role-manager.js`'s `_key()`/`status()`
  shape), typed snapshot per the plan's §2 shape (`activeSpeaker`, `cameras`,
  `segmentGuess`, `updatedAt`) — starts empty per project, updated only by handlers
  that don't exist until Phase 2/3 wire them in.
- New route `packages/plugins/lcyt-agent/src/routes/scene.js`: `GET /scene/state`,
  same auth/project-scoping pattern as the existing `routes/vision-roles.js`; mount
  alongside the other `lcyt-agent` routers.
- Defer the `bus_events`-backed history log (plan §2's "append-only history" open
  question) — Phase 1 ships the snapshot only; the plan itself flags retention
  sizing as an open question to confirm before deciding the table, not a Phase 1
  blocker.
- Tests: `packages/plugins/lcyt-agent/test/` — new `scene-state.test.js` covering the
  empty-snapshot shape and per-project isolation (two `apiKey`s don't leak state).

**Sync point:** both streams merged; `npm test -w packages/plugins/lcyt-production` and
`npm test -w packages/plugins/lcyt-agent` green; `GET /scene/state` reachable and
returns the empty shape for a fresh project; camera edit UI round-trips the new fields.

---

## Phase 2: fps30 Producer for Dedicated-Feed Cameras

**Mode:** Sequential-with-parallel-tail (3 streams, but 2A gates 2B/2C)
**Depends on:** Phase 1 (Stream B's `SceneState`/`GET /scene/state` must exist so
`camera.track_state` has somewhere to land; Phase 1A is not a hard technical
dependency for Phase 2 but should already be merged since both are cheap and Phase 2
is the expensive phase — no reason to start Phase 2 before Phase 1's low-risk work is
banked).
**Goal:** at least one dedicated-feed camera produces real `track_state` (project-level
aggregate, consumed by `lcyt-cues`'s already-wired-but-inert listener) and
`camera.track_state` (per-camera detail, consumed by Phase 1B's `SceneState`) end to
end, running as a job on the existing orchestrator/worker-daemon.

### Stream A — Runner interface + stub backend (**do this first, alone**)
- Define the swappable runner interface from the plan verbatim: `start(cameraId,
  frameSource, config)` / `stop(cameraId)`, emitting `{ cameraId, ts, objects: [...],
  framing? }` at most every `config.emitIntervalMs`.
- **Resolve the runtime question with a stub, not the real model.** Ship a fake
  backend that emits plausible-shaped fake detections at the configured interval —
  this validates the interface and the process-boundary decision (in-process JS,
  child-process subprocess, or a sidecar container per the `docker/lcyt-ffmpeg` /
  `docker/lcyt-dsk-renderer` precedent for "worker-daemon spawns/manages a specialized
  process") without betting real implementation time on a YOLO integration that might
  need to move to a different process boundary once tried.
- **Recommendation, not a repo-verified fact:** given `lcyt-worker-daemon` has zero ML
  dependencies and Node.js YOLO/ByteTrack bindings are immature compared to Python's,
  default to a subprocess/sidecar boundary (new `docker/lcyt-perception` image,
  analogous to the existing `docker/lcyt-dsk-renderer` pattern of "worker-daemon
  manages a specialized child process it doesn't itself implement") rather than an
  in-process Node port of the CV stack. Confirm this before Stream B starts — it
  determines what "job type" even dispatches.
- Sync artifact for the rest of Phase 2: a short written decision (a paragraph in the
  PR description or a comment in the new module) on which process boundary was chosen
  and why, so Stream B doesn't have to re-derive it.

### Stream B — Worker-daemon job-type registry + orchestrator plumbing
**Depends on:** Stream A's process-boundary decision (needs the decision, not the full
real model — the stub backend from 2A is sufficient to build and test this against).
- `packages/lcyt-worker-daemon/src/index.js`: `POST /jobs` (L200-238) currently
  unconditionally calls `createFfmpegRunner`. Introduce a small job-type dispatch
  (`plan.type === 'ffmpeg' ? createFfmpegRunner(...) : plan.type === 'perception' ?
  createPerceptionRunner(...) : 400`) — this is new plumbing, not an extension of an
  existing registry (none exists today, per correction #5 above).
- New `packages/lcyt-worker-daemon/src/perception-runner.js` (name TBD), following
  whatever process-boundary Stream A decided, wrapping Stream A's interface.
- `packages/lcyt-orchestrator`: confirm `POST /compute/jobs`'s `{id, type, apiKey,
  plan}` passthrough (L222-226, `callWorker`, L253) needs no changes — it's already
  type-agnostic bookkeeping, verified in the grounding pass. If true, no orchestrator
  code changes are needed here beyond exercising the existing path with `type:
  'perception'`.
- Tests: `packages/lcyt-worker-daemon/test/` — new test exercising `POST /jobs` with a
  `perception` job type against the stub backend from 2A.

### Stream C — Aggregator: per-camera output → `track_state` + `camera.track_state`
**Depends on:** Stream A's interface (can be written against the stub, doesn't need
Stream B to be live).
- New small module (`lcyt-agent`, alongside Phase 1B's `scene-state.js`) that fans in
  per-camera runner output and emits, per the plan's §1 "Output" section:
  - `track_state { apiKey, ts, labels: [...] }` — union across currently-visible
    cameras for the project, onto `session.emitter` so `lcyt-cues`'s existing
    `_attachTrackerListener()` picks it up with **zero `lcyt-cues` changes** (verified
    wired, correction #4 above).
  - `camera.track_state { apiKey, cameraId, ts, labels, visible }` — feeds Phase 1B's
    `SceneState.cameras[cameraId]`; emit `visible: false` explicitly when a camera
    drops (not silence), per the plan's explicit requirement.
- Wire `SceneState` update handlers (deferred/stubbed in Phase 1B) to actually consume
  `camera.track_state` now that it's real.
- Tests: aggregator unit tests (multiple cameras' detections merge into one
  project-level label union without one camera's absence clobbering another's
  presence — this is the exact bug the plan's §1 "Output" section warns against
  re-introducing, so a regression test for "camera A's detections aren't lost when
  camera B's poll fires next" is worth writing explicitly).

**Sync point:** with the Stream A stub backend running for ≥1 dedicated-feed camera,
`lcyt-cues` fires a `track:` rule end-to-end (manual test: configure a `track:person`
cue rule, confirm it fires against stub-emitted fake "person" detections) and `GET
/scene/state` reflects that camera's `visible: true` + labels. Swapping the stub for a
real YOLO+ByteTrack backend is explicitly a **follow-on task**, not required to close
Phase 2 — the plan itself treats "exact framing/shot-quality scoring approach" as
deferred to whoever implements this, and the interface is the contract worth locking
first.

---

## Phase 3: Shared/Single-Feed Resolver

**Mode:** Sequential, small
**Depends on:** Phase 2 (needs `camera.track_state` flowing to be testable, and needs
the per-camera runner/aggregator to tag detections against).
**Goal:** cameras with no dedicated feed (mixer-input-only) get correctly-tagged
`camera.track_state` while they're on program, and an explicit `visible: false` the
moment they're not — using `DeviceRegistry`'s existing (plain-callback) program-change
signal.

1. **Recommended first sub-step: promote `DeviceRegistry.onProgramChanged`/
   `onCameraPresetRecalled` to a real EventBus topic** (`production.source_changed`,
   following the bus's existing dot-taxonomy — no `production.*` topic exists yet per
   correction #3, this would be the first one) in
   `packages/plugins/lcyt-production/src/registry.js`. This is the promotion the
   plan's §1 explicitly recommends once a second consumer shows up, and this plan is
   that second consumer — per this repo's own stated convention (see ROADMAP.md §0 and
   the `plan_vertical_crop.md` cross-reference), promote rather than let two consumers
   read the same plain-callback API divergently.
   - **Scope discipline:** this step touches `lcyt-production` (the registry) and
     optionally the *existing* consumer (`plan_vertical_crop.md`'s
     `CropManager.applyForSource()` in `lcyt-rtmp`) if you migrate it to the new topic
     too. **Migrating the existing consumer is optional** — keep the plain-callback
     API alongside the new EventBus emission (both fire on the same state change) so
     this phase doesn't force a cross-plan refactor of already-shipped, working code.
     Only migrate the existing consumer if it's genuinely trivial once the topic
     exists; otherwise leave it on the callback API and note the duplication as a
     follow-up, not a blocker.
2. New resolver module (`lcyt-agent`, or co-located with Phase 2C's aggregator):
   subscribes to `production.source_changed` (or, if step 1 is skipped, registers
   directly via `DeviceRegistry.onProgramChanged`/`onCameraPresetRecalled` — both are
   valid, EventBus is just cleaner going forward) and tags the shared feed's
   detections with whichever camera is currently on program before they reach the
   Phase 2C aggregator.
3. Tests: resolver unit test simulating a program change mid-stream — confirm the
   previous camera gets one `visible: false` `camera.track_state` emission (not
   silence) and the new camera starts receiving tagged detections.

**Sync point:** manually switch program between two mixer-input-only cameras with a
shared feed active; confirm `GET /scene/state` reflects the switch within one
resolver-tag cycle and the outgoing camera shows `visible: false`, not stale data.

---

## Critical Path

Phase 1 (either stream, both cheap) → Phase 2 Stream A (runtime decision — the one
piece of real uncertainty) → Phase 2 Streams B+C (can overlap once 2A's decision
lands) → Phase 2 sync point → Phase 3.

Phase 1 is *not* on the critical path in the strict sense (Phase 2 could technically
start in parallel since Stream A doesn't need Phase 1), but per the source plan's own
sequencing rationale — ship the cheap, low-risk schema/skeleton first, since it's
low-risk and unblocks the API shape — treat it as a short mandatory prefix rather than
a true parallel track, especially for a two-agent dispatch where there's no spare
capacity to run both at once anyway.

---

## Risk Register

- **CV runtime/process-boundary choice (highest risk, front-loaded into Phase 2
  Stream A on purpose).** `lcyt-worker-daemon` has no ML dependencies today; guessing
  wrong here (e.g. building deep in-process Node integration, then discovering
  YOLO/ByteTrack really wants a Python process) is expensive to unwind. Mitigation:
  the stub-backend spike in 2A is designed specifically to surface this before Stream
  B commits to job-type plumbing.
- **`track_state` project-level aggregation bug the plan explicitly warns about.**
  `CueEngine._trackerState` replaces wholesale, one blob per project — a naive
  "one `track_state` emission per camera" implementation would have cameras clobber
  each other. Mitigation: Phase 2 Stream C's explicit regression test for this.
- **Phase 3's EventBus-promotion step touches a second plan's shipped consumer.**
  `CropManager.applyForSource()` (`lcyt-rtmp`) already works against the plain
  callback API. Mitigation: Phase 3 step 1 explicitly makes migrating that consumer
  optional — add the new topic alongside the old callbacks, don't force a rewrite.
- **Job-type dispatch is new plumbing, not an extension.** Correction #5 confirms
  `POST /jobs` has never branched on `plan.type` before — Stream B is introducing a
  pattern, not following one. Keep the dispatch minimal (a single conditional is
  enough for two job types; don't build a generic plugin-loader for job types this
  plan doesn't need yet).
- **World State's history log is explicitly deferred** (plan's own open question) —
  don't let Phase 1 Stream B scope-creep into deciding `bus_events` vs. a dedicated
  table; ship the snapshot-only skeleton and revisit once real retention/volume data
  exists.

---

## Recommended Starting Point

Phase 1, both streams in parallel (they're small, independent, and low-risk — good
first work for two agents or two sequential sessions). Do not start Phase 2 Stream B
or C until Stream A's process-boundary decision is written down; that decision is the
one piece of this plan a coding agent shouldn't have to re-derive mid-implementation.

---

## Implementation notes (2026-07-20/21)

Phase 1 was dispatched to a Haiku subagent (per this doc's own recommendation that
it's small/low-risk enough for that); Phases 2-3 were implemented directly in the
orchestrating session rather than dispatched, since Phase 2 Stream A's
process-boundary decision and the cross-package wiring across `lcyt-worker-daemon`
→ `lcyt-production` → `lcyt-backend` benefited from one continuous context. All
tests green post-implementation: `lcyt-backend` 1098, `lcyt-production` 179,
`lcyt-agent` 207, `lcyt-cues` 110, `lcyt-worker-daemon` 5 — plus a `server.js` boot
smoke test (no automated test imports the full composition root, per that package's
own documented coverage gap).

**Phase 1 — one real finding, fixed:** Haiku's `scene-state.js`/`routes/scene.js`
built `SceneState` behind a hidden module-level `getSceneState()` singleton instead
of following the exact DI convention this plugin already establishes
(`visionRoleManager`/`assistantManager` are constructed once in `initAgent()` and
threaded through explicitly to route factories). Caught in review, not by tests —
both patterns pass tests fine, it's an architectural consistency issue, not a
correctness bug. Fixed: `initAgent()` now constructs `SceneState` and returns it
alongside the other managers; `createSceneRouter(auth, sceneState)` takes it as a
parameter. Also missed on the first pass: `GET /scene/state` never made it into
`lcyt-backend/CLAUDE.md`'s route table (only `lcyt-agent/CLAUDE.md` got it) —
added in the same fix-up commit. This is exactly the class of gap dispatching a
smaller model without a human/stronger-model review pass would let ship silently —
see the parent conversation's broader point about which lanes suit which model.

**Phase 2 Stream A's process-boundary decision, made concretely:** in-process Node,
not a subprocess/sidecar — resolved down from "should decide based on what the CV
integration actually needs" to "there is no real CV integration in this pass, so
there's nothing to isolate into its own process." `lcyt-worker-daemon/src/perception/`
ships a swappable `{ detect(frame) }` backend interface with exactly one
implementation, a deterministic stub (`stub-backend.js`) — no YOLO/ByteTrack, no new
runtime dependency, no Docker image. A real model backend remains a documented,
scoped follow-on that can revisit the process-boundary question with an actual
workload to measure, per this doc's own "resolve with a stub, not the real model"
recommendation.

**Frame source turned out to need no new endpoint at all.** Grounding for Phase 2
confirmed a dedicated-feed camera's `cameraKey` (`lcyt-production`'s `prod_cameras`
column, populated via WHIP or `lcyt-rtmp`'s feed-RTMP resolver) IS the same MediaMTX
path name the already-public `GET /preview/:key/incoming` route serves — the exact
endpoint Tracker/Describer already poll, just keyed differently. So Phase 2's frame
acquisition is a second consumer of existing infrastructure, not new surface.

**Phase 2 output contract, built exactly as specced:**
`packages/lcyt-backend/src/perception-aggregator.js` emits the project-level
`track_state` union (via `session.emitter.emit('event', {type, data})` — the exact
shape `lcyt-cues`'s `_attachTrackerListener()` already expected, verified against its
source rather than assumed) and per-camera `camera.track_state` (EventBus +
`SceneState` update) as two genuinely distinct emissions, with a regression test
proving one camera's tick doesn't clobber another's contribution to the union — the
exact bug this doc's Risk Register flagged as the one correctness trap in this phase.

**Phase 2's job-type dispatch surface ended up bigger than "one conditional":**
beyond the worker-daemon `POST /jobs` branch, shipping something a human/AI could
actually trigger needed a dispatch manager (`lcyt-production/src/perception-manager.js`,
reusing `FFMPEG_RUNNER=worker`'s exact `ORCHESTRATOR_URL`/`WORKER_DAEMON_URL` dispatch
pattern rather than inventing a third knob) and camera-scoped start/stop/status
routes. Not scoped in this doc's original Stream B description, which focused only on
the worker-daemon half — a gap in this phase plan's own foresight, not a deviation
found necessary mid-build.

**Phase 3 — the EventBus-promotion sub-step was skipped entirely, not just made
optional.** This doc's Phase 3 step 1 recommended promoting
`DeviceRegistry.onProgramChanged`/`onCameraPresetRecalled` to a real
`production.source_changed` EventBus topic (since this resolver is the second
consumer that was supposed to trigger that promotion), while allowing the plain
callback API as a fallback. In practice the resolver just registers its own
`onProgramChanged`/`onCameraPresetRecalled` listeners directly, same as
`plan_vertical_crop.md`'s existing `CropManager.applyForSource()` consumer — simpler,
zero risk to the already-shipped consumer, and avoids introducing the repo's first
`production.*` EventBus topic on spec rather than on demonstrated need. The promotion
recommendation still stands as a good idea if a *third* consumer ever shows up.

**Shared-feed camera resolution, concretely:** `onProgramChanged` fires
`{ apiKey, mixerId, inputNumber }` — a mixer input number, not a camera id — so the
resolver looks up `prod_cameras` by `mixer_input` to find which camera (if any) is
mapped to that input. `onCameraPresetRecalled` fires `{ apiKey, cameraId }` directly.
Both update the same per-project "currently active camera" state; a change emits a
synthetic `visible: false` `camera.track_state` for the outgoing camera before
tracking the new one, per the plan's explicit "confirmed absent, not silence"
requirement — verified by test, including that switching to the same input twice is
a no-op (no spurious re-emission).
