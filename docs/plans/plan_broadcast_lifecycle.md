---
id: plan/broadcast_lifecycle
title: "Broadcast lifecycle — a broadcast with its own schedule, start and stop, decoupled from the caption session"
status: draft
summary: "Findings on what 'broadcast' means in the code today (a database row whose status is driven almost entirely by the caption session) and a plan to make it the thing that owns a go-live: a state machine with explicit start/stop, a server-side scheduler, a pre-flight check, and a list of components it starts and stops (outputs from plan_egress_outputs, recording, platform go-live, arming, captioning). The caption session becomes one participant that can join and leave without ending the broadcast. Plan only; nothing is built."
related: plan/broadcasts, plan/broadcasts_next, plan/broadcast_platform_sync, plan/egress_outputs, plan/recording_vod, plan/backend_actions
---

# Broadcast lifecycle (plan, 2026-10-19)

Status: draft for Juha's review. Docs only, no code. Nothing here has been run against a real MediaMTX, fleet or YouTube; claims about current behaviour are from reading `main` at `c8bffb7`.

## 1. What a "broadcast" is today

A broadcast is a row in `broadcasts` plus a handful of side tables and columns that point at it. It is a **record that a caption session writes into**, not an object that runs anything.

### 1.1 Data model

| Piece | Where | What it holds |
|---|---|---|
| `broadcasts` | `prisma/schema.prisma:325`, `src/db/schema.js:410` | `id`, `api_key`, `title`, `description`, `status` (`draft|scheduled|live|completed|archived`), `scheduled_start/end`, `actual_start/end`, `youtube_video_ids` (JSON), `youtube_broadcast_id` (legacy mirror), `rundown_file_id`, `record_enabled`, `privacy_status`, `armed`, `archived_at` |
| `broadcast_assets` | schema:265 | N:M links to reusable graphics, cues, actions, icons, targets, rundown |
| `broadcast_files` | schema:278 | N:M pins of caption files (planner rundowns) |
| `broadcast_platform_links` | schema:291 (`lcyt-platforms`) | the external YouTube broadcast: `external_broadcast_id`, `external_stream_id`, `credential_id`, `last_status`, `last_sync_error` |
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

- Routes: `routes/broadcasts.js` (CRUD, `active`, `activate`, restore, duplicate, files, assets), `lcyt-platforms/src/routes/broadcast-platforms.js` (schedule, thumbnail, go-live, end, stats), `routes/arming.js`, `routes/handoff.js`, `routes/videos.js`. All mounted in `routes/content.js:62-64` behind `scoped('broadcast')`.
- `arming.js`: the ARMED/SAFE flag lives on the project's `live` broadcast, else its active one. Cue-triggered device actions (`lcyt-actions` `cue-dispatcher.js`) check it.
- Recording: `recording/feeds.js` creates one recording group per broadcast; `finalizeVideoRecording` and `HANDOFF_AUTO_SEND` run from the session-end path.
- Frontend: `BroadcastsManager.jsx` (`/broadcasts`, calendar-ish list, create/edit/duplicate), `BroadcastPlatformPanel.jsx` (schedule/thumbnail/Go live/End/stats), `BroadcastsSection.jsx` (activate toggle on the project summary), `useActiveBroadcast.js` and the top bar chip, `PlannerBroadcastFilePanel.jsx`, `DskBroadcastAssetPanel.jsx`, `AssetsPage.jsx` card, Production header chip and status select, `BroadcastPage.jsx` (`/broadcast`: Live and Settings tabs; this is the operator console, unrelated to the entity despite the name).
- Name collisions that are **not** the entity: `POST /dsk/:key/broadcast` and the MCP tool `broadcast_dsk_data` (push live graphics data), `broadcastToViewers` (SSE fan-out), `BroadcastChannel` (browser embed sync), `broadcastTallyUpdated`. Keep these out of any rename.

### 1.4 Gaps and bugs found while reading

