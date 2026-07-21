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

`plan_env_to_ui_settings.md` (former Tier 2 Lane 8) shipped in full 2026-07-21:
`server_settings` table + declarative registry (`src/settings/registry.js`,
~105 entries, cross-checked against every actual read site rather than the
drifting CLAUDE.md tables — several defaults/env-var names were wrong or
missing and got fixed along the way) + `SettingsService` + admin API + Admin →
Server UI tab, then call-site migration across `lcyt-backend` itself,
`lcyt-files`, `lcyt-music`, `lcyt-rtmp`, `lcyt-dsk`, `lcyt-production`'s
`MediaMtxClient`, and `lcyt-agent`'s embedding functions. `RTMP_RELAY_ACTIVE`/
`MUSIC_DETECTION_ACTIVE` route gates and CEA-708 caption timing are genuinely
hot now (DB write takes effect with no restart, verified end-to-end). Also
surfaced and fixed a real pre-existing bug: `computeEmbeddings`'s credential
vs. project-apiKey collision in cue semantic matching (a project's api_key
was being sent as the embeddings API bearer token). **Not done:** two small,
newly-discovered settings (`VISION_PREVIEW_BASE_URL`, `CAMERA_PREVIEW_BASE_URL`/
`CAMERA_THUMBNAILS_DIR`) are registered but not yet wired — see `CONSIDER.md`.
Full monorepo test sweep (`npm test`, all 18 Node.js workspaces) passes.

`plan_ai_roles_framework.md`'s remaining Tier 1 item (former Lane 4) shipped
2026-07-21: `useGuidedAction.jsx` (`GuidedActionProvider`/
`useGuidedActionTargets`/`useGuidedActionDispatcher`, `lcyt-web/src/hooks/`)
implements the dialog-driving primitive the plan specced but never built, and
`RoleAssistantPanel.jsx` (`POST /roles/:roleCode/message` wired to
`<AgentChatPanel>`) is now mounted for `setup_assistant` in `SetupHubPage.jsx`
and `asset_control_assistant` in `AssetsPage.jsx`, each wrapped in a
`GuidedActionProvider`. `CaptionTargetsManager`/`CamerasManager`/
`MixersManager` each gained `openAddPrefilled`/`openEditPrefilled`/
`openDeleteConfirm` on their existing `useImperativeHandle`, registered by
their Setup Hub section components — a `confirm`-mode staged tool call now
opens the real Add/Edit/Delete dialog pre-filled, and the human still clicks
that dialog's own submit button. **Not done:** Asset Control Assistant's
tools (`asset.update`/`asset.delete`) target `lcyt-dsk`'s image-asset
library, which `AssetsPage.jsx` renders no dialog for — a real page-ownership
question (should it move to `DskEditorPage.jsx`'s Media Library, or should
`AssetsPage.jsx` grow one?), not a build gap; see `CONSIDER.md`. Full
`packages/lcyt-web` test sweep passes (447 Vitest + 461 node:test).

`plan_ui.md`'s remaining backlog also cleared out 2026-07-21, item by item,
each re-audited against actual current code before touching anything (not
just implemented off the original, sometimes-stale proposal text):
onboarding auto-trigger (`OnboardingBanner.jsx` + `lib/onboarding.js`, a
dismissible per-project nudge rather than the originally-sketched blocking
wizard, since `/setup/wizard` already exists as a fuller flow); localStorage
quota monitoring (`StorageQuotaMonitor.jsx` + `lib/storageQuota.js`, periodic
`navigator.storage.estimate()` checks rather than a per-write gate, since no
browser API can intercept an individual `localStorage.setItem()` call); the
DSK metacode autocomplete helper (`lib/metacodeAutocomplete.js` +
`hooks/useDskMetacodeSources.js`, wired into `InputBar.jsx` — corrected the
proposal's "template names" to image shorthand names, the thing
`graphics:` actually resolves against); context-aware layout modes (its
premise was superseded by the sidebar routing model — 4 of 5 rows were
already true; the one real gap, a Production caption input, closed via a new
`captionInput` pane type); detachable/pop-out panels (`PopOutButton.jsx`,
wired to the Sent Captions panel via the already-existing `/embed/*`
`BroadcastChannel` infrastructure, now also broadcast by the main
`SidebarApp` not just `/embed/*` pages); and the mobile-first caption flow's
actual gap — re-auditing found the file viewer was never hidden on mobile,
only the free-text input was (`#footer` was unconditionally hidden below
768px) — fixed with a ⌨ toggle on `MobileAudioBar.jsx` that reveals the same
`InputBar` instance rather than a swipeable-card rebuild. Only workflow
presets (named localStorage config bundles) remains open in this plan.

