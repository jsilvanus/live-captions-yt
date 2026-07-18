---
status: reference
summary: "Prioritised way-forward across every plan in docs/PLANS.md as of 2026-07-18: what to work next, and — the point of this doc — which pieces of work can run in parallel across multiple simultaneous agents without touching the same files. Organised into tiers (finish what's in-progress, close high-value gaps in 'done' plans, small independent gap-closers, new/draft features, and one cross-cutting item that must run alone) plus a set of concrete, non-overlapping lanes for parallel dispatch. Also records two operational lessons learned from this session's subagent batch (isolation-worktree reliability, package.json `exports` fragility) that any future parallel dispatch should account for."
---

# Roadmap — Way Forward

This is not a new plan. It reads `docs/PLANS.md` (the audited index — see there for
per-plan detail and status) and turns it into an ordering: what to do next, and what
can be done *at the same time* by independent agents without merge conflicts.

Re-check `docs/PLANS.md` before acting on this document — it decays as work lands.

---

## 0. Operational notes before dispatching parallel agents

Two things surfaced while closing out the last batch of small fixes, worth carrying
forward into any future multi-agent dispatch:

1. **`isolation: "worktree"` can silently fail.** Two of five agents in the last batch
   ended up committing directly into the primary repo checkout instead of an isolated
   worktree, with no error surfaced — the only tell was the worktree directory being
   untouched at its base commit while the *primary* repo's `main` branch gained a stray
   commit. **Always verify** a background agent actually produced its own worktree
   (`git worktree list`, check the reported path is non-empty and matches) before
   trusting isolation held. If it didn't, the commit is still recoverable (branch it
   off before resetting `main`) but do this check *before* running anything destructive
   in the primary checkout.
2. **Never let an agent replace entries in a package's `"exports"` map — only add.**
   One agent's edit to `lcyt-files/package.json` swapped an existing `exports` entry
   for new ones its own code didn't even need (it imported via relative paths), which
   silently broke every deep import of the old entry elsewhere in the repo
   (`ERR_PACKAGE_PATH_NOT_EXPORTED`, three failing test files, only caught by running
   the full `lcyt-backend` suite — package-scoped tests didn't touch the broken path).
   This repo's convention is a small, curated, explicit `exports` map per package (no
   wildcards) — before touching one, `grep -rn "from '<pkg>/` across the whole repo to
   find every existing consumer, and only add.

Both are why the parallel lanes below are grouped by **package/directory ownership** —
two agents editing the same package's shared files (a `package.json`, a composition
root like `server.js`) at the same time is the actual collision risk, not file count.

---

## Tier 1 — Finish what's in-progress (unblocks other work)

These are partially built; finishing them removes a dependency several other items
lean on.

| Plan | What's left | Why it matters |
|---|---|---|
| `plan_ai_roles_framework.md` | Translation role — still just a flagged future gap, not spec'd | Needs a short design pass before it's implementable; not urgent, blocks nothing else. |
| `plan_ai_model_registry.md` | Role-config model-picker UI (`GET /ai/providers/:id/models` wired into the Setup Hub) | Backend (registry, discovery, bridge-relayed inference for both the `agentic_chat` turn loop and all three vision adapters) is done and tested; today a role's `provider_id`/`model_name` can only be set by a direct API call, not through the UI. Pure `lcyt-web` frontend work. |
| `plan_vertical_crop.md` | Production-follow phase (`crop_source_map` → mixer-switch/PTZ-preset registry callbacks, `crop_preset` named-action/cue/tool), `overridePublisher` pre-config | Backend (schema, `CropManager`, `/crop` routes, live zmq repositioning) and the operator UI (Phase 3) are done; this is the remaining auto-follow wiring + one config knob. |

