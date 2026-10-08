---
id: plan/ai_observability
title: "AI Observability â€” Prompt Sculpting Page for Vision Roles"
status: in-progress
summary: "A separate, gated dev/api/v1/admin page for seeing what LCYT's vision AI actually perceives and iterating on prompts against captured evidence, rather than guessing why a decision was made after the fact. Deliberately scoped to start against what's already implemented â€” the Tracker/api/v1/Describer roles (`plan_ai_roles_framework.md`) â€” rather than being gated on `plan_video_perception.md`'s fps30 tracker or `plan_mixer_feed_sources.md`'s WHEP preview tiles, both still unbuilt. Split out of `plan_video_perception.md` specifically so its schedule isn't coupled to that plan's much larger, harder, dependency-chained CV pipeline. Ships in three stages: (1) single-feed live overlay + capture/api/v1/replay + prompt sandbox against today's project-scoped Tracker/api/v1/Describer, no new dependency; (2) a true multi-camera grid, which honestly does need either `plan_ai_roles_framework.md`'s not-yet-built camera-scoping amendment or a per-feed extension to `PreviewManager` (currently keyed only by project `api_key`, verified by reading `preview-manager.js`/api/v1/`routes/api/v1/preview.js`); (3) extending the overlay to `plan_video_perception.md`'s `camera.track_state` once that ships. **Stage 1 implemented (2026-07-20, Lane 10 of `ROADMAP.md`):** `VisionRoleManager` (`packages/api/v1/plugins/api/v1/lcyt-agent/api/v1/src/api/v1/vision-role-manager.js`) now keeps a bounded 20-entry-per-`(apiKey,roleCode)` in-memory capture ring buffer (prompt + frame + result/api/v1/error) alongside its existing poll loop, survives stop()/api/v1/start(), never persists to disk; `GET /api/v1/roles/api/v1/:roleCode/api/v1/captures`, `GET /api/v1/roles/api/v1/:roleCode/api/v1/captures/api/v1/:id/api/v1/frame`, and `POST /api/v1/roles/api/v1/:roleCode/api/v1/captures/api/v1/:id/api/v1/replay` (`packages/api/v1/plugins/api/v1/lcyt-agent/api/v1/src/api/v1/routes/api/v1/vision-roles.js`) expose it and the prompt-sandbox re-run (never writes back to `harness_config`). Frontend: `/api/v1/admin/api/v1/ai-observability` (`packages/api/v1/lcyt-web/api/v1/src/api/v1/components/api/v1/AiObservabilityPage.jsx`, gated the same way as `/api/v1/admin/api/v1/ai-models` â€” `AdminKeyGate` + `useProjectRequired` â€” plus a nav entry gated on the `admin` feature) renders the live canvas overlay over the existing polled preview-JPEG feed (subscribing directly to `role.tracker.*`/api/v1/`role.describer.*` on `/api/v1/events/api/v1/stream`, no new backend), a capture browser, and the prompt-editing replay/api/v1/diff sandbox. Stages 2 and 3 remain unbuilt, per their own dependencies above."
related: plan/ai_roles_framework, plan/video_perception, plan/mixer_feed_sources, plan/prod
---

# AI Observability â€” Prompt Sculpting Page for Vision Roles

## Motivation

Split out of `plan_video_perception.md` (2026-07-20) on the observation that this
page doesn't actually need to wait for anything in that plan. It's useful the moment
you have Tracker/Describer emitting `tracker_update`/`describer_update` â€” which is
today, already implemented. Bundling it as "the last phase" of the fps30
tracker/World State plan tied its priority to that plan's much bigger, harder,
sequencing-blocked-on-`plan_vertical_crop.md`-Phase-4 timeline. This plan exists so
that coupling doesn't happen.

Without this kind of visibility, tuning a vision pipeline is blind â€” you're guessing
why the Production Assistant made a bad decision, or why Describer classified a
segment wrong, with no way to look back at exactly what was sent to the model and
what it actually returned.

## Non-goals

- **Not the live operator console.** A separate, gated route (dev/admin only) â€”
  raw model internals and editable prompts are the wrong audience and risk profile
  for `/api/v1/production`, which a volunteer operates live during a service. Same pattern
  as `/api/v1/production/api/v1/crop` being its own route.
