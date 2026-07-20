---
id: plan/video_perception
title: "Video Perception — Per-Camera fps30 Tracker, World State, and AI Observability"
status: draft
summary: "Specs the two genuinely new AI layers a multi-camera (1-10) production system needs on top of LCYT's existing AI infrastructure: (1) the fps30 tracker subsystem — a local, GPU-light, per-camera CV pipeline (detection/tracking/pose/framing) that `plan_cues.md` already anticipated and left an inert consumer contract for (`track:` leaves, `track_state` event) — handling both dedicated-feed cameras and cameras only visible via a shared/mixer feed (visibility/staleness state, feed→active-camera resolver reusing `plan_vertical_crop.md` Phase 4's not-yet-built onProgramChanged/onCameraPresetRecalled callbacks); (2) a World State / Scene State service that fuses per-camera observations into queryable structured state, exposed as new EventBus topics rather than a knowledge graph. Also specs project-editable camera/preset metadata (label + overlaps_with/alternate_for, not a geometric floor-plan map). Explicitly does NOT introduce a new 'Production Director' — richer input from this plan feeds the existing Production Assistant / Hosted Operator (`plan_ai_roles_framework.md`, `plan_unified_external_control.md`), which already receives structured (non-video) state and decides camera/mixer actions. The AI observability/prompt-sculpting page originally specced as part of this plan was split out to `plan_ai_observability.md` (2026-07-20) since it doesn't need to wait for anything here — see that plan's Stage 3 for how it extends to this plan's `camera.track_state` once built."
related: plan/cues, plan/ai_roles_framework, plan/prod, plan/pubsub_event_bus, plan/dock_ffmpeg, plan/vertical_crop, plan/unified_external_control, plan/mixer_feed_sources, plan/agent, plan/ai_observability
---

# Video Perception — Per-Camera fps30 Tracker, World State, and AI Observability

## Motivation

A production-quality AI co-pilot for 1–10 simultaneous camera feeds needs two things
LCYT does not have today, and does not need most of the rest of what a from-scratch
"AI production architecture" brief would ask for — because most of it is already
built. Before specifying anything new, here is what this plan deliberately does
**not** re-invent, and why:

| Would-be new layer | Already exists | Where |
|---|---|---|
| Multi-camera entity model | `prod_cameras`, including named independently-relayable RTMP feeds | `plan_prod.md`, `plan_ingest_feeds.md` (implemented) |
| Event transport / message bus | `EventBus` — topic pub/sub, SSE, in-process `subscribe()`, `bus_events` audit log | `plan_pubsub_event_bus.md` (implemented) |
| Scene understanding (VLM) service | Tracker/Describer roles, `continuous_vision` runtime, 3-provider vision-adapter interface | `plan_ai_roles_framework.md` (implemented, project-scoped today — see amendments below) |
| Model provider abstraction, local vs. cloud | `ai_providers`/`ai_provider_models`, bridge-relayed inference incl. local Ollama over a LAN bridge | `plan_ai_model_registry.md` (implemented) |
| Production director (decides camera/mixer actions from structured state) | Production Assistant role + Hosted Operator, confirm/auto safety gate, dynamic tool allowlist from live `prod_cameras`/`prod_mixers` | `plan_ai_roles_framework.md`, `plan_unified_external_control.md` (implemented) |
| Command/action surface | Shared `lcyt-tools` MCP-shaped tool registry | `plan/mcp` (implemented) |
| Specialist-service pattern | `lcyt-music` (small plugin, event-emitting, audio classification) | `plan_music.md` (implemented) — precedent for future vision specialists (OCR, hymn/slide recognition), not itself in scope here |

What's actually missing is:

1. **A local, per-camera perception layer** that doesn't call an LLM per frame — this
   is the "fps30 tracker subsystem" `plan_cues.md` already named and built a consumer
   for (`track:` cue leaves, `track_state` event, `CueEngine.evaluateTrackerEvent()`),
   explicitly distinguishing it from `ai_roles_framework`'s "Tracker" role (5s-interval
   VLM polling — a different technique, not a faster configuration of the same thing).
   **Nothing in this repo produces `track_state` yet.** This plan is that producer.
