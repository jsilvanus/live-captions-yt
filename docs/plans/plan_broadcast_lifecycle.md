---
id: plan/broadcast_lifecycle
title: "Broadcast lifecycle — a broadcast with its own states, decoupled from the caption session"
status: draft
summary: "Findings on what 'broadcast' means in the code today (a database row whose status is driven almost entirely by the caption session) and a plan to make it the thing that owns a go-live: states draft, scheduled, staging, live, stopping, stopped, completed, archived (plus cancelled), explicit transitions, a Production pane to drive them, and a list of components it starts and stops (outputs from plan_egress_outputs, recording, YouTube staging and go-live, arming, captions). The caption session becomes a participant that can join and leave without ending the broadcast. Revised 2026-10-19 after Juha's answers. Plan only; nothing is built."
related: plan/broadcasts, plan/broadcasts_next, plan/broadcast_platform_sync, plan/egress_outputs, plan/recording_vod, plan/backend_actions
---

# Broadcast lifecycle (plan, revised 2026-10-19)

Status: draft, revised after Juha's answers (section 6). Docs only, no code. Nothing here has been run against a real MediaMTX, fleet or YouTube; claims about current behaviour are from reading `main` at `c8bffb7`.

## 1. What a "broadcast" is today

A broadcast is a row in `broadcasts` plus side tables and columns that point at it. It is a **record that a caption session writes into**, not an object that runs anything.

### 1.1 Data model

| Piece | Where | What it holds |
|---|---|---|
| `broadcasts` | `prisma/schema.prisma:325`, `src/db/schema.js:410` | `id`, `api_key`, `title`, `description`, `status` (`draft|scheduled|live|completed|archived`), `scheduled_start/end`, `actual_start/end`, `youtube_video_ids` (JSON), `youtube_broadcast_id` (legacy mirror), `rundown_file_id`, `record_enabled`, `privacy_status`, `armed`, `archived_at` |
| `broadcast_assets` | schema:265 | N:M links to reusable graphics, cues, actions, icons, targets, rundown |
| `broadcast_files` | schema:278 | N:M pins of caption files (planner rundowns) |
| `broadcast_platform_links` | schema:291 (`lcyt-platforms`) | the external YouTube broadcast: `external_broadcast_id`, `external_stream_id`, `credential_id`, `last_status`, `last_sync_error`; unique on `(broadcast_id, platform)` |
| `broadcast_platform_stats` | schema:312 | live viewer snapshots and the post-broadcast summary |
| `api_keys.active_broadcast_id` | schema:150 | the "active" pointer: which broadcast the operator is curating (not the same as live) |
| `sessions.broadcast_id`, `session_stats.broadcast_id`, `caption_files.broadcast_id` | schema:976, 962, 395 | produced content attaches back to the broadcast |
| `videos.broadcast_id`, `handoffs.broadcast_id` | schema:1110, 1145 | recordings and the Saarnavideo handoff hang off the broadcast |

### 1.2 How status changes today

Statuses are driven by the **caption session**, not by anything the broadcast owns:

- `POST /api/v1/live` (`routes/live.js:124`) takes an optional `broadcastId`. With one, `bindSessionStart` (`db/broadcasts.js`) moves a `draft|scheduled` broadcast to `live` and rejects with 409 when it is already `live`. Without one, `autoCreateForSession` creates a new `live` broadcast titled `Broadcast <timestamp>`.
- The same request then calls `armOnGoLive`, starts a recording group when `record_enabled` (or a relay slot has `recordOnStart`), and stamps `session.broadcastId`.
- Session end moves the broadcast to `completed` (`disarmOnEnd`, then `completeBroadcast`: stamps `actual_end`, clears `armed`). That happens in `DELETE /live` (`routes/live.js:~495`) and in the TTL path, `store.onSessionEnd` in `server.js:~645`. `SESSION_TTL` defaults to 2 hours of idleness.
- `PUT /broadcasts/:id` accepts any valid `status` value, so the Production header's status select (`useProductionData.setBroadcastStatus`) can set `live` or `completed` with no session, no recording and no platform call behind it.
- YouTube go-live and end (`lcyt-platforms` `POST /broadcasts/:id/platforms/youtube/go-live|end`) change `broadcast_platform_links.last_status` and publish `platform.status_changed`. They do **not** change `broadcasts.status`. The route has a `startSession` hook, deliberately left `null` in `server.js` because the browser makes the second call itself.

