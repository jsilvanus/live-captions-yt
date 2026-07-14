---
id: plan/broadcasts
title: "Broadcasts — First-Class Intra-Project Broadcast Entity (Schedule + Asset Linkage)"
status: draft
summary: "Introduces Broadcast as a first-class entity inside a project. Today a 'broadcast' exists only ephemerally as a live session plus a historical session_stats row, with every asset keyed flat by api_key and nothing grouping a single casting occasion. This plan adds a broadcasts table (a project has many), a lifecycle (draft → scheduled → live → completed → archived), scheduling fields, a broadcast_assets join linking reusable assets (graphics/cues/actions/icons/targets/rundown) to a broadcast, and a nullable broadcast_id on sessions/session_stats/caption_files so produced content and YouTube casts attach to the broadcast that made them. Supersedes plan_assets_page.md's youtube_video_ids-on-session_stats delta (the ids live on the broadcast instead) and upgrades that page's Broadcasts card from a raw session_stats list into real broadcast records."
related: plan/assets_page, plan/dashboard_console_redesign, plan/ai_roles_framework, plan/selfservice_config_backend, plan/captions
---

# Broadcasts — First-Class Intra-Project Broadcast Entity

## Motivation

A project (`api_keys.key`) casts many times, but the codebase has **no entity
for a single casting occasion.** What exists instead:

- A live **`session`** (`store.create()` in `packages/lcyt-backend/src/routes/live.js:231`,
  born on `POST /live`) — ephemeral, one at a time, gone when the session ends.
- A historical **`session_stats`** row (`packages/lcyt-backend/src/db/stats.js`) —
  a summary written on session end (duration, captions sent/failed).
- Every asset (`dsk_templates`, `cue_rules`, `action_defs`, `icons`,
  `caption_targets`, `caption_files`, …) keyed **flat by `api_key`**, with
  nothing associating a graphic or a cue or a produced caption file with the
  *particular broadcast* it belonged to.

So today you cannot: schedule a cast in advance, say "these graphics + cues +
this rundown are for Sunday's service", see a broadcast's produced caption files
and YouTube link in one place, or tell two casts of the same project apart
beyond a timestamp. This plan makes **Broadcast** a real, persisted,
intra-project entity that ties those together.

## Relationship to the Assets page plan