2. **A World State / Scene State service** that merges observations across cameras
   into current, queryable state — the EventBus is transport, not a fusion/memory
   layer, and nothing today aggregates "camera 3 currently has the best framing of the
   active speaker" from raw per-camera events.
3. **Project-editable camera/preset context** (what does this camera usually show, and
   what else could show the same thing) so Scene Understanding and the Director aren't
   guessing spatial relationships purely from pixels.
4. **An AI observability / prompt-sculpting surface**, separate from the live operator
   console, to see what the perception/understanding layers actually produced and
   iterate on prompts against captured evidence instead of guessing why a decision was
   made after the fact. Specced in a sibling plan, `plan_ai_observability.md` — not
   in this one, and not gated on it (see "Non-goals" below).

Everything else in a from-scratch brief (communication protocol choice, specialist
services, future multi-agent coordination) already has an LCYT-native answer or is
explicitly out of scope — see "Non-goals" below.

## Non-goals

- **No new "Production Director."** Richer input from this plan (world state,
  `track_state`) feeds the *existing* Production Assistant / Hosted Operator loop.
  See "Amendments to other plans" below — this is a deliberate, explicit decision,
  not an oversight.
- **No new message broker.** EventBus stays the transport for every event this plan
  defines. Revisit only if raw per-frame throughput genuinely can't fit it (unlikely —
  this layer emits structured `track_state` summaries at a bounded rate, not raw
  frames, onto the bus).
- **No geometric floor-plan/camera-placement editor in v1.** See "Camera/preset
  metadata" below for why structured labels + overlap links cover the actual need
  more cheaply. A spatial map is a plausible v2, not blocked by anything here.
- **No commitment to specific CV/VLM models.** Per this repo's `plan_ai_model_registry.md`
  precedent, this plan commits to interfaces (a swappable local-inference runner,
  the existing 3-provider vision-adapter shape) and lists a default stack as a
  starting point, not a decision to revisit later.
- **No continuous per-frame LLM reasoning.** The whole point of splitting perception
  (this plan, local/cheap) from scene understanding (`ai_roles_framework`'s Describer,
  sampled/event-driven, already implemented) stays intact. `plan_ai_observability.md`'s
  page letting a human *watch* continuous video is a frontend decoding cost, not a
  backend inference-cost regression — see that plan's own non-goal note.
- **No AI observability page in this plan.** Split out to `plan_ai_observability.md`
  (2026-07-20) — see §4 below for why, and for the one point of coupling (its Stage 3).

---

## 1. The fps30 tracker subsystem (per-camera perception)

### Responsibilities

Per camera, a local (no per-frame model-API call) pipeline producing structured
observations at a bounded rate — object/person detection, multi-object tracking,
optionally pose/head-orientation and a cheap framing/shot-quality score. Full model
comparison (YOLO-family detectors, ByteTrack/BoT-SORT tracking, RTMPose/YOLO-Pose,
MediaPipe/InsightFace for face-orientation) is implementation detail for whoever
builds this — the plan commits to the **runner interface**, not the models:

```js
// one runner instance per camera, parameterized by a swappable backend
export async function start(cameraId, frameSource, config)
export async function stop(cameraId)
// emits, at most every `config.emitIntervalMs` (default: bounded to avoid
// flooding the bus — NOT literally every frame even though sampling is fps30-class):
// { cameraId, ts, objects: [{ id, label, confidence, bbox }], framing?: { score, notes } }
```

**Default stack (swappable, not a decision):** a YOLO-family detector + ByteTrack for
the detection/tracking core (cheapest, best-supported combination for CPU/light-GPU
deployment); pose/face-orientation adapters added only if a concrete
speaking-probability or framing-quality use case needs them — don't build them
speculatively ahead of a driver.