### 1.3 Routes and consumers

- Routes: `routes/broadcasts.js` (CRUD, `active`, `activate`, restore, duplicate, files, assets), `lcyt-platforms/src/routes/broadcast-platforms.js` (schedule, thumbnail, go-live, end, stats), `routes/arming.js`, `routes/handoff.js`, `routes/videos.js`. Mounted in `routes/content.js:62-64` behind `scoped('broadcast')`.
- `arming.js`: the ARMED/SAFE flag lives on the project's `live` broadcast, else its active one. Cue-triggered device actions (`lcyt-actions` `cue-dispatcher.js`) check it.
- Recording: `recording/feeds.js` creates one recording group per broadcast; `finalizeVideoRecording` and `HANDOFF_AUTO_SEND` run from the session-end path.
- Frontend: `BroadcastsManager.jsx` (`/broadcasts`), `BroadcastPlatformPanel.jsx` (schedule/thumbnail/Go live/End/stats), `BroadcastsSection.jsx` (activate toggle on the project summary), `useActiveBroadcast.js` and the top bar chip, `PlannerBroadcastFilePanel.jsx`, `DskBroadcastAssetPanel.jsx` (pin graphics to the active broadcast), `AssetsPage.jsx` card, the Production header chip and status select, `BroadcastPage.jsx` (`/broadcast`: Live and Settings tabs; the operator console, unrelated to the entity despite the name).
- Name collisions that are **not** the entity: `POST /dsk/:key/broadcast` and the MCP tool `broadcast_dsk_data` (push live graphics data), `broadcastToViewers` (SSE fan-out), `BroadcastChannel` (browser embed sync), `broadcastTallyUpdated`. Keep these out of any rename.

### 1.3b What exists for graphics

`broadcast_assets` with `asset_type='graphic'` already links DSK templates to a broadcast, in any non-archived state, through `POST /broadcasts/:id/assets`; `DskBroadcastAssetPanel.jsx` shows pinned state on the DSK Control page. What is missing is the filter: the template lists (DSK Control grid, DSK editor list, Assets card) always show every template.

### 1.4 Gaps and bugs found while reading

1. **No client binds a broadcast.** `BackendCaptionSender.start()` and `useSession.connect()` never send `broadcastId` (grep over `packages/lcyt` and `packages/lcyt-web`). Every browser connect auto-creates a new `Broadcast <timestamp>` row, and a planned broadcast never goes `live` from the UI. The activate pointer is not consulted by `POST /live` either.
2. **`youtube_video_ids` is never written.** `completeBroadcast` is passed `session.youtubeVideoIds`, and nothing assigns that property (only reads in `live.js:509` and `server.js:666`). The Assets and Broadcasts pages always see an empty list. The YouTube video id is available from `broadcast_platform_links.external_broadcast_id` (for YouTube the live broadcast id is the video id).
3. **The caption session ends the broadcast.** A disconnect, a network drop longer than `SESSION_TTL`, or closing the tab completes the broadcast and its recording even though the stream is still on air. The next connect starts a *new* broadcast.
4. **Statuses can be set to `live` by hand** (`PUT status`), producing a broadcast marked live with no stream behind it, after which `bindSessionStart` refuses the real session (409).
5. **Relay, DSK renderer, crop and STT are independent of the broadcast.** `PUT /stream/active` turns the relay on and off for the project; nothing starts or stops it with a broadcast.
6. **Schedule is data only.** Nothing reads `scheduled_start`. Time zone is whatever string the client sent.
7. **The caption sequence belongs to the project key, not the broadcast.** The counter lives in `api_keys.sequence` (reset only after 2 hours of inactivity, `db/sequences.js`) and is copied into each session and each YouTube sender; the client may pass its own `sequence` to `POST /live`. A broadcast therefore starts at whatever number the last one left, and two sessions on one broadcast would each count on their own.
8. **Clock sync happens once.** `sender.sync()` runs at session start and on a manual `POST /sync`; nothing repeats it, so the offset goes stale during a long broadcast.
9. **Two places complete a broadcast** (`DELETE /live`, `onSessionEnd` TTL) and they are copies of each other.