`plan_assets_page.md` adds a read-only **Broadcasts** card that lists
`session_stats` rows and (per that plan's one backend delta) a
`youtube_video_ids` column on `session_stats` for the watch link.

This plan **supersedes that delta**: YouTube ids and the broadcast's identity
live on the new `broadcasts` entity, not on `session_stats`. Once this lands,
the Assets page's Broadcasts card lists **broadcast records** (scheduled + past)
instead of raw session summaries — a strict upgrade. If the Assets page ships
first, implement its `session_stats.youtube_video_ids` column as written and
migrate the ids onto `broadcasts` here; if this plan ships first, the Assets
card reads `broadcasts` directly and that column is never added.

## The entity

A **Broadcast** is one casting occasion within a project. A project has many;
each has a lifecycle, optional schedule, linked reusable assets, and — once it
runs — attached produced assets and session records.

### Lifecycle

```
draft ──▶ scheduled ──▶ live ──▶ completed ──▶ archived
  │           │                      ▲
  └───────────┴──────────────────────┘  (can be edited/rescheduled while not live)
```

- **draft** — created, not yet scheduled. Assets can be linked, rundown drafted.
- **scheduled** — has a planned start (and optional end); appears on the schedule.
- **live** — a session is currently bound to it (set when a session starts
  against this broadcast, cleared on session end).
- **completed** — the session ended; produced assets + stats + YouTube ids attached.
- **archived** — hidden from default lists, retained.

Transitions are explicit API calls except `live`/`completed`, which are driven
by the session lifecycle (see "Binding a session" below).

## Schema

New tables + additive nullable FK columns. All `api_key`-scoped, following the
existing flat-keying convention and the backend DB-access convention (helpers in
`packages/lcyt-backend/src/db/broadcasts.js`, routes stay thin).

```sql
CREATE TABLE IF NOT EXISTS broadcasts (
  id                TEXT PRIMARY KEY,             -- uuid
  api_key           TEXT NOT NULL REFERENCES api_keys(key) ON DELETE CASCADE,
  title             TEXT NOT NULL DEFAULT '',
  description       TEXT,
  status            TEXT NOT NULL DEFAULT 'draft', -- draft|scheduled|live|completed|archived
  scheduled_start   TEXT,                          -- ISO, nullable
  scheduled_end     TEXT,                          -- ISO, nullable
  actual_start      TEXT,                          -- set when first session binds
  actual_end        TEXT,                          -- set when last session ends
  youtube_video_ids TEXT,                          -- JSON array (target-array mode → multiple casts)
  rundown_file_id   INTEGER,                       -- optional FK into caption_files (type='rundown') or planner doc ref
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_broadcasts_api_key ON broadcasts(api_key);
CREATE INDEX IF NOT EXISTS idx_broadcasts_status  ON broadcasts(api_key, status);

-- Reusable assets linked to a broadcast (graphics/cues/actions/icons/targets).
-- The produced assets (caption_files, session_stats) attach via broadcast_id
-- columns instead — see below — because they are 1:N owned, not N:M shared.
CREATE TABLE IF NOT EXISTS broadcast_assets (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  broadcast_id  TEXT NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
  asset_type    TEXT NOT NULL,   -- 'graphic'|'cue'|'action'|'icon'|'target'|'rundown'
  asset_ref     TEXT NOT NULL,   -- the linked row's id/key in its own table
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(broadcast_id, asset_type, asset_ref)
);
CREATE INDEX IF NOT EXISTS idx_broadcast_assets_bid ON broadcast_assets(broadcast_id);
```

Additive nullable columns on existing tables (produced-content attachment):

- `sessions.broadcast_id TEXT` — the broadcast a live session is running.
- `session_stats.broadcast_id TEXT` — which broadcast this run belonged to.
- `caption_files.broadcast_id TEXT` — the broadcast that produced this file
  (so a broadcast's caption files + completed translations list cleanly).

All nullable → fully backward compatible; existing rows keep `NULL` and behave
exactly as today (an "unassigned" bucket).

### Why join table for reusable, FK column for produced

Reusable assets (a graphic template, a cue rule) can belong to **many**
broadcasts → N:M → `broadcast_assets`. Produced assets (a caption file, a
session record) are created **by one** broadcast → 1:N → a `broadcast_id`
column on the owning row. Mixing them would either duplicate produced rows or
force everything through a heavier join.

## Binding a session to a broadcast

`POST /live` gains an optional `broadcastId`:

- **Provided** → `store.create()` stamps `session.broadcastId`; the broadcast
  transitions to `live`, `actual_start` set if first bind.
- **Omitted (ad-hoc cast)** → per the decision below, either auto-create a
  `draft`/`live` broadcast for this session, or leave `broadcast_id NULL`
  (unassigned) and allow assigning it to a broadcast afterward.

On session end (`store.onSessionEnd`, `packages/lcyt-backend/src/server.js`):
`session_stats.broadcast_id` is written, the broadcast → `completed`,
`actual_end` + `youtube_video_ids` recorded. `caption_files` written during the
session inherit `broadcast_id` from `session.broadcastId`
(`packages/lcyt-backend/src/routes/captions.js` write path).

## API surface

`packages/lcyt-backend/src/routes/broadcasts.js` (new), mounted with `auth`:

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/broadcasts` | List (filter `?status=`, default excludes `archived`) |
| `POST` | `/broadcasts` | Create (draft) |
| `GET` | `/broadcasts/:id` | One broadcast + linked assets + produced content refs |
| `PUT` | `/broadcasts/:id` | Edit title/desc/schedule/status |
| `DELETE` | `/broadcasts/:id` | Delete (or archive) |
| `POST` | `/broadcasts/:id/assets` | Link a reusable asset (`{ asset_type, asset_ref }`) |
| `DELETE` | `/broadcasts/:id/assets/:assetRowId` | Unlink |

Data-access logic in `src/db/broadcasts.js`; routes stay thin per the repo
convention.

## Frontend

- **Broadcasts list + detail** — a `/broadcasts` route (list of scheduled +
  past) and `/broadcasts/:id` detail (schedule, linked assets, produced caption
  files/translations, Watch-on-YouTube link(s), the bound/past session stats).
  A schedule/calendar view is a natural later addition; v1 can be a sorted list
  grouped by upcoming vs. past.
- **Assets page** — its Broadcasts card lists `broadcasts` records (this plan)
  rather than `session_stats` rows; each row links to the detail page.
- **Asset linking** — from a reusable asset (graphic/cue/action) or from the
  broadcast detail, a "link to broadcast" affordance writes `broadcast_assets`.
- **Planner tie-in** — a broadcast's `rundown_file_id` points at a
  planner-produced rundown; the planner (`PlannerPage.jsx`) can "attach this
  rundown to a broadcast." (Rundown persistence itself is still the placeholder
  from `plan_assets_page.md`; this plan only reserves the FK.)

## Cross-plan alignment

- **`plan_assets_page.md`** — superseded YouTube-id delta (above); Broadcasts
  card upgraded to real records.
- **`plan_ai_roles_framework.md`** — the Asset Control Assistant's
  `asset.link`/broadcast-scoped tools have a real target once broadcasts exist;
  the Planner Assistant's rundown output can attach to a broadcast.
- **`plan_selfservice_config_backend.md`** — `caption_targets` remain
  project-level config; a broadcast may *reference* a subset via
  `broadcast_assets` (`asset_type='target'`) without moving the source of truth.

## Open design questions

1. **Ad-hoc sessions** — when `POST /live` omits `broadcastId`, auto-create a
   broadcast per session, or leave the session unassigned (assignable later)?
   (Recommendation: leave `NULL` = unassigned; offer "assign to broadcast" after
   the fact, so casual users aren't forced into the entity.)
2. **One session ⇄ one broadcast, always?** Can two concurrent sessions belong
   to one broadcast (multi-operator), or is it strictly 1:1 per run? Schema
   allows N sessions → 1 broadcast; confirm the product intent.
3. **Delete vs. archive** — hard delete a broadcast (cascade unlinks, produced
   `broadcast_id`s null out), or archive-only to preserve history?
4. **Scheduling depth (v1)** — plain start/end fields + a sorted list, or a
   calendar/recurrence model (weekly service, etc.) from the start?
   (Recommendation: start/end + list in v1; recurrence later.)

## Out of scope (v1)

- Recurrence / calendar UI (plain scheduled_start/end first).
- Rundown backend persistence (reserved FK only; store designed elsewhere).
- Automated pre-broadcast checks ("all linked assets present") — a natural
  follow-on once linkage exists.