**Lane A — AI bridge-relay wiring** (`packages/plugins/lcyt-agent` only) is **done** —
verified 2026-07-18: `resolveRoleProviderSettings()`/`invokeModelCall()` already dispatched
bridge-relayed inference for the `agentic_chat` turn loop (landed 2026-07-13, `fafb55c`); this
pass additionally routed the Google and Anthropic vision adapters through the same
`invokeModelCall()` bridge path (previously only the OpenAI-compatible/Ollama-vendor adapter
supported it), added bridge-relay test coverage for all three vendors in
`test/vision-adapters.test.js`, and updated `packages/plugins/lcyt-agent/CLAUDE.md`,
`CONSIDER.md`, `docs/PLANS.md`, and the two plan files, all of which had gone stale relative to
the 2026-07-13 commit. No lane is needed here anymore — the only remaining piece
(`plan_ai_model_registry.md`'s role-config model-picker UI, above) is a `lcyt-web` frontend
task, not a `lcyt-agent` backend one.

**Lane B — Vertical crop operator UI** is **done** — implemented 2026-07-18:
`packages/lcyt-web/src/components/production/ProductionCropPage.jsx` (route
`/production/crop`, linked from the main `/production` console header) plus
`production/crop/{useCropEditor,CropPresetPanel,CropCanvas,CropSourcePanel}.jsx`.
`useProductionData.js` gained one additive export (`jfetch`) so the new page
can reuse its credentials/cameras/mixers plumbing instead of duplicating it;
`Chrome.jsx` gained the "Vertical Crop" header link. See
`plan_vertical_crop.md` Phase 3 for the UI shape (a three-column operator
layout, not the plan's original sources×sets matrix-grid sketch — see that
phase note for why). Remaining work on this plan (production-follow, Phase 4)
is listed in Tier 1 above and is a `lcyt-rtmp`/`lcyt-production` backend lane,
not a frontend one — no conflict with any other lane below.

---

## Tier 2 — Highest-value gap in an otherwise-"done" plan: the cue rules editor

`plan_cues.md` is the single biggest concentration of remaining, user-visible work.
Phases 1–8 are fully implemented, but:

- **Phase 10 (Assets-card cue rules editor)** — `packages/plugins/lcyt-cues/src/routes/cues.js`
  has had a full `/cues/rules` CRUD API since Phase 1, and **nothing in `lcyt-web` calls
  it**. Today the only way to create a persistent cue rule is a raw HTTP request. This
  is a shipped backend feature with zero UI — the highest-leverage single fix in the
  whole backlog.
- **Phase 9 (composite trees + named conditions, `/cues/defs`)** — a backend extension
  motivated by exactly this editor gap (hand-authoring composite JSON trees is what
  makes the missing editor actually painful).
- **Phase 8.5 (inline ↔ backend cue sync gap)** — a correctness fix, independent of
  9/10.

**Recommended order:** ship the editor (Phase 10) *first*, scoped to today's simpler
rule types (phrase/regex/section/fuzzy) — don't wait on Phase 9. That alone closes the
"shipped API, no UI" gap for the common case. Extend the editor once Phase 9's
composite trees exist.

**Lane C — Cue rules editor (Phase 10, current rule types only)** is **done** —
implemented 2026-07-18: `packages/lcyt-web/src/components/CuesPage.jsx` (new,
route `/cues`) is a CRUD editor over the existing `/cues/rules` API, scoped to
`phrase`/`regex`/`section`/`fuzzy` as planned — no backend changes. Rules of
other match types (`semantic`, `event_cue`, sound-cue types, future
`composite`) still list/toggle/delete but lock their edit form with a notice
rather than expose fields the editor doesn't support yet. `AssetsPage.jsx`'s
existing "Global cues" card (it already had one, unlike the plan's original
`TILES`-array sketch — see `plan_cues.md` Phase 10) now links to `/cues`
instead of `/planner`. `plan_cues.md`, `plan_assets_page.md`, and
`packages/lcyt-web/CLAUDE.md` updated; `test/components/CuesPage.test.jsx`
(9 tests, Vitest) added. The composite-tree `ConditionTreeEditor` and Named
Conditions section remain deferred to Phase 9 (Lane D), as scoped.

**Same-day follow-up (also 2026-07-18):** on user feedback that cues (and
named actions) are properties of a rundown file rather than a standalone
library, the editor's logic was extracted into `CuesManager({ embedded })`
(`CuesPage.jsx` is now a thin wrapper, mirroring `LanguagesManager`/
`LanguagesPage.jsx`) and given a second home: an embedded "📋 Cues" tab in
a new `packages/lcyt-web/src/components/planner/PlannerAssistPanel.jsx`,
the Planner's right column, alongside an "⚡ Actions" tab and the AI
assistant chat below both. The Actions tab reuses `NamedActionsManager.jsx`
(`plan_named_actions.md`) — rebuilt on the same Dialog/SetupItemRow pattern
and given its own standalone `/actions` page (linked from the Assets
"Global actions" card, which was read-only until now) since it turned out
to have been built earlier but never actually mounted anywhere. This
replaced a non-functional "Cues and Actions panels coming soon" tab stub
that was already sitting in `PlannerPage.jsx`'s narrow/mobile layout, and
gave the desktop 3-column layout the same tabs for the first time.
`plan_cues.md`, `plan_named_actions.md`, `plan_assets_page.md`, `docs/PLANS.md`,
and `packages/lcyt-web/CLAUDE.md` updated; `test/components/NamedActionsManager.test.jsx`
(7 tests) and `test/components/PlannerAssistPanel.test.jsx` (4 tests) added,
`CuesPage.test.jsx`'s original 9 tests kept passing unmodified (pure
extraction, no behavior change to the non-embedded default).