### Deployment

Runs as a new job type on the **existing** compute orchestration layer
(`plan_dock_ffmpeg.md`'s `lcyt-orchestrator`/`lcyt-worker-daemon`, Hetzner
autoscaling) rather than a separate deployment/ops story — this is exactly the kind
of per-stream, GPU-relevant workload that infrastructure already exists to schedule.
Extending it to a non-ffmpeg job type is new work, but reusing the scaling/ops model
is the point.

### Two camera-feed topologies

Not every `prod_cameras` row has its own addressable video feed — some are
PTZ-preset-only, with the only video being whatever's currently cut to program (or a
multiview tap). The perception layer must handle both:

- **Dedicated-feed cameras** (independent RTMP ingest per `plan_ingest_feeds.md`, or
  future SDI/NDI/WHIP input) — continuous tracker state, one runner instance per
  camera, straightforward.
- **Shared/single-feed cameras** (mixer-input-only, no independent ingest) —
  detections can only be produced while that camera happens to be live on the shared
  feed. This is a **permanent structural fact**, not a bug to work around: World
  State (below) must model per-camera visibility explicitly, not assume continuous
  observation.

For the shared-feed case, a **feed → active-camera resolver** tags incoming
frames/detections with whichever camera is currently on program, so tracker state
stays per-camera-id even though the physical stream is shared. This resolver's
trigger already has a design, just not a shipped one: `plan_vertical_crop.md` Phase 4
specs `registry.onProgramChanged(cb)` / `registry.onCameraPresetRecalled(cb)` in
`lcyt-production` (in-process setter-injected callbacks, not yet implemented — see
that plan's Phase 4). **Recommendation:** when Phase 4 lands, promote these from
ad-hoc injected callbacks to real EventBus events (e.g. `production.source_changed`),
since this plan is now a second real consumer alongside vertical-crop's own
production-follow — a threshold worth generalizing at, per this repo's own pattern of
promoting single-consumer mechanisms once a second consumer shows up. Track this as
a shared dependency, not something either plan should duplicate.

### Output: two events, not one — the cue-engine contract is project-level, not per-camera

**Verified against actual code (`packages/plugins/lcyt-cues/src/cue-engine.js`):**
`CueEngine._trackerState` is `Map<apiKey, state>` — **one state blob per project, no
camera dimension** — and `evaluateTrackerEvent(apiKey, state)` **replaces** it wholesale
on every call, it does not merge. `track:label` cue leaves are written without a
camera qualifier too (`track:person`, never `track:camera2.person`). This matters:
naively emitting one raw `track_state` per camera would have each camera's event
clobber the previous camera's state in the already-shipped cue engine — a real bug
this plan must not introduce. Two distinct emissions are needed:

1. **Project-level aggregate `track_state`** (what the cue engine actually consumes,
   unchanged contract, no cue-engine code needs to change):
   ```
   track_state  { apiKey, ts, labels: [{ label, confidence }] }
   ```
   The union of currently-tracked labels across every camera currently visible for
   that project — computed by whatever component fans out per-camera runner output
   (a small aggregator step, not the cue engine's job to change). This is the only
   shape that needs to match `plan_cues.md`'s existing, already-tested consumer.
2. **Per-camera detail** (new, feeds World State §2 below, not the cue engine):
   ```
   camera.track_state  { apiKey, cameraId, ts, labels: [...], visible: bool }
   ```
   Carries `cameraId`/`visible`/bbox-level detail the cue engine's flat contract
   was never meant to carry. When a shared-feed camera goes off program, emit one
   `camera.track_state` with `visible: false` (not silence) so World State can
   distinguish "confirmed absent" from "no update yet."

**Cue-engine cooldown note (already documented in `plan_cues.md`, repeated here for
visibility):** at fps30-class rates, per-rule `cooldown_ms` is load-bearing for
`track:` cue rules — this plan does not change that contract, just finally ships the
producer side of it.

---

## 2. World State / Scene State service

### Responsibilities

Fuses per-camera `camera.track_state`, `describer_update`, STT transcript, and (once built)
audio/music events into current, queryable project-level state. Exposes **structured
APIs, not images** — this is the layer that answers "who's the active speaker," "which
camera currently has the best framing of them," "is the congregation standing,"
without the Director having to re-derive it from raw events on every decision.

### Design choice: flat versioned state + append-only history, not a knowledge graph

The brief's "event sourcing vs. knowledge graph vs. symbolic state vs. hybrid" question
has a fairly clear answer for this system's actual query shape (a handful of
well-known concepts — active speaker, per-camera visibility/framing, current segment
guess — not open-ended relationship queries): a **typed, versioned in-memory state
object per project**, updated by event handlers, snapshotted on demand — the same
shape this repo already uses for `RolesBus`/context-window maps — backed by an
**append-only history log** reusing the `bus_events` audit-log pattern from
`plan_pubsub_event_bus.md` for "what did we believe and when" replay. A full graph
database is the over-engineered option here for the same reason a geometric
floor-plan editor is over-engineered for camera metadata (§3) — it buys generality
this system's actual query patterns don't need, at real implementation and ops cost.
Revisit only if a genuine graph-shaped query need shows up (e.g. multi-hop "who can
see what" reasoning beyond simple overlap links) — §3's `overlaps_with` links are
deliberately *not* modeled as a graph for the same reason.

```
SceneState (per project, in-memory, versioned)
{
  activeSpeaker:   { personId?, cameraId?, confidence, since }
  cameras: {
    [cameraId]: { visible, lastSeenAt, labels: [...], framingScore? }
  }
  segmentGuess:    { label?, confidence, since }   // from Describer's ceremony-state classification
  updatedAt
}
```

### API

- `GET /scene/state` — snapshot, same convention as `GET /variables`.
- New EventBus topics, namespaced per the bus's existing dot-taxonomy (not a
  standalone schema): `scene.speaker_changed`, `scene.segment_changed`,
  `camera.visibility_changed`, `camera.best_framing_changed`. Consumers (Production
  Assistant, Hosted Operator, future UI) subscribe the same way they already
  subscribe to any other bus topic — no new subscription mechanism.

---

## 3. Camera/preset metadata — structured labels, not a geometric map

**Recommendation: skip the floor-plan/placement editor for v1.** The AI doesn't
consume spatial coordinates as geometry — it needs semantic context to condition a
prompt or filter candidate cameras in code. A drag-cameras-onto-a-diagram UI (canvas
editor, coordinate system, per-venue background image) is a real build for a payoff a
much simpler form mostly captures:

Extends `prod_cameras`/`controlConfig.presets` (`plan_prod.md`) with, per
camera/preset:

- `label` — free text, e.g. `"pulpit"`, `"choir"`, `"congregation wide"`.
- `zone` (optional) — coarse tag (front/back/left/right/wide), only if it turns out
  to help.
- `overlaps_with` / `alternate_for` — links to other camera+preset pairs, e.g. "if
  camera 1 loses the subject, camera 3's wide preset covers the same area." This is
  the field that actually pays off: it turns camera hand-off from a vision-inference
  problem into a lookup.

**Consumers:**
- Scene Understanding's project-editable venue-context prompt block (§4 in the
  `plan_ai_roles_framework.md` amendment below) — interpolates these labels so the
  model doesn't have to guess what "camera 2" means for this venue.