1. **No client binds a broadcast.** `BackendCaptionSender.start()` and `useSession.connect()` never send `broadcastId` (grep over `packages/lcyt` and `packages/lcyt-web`). Every browser connect therefore auto-creates a new `Broadcast <timestamp>` row, and a planned, scheduled broadcast never goes `live` from the UI. The activate pointer is not consulted by `POST /live` either.
2. **`youtube_video_ids` is never written.** `completeBroadcast` is passed `session.youtubeVideoIds`, and nothing assigns that property (only reads in `live.js:509` and `server.js:666`). The Assets and Broadcasts pages read the column and always see an empty list. The YouTube video id is available from `broadcast_platform_links.external_broadcast_id` (for YouTube the live broadcast id is the video id).
3. **The caption session ends the broadcast.** Two clicks of Disconnect/Connect, a network drop longer than `SESSION_TTL`, or an operator closing the tab completes the broadcast and its recording even though the stream is still on air. The next connect starts a *new* broadcast.
4. **Statuses can be set to `live` by hand** (`PUT status`), producing a broadcast marked live with no stream behind it, and `bindSessionStart` then refuses the real session (409 "already has a live session").
5. **Relay, DSK renderer, crop and STT are independent of the broadcast.** `PUT /stream/active` turns the relay on and off for the project; nothing starts or stops it with a broadcast.
6. **Schedule is data only.** Nothing watches `scheduled_start`; no reminder, no auto-start, no overdue handling. Time zone is whatever string the client sent.
7. **Three places complete a broadcast** (`DELETE /live`, `onSessionEnd` TTL, and the YouTube `end` route does not) and they are copies of each other.

## 2. Target model

**A broadcast is the unit of going on air.** It owns a schedule, a lifecycle, and a list of *components* it starts and stops. The caption session is a component that attaches to a broadcast that is already live (or starts one, for old clients), and leaving it does not end anything.

### 2.1 State machine

```text
draft ──► scheduled ──► starting ──► live ──► stopping ──► completed ──► archived
  │          │             │          │                        ▲
  └──────────┴─► cancelled (draft or scheduled only)
```

A failed optional step never moves `live` anywhere; it adds a warning.

- `draft`: being planned; no schedule needed.
- `scheduled`: has `scheduled_start`; appears on the calendar; the scheduler may act on it.
- `starting`: a start was requested; steps are running (section 2.3). Short-lived, visible so the UI does not double-fire.
- `live`: required steps succeeded. Optional step failures show as `warnings` on the broadcast, they do not block.
- `stopping`: stop requested; steps unwinding (finalize recording, platform end, outputs off).
- `completed`: `actual_end` set. Produced content stays attached.
- `cancelled`: scheduled or draft broadcast that will not run (kept for history and the calendar).
- `archived`: unchanged from today (soft delete, 30-day cooling-off).

Existing values (`draft|scheduled|live|completed|archived`) keep their meaning; `starting`, `stopping`, `cancelled` are additive, the column is already free text. **Status is no longer writable through `PUT`** except `draft↔scheduled` (by setting or clearing the schedule) and `cancelled`. `live`, `stopping`, `completed` are reached only through the lifecycle service.

At most **one `live` broadcast per project** (`starting|live|stopping` count). Landscape plus vertical or several YouTube channels are *outputs* of one broadcast (egress plan), not separate broadcasts. A second `start` while one is live answers 409 with the live broadcast's id. Revisit if Juha wants simultaneous services in one project.

### 2.2 New fields on `broadcasts` (all nullable or defaulted, additive)

| Field | Purpose |
|---|---|
| `auto_start` (0/1), `start_lead_s` | scheduler starts it at `scheduled_start - lead` |
| `stop_policy` | `manual` (default for planned), `schedule` (stop at `scheduled_end`), `session_end` (legacy behaviour, used by compat ad-hoc broadcasts), `idle` (no session and no ingest for N minutes) |
| `origin` | `planned` \| `adhoc` (auto-created for a session) \| `platform` (imported from a YouTube schedule, later) |
| `components_json` | which components take part and whether each is `required` or `optional` (section 2.3); default derived from today's flags (`record_enabled`, linked platform, linked outputs) |
| `timezone` | IANA name for display and for recurrence later; stored times stay UTC ISO |
| `stop_reason`, `last_error`, `warnings_json` | why it ended, what failed, non-fatal step failures |
| `started_by`, `stopped_by` | user id or `scheduler` or `session` |

`record_enabled`, `armed`, `privacy_status`, `youtube_*` stay as they are.