**Lane D — Cue engine backend: Phase 8.5 sync fix + Phase 9 composite trees** is
**done** — implemented 2026-07-18, continuing PR #282, `packages/plugins/lcyt-cues`
only (no frontend changes). Phase 8.5 turned out to already be shipped by the time
this lane started: `POST /cues/inline`, `CueEngine.setInlineSnapshot()`/
`evaluateInlineCues()`, and the frontend caller in `InputBar.jsx` all already
existed with test coverage — this doc and `plan_cues.md` had simply gone stale
(the "operational lesson" §0 warns about exactly this: re-check before acting).
Phase 9 backend landed fresh in this pass: `cue_named_conditions` table +
`GET/POST/PUT/DELETE /cues/defs` (write-time cycle rejection for both
self-reference and multi-hop cycles), `cue_rules.condition_tree` +
`match_type: 'composite'`/`'track'` support in `/cues/rules` (non-zero default
`cooldown_ms` for `track`/composite-with-`track`-leaf rules), and a rewritten
async `CueEngine.evaluateComposite()` (leaf types `phrase`/`exact`/`regex`/
`fuzzy`/`section`/`context`/`track`/`semantic`/`event`, cheap-sync-before-async
ordering within a group, cycle-guarded `ref` resolution against the DB-backed
named-condition cache) replacing the old inline-only, sync, `cueDefs`-only
evaluator. New `evaluateCompositeRules()` (DB-backed composite rules — inline
composite already worked) and `evaluateTrackerEvent()`/`createTrackerCueListener()`
(`track:` leaves and standalone `track` rules — mirrors the sound-cue listener;
inert until some future tracker subsystem emits `track_state`, which is out of
scope for this plugin). 24 new tests (`cue-engine.test.js`, new
`tracker-cues.test.js`, `routes.test.js`). `plan_cues.md`, `docs/PLANS.md`, and
`packages/plugins/lcyt-cues/CLAUDE.md` updated. **Now unblocked:** Lane C's
`ConditionTreeEditor`/Named Conditions extension and the frontend composite-cue/
`cue-def:` parser work — see `plan_cues.md` Phase 9's "Frontend (not built)"
note for the API surface to build against; not dispatched as part of this lane
since it's frontend work.

---

## Tier 3 — Small, independent gap-closers (good for a parallel batch, like the last one)

Each of these touches one package (plus at most one composition-root line), has no
product-design ambiguity, and doesn't overlap any other row here or in Tiers 1–2:

| Item | Package(s) | Note |
|---|---|---|
| Wire `putObject`/`publicUrl` into the HLS manager | `lcyt-rtmp` (`hls-manager.js`) + `lcyt-files` | `plan_files3.md`; medium priority, uses `resolveStorage` the same way captions already do |
| DSK editor: rotation handle + snap-grid visual ruler | `lcyt-web` (`DskEditorPage.jsx`) | `plan_dsk.md`; two small, unrelated UI additions — could even be two separate agents |
| Admin Phase 3: role-tiered admin access + live-stats dashboard | `lcyt-backend` (`routes/admin.js`) + `lcyt-web` admin page | `plan_admin.md` |
| Device role Phase 4 enhancements | `lcyt-backend` (`db/device-roles.js`) + `lcyt-web` | `plan_userprojects.md` — check with the user first; the plan doesn't specify *what* the enhancements are, only that Phase 4 is future work |
| YouTube stream-status polling in the web client | `lcyt-web` | `plan_client.md`; small, self-contained, no backend change needed if using YouTube's public API directly — confirm auth approach first |
| HLS ffprobe `BANDWIDTH`/`CODECS` detection | `lcyt-rtmp` (`hls-sidecar` / manifest generation) | `plan_hls_sidecar.md`; replaces the hard-coded H.264/AAC default |
| S3 adapter tests against a mock S3 | `lcyt-files` | `plan_files3.md`; needs localstack or a custom HTTP mock — infra decision first |

These are exactly the shape of task that worked well as Haiku subagents this session —
one package, one clear spec, tests included. **Caveat from §0**: if any of these touch
a `package.json`, diff-review it before merging.

---

## Tier 4 — New/draft features (each isolated to a new or rarely-touched package)

Not urgent, but genuinely good parallel candidates *because* they're new surface area
with no existing consumers to break:

| Plan | Package | Status |
|---|---|---|
| `plan_translate.md` — server-side translation plugin | new `lcyt-translate` plugin | Exploratory/not scheduled; zero collision risk with anything else since the package doesn't exist yet |
| `plan_monitors.md` — confidence-only monitoring feeds | likely new plugin | Draft; needs a data-model decision before engineering starts |
| `plan_mixer_feed_sources.md` — encoder/file sources, low-latency preview tiles | `lcyt-production` / mixer code | Draft; generalizes the existing mixer program bus |
| `plan_live_variables.md` — live refresh, operator display, text-block expansion | `lcyt-connectors` + `lcyt-web` | Draft; ideas 2–3 are explicitly "design-pending" — needs a product decision before it's a Tier 3-style task |

These can all run **simultaneously** with each other and with every lane above — none
share a package with anything else in this document.

---

## Tier 5 — Do last, alone: PostgreSQL option

`plan_postgres_option.md` touches the `db/*.js` layer of **every** package
(`lcyt-backend` and every plugin that owns its own tables). It is the one item in this
backlog that cannot be parallelized against anything else, including itself — every
other lane above will be editing schema/migration files in the same packages this
touches. Schedule it only when nothing else in Tiers 1–3 is actively in flight, or
expect merge pain.

---

## Suggested parallel dispatch (right now)

If launching several agents today, this set has no file/package overlap:

- **Lane A** — done, see Tier 1 above; nothing left to dispatch here
- **Lane B** — done, see Tier 1 above; the remaining vertical-crop work (production-follow) is a backend lane, not this frontend one
- **Lane C** — done, see Tier 2 above; the deferred `ConditionTreeEditor`/Named
  Conditions extension is now unblocked by Lane D's backend API but not yet
  dispatched (frontend work — see Lane D's note above for what to build against)
- **Lane D** — done, see Tier 2 above; nothing left to dispatch here
- One or two Tier 3 items from packages not already claimed above (e.g. HLS
  `putObject`/`publicUrl` wiring, or the DSK editor's rotation handle)

Do **not** add a Tier 5 (Postgres) lane to any batch that includes the above.
