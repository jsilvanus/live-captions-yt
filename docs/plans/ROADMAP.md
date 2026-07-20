---
status: reference
summary: "Prioritised way-forward across every plan in docs/PLANS.md, rebuilt 2026-07-20 from a full repo-wide frontmatter/status audit of docs/plans/*.md (every 'implemented' claim verified against actual code) plus five newly drafted plans (plan_broadcast_platform_sync.md, plan_local_stt.md, plan_env_to_ui_settings.md merged via PR #287; plan_video_perception.md — the fps30 tracker/World State plan; and plan_ai_observability.md, split out of plan_video_perception.md the same day so its prompt-sculpting page isn't stuck behind that plan's dependency chain). Organised into tiers — fix the two real bugs the audit surfaced, finish what's genuinely in-progress, schedule the new draft features by value (noting plan_video_perception.md's real sequencing dependency on plan_vertical_crop.md Phase 4, and plan_ai_observability.md's deliberate lack of one), then a long tail of deliberately-deferred residual items — plus concrete non-overlapping lanes for parallel dispatch."
---

# Roadmap — Way Forward

This is not a new plan. It reads `docs/PLANS.md` (the audited index — see there for
per-plan detail and status) and turns it into an ordering: what to do next, and what
can be done *at the same time* by independent agents without merge conflicts.

Re-check `docs/PLANS.md` before acting on this document — it decays as work lands.
Every status below reflects a 2026-07-20 pass that read the actual source for every
`in-progress`/`implemented`-with-"Not done" plan; nothing here is copied from a plan's
own possibly-stale self-description.

**What changed since the previous version of this doc (2026-07-18):** that version's
Tiers 1–3 were a single day's work session, all now shipped (see "Recently closed"
below) — this rewrite drops that play-by-play and rebuilds the backlog from scratch
against current reality, including two real bugs the audit itself surfaced and three
brand-new draft plans (PR #287) not covered by the old version at all.

---

## 0. Operational notes before dispatching parallel agents

Two things surfaced in an earlier multi-agent batch, still worth carrying forward:

1. **`isolation: "worktree"` can silently fail.** Verify a background agent actually
   produced its own worktree (`git worktree list`, check the reported path is
   non-empty and matches) before trusting isolation held. If it didn't, the commit is
   still recoverable (branch it off before resetting `main`) but check this *before*
   running anything destructive in the primary checkout.
2. **Never let an agent replace entries in a package's `"exports"` map — only add.**
   This repo's convention is a small, curated, explicit `exports` map per package (no
   wildcards) — before touching one, `grep -rn "from '<pkg>/` across the whole repo to
   find every existing consumer, and only add.

Both are why the parallel lanes below are grouped by **package/directory ownership** —
two agents editing the same package's shared files (a `package.json`, a composition
root like `server.js`, or in `lcyt-web`'s case a shared page like `SetupHubPage.jsx`)
at the same time is the actual collision risk, not file count.

---

## Recently closed (for context, not action)

The previous version of this document tracked a single 2026-07-18 session in detail:
the cue rules editor + composite condition trees (Phases 9–10 of `plan_cues.md`, PR
#282), the AI bridge-relay vision-adapter wiring (`plan_ai_roles_framework.md`,
`plan_ai_model_registry.md`), the vertical-crop operator UI (`plan_vertical_crop.md`
Phase 3), and seven small Tier-3 gap-closers (`tmp_plan_tier3.md`). All of it shipped
and was verified still-accurate by the 2026-07-20 audit. See `CONSIDER.md` and
`tmp_plan_tier3.md`'s "Implementation notes" for the detail; it's not repeated here.

`plan_vertical_crop.md` Phase 4 (production-follow — `registry.onProgramChanged()`/
`onCameraPresetRecalled()` in `lcyt-production`, `CropManager.applyForSource()` in
`lcyt-rtmp`, a `crop.list_presets`/`crop.activate_preset` AI-tool pair in
`lcyt-tools` wired into the Production Assistant role) and Phase 5 (ops —
`docker/lcyt-ffmpeg/Dockerfile` now builds ffmpeg from source with
`--enable-libzmq`, `PORTS.md`/`docker/mediamtx.yml` docs) landed since the
2026-07-20 audit. **Not done, premise mismatch found:** the plan's `crop_preset`
"named-action/cue" half — `lcyt-actions` is pure storage with all execution
client-side (`packages/lcyt-web/src/lib/metacode-actions.js`), and cue rules'
`action` JSON is descriptive-only, interpreted by the frontend, with no
production-control atom (camera/mixer included) ever wired into either system
today. Implementing it for real needs `lcyt-web` changes explicitly out of scope
for that work session, or a new backend cue-action-dispatcher that doesn't
exist for any action type yet. See `CONSIDER.md`.

