---
id: plan/live_variables
title: "Live Variables — Continuous Refresh, Live Operator Display, and Text-Block Expansion"
status: draft
summary: "Forward-looking variable behaviours split out of plan_metacode_variable_unification so that plan can finish on its implemented core (registry/namespace/TTL). Three ideas: (1) the settled connector-fetch-timing decision (no load tier — a pointer-tier trigger on the first line covers 'on load'); (2) an always-updated variable that the operator sees live and normalized (a session-long, pointer-independent background refresh plus a live on-screen display surface — depends on the Pub/Sub Event Bus for the push path); (3) variable-backed text blocks that expand a variable's long text into multiple visible, navigable, sendable caption lines via normalizeLines. Ideas 2–3 are design-pending; idea 1 is decided and recorded here as the source of truth."
related: plan/api_connectors_variables, plan/metacode_variable_unification, plan/pubsub_event_bus, plan/cues, plan/dsk
---

# Live Variables — Continuous Refresh, Live Operator Display, and Text-Block Expansion

## Context

`plan_api_connectors_variables.md` shipped `{{name}}` insertion and the three
connector-refresh tiers (`!api:`/`api:`/`api!:`). `plan_metacode_variable_unification.md`
adds the reserved-name registry, the one-namespace model, and per-assignment TTL
(time-based TTL implemented). This plan collects the **remaining, more speculative
variable behaviours** so the unification plan can finish on its implemented core.

`{{name}}` today is a pure read resolved **only at send** — there is no surface
where the operator watches a variable change in real time, and no way to turn a
variable's long text into multiple sendable lines. Those are the gaps below.

## 1. Fetch timing — DECIDED: no load tier (2026-07-12)

The connector-refresh tiers stay exactly three: `!api:` (pointer arrival), `api:`
(send), `api!:` (prefetch loop while on the line). **There is no dedicated
load/connect tier, and one is not to be reintroduced.** "Fetch on load" is
reproduced by placing a pointer-tier trigger on the file's **first line**.

To make that robust, **file open/activation fires the start-of-file pointer
triggers even when the pointer is restored to a later line** from a previous
session — the start-line triggers run on open, then the saved pointer position is
applied. This closes the "reopen the file and it never refreshes" gap (a restored
non-zero pointer would otherwise skip the line-1 trigger) without adding a tier.
Settled — do not revisit "on load".

> This is about *refreshing* a variable from a connector. `{{name}}` itself is a
> pure read, resolved at send; it never fetches.

## 2. Always-updated, always-seen (live) variable — design pending

A variable that stays continuously current and that the operator **sees live and
normalized** — e.g. a viewer count, "now playing", a countdown, the current
speaker. It is a *monitor*, not necessarily ever "sent". Two pieces, of which the
first partly exists:

- **Always-updated.** The `api!:` prefetch tier already polls on an interval, but
  only *while the pointer sits on its line*. "All the time" means a **session-long,
  pointer-independent background refresh** (a per-request "keep warm" for the whole
  session), on top of the existing per-change SSE push.
- **Always-seen + normalized.** The live-display surface that does not exist yet —
  a small widget/field showing `normalizeLines(value)` (`packages/lcyt-web/src/lib/normalizeLines.js`)
  that updates in place as the value changes. `{{ }}` only resolves at send, so
  there is nowhere the operator watches a value update today.

**Depends on `plan_pubsub_event_bus.md`** for the live push path — a live display
that reacts to variable changes (and cross-plugin events) is exactly what the
event bus's `variable.updated` topic + in-process `subscribe()` are for; building
this before the bus lands would mean another bespoke SSE consumer.

Open questions: is "updated all the time" a continuous background poll or fed by a
streaming source; where does the operator see it (inline in the caption/rundown
view vs. a dedicated live panel/dashboard widget); refresh cadence.

## 3. Variable-backed text blocks — design pending

Distinct from inline `{{name}}` (single value, one line, resolved at send): a
**block** expands a variable's (long) text into multiple **visible, navigable,
sendable** caption lines so the operator can step through them. Use case: an
`api:` call fetches a long text into a variable, normalized (reusing
`normalizeLines.js`) into caption-width lines the operator sends one at a time.

Decisions still open (recommendations in **bold**):
1. **Syntax** — **`<!-- lines: name -->`** (structural marker, supports options
   like `<!-- lines[40]: name -->`) vs. `{{{name}}}`.
2. **Expansion** — **materialize-on-arrival + freeze while inside** the block
   (refresh happens before arrival via the pointer tier; lines don't shift under
   the operator mid-block) vs. live re-expand.
3. **Not-yet-fetched fallback** — **`loading…` placeholder, expand when the value
   lands** vs. briefly block.

Hard part (flagged): expanded lines are **virtual** (not in the raw `.txt`), so
`useFileStore`'s 1:1 `lines[]`/`lineCodes[]`/`lineNumbers[]`/pointer model must
materialize them at the marker and keep `goto`/gutter line numbers + the pointer
sane across them, tagging virtual lines so save/serialize skips them.

## Dependencies & sequencing

- **Idea 1** is decided; it constrains the connectors frontend wiring only.
- **Idea 2** depends on `plan_pubsub_event_bus.md` (live push) — schedule after it.
- **Idea 3** depends on the file/pointer-model work; schedule after
  `plan_metacode_variable_unification.md`'s namespace phase.

## Index Entry

Add to `docs/PLANS.md`'s Draft table:

```
| [plan_live_variables.md](plans/plan_live_variables.md) | Live Variables — Continuous Refresh, Live Operator Display, Text-Block Expansion | Forward-looking variable behaviours split out of the unification plan: (1) DECIDED fetch-timing (no load tier — a first-line pointer trigger covers "on load", fired on file open even when the pointer is restored later); (2) an always-updated variable shown live + normalized to the operator (session-long pointer-independent refresh + a live display surface — depends on the Pub/Sub Event Bus); (3) variable-backed text blocks expanding a variable's long text into multiple sendable lines via normalizeLines (virtual-line file-store work). Ideas 2–3 design-pending. | |
```