- World State — candidate lookup ("need a shot of the choir → look up cameras/presets
  tagged `choir`").
- `plan_vertical_crop.md` Phase 4's production-follow — the concrete, already-planned
  consumer of `overlaps_with` data; link explicitly rather than building this
  metadata speculatively.

A real spatial map stays a plausible v2 once label/overlap metadata alone has been
tried against actual handoff decisions and found insufficient — not before.

---

## 4. AI observability / "prompt sculpting" page — see `plan_ai_observability.md`

Originally specced as part of this plan; split out (2026-07-20) because it doesn't
need to wait for anything here — it's useful today against the already-implemented
Tracker/Describer roles. That plan's Stage 3 extends its overlay to this plan's
`camera.track_state` once built (§1 above) — the only coupling between the two, and
it's additive, not blocking. See `plan_ai_observability.md` for the page's own scope,
staging, and its explicit non-goal about not silently increasing production
inference sampling rate.

---

## Amendments to other plans (tracked here, applied there)

This plan's job is Layers 1 and 3 plus the camera-metadata cross-cutting piece (the
observability page is now `plan_ai_observability.md`'s job, not this plan's — see §4).
It deliberately does not re-spec Layers 2/4/5/9 — those get targeted amendments in
their owning plans instead of a competing description here:

- **`plan_ai_roles_framework.md`** — camera-scope Tracker/Describer (today
  project-scoped, one preview-JPEG feed per project) so a project with N cameras gets
  N-way sampling/batching instead of one shared feed; split `systemPromptOverride`
  into a fixed base template (owns the output-schema contract) + the project-editable
  venue-context block this plan's camera metadata feeds.