`plan_ai_model_registry.md` Phase 3's frontend half (Tier 1, Lane 3) also landed
since the 2026-07-20 audit: `AiRoleModelsSection.jsx`, a new Setup Hub card
(`id="ai-roles"`, mounted alongside `McpAccessSection`/`ConnectorsSection`) that
lets a project pick a configured `ai_providers` row and a model per
`agentic_chat` role, saved through the existing `PUT /roles/:roleCode/config`
route — no backend changes were needed, `GET /ai/providers`/
`GET /ai/providers/:id/models` already existed and worked. This is the real
fold-in of Tier 0's `AiModelsSection.jsx` decision: a genuinely new component,
not a repurposing of that deleted shell. Phase 4 ("deer" runtimes) remains
unscoped, as planned. See `docs/plans/plan_ai_model_registry.md`.

---

## Tier 0 — Fix now: real bugs the audit surfaced

Small, isolated, and each one is a silent-failure mode in shipped code — not a
docs-accuracy issue like the rest of the audit, an actual functional gap. Both are
logged in full in `CONSIDER.md`.

| Item | Where | Why it's Tier 0 |
|---|---|---|
| Recording/VOD never uploads to S3 | `packages/lcyt-backend/src/db/videos.js`, `src/routes/live.js` | `videos.storage_type` is set to `'s3'` whenever S3 is configured, but MediaMTX always writes recordings to local disk and nothing moves them to S3 afterward — an S3-configured deployment 404s on VOD playback today, silently. Fix: either wire an uploader (reuse `lcyt-files`'s S3 adapter or worker-daemon's `createS3UploadFn`) into the recording-finish path, or make `storage_type` correctly reflect "local" until that's built. |
| Dead `AiModelsSection.jsx`/`ai_model_configs` plumbing | `packages/lcyt-web/src/components/setup-hub/AiModelsSection.jsx`, `packages/plugins/lcyt-agent/src/routes/ai-models.js`, `ai_model_configs` table | Looks like it could be `plan_ai_model_registry.md`'s missing Phase 3 frontend but is entirely disconnected from the `ai_providers` registry that plan actually built — `getAiModelConfig()` has zero callers. **Resolved:** deleted whole, then Phase 3's real model-picker UI (`AiRoleModelsSection.jsx`) was built fresh against the actual registry — see "Recently closed" above. |

---

## Tier 1 — Finish what's genuinely in-progress

Every plan below still has real, in-scope, unbuilt work — not a deliberately-deferred
edge case (those are Tier 3). Ordered roughly by value/urgency.

| Plan | What's left | Why it matters |
|---|---|---|
| `plan_ai_roles_framework.md` | Frontend chat panel + a `useGuidedAction` primitive for the Setup Assistant and Asset Control Assistant roles (Planner and Graphics Editor Assistant already have theirs — `AgentChatPanel` is shipped for 2 of 5 `agentic_chat` roles, not all 5) | Backend (`POST /roles/:roleCode/message`) is identical and already built for all three chat-dialog roles; this is pure `lcyt-web` frontend work, mounting into `SetupHubPage.jsx`/`AssetsPage.jsx`. Translation role remains a flagged, unspec'd future gap — needs a short design pass before it's even schedulable, not urgent. |
| `plan_ui.md` | Context-aware layout modes, detachable/pop-out panels, mobile-first caption-flow redesign, workflow presets, DSK metacode autocomplete, localStorage quota monitoring, onboarding auto-trigger (`lcyt:onboarded` flag) | Real but lower-urgency UX polish on an otherwise-mature `lcyt-web`. Good filler work between the higher-value items above; each sub-item is independently schedulable. |

---

## Tier 2 — New draft features, ranked by value

Three brand-new plans landed via PR #287 (merged 2026-07-20), plus `plan_video_perception.md`
and `plan_ai_observability.md` (drafted the same day, the latter split out of the
former — see below) and two pre-existing drafts. None have any code yet, so zero
collision risk with Tier 0/1 work above — but `plan_broadcast_platform_sync.md`,
`plan_env_to_ui_settings.md`, and `plan_video_perception.md` are each big enough to
deserve their own phase-plan pass (`/phase-planning`) before dispatch, not a single
one-shot lane.