New join table, **after** the egress plan lands its `outputs` table: `broadcast_outputs(broadcast_id, output_id, enabled, sort_order)`.

### 2.3 Components and start/stop order

The lifecycle service (`src/broadcasts/lifecycle.js`, new, route handlers stay thin per the repo convention) runs a fixed list of idempotent steps. Each step records `{ status, startedAt, error }` in the broadcast's start report so a retry resumes instead of repeating.

Start (`POST /broadcasts/:id/start`):

1. **Claim.** Take the lease `broadcast:<id>` (existing `cluster.leases`); refuse if another broadcast of the project is `starting|live|stopping`. Set `starting`.
2. **Pre-flight** (also exposed as `GET /broadcasts/:id/preflight`, run before any side effect; `?force=1` skips non-critical findings): outputs have a destination and their source feed is publishing, YouTube link exists and the credential is usable, recording storage reachable, linked graphics/cues exist. Result is a list of `{ code, severity: error|warn, message }`.
3. **Outputs.** Start every linked output and its relay slots through the egress plan's manager (or, until that exists, `PUT /stream/active` with `active=1`). Required by default.
4. **Recording.** `startRecordingGroup` (today inside `POST /live`). Optional by default unless `record_enabled`.
5. **Platform.** For each platform link: `adapter.transition(live)` (today the `go-live` route; the route stays as a manual action and calls the same function). Optional by default; a failure is a warning with the adapter's error.
6. **Arming.** `armOnGoLive` (today in `POST /live`).
7. **Open for captions.** Set `live`, `actual_start`, publish `broadcast.state_changed`. Sessions can now bind.

Stop (`POST /broadcasts/:id/stop`, or the scheduler, or `stop_policy`): set `stopping`; disarm; tell bound sessions the broadcast ended (SSE `session_closed` with reason `broadcast_ended`) and let them close; platform `transition(complete)` and the post-broadcast summary; recording group stop and finalize; outputs off; write `youtube_video_ids` from the platform links; `HANDOFF_AUTO_SEND`; set `completed`, `actual_end`, `stop_reason`. A failed step in stop never blocks the rest and is reported in `warnings`.

`POST /broadcasts/:id/cancel` for `draft|scheduled`. `POST /broadcasts/:id/reschedule` is just `PUT` of the times.

### 2.4 Scheduler

A small `BroadcastScheduler` started from `server.js`, one sweep every 15 s under the lease `broadcast-scheduler` (cluster-safe the same way as the existing `session-orphan-sweep`). Per sweep:

- `scheduled` with `auto_start` and `now >= scheduled_start - start_lead_s`: call `start`.
- `starting_soon` event (`broadcast.starting_soon`, default 10 min before) for scheduled broadcasts, so the notify layer (PR #374) can email or text the operator.
- `live` with `stop_policy=schedule` and `now >= scheduled_end`: call `stop`.
- `live` with `stop_policy=idle`: no bound session and no publishing ingest for `idle_minutes`: call `stop`.
- `scheduled` more than a configurable grace past `scheduled_start` without starting: publish `broadcast.overdue` (no automatic cancel).

Start from the scheduler fails soft: pre-flight errors leave the broadcast `scheduled`, publish `broadcast.start_failed` with the findings, and retry on the next sweep until the grace ends. Auto-start with nobody watching is the risky case, so it is opt-in per broadcast (`auto_start`), never a project default.

### 2.5 Caption session as a participant

- `POST /live` resolves the broadcast in this order: explicit `broadcastId` (must be `live`, or `scheduled|draft` for **old clients only**, see below), else the project's `live` broadcast, else **compat**: create an `adhoc` broadcast with `stop_policy=session_end` and start it through the lifecycle service. Today's behaviour (every session has one broadcast, produced content always attaches) is preserved for clients that know nothing about this plan.
- A session never changes `broadcasts.status` directly any more. `bindSessionStart`'s `live` transition, `armOnGoLive` and `startRecordingGroup` calls in `live.js` move into the lifecycle service; `live.js` only stamps `session.broadcastId`.
- The 1:1 rule goes away: many sessions may bind one broadcast over its life (a reconnect, a second operator, a translator tab), and they all write to the same `session_stats.broadcast_id`/`caption_files.broadcast_id`. `session_stats` rows stay one per session.
- Session end (`DELETE /live`, TTL) calls `lifecycle.onSessionEnded(broadcast)`, which only stops the broadcast when `stop_policy=session_end`. The three copies of "complete the broadcast" collapse into the lifecycle service.
- The web client passes `broadcastId` (the live one, else the active pointer) on connect and shows "Broadcast is not live, [Start]" instead of silently creating one. `BackendCaptionSender.start()` gets an optional `broadcastId`.
- Server-driven captioning (STT only, nobody in a browser) needs a session without a client. `SttManager` already depends on `store.getByApiKey`; a "broadcast-owned session" created by the lifecycle service is possible but is **phase 6**, not part of the decoupling.

### 2.6 Platform sync

`go-live` and `end` become thin wrappers over the lifecycle's platform step, so there is one code path whether the operator clicks "Go live" on YouTube or "Start broadcast". The stats poller already sees YouTube's own status; if YouTube reports `complete` while LCYT is `live` (operator ended it in Studio), publish `broadcast.platform_ended` and, with `stop_policy` not `manual`, stop. The stream key binding (`maybeBindStreamKey` into `caption_targets`) stays in the schedule step.

### 2.7 Active pointer, arming, recording

- `active_broadcast_id` keeps its meaning: *the broadcast being curated or prepared next*. It is the default for `POST /live` only when nothing is live **and** the client explicitly asks to start (not for plain connects). The UI should call the two things "Selected" and "Live" to stop the confusion.
- Arming keeps `live` first, `active` second. `armOnGoLive`/`disarmOnEnd` move into start and stop.
- Recording keeps its recorder and handoff code; only the trigger moves from `POST /live` to the lifecycle service, so a recording no longer stops when the caption tab closes. `POST /live/recording` (manual start/stop of a relay slot's recording) stays.

## 3. Alignment with the egress outputs plan (PR #396, `plan_egress_outputs.md`)

That plan defines **outputs**: `source → DSK viewports → crop → destinations`, with relay slots as destinations, and an `outputs` table. This plan does not redefine any of it.

| Concern | Egress plan owns | This plan owns |
|---|---|---|
| What goes out and how it is processed | outputs, steps, relay slots, audio source | nothing |
| When it runs | step supervisors that run while an output is *enabled* | the decision to enable them: a broadcast's start/stop turns its linked outputs on and off |
| Which outputs belong to a service | nothing (outputs are project config) | `broadcast_outputs` join; an output can be reused by many broadcasts |
| Manual operation | `PUT /stream/active`, per-output status | still allowed with **no** broadcast (always-on monitor, testing); a broadcast does not forbid it |
| YouTube destinations | relay slot with an RTMP URL | the platform link supplies the stream key (`maybeBindStreamKey`) and the go-live/complete transition |
| Limits | `MAX_OUTPUT_STEPS` | pre-flight reports it |

Sequencing: the lifecycle service ships first with an **outputs step that calls today's relay on/off**, so it does not wait for egress PRs 1 to 5. When egress PR 4 (relay slots source from outputs) lands, the step is switched to start the broadcast's `broadcast_outputs`. The `outputs` ids in `broadcast_outputs` are the same ids as the egress plan's table, so no data migration is needed beyond the join. If Juha prefers one data PR, `broadcast_outputs` can be folded into egress PR 1.

One thing to settle with the egress thread: whether an output carries its own `enabled` or only the broadcast does. Recommendation: output `enabled` means "configured and allowed", broadcast start sets a separate runtime `running` state, so disabling an output in config is not confused with it being off air.

## 4. PR order

Small and independent first, because items 1 to 3 are bugs today.

1. **Fixes, no model change.** Client passes `broadcastId` (selected or live broadcast) on connect; `youtube_video_ids` filled from platform links at completion; `PUT status` refuses `live|completed|starting|stopping` and the Production header select becomes read-only until the Start/Stop buttons exist. Tests: `broadcasts-route`, `live`, `arming`.
2. **Lifecycle service and endpoints.** `src/broadcasts/lifecycle.js` (state machine, steps for arming, recording, platform, relay on/off), `start|stop|cancel|preflight` routes, events `broadcast.state_changed|step_failed` in `events-catalog.js`, new columns in both Prisma schemas plus `postgres/migrations/0011_broadcast_lifecycle.sql` and `sqlite/schema.sql`, audit entries. `POST /live` unchanged yet. Tests on both dialects with fake steps.
3. **Decouple the session.** `POST /live` resolution order, compat ad-hoc broadcast with `stop_policy=session_end`, session-end paths call `onSessionEnded`, 1:1 rule dropped, `session_closed` reason `broadcast_ended`. This is the behaviour change; behind no flag because ad-hoc compat keeps old clients identical.
4. **Scheduler, pre-flight, notifications.** `BroadcastScheduler` with a lease, `auto_start`, `stop_policy` schedule/idle, `broadcast.starting_soon|overdue|start_failed` events, hook for the notify adapters.
5. **Outputs.** `broadcast_outputs`, outputs step uses the egress manager (after egress PR 4).
6. **UI.** Start/Stop/Cancel buttons and the pre-flight panel in `BroadcastsManager`, schedule with timezone and auto-start toggle, Live and Selected chips in the top bar, Production header buttons instead of the status select, "Go live" on the platform panel folded into Start with a "platform only" option, caption connect shows broadcast state. i18n in all three locale files.
7. **Later, only on request:** server-owned caption session for unattended STT broadcasts, recurrence (`series_id`, RRULE), platform-imported broadcasts (`origin=platform`), simultaneous live broadcasts per project.

Each PR updates `packages/lcyt-backend/CLAUDE.md`, `lcyt-platforms/CLAUDE.md`, `lcyt-web/CLAUDE.md`, `docs/PLANS.md` and the API docs, per the repo's sync rules.

## 5. Risks

- **Auto-start is the dangerous feature.** A scheduler that starts relay ffmpeg and flips a YouTube broadcast to live with nobody watching needs the pre-flight to be strict and the opt-in to be explicit. Not verified against a real YouTube channel (nothing in `lcyt-platforms` is).
- **Behaviour change for session end.** Operators who relied on "disconnect completes the broadcast" must set `stop_policy=session_end` or press Stop. Ad-hoc compat broadcasts keep the old behaviour, planned ones do not. Needs a line in the release notes.
- **Cluster.** Start/stop run on whichever instance gets the request; steps that touch relay, crop or STT go through the existing per-key ownership forwarding (`withOwnership`, `/internal/cluster/call`). The broadcast lease prevents two starts, but a lease holder that dies mid-start leaves `starting`; the sweeper must time `starting` out (default 2 min) back to `scheduled` or to `live` with a warning, depending on which required steps finished. Not verified with two instances.
- **Partial failure.** Required vs optional per component is a judgment call; defaults above are outputs required, everything else optional.
- **Time.** All times UTC ISO; the scheduler compares with the server clock, so hosts need NTP (same assumption as the lease code).
- **Existing data.** Old `completed` rows with empty `youtube_video_ids` stay empty; only new completions are fixed. Auto-created `Broadcast <timestamp>` rows already in the database are `origin=adhoc` after migration (default for rows without a schedule), planned ones `planned`.
- **Naming.** The page called Broadcast (`/broadcast`) is the operator console, the entity is on `/broadcasts`. Worth renaming the first to "Live" in the nav when the UI PR lands.

## 6. Decisions for Juha (recommendation first)

1. One live broadcast per project at a time? **Yes**; landscape and vertical are outputs of it.
2. Does closing the caption tab end a planned broadcast? **No**; only ad-hoc compat broadcasts end with the session.
3. Auto-start per broadcast, opt-in, with pre-flight and a grace period before it gives up? **Yes.**
4. Required components by default: outputs only, everything else a warning? **Yes.**
5. Fold `broadcast_outputs` into egress PR 1, or keep it in PR 5 here? **PR 5 here**, so the egress plan stays untouched until Juha says go.
6. Should the Production header keep a manual status select for emergencies (force `live`/`completed`)? **No**; use Start/Stop with `?force=1` on pre-flight.

## 7. Out of scope

Recurrence, platform-imported schedules, Facebook Live as a second platform (adapter is a skeleton), server-side caption sessions, simultaneous live broadcasts, a billing or metering view of broadcast hours, and any change to what an output does.