- **`plan_unified_external_control.md`** / **`plan_ai_roles_framework.md`**
  (Production Assistant / Hosted Operator) — note that these consume World State's
  new `scene.*` topics as additional context, same subscription mechanism as
  everything else on the bus. No new director, no new trigger mechanism.
- **`plan_vertical_crop.md`** — link Phase 4's `overlaps_with`-shaped follow logic to
  this plan's camera metadata; flag the shared `onProgramChanged`/
  `onCameraPresetRecalled` → EventBus promotion as a joint dependency, not something
  either plan should build twice.
- **`plan_prod.md`** — add the camera/preset metadata fields; flag that
  `getActiveSource()` is poll-only today (verified: no EventBus emission anywhere in
  `lcyt-production` as of this writing) — Phase 4 of vertical-crop is what's expected
  to close that gap, not this plan.
- **`plan_cues.md`** — update its "nothing in this repo produces `track_state` yet"
  note to point at this plan as the drafted (not yet built) producer.

---

## Suggested phase order (within this plan)

1. **Schema + camera metadata + World State skeleton** — `label`/`overlaps_with` on
   `prod_cameras`/presets, `SceneState` in-memory structure + `GET /scene/state`
   snapshot, no perception producer yet (World State starts empty/idle — cheap to
   ship ahead of the harder perception work, and unblocks UI/prompt work against a
   real API shape).
2. **fps30 producer for dedicated-feed cameras** — the local CV runner, one instance
   per independently-fed camera, emitting `track_state`. Shared-feed cameras deferred
   to the next phase since they depend on vertical-crop's Phase 4 callbacks.
3. **Shared/single-feed resolver** — once `plan_vertical_crop.md` Phase 4's
   `onProgramChanged`/`onCameraPresetRecalled` ship (ideally as EventBus events per
   the promotion recommendation above), wire the feed→active-camera tagging.

The AI observability page is no longer phased here — see `plan_ai_observability.md`'s
own staging, which starts independently of this plan and only picks up a dependency
on it (Stage 3, extending the overlay to `camera.track_state`) once Phase 2 above has
shipped.

## Open questions

- Exact framing/shot-quality scoring approach (rule-based from bbox geometry vs. a
  small learned model) — defer to whoever implements Phase 2, not a plan-level
  decision.
- Whether `SceneState`'s history log should live in the same `bus_events` table or a
  dedicated one — likely the same table with a `scene` topic prefix, but confirm
  retention/volume assumptions don't collide with `EVENT_LOG_RETENTION_DAYS` sizing
  for busy multi-camera projects before deciding.
- Whether pose/face-orientation/speaking-probability models are worth their
  compute cost before a concrete consumer (e.g. auto-framing) asks for them — lean
  toward deferring per this plan's own "don't build speculatively" stance.
