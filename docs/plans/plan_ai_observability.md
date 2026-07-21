---
id: plan/ai_observability
title: "AI Observability — Prompt Sculpting Page for Vision Roles"
status: in-progress
summary: "A separate, gated dev/admin page for seeing what LCYT's vision AI actually perceives and iterating on prompts against captured evidence, rather than guessing why a decision was made after the fact. Deliberately scoped to start against what's already implemented — the Tracker/Describer roles (`plan_ai_roles_framework.md`) — rather than being gated on `plan_video_perception.md`'s fps30 tracker or `plan_mixer_feed_sources.md`'s WHEP preview tiles, both still unbuilt. Split out of `plan_video_perception.md` specifically so its schedule isn't coupled to that plan's much larger, harder, dependency-chained CV pipeline. Ships in three stages: (1) single-feed live overlay + capture/replay + prompt sandbox against today's project-scoped Tracker/Describer, no new dependency; (2) a true multi-camera grid, which honestly does need either `plan_ai_roles_framework.md`'s not-yet-built camera-scoping amendment or a per-feed extension to `PreviewManager` (currently keyed only by project `api_key`, verified by reading `preview-manager.js`/`routes/preview.js`); (3) extending the overlay to `plan_video_perception.md`'s `camera.track_state` once that ships. **Stage 1 implemented (2026-07-20, Lane 10 of `ROADMAP.md`):** `VisionRoleManager` (`packages/plugins/lcyt-agent/src/vision-role-manager.js`) now keeps a bounded 20-entry-per-`(apiKey,roleCode)` in-memory capture ring buffer (prompt + frame + result/error) alongside its existing poll loop, survives stop()/start(), never persists to disk; `GET /roles/:roleCode/captures`, `GET /roles/:roleCode/captures/:id/frame`, and `POST /roles/:roleCode/captures/:id/replay` (`packages/plugins/lcyt-agent/src/routes/vision-roles.js`) expose it and the prompt-sandbox re-run (never writes back to `harness_config`). Frontend: `/admin/ai-observability` (`packages/lcyt-web/src/components/AiObservabilityPage.jsx`, gated the same way as `/admin/ai-models` — `AdminKeyGate` + `useProjectRequired` — plus a nav entry gated on the `admin` feature) renders the live canvas overlay over the existing polled preview-JPEG feed (subscribing directly to `role.tracker.*`/`role.describer.*` on `/events/stream`, no new backend), a capture browser, and the prompt-editing replay/diff sandbox. Stages 2 and 3 remain unbuilt, per their own dependencies above."
related: plan/ai_roles_framework, plan/video_perception, plan/mixer_feed_sources, plan/prod
---

# AI Observability — Prompt Sculpting Page for Vision Roles

## Motivation

Split out of `plan_video_perception.md` (2026-07-20) on the observation that this
page doesn't actually need to wait for anything in that plan. It's useful the moment
you have Tracker/Describer emitting `tracker_update`/`describer_update` — which is
today, already implemented. Bundling it as "the last phase" of the fps30
tracker/World State plan tied its priority to that plan's much bigger, harder,
sequencing-blocked-on-`plan_vertical_crop.md`-Phase-4 timeline. This plan exists so
that coupling doesn't happen.

Without this kind of visibility, tuning a vision pipeline is blind — you're guessing
why the Production Assistant made a bad decision, or why Describer classified a
segment wrong, with no way to look back at exactly what was sent to the model and
what it actually returned.

## Non-goals

- **Not the live operator console.** A separate, gated route (dev/admin only) —
  raw model internals and editable prompts are the wrong audience and risk profile
  for `/production`, which a volunteer operates live during a service. Same pattern
  as `/production/crop` being its own route.
- **Not gated on `plan_video_perception.md`.** Stage 1 (below) needs nothing from
  that plan. Stage 3 extends to it once it exists — that's the only coupling, and
  it's additive, not blocking.
- **Must not silently increase production inference cost.** The whole point of the
  Tracker/Describer/fps30 split is sampled, event-driven inference, not continuous
  reasoning. A human *watching* video in this debug page is a frontend decoding
  cost, not a backend inference-cost regression — but opening the page must not
  itself crank up sampling rate on the backend. If temporarily-faster sampling while
  actively debugging one camera/feed is wanted, it must be an explicit, scoped,
  auto-reverting override — never a side effect of the page being open.

## Stage 1 — single-feed overlay + capture/replay + prompt sandbox (no new dependency)

**Implemented (2026-07-20).** See the frontmatter `summary` for the file/route map.

Works against today's project-scoped Tracker/Describer (one preview-JPEG feed per
project, `PreviewManager`'s existing `GET /preview/:key/incoming.jpg`). Not a
multi-camera grid yet — that's Stage 2 — but genuinely useful today for tuning
prompts/thresholds on whatever feed a project already has.

1. **Live overlay.** Render the existing preview-JPEG feed with `tracker_update`
   (`{ objects: [{ id, label, confidence, bbox }] }`) boxes and `describer_update`
   text/JSON composited on top, client-side canvas over the polled image. No new
   backend — both events already exist.
2. **Capture + replay.** Describer's `VisionRoleManager` retains its last-N
   request/response pairs (prompt sent, image reference, raw model output) in a
   small ring buffer or debug-log table — not just the final emitted event. Without
   this, "why did it think X five minutes ago" is unanswerable; only live debugging
   would ever be possible. This is new backend work but small — a bounded buffer
   next to the manager's existing polling loop.
3. **Prompt sandbox.** Take a captured frame + its context, edit the venue-context
   prompt block (the project-editable half of `systemPromptOverride`, per
   `plan_ai_roles_framework.md`'s amendment), re-run against that same frame, diff
   the output against what was actually produced live. The one genuinely new
   backend endpoint here — a "replay this input against a new prompt" call.
   Everything else in Stage 1 is composition of already-shipped pieces.

## Stage 2 — true multi-camera grid

Requires one of two real dependencies — pick based on what's actually available when
this stage is picked up, don't block on both:

- **`plan_ai_roles_framework.md`'s camera-scoping amendment** for Tracker/Describer
  (currently unbuilt — see that plan) gives each camera its own tracker/describer
  output to overlay, which is the real precondition for "a grid of N cameras each
  with their own live detections," not just N video tiles.
- **Video source**, independent of the above: either extend `PreviewManager` to key
  by feed/camera id instead of only project `api_key` (smaller, immediately
  buildable, higher latency), or adopt `plan_mixer_feed_sources.md`'s WHEP preview
  tiles once that plan ships (lower latency, bigger dependency). Don't assume WHEP
  is required — the JPEG-polling path this repo already uses for Tracker/Describer
  is a legitimate, lower-effort v1 for this page's grid too.

## Stage 3 — extend to the fps30 tracker

Once `plan_video_perception.md`'s fps30 tracker ships, the same overlay mechanism
from Stage 1 renders `camera.track_state` (bbox/label detail per camera) alongside
or instead of the VLM-based `tracker_update`, and capture/replay extends to whatever
of that layer benefits from post-hoc inspection. Purely additive to Stages 1–2 — no
rework implied.

## Open questions

- Ring buffer size/retention for captured request/response pairs — start small (e.g.
  last 20 per camera/role) and revisit against actual storage/debugging use once
  built, not a plan-level decision now.
- Whether the prompt sandbox's "replay" should also support re-running against a
  *different* model/provider (useful for comparing providers on the same captured
  frame, ties into `plan_ai_model_registry.md`) — plausible extension, not required
  for Stage 1.