## 2. Target model

**A broadcast is the unit of going on air.** It owns a lifecycle and a list of components it brings up and down. The caption session is a component that attaches to a broadcast that is already staged or live, and leaving it (or the tab closing) does not end anything.

### 2.1 States (Juha's definitions, 2026-10-19)

```text
draft ──► scheduled ──► staging ──► live ──► stopping ──► stopped ──► completed ──► archived
  │          │            ▲  │                              │
  │          │            │  └──(abort)──► stopping         │
  │          │            └──────────── go up again ─────────┘
  └──────────┴─► cancelled ──► archived        (cancelled: from draft or scheduled only)
```

| State | Meaning | What the system does |
|---|---|---|
| `draft` | Being planned. Graphics (and cues, actions, files) can be assigned to this existing broadcast. | Nothing runs. Assets link as today. |
| `scheduled` | We have a time (`scheduled_start`, optional `scheduled_end`). **No auto-start and no auto-end yet**; the time is information and drives what the control pane suggests. | Nothing runs. |
| `staging` | "We will send signal to YouTube." | Outputs on, YouTube broadcast created or reused and its stream key bound, ingest from us reaches YouTube. YouTube is in its test state, not public. Caption sessions may bind. |
| `live` | "YouTube goes live." | YouTube transition to live, recording starts, arming on, caption clock synced now and then. |
| `stopping` | "We are going down." | Transient: disarm, recording finalized, outputs off. |
| `stopped` | "We are down. We can still go up." | Outputs off, the YouTube broadcast is **not** completed, so staging again resumes the same broadcast. |
| `completed` | "We are done." | YouTube broadcast completed, post-broadcast summary, `youtube_video_ids`, handoff, sessions closed, `actual_end`. Final. |
| `archived` | "We have archived everything, including statistics." | Existing soft delete: hidden from lists, kept with its platform stats, hard delete only after the cooling-off window. |
| `cancelled` | Was a draft or scheduled broadcast that will not run. | Kept for history; can go to `archived`, or back to `draft`. |

Existing values (`draft|scheduled|live|completed|archived`) keep their meaning; `staging`, `stopping`, `stopped`, `cancelled` are additive (the column is free text). **`PUT /broadcasts/:id` no longer takes `status`.** All changes go through transition endpoints (section 2.4).

Transition table (anything else is 409):

| From | To | Trigger |
|---|---|---|
| `draft` | `scheduled` | a start time is set |
| `scheduled` | `draft` | the start time is cleared |
| `draft`, `scheduled` | `staging` | operator presses Stage (a time is not required) |
| `draft`, `scheduled` | `cancelled` | Cancel |
| `cancelled` | `draft`, `archived` | Restore, Archive |
| `staging` | `live` | Go live |
| `staging` | `stopping` | Abort |
| `live` | `stopping` | Stop |
| `stopping` | `stopped` | automatic when the steps finish |
| `stopped` | `staging` | Go up again |
| `stopped` | `completed` | Complete |
| `completed`, `draft`, `scheduled` | `archived` | Archive (also `cancelled`, above); refused in `staging|live|stopping|stopped` |

At most **one broadcast per project is in `staging|live|stopping|stopped`** at a time. A second Stage answers 409 with the other broadcast's id. Landscape plus vertical, or several YouTube channels, are outputs of one broadcast (egress plan).

### 2.2 New fields on `broadcasts` (additive, nullable or defaulted)