| Plan | Value | Scope note |
|---|---|---|
| `plan_broadcast_platform_sync.md` | **High** — closes `plan_broadcasts.md`'s biggest explicitly-out-of-scope gap (YouTube two-way sync), which is the most-requested-shaped missing piece in the whole broadcasts feature | New `lcyt-platforms` plugin + server-side OAuth (replacing the current browser-only implicit-token flow in `youtubeAuth.js`/`youtubeApi.js`/`YouTubeTab.jsx`) + `lcyt-web` broadcast UI. Facebook Live is explicitly deferred within this same plan — don't scope it in. |
| `plan_env_to_ui_settings.md` | **Medium-high** — ops/quality-of-life; makes ~130 env-var-only settings admin-editable without redeploying, closes a real operability gap for self-hosted deployments | New `server_settings` table + declarative registry/service + Admin UI tab, additive by design (env > DB > default precedence keeps 12-factor deployments untouched). Mostly isolated to `lcyt-backend` config plumbing + one new Admin page; low collision risk with Tier 1 work. |
| `plan_video_perception.md` | **High but large** — the fps30 tracker subsystem `plan_cues.md` has anticipated (and left an inert consumer contract for) since before this doc existed, plus a World State fusion service; the biggest single scope item in this tier | New per-camera CV pipeline (deploys as a new job type on the existing `lcyt-orchestrator`/`lcyt-worker-daemon`, not a new ops story) + World State service + camera/preset metadata. Its shared/single-feed camera handling needs `plan_vertical_crop.md` Phase 4's `onProgramChanged`/`onCameraPresetRecalled` callbacks — **now implemented** (`lcyt-production`'s `DeviceRegistry`), so this plan's Phase 3 (shared-feed resolver) is unblocked; the callbacks are still plain setter-injected listeners, not real EventBus events, so a second consumer here should still weigh promoting them per that plan's §4 note. Its Phase 1 (schema + camera metadata + World State skeleton, no perception producer) has no dependency either way and can start immediately. |
| `plan_ai_observability.md` | **Medium, high leverage-per-effort** — the prompt-sculpting/debug page, split out of `plan_video_perception.md` specifically so it isn't stuck behind that plan's dependency chain | Genuinely startable now: Stage 1 (live overlay + capture/replay + prompt sandbox) works against the already-implemented Tracker/Describer roles, no new dependency. Stage 2 (true multi-camera grid) needs `plan_ai_roles_framework.md`'s camera-scoping amendment (Tier 1). Stage 3 (extend to `camera.track_state`) needs `plan_video_perception.md` Phase 2. Small enough to skip the phase-planning-first recommendation given to the three larger Tier 2 items above. |
| `plan_mixer_feed_sources.md` | Medium — niche production feature (looping-file mixer source + WHEP low-latency preview tiles) | `lcyt-production`/mixer code; its former 'encoder' source type is already covered by the implemented `plan_ingest_feeds.md`, so scope is smaller than the plan's original draft. May overlap `plan_vertical_crop.md` Phase 4's mixer-registry callbacks — check before running both at once. `plan_video_perception.md`'s observability page also wants this plan's WHEP preview-tile work as its video source — a second reason to land this one earlier rather than later in the tier. |
| `plan_local_stt.md` | Depends on appetite — large, standalone infra investment (containerized faster-whisper server, Finnish fine-tuning pipeline, dependency on the separate `crowd-source-voice` platform for training data) | Self-contained new service (`lcyt-stt`), integrates via the *unchanged* `WhisperHttpAdapter`, so it's zero-risk to schedule alongside anything else — but confirm there's actually a Finnish-STT-quality driver before investing in the training pipeline half; the inference-server half alone may be worth doing independently of the training half. |

---

## Tier 3 — Residual "Not done" items on already-implemented plans

Deliberately deferred, scoped, or genuinely low-priority — pick these up
opportunistically, none of them block anything else. Grouped by rough theme.