`plan_ai_observability.md` Stage 1 (Lane 10) also landed since the 2026-07-20
audit: a bounded 20-entry-per-`(apiKey,roleCode)` capture ring buffer in
`VisionRoleManager`, three new routes (`GET /roles/:roleCode/captures[/:id/frame]`,
`POST /roles/:roleCode/captures/:id/replay` — the prompt sandbox, never
persisted to `harness_config`), and a gated `/admin/ai-observability` page
(live canvas overlay over the polled preview feed off `role.tracker.*`/
`role.describer.*` on `/events/stream`, capture browser, replay/diff sandbox).
Stages 2/3 remain exactly as scoped below (still blocked on the same
dependencies). See `docs/plans/plan_ai_observability.md`.

`plan_video_perception.md` (Lane 9) also landed since the 2026-07-20 audit — all
three phases, across two work sessions (Phase 1 dispatched to a Haiku subagent per
`tmp_plan_video_perception.md`'s own recommendation; Phases 2-3 implemented directly
given Phase 2 Stream A's process-boundary decision and the cross-package wiring
benefited from one continuous context). Camera/preset metadata (`label`/`zone`/
`overlap_links` on `prod_cameras`) and a World State snapshot service
(`GET /scene/state`, `lcyt-agent`); a new `type: 'perception'` job on
`lcyt-worker-daemon` (swappable runner interface, one implementation — a
deterministic stub detector, no real CV model, a deliberate scope cut written down
in `lcyt-worker-daemon/src/perception/runner.js`'s module doc) dispatched via
`lcyt-production`'s `perception-manager.js` reusing `FFMPEG_RUNNER=worker`'s exact
`ORCHESTRATOR_URL`/`WORKER_DAEMON_URL` knobs; an aggregator
(`lcyt-backend/src/perception-aggregator.js`) producing both the cue engine's
long-inert `track_state` contract (now genuinely fires — `lcyt-cues`'s
`_attachTrackerListener()` needed no changes) and per-camera `camera.track_state`
for World State; and a shared-feed resolver for mixer-input-only cameras, consuming
`DeviceRegistry`'s existing `onProgramChanged`/`onCameraPresetRecalled` plain
callbacks directly rather than promoting them to an EventBus topic first (that
promotion idea was weighed and explicitly skipped, not just deferred — see the
phase-plan doc's implementation notes for why). One real review finding from Phase
1: the Haiku agent's `SceneState` used a hidden module singleton instead of this
codebase's DI convention (managers constructed once in `initAgent()`, threaded
through explicitly) — caught and fixed before merge, not by tests (both patterns
pass tests fine). See `docs/plans/tmp_plan_video_perception.md`'s "Implementation
notes" for the full record and `docs/plans/plan_video_perception.md`'s frontmatter
for the one remaining "Not done" (the CV model).

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
| `plan_ai_roles_framework.md` | **Done, 2026-07-21** — `RoleAssistantPanel.jsx` + `useGuidedAction.jsx` shipped, mounted in `SetupHubPage.jsx`/`AssetsPage.jsx`. Only remaining gap: Asset Control Assistant's tools have no dialog on `AssetsPage.jsx` to drive (page-ownership question, see CONSIDER.md), not a build gap. | — |
| `plan_ui.md` | **Done except workflow presets, 2026-07-21** — onboarding auto-trigger, localStorage quota monitoring, DSK metacode autocomplete, context-aware layout modes, detachable/pop-out panels, and the mobile-first caption flow's core functional gap all shipped this pass. Only workflow presets (named localStorage config bundles) remains. | — |

---

## Tier 2 — New draft features, ranked by value

Three brand-new plans landed via PR #287 (merged 2026-07-20), plus `plan_video_perception.md`
and `plan_ai_observability.md` (drafted the same day, the latter split out of the
former — see below) and two pre-existing drafts. None have any code yet, so zero
collision risk with Tier 0/1 work above — but `plan_broadcast_platform_sync.md`
and `plan_video_perception.md` are each big enough to deserve their own phase-plan
pass (`/phase-planning`) before dispatch, not a single one-shot lane.
(`plan_env_to_ui_settings.md`, the third plan this note used to name, shipped
2026-07-21 — see "Recently closed".)

| Plan | Value | Scope note |
|---|---|---|
| `plan_project_roles.md` | **High, security-relevant** — replaces the flat org-baseline `member` role `plan_team_org_backend.md` shipped with a real owner/admin/editor/viewer tier system and page-scoped write gates (Setup=admin-only, Assets=editor+); an interim fix already closed the one concrete credential-minting gap (`/mcp-tokens`, `/ai/providers`), but every other Setup-shaped route (dsk, connectors, production/rtmp CRUD, targets, stt config, ...) still only has the broad baseline gate | Two open product decisions block starting (see the plan's "Open questions"): whether `project_members.access_level` literally unifies to the new vocabulary or stays parallel, and whether Production/live-operate needs its own 5th `operator` role — don't start without those answered first, per the plan's own recommendation. |
| `plan_broadcast_platform_sync.md` | **High** — closes `plan_broadcasts.md`'s biggest explicitly-out-of-scope gap (YouTube two-way sync), which is the most-requested-shaped missing piece in the whole broadcasts feature | New `lcyt-platforms` plugin + server-side OAuth (replacing the current browser-only implicit-token flow in `youtubeAuth.js`/`youtubeApi.js`/`YouTubeTab.jsx`) + `lcyt-web` broadcast UI. Facebook Live is explicitly deferred within this same plan — don't scope it in. |
| `plan_env_to_ui_settings.md` | **Medium-high** — ops/quality-of-life; makes ~130 env-var-only settings admin-editable without redeploying, closes a real operability gap for self-hosted deployments | New `server_settings` table + declarative registry/service + Admin UI tab, additive by design (env > DB > default precedence keeps 12-factor deployments untouched). Mostly isolated to `lcyt-backend` config plumbing + one new Admin page; low collision risk with Tier 1 work. |
| `plan_video_perception.md` | **Done** — the fps30 tracker subsystem `plan_cues.md` anticipated, plus a World State fusion service and camera/preset metadata, all shipped 2026-07-20/21 (see "Recently closed" below). Only the real CV model itself remains unbuilt, a deliberately deferred follow-on. | ~~New per-camera CV pipeline...~~ shipped: `type: 'perception'` jobs on `lcyt-worker-daemon` (dispatched via `lcyt-orchestrator`/`WORKER_DAEMON_URL`, the same knobs `FFMPEG_RUNNER=worker` uses) + World State (`lcyt-agent`) + camera/preset metadata (`lcyt-production`) + a shared-feed resolver consuming `DeviceRegistry`'s existing `onProgramChanged`/`onCameraPresetRecalled` callbacks directly (the EventBus-promotion idea from the previous version of this row was weighed and skipped — see `tmp_plan_video_perception.md`'s implementation notes). |
| `plan_ai_observability.md` | **Medium, high leverage-per-effort** — the prompt-sculpting/debug page, split out of `plan_video_perception.md` specifically so it isn't stuck behind that plan's dependency chain | **Stage 1 done** (Lane 10, live overlay + capture/replay + prompt sandbox against the already-implemented Tracker/Describer roles — see "Recently closed" above). Stage 2 (true multi-camera grid) needs `plan_ai_roles_framework.md`'s camera-scoping amendment (Tier 1). Stage 3's dependency (`plan_video_perception.md` Phase 2's `camera.track_state`) is now satisfied — unblocked, but note today's `camera.track_state` comes from a stub CV backend, not a real model; weigh whether Stage 3 is worth building against that yet. |
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
- **Lane 4 — done.** Tier 1's `plan_ai_roles_framework.md` Setup/Asset
  Assistant frontend shipped 2026-07-21: `RoleAssistantPanel.jsx` +
  `useGuidedAction.jsx`, mounted in `SetupHubPage.jsx`/`AssetsPage.jsx` —
  see "Recently closed" below.
- **Lane 7 (new package, isolated):** Begin `plan_broadcast_platform_sync.md` with a
  `/phase-planning` pass first — it's too big for a single-shot dispatch.
- **Lane 8 — done.** `plan_env_to_ui_settings.md` shipped 2026-07-21, all six
  phases — see "Recently closed" below.
- **Lane 9 (`lcyt-production` + `lcyt-agent` + `lcyt-worker-daemon` + `lcyt-backend`,
  isolated):** `plan_video_perception.md` — **all three phases done** (2026-07-20/21,
  see "Recently closed" below). `plan_video_perception.md`'s frontmatter now carries
  the one remaining "Not done": the fps30 runner's CV backend is a deterministic stub,
  no real model integrated.
- **Lane 10 (`lcyt-web` + `lcyt-agent`, isolated):** `plan_ai_observability.md`
  Stage 1 — **done** (live overlay + capture/replay + prompt sandbox against
  today's Tracker/Describer; see "Recently closed" above). Stage 3's dependency
  (`plan_video_perception.md` Phase 2's `camera.track_state`) is now satisfied, so
  Stage 3 is unblocked — but note it'd extend the overlay to a stub-backend signal
  today, not a real one; weigh whether that's worth building yet. Stage 2 still
  needs camera-scoping (Tier 1).

Do **not** add a Tier 4 (Postgres) lane to any batch that includes the above.