| Field | Purpose |
|---|---|
| `origin` | `planned` \| `adhoc` (auto-created for a legacy client) \| `platform` (imported from YouTube, later) |
| `timezone` | IANA name for display; stored times stay UTC ISO |
| `state_changed_at`, `stage_report_json` | when the last transition happened and the per-step result of the latest staging/stop, so a retry resumes instead of repeating |
| `stop_reason`, `last_error`, `warnings_json` | why it went down, what failed, non-fatal step failures |
| `started_by`, `stopped_by` | user id or `session` |
| `caption_sequence` (int, default 0) | the broadcast's caption sequence counter (2.5b) |
| `sync_offset_ms`, `last_synced_at`, `sync_failures` | latest caption clock offset, when it was measured, consecutive failures |

`record_enabled`, `armed`, `privacy_status`, `youtube_*` stay. `actual_start` is set the first time it goes `live`; `actual_end` when `completed`. A `stopped` then `live` again keeps the first `actual_start`.

New join table, **PR 5**, after the egress plan's `outputs` table exists: `broadcast_outputs(broadcast_id, output_id, enabled, sort_order)`.

### 2.3 Deliverables and steps

**What a broadcast must produce (Juha, answer 4).** Staging is refused, with a pre-flight error, unless at least one of these is configured, and each configured one is brought up:

1. **Captions**, either created in LCYT (STT, or a caption session) or sent (an enabled caption target: YouTube, viewer, generic).
2. **Video feed out** (a DSK output alone is enough).
3. **Audio feed out.**

A pure function `deliverables(db, broadcast)` computes the set. Before PR 5 it reads project-level config (enabled caption targets, active relay slots, DSK viewports, STT config); from PR 5 it reads `broadcast_outputs` plus caption targets.

**Steps per transition** (each idempotent, each records `{ status, startedAt, error }` in `stage_report_json`):