**Auth/broadcasts follow-ups:**
- `plan_authentication_refactor.md` — UI adoption of user JWTs on project-scoped routes (the frontend still gets its bearer token via `POST /live`, not a direct user-JWT path).
- `plan_broadcasts.md` — recurrence/RRULE, automated pre-broadcast asset checks (YouTube two-way sync itself is now covered by Tier 2's `plan_broadcast_platform_sync.md`, not listed twice here).
- `plan_selfservice_config_backend.md` — `PATCH /ingestion/dsk` is a deliberate 501 until a real DSK-ingest gate is designed.
- `plan_recording_vod.md` — phase 2, the worker-daemon ffmpeg recorder behind a swappable interface (the S3-upload half of this gap is Tier 0, not here).

**Frontend/UX long tail:**
- `plan_dsk_viewport_settings.md` — slug migration for `/video`/`/radio`/`/preview`/viewer embeds/Android TV links, per-device display settings via device roles, URL/iframe template layer type.
- `plan_live_variables.md` — start-of-file pointer triggers don't fire when the pointer is restored to a later line; constant-poll aggregate concurrency cap; caption-based `c` TTL enforcement.
- `plan_web_ui_event_stream_consolidation.md` — optional Phase B (fold the caption session `/events` stream and `/stt/events` onto the shared hook).
- `plan_server_stt.md` — live-operate-surface source-language quick-toggle (outside Setup Hub).
- `plan_unified_external_control.md` — no web UI consumes `/operator/*` (the Hosted Operator) yet; it's API-only today.
- `plan_profile_team_admin_reconciliation.md` — per-category "team defaults" pull-down, deliberately deferred to its own future plan.

**Deliberately deferred by product decision (don't start without checking first):**
- `plan_userprojects.md` — QR code generation for device PINs, tally-light display.
- `plan_batch_options.md` — client-side early flush guard for the 64 kB payload limit (skipped until limits are ever actually hit).
- `plan_cloudfleet.md` — Helm chart, Litestream, Postgres migration (overlaps Tier 4 below), CI CFCR push, native K8s Jobs runner.
- `plan_files3.md` — a `cdn_url` config field (low value).
- `plan_agent.md` — Phase 7 multi-modal scene understanding (same subsystem `plan_cues.md` also excludes; no active driver yet).

---

## Tier 4 — Do last, alone: PostgreSQL option

`plan_postgres_option.md` touches the `db/*.js` layer of **every** package
(`lcyt-backend` and every plugin that owns its own tables). It is the one item in this
backlog that cannot be parallelized against anything else, including itself — every
Tier 1–3 lane above will be editing schema/migration files in the same packages this
touches. Schedule it only when nothing else is actively in flight, or expect merge pain.

---

## Explicitly deferred — do not build without a fresh trigger

- `plan_mcp_oauth.md` — reference design for LCYT as its own OAuth 2.1 authorization
  server. Nothing built, nothing should be, until a specific hosted-MCP-client
  integration is actually requested; `mcp_tokens` already covers the near-term audience.
- `plan_translate.md`'s remaining API/generic-client server-translation gap — the
  STT half of its original motivation was already closed by `plan_server_stt.md`
  Phase 5's `translate-server.js` mechanism. What's left (`POST /captions` from
  CLI/API/generic clients gets zero server-side translation) is real but has no
  known driver; don't revive this doc's specific standalone-plugin architecture
  without checking whether a lighter fix (reusing `translate-server.js` from the
  generic-client route too) covers it instead.

---

## Suggested parallel dispatch (right now)

Non-overlapping lanes, grouped by package ownership per §0:

- **Lane 1 (isolated, small):** Tier 0's recording/S3 bug — `lcyt-backend`
  (`db/videos.js`, `routes/live.js`) + `lcyt-files` S3 adapter reuse.
- **Lane 2 (auth-sensitive, `lcyt-backend`):** `plan_team_org_backend.md`'s
  `getEffectiveProjectAccessLevel()` resolver — **done.** Landed on
  `middleware/project-access.js`, `routes/project-features.js`,
  `routes/device-roles.js`, `routes/project-slug.js`,
  `routes/project-observability.js`, and `routes/auth.js`'s
  `POST /auth/project-token`, plus the `api_keys.restricted` escape-hatch column.
- **Lane 4 (`lcyt-web`, Setup Hub / Assets — chat panels):** Tier 1's
  `plan_ai_roles_framework.md` Setup/Asset Assistant frontend. Lane 3 (the AI
  model picker, `plan_ai_model_registry.md` Phase 3 frontend) already landed —
  confirm `SetupHubPage.jsx`'s "AI & integrations" section ordering against the
  now-mounted `AiRoleModelsSection.jsx` before adding these chat panels there.
- **Lane 7 (new package, isolated):** Begin `plan_broadcast_platform_sync.md` with a
  `/phase-planning` pass first — it's too big for a single-shot dispatch.
- **Lane 8 (new package, isolated):** Begin `plan_env_to_ui_settings.md` similarly —
  phase-plan first, then dispatch.
- **Lane 9 (`lcyt-agent` + new tables, isolated):** `plan_video_perception.md`
  Phase 1 (schema + camera metadata + World State skeleton, no perception
  producer yet), and now also Phase 2/3 (the fps30 producer + shared-feed
  resolver) — their dependency on `plan_vertical_crop.md` Phase 4's
  `onProgramChanged`/`onCameraPresetRecalled` callbacks is satisfied, that
  phase has landed (see "Recently closed" above).
- **Lane 10 (`lcyt-web` + `lcyt-agent`, isolated):** `plan_ai_observability.md`
  Stage 1 (live overlay + capture/replay + prompt sandbox against today's
  Tracker/Describer) — no dependency on any other lane here, can start immediately
  and in parallel with Lane 9. Don't start its Stage 2/3 yet (camera-scoping and
  `plan_video_perception.md` Phase 2 dependencies respectively).

Do **not** add a Tier 4 (Postgres) lane to any batch that includes the above.