- **Not gated on `plan_video_perception.md`.** Stage 1 (below) needs nothing from
  that plan. Stage 3 extends to it once it exists â€” that's the only coupling, and
  it's additive, not blocking.
- **Must not silently increase production inference cost.** The whole point of the
  Tracker/Describer/fps30 split is sampled, event-driven inference, not continuous
  reasoning. A human *watching* video in this debug page is a frontend decoding
  cost, not a backend inference-cost regression â€” but opening the page must not
  itself crank up sampling rate on the backend. If temporarily-faster sampling while
  actively debugging one camera/feed is wanted, it must be an explicit, scoped,
  auto-reverting override â€” never a side effect of the page being open.

## Stage 1 â€” single-feed overlay + capture/replay + prompt sandbox (no new dependency)

**Implemented (2026-07-20).** See the frontmatter `summary` for the file/route map.

Works against today's project-scoped Tracker/Describer (one preview-JPEG feed per
project, `PreviewManager`'s existing `GET /preview/:key/incoming.jpg`). Not a
multi-camera grid yet â€” that's Stage 2 â€” but genuinely useful today for tuning
prompts/thresholds on whatever feed a project already has.

1. **Live overlay.** Render the existing preview-JPEG feed with `tracker_update`
   (`{ objects: [{ id, label, confidence, bbox }] }`) boxes and `describer_update`
   text/JSON composited on top, client-side canvas over the polled image. No new
   backend â€” both events already exist.
2. **Capture + replay.** Describer's `VisionRoleManager` retains its last-N
   request/response pairs (prompt sent, image reference, raw model output) in a
   small ring buffer or debug-log table â€” not just the final emitted event. Without
   this, "why did it think X five minutes ago" is unanswerable; only live debugging
   would ever be possible. This is new backend work but small â€” a bounded buffer
   next to the manager's existing polling loop.
3. **Prompt sandbox.** Take a captured frame + its context, edit the venue-context
   prompt block (the project-editable half of `systemPromptOverride`, per
   `plan_ai_roles_framework.md`'s amendment), re-run against that same frame, diff
   the output against what was actually produced live. The one genuinely new
   backend endpoint here â€” a "replay this input against a new prompt" call.
   Everything else in Stage 1 is composition of already-shipped pieces.

## Stage 2 â€” true multi-camera grid

Requires one of two real dependencies â€” pick based on what's actually available when
this stage is picked up, don't block on both:

- **`plan_ai_roles_framework.md`'s camera-scoping amendment** for Tracker/Describer
  (currently unbuilt â€” see that plan) gives each camera its own tracker/describer
  output to overlay, which is the real precondition for "a grid of N cameras each
  with their own live detections," not just N video tiles.
- **Video source**, independent of the above: either extend `PreviewManager` to key
  by feed/camera id instead of only project `api_key` (smaller, immediately
  buildable, higher latency), or adopt `plan_mixer_feed_sources.md`'s WHEP preview
  tiles once that plan ships (lower latency, bigger dependency). Don't assume WHEP
  is required â€” the JPEG-polling path this repo already uses for Tracker/Describer
  is a legitimate, lower-effort v1 for this page's grid too.

## Stage 3 â€” extend to the fps30 tracker

Once `plan_video_perception.md`'s fps30 tracker ships, the same overlay mechanism
from Stage 1 renders `camera.track_state` (bbox/label detail per camera) alongside
or instead of the VLM-based `tracker_update`, and capture/replay extends to whatever
of that layer benefits from post-hoc inspection. Purely additive to Stages 1â€“2 â€” no
rework implied.

## Open questions

- Ring buffer size/retention for captured request/response pairs â€” start small (e.g.
  last 20 per camera/role) and revisit against actual storage/debugging use once
  built, not a plan-level decision now.
- Whether the prompt sandbox's "replay" should also support re-running against a
  *different* model/provider (useful for comparing providers on the same captured
  frame, ties into `plan_ai_model_registry.md`) â€” plausible extension, not required
  for Stage 1.