Stage (`→ staging`, also "go up again"):
1. Claim: lease `broadcast:<id>` (existing `cluster.leases`) and the one-per-project check.
2. Caption counter: set `caption_sequence` to 0 on the first staging of this broadcast (2.5b).
3. Pre-flight (also `GET /broadcasts/:id/preflight`): deliverables non-empty, source feeds publishing, YouTube credential usable if a platform link exists, recording storage reachable, linked graphics exist. Findings are `{ code, severity: error|warn, message }`; `?force=1` skips warnings.
4. Outputs on: video/audio outputs and their relay slots, DSK renderer (first version calls today's relay on/off, then the egress manager).
5. YouTube: schedule the YouTube broadcast if there is no link yet (`schedule` route's logic), bind the stream key into `caption_targets`, wait until YouTube sees the ingest, leave the broadcast in its test state.
6. One clock sync, then caption sessions may bind from here.

Go live (`staging → live`): YouTube transition to live (the `go-live` route's function), start the recording group, arm (`armOnGoLive`), start the caption clock sync (2.5b), set `actual_start` once, publish `broadcast.state_changed`.

Stop (`→ stopping → stopped`): stop the clock sync, disarm, finalize the recording group, outputs off, platform link marked not live (YouTube is **not** completed), sessions return to normal idle expiry.

Complete (`stopped → completed`): YouTube transition to complete and the post-broadcast summary, write `youtube_video_ids` from the platform link, `HANDOFF_AUTO_SEND`, stop and close bound sessions (SSE `session_closed`, reason `broadcast_completed`), `actual_end`.

A failed step never blocks the rest of a stop or complete and shows up in `warnings`; a failed step in staging leaves the broadcast in `staging` with the error so the operator can retry or abort.

### 2.4 Endpoints and events

| Route | Effect |
|---|---|
| `POST /broadcasts/:id/stage` | → `staging` (also from `stopped`) |
| `POST /broadcasts/:id/go-live` | `staging → live` |
| `POST /broadcasts/:id/stop` | `live|staging → stopping → stopped` |
| `POST /broadcasts/:id/complete` | `stopped → completed` |
| `POST /broadcasts/:id/cancel`, `/restore` | `draft|scheduled → cancelled`; `cancelled → draft` (restore also un-archives, as today) |
| `PUT /broadcasts/:id` | title, description, schedule, privacy, `record_enabled`; setting or clearing `scheduledStart` moves `draft ↔ scheduled` |
| `GET /broadcasts/:id/preflight` | findings, no side effects |
| `GET /broadcasts/current` | the project's `staging|live|stopping|stopped` broadcast, else null |

Events on the EventBus (added to `events-catalog.js`, audited): `broadcast.state_changed { broadcastId, from, to, reason }`, `broadcast.step_failed`. `POST /broadcasts/:id/platforms/youtube/go-live|end` stay as manual platform-only actions and call the same functions the steps use, so there is one code path.

### 2.5 Caption session as a participant

Decided (answer 2): **closing the caption tab ends neither the broadcast nor the session.**

- `POST /live` resolves the broadcast in this order: explicit `broadcastId` (must be `staging|live`, otherwise 409 "stage it first"), else the project's current broadcast if one is `staging|live`, else **compat for old clients**: create an `adhoc` broadcast and walk it through staging and live (no YouTube step because it has no platform link). Produced content always attaches, as today.
- A session never changes `broadcasts.status`. The `live` transition, `armOnGoLive` and `startRecordingGroup` calls in `live.js` move into the lifecycle service; `live.js` only stamps `session.broadcastId`.
- **Idle expiry:** a session bound to a broadcast in `staging|live` is exempt from the `SESSION_TTL` sweep. A closed tab sends no `DELETE /live`, so without this exemption the session would silently expire after 2 hours. When the broadcast goes `stopped` the exemption ends (normal TTL again), at `completed` bound sessions are closed. An explicit Disconnect still ends that one session, never the broadcast. The exemption needs the sweeper to know the project's live broadcast: keep an in-memory set updated from `broadcast.state_changed` (works across instances through the existing bus relay).
- The 1:1 rule goes away: many sessions may bind one broadcast over its life (reconnect, a second operator, a translator tab); `session_stats` stays one row per session.
- The web client passes `broadcastId` (the current broadcast) on connect and shows "Broadcast is not staged, [Open control pane]" instead of silently creating one. `BackendCaptionSender.start()` gets an optional `broadcastId`.
- A server-owned caption session (STT only, nobody in a browser) is **not** part of this plan.

### 2.5b The broadcast owns the caption sequence and the clock sync (Juha, 2026-10-19)

The broadcast owns *the* caption session in the sense that matters to YouTube: one sequence counter and one clock offset. Client connections (sessions) attach to it and use it; they no longer have their own.

**Sequence.**
- `broadcasts.caption_sequence` starts at **0** the first time the broadcast enters `staging`, and is reset to 0 again whenever a **new** YouTube broadcast is created for it (a new stream starts a new sequence). It is **not** reset on stop and go up again while the same YouTube broadcast is reused, so the numbers keep rising.
- Every caption sent for the broadcast takes its number from that counter and increments it, whichever session or tab sent it. The multi-instance code already reserves numbers atomically (`reserveSequence`, `syncSequenceFromDb`, `liftSenders` in `store.js`, today on the `sessions` row); for a bound session the same functions work on the `broadcasts` row instead, which also makes two sessions on one broadcast consistent.
- A bound session ignores the `sequence` a client passes to `POST /live` and takes the broadcast's counter (the response already returns `sequence`, so clients adopt it). `PATCH /live` with a sequence sets the broadcast's counter. Operators who need a manual reset use that, not a new broadcast.
- Sessions with no broadcast (not possible after the compat ad-hoc path, but kept for safety) and `api_keys.sequence` stay as they are; `api_keys.sequence` is mirrored from the broadcast counter so old readers still see a sensible value.

**Clock sync.**
- At `go-live` the broadcast runs an immediate sync, then re-syncs **every `CAPTION_SYNC_INTERVAL_S` (default 300 s, plus up to 10 % jitter)** while it is `live`. It also syncs once when entering `staging`, so the first caption has a fresh offset. It stops in `stopping`.
- One `BroadcastCaptionSync` per live broadcast, owned by the instance that holds the lease `broadcast-sync:<id>` (cluster-safe like the other sweeps; the `/internal/cluster/call` forwarding already exists for process owners). It calls `sender.sync()` on each YouTube sender of the broadcast's bound sessions, stores the result in `broadcasts.sync_offset_ms`, `last_synced_at`, writes it onto every bound session's `syncOffset`, and publishes `broadcast.caption_synced { offsetMs, rttMs }`.
- Failures never stop a broadcast: the previous offset stays in use, `sync_failures` counts up and a warning appears in the pane after 3 in a row, and the interval backs off x2 (cap x4) until one succeeds. Manual `POST /sync` stays and updates the same fields.
- With several YouTube targets each sender has its own offset in memory; the broadcast row keeps the first successful one for display. Whether per-target offsets must be persisted is left open (section 6).
- The interval is a guess, not a measured need: how fast the offset drifts against YouTube is not known. Make it a setting in `settings/registry.js` (`captions.sync_interval_s`) so it can be tuned on a real run.

### 2.6 YouTube

`go-live` and `end` become the steps above. The unique key `(broadcast_id, platform)` on `broadcast_platform_links` is a problem for "go up again": if YouTube has already completed the broadcast (after a long pause, or the operator ended it in Studio), a new YouTube broadcast is needed, and the old link must be kept as history. Plan: add a `superseded_at` column and relax the unique index to the one non-superseded row. The stats poller already sees YouTube's own status; if YouTube reports `complete` while LCYT is `staging|live`, publish `broadcast.platform_ended` and show a warning (no automatic state change, consistent with "no autoend yet").

### 2.7 Active pointer, arming, recording, graphics

- `active_broadcast_id` keeps its meaning and becomes **Selected** in the UI; the control pane selects through it. The word **Live** is reserved for the state.
- Arming keeps "live first, active second". `armOnGoLive`/`disarmOnEnd` move into go-live and stop.
- Recording moves from `POST /live` to the lifecycle service: a recording no longer stops when the tab closes. Each go-live starts a recording group and each stop finalizes it, so a stop and re-up makes two groups for one broadcast. The Saarnavideo handoff (`findGroupForBroadcast`) takes one group today; see risks.
- **Graphics (draft state and onwards):** graphics are assigned to a broadcast through the existing links in any state before `archived`. The template lists (DSK Control grid, DSK editor list, Assets graphics card) get a toggle **All | This broadcast**, default All; "this broadcast" is the Selected one. First version is client-side, filtering by `broadcast_assets` rows from `GET /broadcasts/:id`; no backend change.

### 2.8 The Production pane (answer 6)

A new Production workspace pane type `broadcast` (`production/workspace/panes/`, registered in `layout.js`; it replaces the status select in `Chrome.jsx`'s header, which becomes a read-only state chip):

- **Title line.** If a broadcast is scheduled for approximately now (`scheduled_start` within -3 h and +4 h of the current time, nearest first; constants in one place), the pane shows its title with a "Use this" button that selects it. Otherwise, or in addition, the operator can type a title; the title is only information (nothing reads it yet). Typing a title and pressing the first action creates a `draft` broadcast with that title.
- **State and buttons.** One button row per state, each button one transition:
  - `draft`: Schedule (time picker), Stage, Cancel
  - `scheduled`: Stage, Clear time, Cancel
  - `staging`: Go live, Abort
  - `live`: Stop
  - `stopping`: none (busy indicator)
  - `stopped`: Go up again, Complete
  - `completed`: Archive
  - `cancelled`: Restore, Archive
- **Pre-flight and warnings** list inline; Stage shows errors before it does anything. A failed step shows its message and a Retry.
- Live chip and elapsed time while `staging|live`.

The same buttons and the pre-flight panel also appear in `BroadcastsManager`'s cards (shared component), and `BroadcastPlatformPanel`'s "Go live" and "End" stay as "platform only" actions.

## 3. Alignment with the egress outputs plan (PR #396, `plan_egress_outputs.md`)

That plan defines **outputs**: `source → DSK viewports → crop → destinations`, with relay slots as destinations, and an `outputs` table. This plan does not redefine any of it.

| Concern | Egress plan owns | This plan owns |
|---|---|---|
| What goes out and how it is processed | outputs, steps, relay slots, audio source | nothing |
| When it runs | step supervisors that run while an output is running | the decision to run them: Stage and Go up again turn a broadcast's outputs on, Stop turns them off |
| Which outputs belong to a service | nothing (outputs are project config) | `broadcast_outputs` join (PR 5); an output can be reused by many broadcasts |
| Video, audio, DSK-only | an output with a DSK step, an audio-only feed (`audio_source`, `prod_feeds.media`) | the deliverables rule: at least one of captions, video feed out (DSK is enough), audio feed out |
| Manual operation | `PUT /stream/active`, per-output status | still allowed with **no** broadcast (always-on monitor, testing); a broadcast does not forbid it |
| YouTube destinations | relay slot with an RTMP URL | the platform link supplies the stream key (`maybeBindStreamKey`) and the staging, go-live and complete transitions |
| Limits | `MAX_OUTPUT_STEPS` | pre-flight reports it |

Sequencing: the lifecycle service ships first with an outputs step that calls today's relay on/off, so it does not wait for egress PRs 1 to 5. When egress PR 4 (relay slots source from outputs) lands, PR 5 here switches the step to the broadcast's `broadcast_outputs`. The `outputs` ids are the same ids as the egress table, so no migration beyond the join. To settle with the egress thread: output `enabled` means "configured and allowed", while "running" is runtime state set by the broadcast, so disabling an output in config is not confused with it being off air.

## 4. PR order

1. **Fixes, no model change.** Client passes `broadcastId` (Selected or current broadcast) on connect; `youtube_video_ids` filled from the platform link at completion; `PUT status` refuses `live|completed` and the Production header select becomes a read-only chip. Tests: `broadcasts-route`, `live`, `arming`.
2. **Lifecycle service and endpoints.** `src/broadcasts/lifecycle.js` (state machine and transition table, steps for arming, recording, YouTube staging/go-live/complete, relay on/off, `deliverables()`, sequence reset at first staging), `BroadcastCaptionSync` (immediate and periodic sync while live), the endpoints and events of 2.4, new columns (including `caption_sequence` and the sync fields) in both Prisma schemas plus `postgres/migrations/0011_broadcast_lifecycle.sql` and `sqlite/schema.sql`, `superseded_at` on platform links. `POST /live` unchanged. Tests on both dialects with fake steps.
3. **Decouple the session.** `POST /live` resolution, ad-hoc compat, sequence taken from and incremented on the broadcast (atomic reservation moved from the `sessions` row to the `broadcasts` row, `api_keys.sequence` mirrored), TTL exemption for bound sessions, session end no longer completes anything, sessions closed at `completed`, the 1:1 rule dropped. The behaviour change; old clients stay identical through the ad-hoc path.
4. **UI.** The `broadcast` pane, transition buttons and pre-flight panel in `BroadcastsManager`, schedule with time zone, Live and Selected chips in the top bar, graphics All | This broadcast toggle, caption connect passes the broadcast, i18n in fi, en, sv, and renaming the nav entry for `/broadcast` to "Live".
5. **Outputs.** `broadcast_outputs`, outputs step and `deliverables()` use the egress manager (after egress PR 4).
6. **Remove the manual caption-session controls from the top bar.** Heartbeat, Sync and Set sequence leave `sidebar/QuickActionsPopover.jsx` (and the same buttons in `ControlsPanel.jsx`), because the broadcast now owns the sequence (reset at first staging, incremented on send) and syncs the clock itself (`BroadcastCaptionSync`). A manual "Sync now" stays only as an action on the broadcast pane (`POST /broadcasts/:id/sync`), and a sequence override as an admin action there, for repair. Comes after PR 4, so the pane exists before the top-bar buttons go. i18n keys and tests for the removed buttons are dropped; legacy `POST /sync`, `/heartbeat` and the sequence route stay for API clients.
7. **Later, on request:** auto-start and auto-end (a lease-based scheduler, `starting_soon` notifications through the notify adapters), recurrence, platform-imported broadcasts, server-owned caption session, simultaneous broadcasts per project.

Each PR updates `packages/lcyt-backend/CLAUDE.md`, `lcyt-platforms/CLAUDE.md`, `lcyt-web/CLAUDE.md`, `docs/PLANS.md` and the API docs, per the repo's sync rules.

## 5. Risks

- **YouTube semantics are unverified.** Nothing in `lcyt-platforms` has run against YouTube. "Stopped can go up again" assumes YouTube keeps a live broadcast resumable for a while after the ingest stops; that is not guaranteed, hence the superseded-link fallback. Whether captions POSTed in YouTube's test state are accepted is also unknown.
- **Recording groups.** One group per go-live means one broadcast can own several; `findGroupForBroadcast` and the handoff builder assume one. Either the handoff joins the groups in time order or each group is handed off separately; decide in PR 2.
- **Cluster.** Transitions run on the instance that gets the request; steps that touch relay, crop or STT go through the existing per-key ownership forwarding. The broadcast lease prevents two simultaneous transitions, but a holder that dies mid-transition leaves `staging` or `stopping`; a stuck `stopping` older than 2 minutes should be retryable from the pane. Not verified with two instances.
- **Sequence ownership.** Moving the counter to the broadcast changes the atomic increment that `CLUSTER_SEND_LOCK=atomic` relies on; the hot path must stay one conditional write per caption. The `lease` mode must lease on the broadcast, not the session. A client library that keeps its own local counter (`YoutubeLiveCaptionSender`) must adopt the server's number or YouTube sees repeats; check the CLI, Python library and MCP servers, which also call `/live`.
- **Session exemption** adds a dependency from the session sweeper to broadcast state; a missed bus event could pin a session. The set is rebuilt from the database on startup.
- **Behaviour change.** Operators who relied on "disconnect completes the broadcast" now press Stop and Complete. Release note needed.
- **Time.** All times are UTC ISO; the pane's "approximately now" uses the browser clock and the stored times only.
- **Existing data.** Old `completed` rows keep empty `youtube_video_ids`; only new completions are fixed. Existing `Broadcast <timestamp>` rows become `origin=adhoc`, the rest `planned`.
- **Naming.** The page called Broadcast (`/broadcast`) is the operator console; the entity lives on `/broadcasts`.

## 6. Decisions

Juha's answers of 2026-10-19:

1. One broadcast in `staging|live|stopping|stopped` per project at a time: **yes**.
2. Closing the caption tab ends neither the broadcast nor the session: **adopted** (2.5). Implemented as an idle-expiry exemption, since a closed tab sends nothing.
3. Opt-in auto-start, pre-flight: **yes in principle**, but the lifecycle brief says no auto-start or auto-end yet, so the scheduler moved to PR 7. The pre-flight stays in PR 2.
4. Required deliverables: **captions (created or sent), video feed out (DSK is enough), or audio feed out**: adopted as the deliverables rule (2.3).
5. `broadcast_outputs` in PR 5 of this plan: **yes**.
6. No status select; a broadcast control pane with a suggested or typed title and a button per transition: **adopted** (2.8).

Still open, with my recommendation:

- **A. Ad-hoc broadcasts for old clients end when?** With answer 2 they never end by themselves. Recommendation: they stay `live` until someone presses Stop (the next legacy connect then binds to that same broadcast instead of creating another), and the auto-end in PR 6 later covers them.
- **B. Recording on stop and re-up.** Recommendation: one recording group per go-live, handed off as separate groups in PR 2.
- **C. Does recording start at staging or at go-live?** Recommendation: go-live, so tests during staging are not recorded.
- **D. Cancelled can return to draft.** Recommendation: yes (cheap).
- **E. Sequence reset rule.** Reset to 0 at the first Stage and when a new YouTube broadcast is created; keep counting across stop and go up again on the same YouTube broadcast. Recommendation: as written. Say if you want a reset on every Stage instead.
- **F. Sync interval and per-target offsets.** Recommendation: 5 minutes, settable, one offset on the broadcast row and per-target offsets only in memory until a real run shows they differ.

## 7. Out of scope

Auto-start and auto-end, a server-owned caption session without a browser, recurrence, platform-imported schedules, Facebook Live (the adapter is a skeleton), server-side caption sessions, simultaneous broadcasts in one project, a metering view of broadcast hours, and any change to what an output does.
