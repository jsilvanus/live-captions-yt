---
id: plan/broadcasts
title: "Broadcasts — First-Class Intra-Project Broadcast Entity (Schedule + Asset Linkage)"
status: draft
summary: "Introduces Broadcast as a first-class entity inside a project — an interface to the project's YouTube Live schedule and a place to gather the assets for one cast. Today a 'broadcast' exists only ephemerally as a live session plus a historical session_stats row, with every asset keyed flat by api_key and nothing grouping a single casting occasion. This plan adds a broadcasts table (a project has many), a lifecycle (draft → scheduled → live → completed → archived), calendar scheduling from the start, a broadcast_assets join linking reusable assets (graphics/cues/actions/icons/targets/rundown), and a nullable broadcast_id on sessions/session_stats/caption_files so produced content and YouTube casts attach to the broadcast that made them (strictly one session per broadcast; ad-hoc sessions auto-create a broadcast). Broadcasts can be duplicated (and duplicated across projects) without copying produced content. Delete archives; archived rows are hard-purged after a retention window (default 30d) by a periodic sweep. Supersedes plan_assets_page.md's youtube_video_ids-on-session_stats delta (the ids live on the broadcast instead) and upgrades that page's Broadcasts card from a raw session_stats list into real broadcast records. Later gains two-way sync with YouTube Live scheduling (liveBroadcasts)."
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

### What a Broadcast *is*, framed

Two things, primarily:

1. **An interface to the project's YouTube Live schedule.** A broadcast maps to
   a scheduled (or past) YouTube live cast. v1 stores the schedule and the
   resulting `youtube_video_ids` locally; a later phase syncs two-way with
   YouTube's `liveBroadcasts` API (create/read scheduled casts, reconcile
   status). The lifecycle vocabulary below is chosen to map cleanly onto
   YouTube's own (`created`/`ready`/`testing`/`live`/`complete`).
2. **A place to gather the assets for one cast** — link the graphics, cues,
   actions, rundown, and caption targets a specific broadcast will use.

Everything else (produced content attachment, stats) follows from those two.

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
  Ad-hoc/test casts that auto-created a broadcast land here.
- **scheduled** — has a planned start (and optional end); appears on the calendar.
- **live** — the (single) session bound to it is running.
- **completed** — the session ended; produced assets + stats + YouTube ids attached.
- **archived** — soft-deleted: hidden from default lists, retained for a window,
  then hard-purged (see below).

Transitions are explicit API calls except `live`/`completed`, which are driven
by the session lifecycle (see "Binding a session" below).

### Delete = archive; archived is purged after retention

Per decision, **`DELETE` archives** rather than hard-deleting (so an accidental
delete of a real broadcast is recoverable, and test/ad-hoc broadcasts can be
cleaned up without losing history immediately). An archived broadcast is
**hard-purged after a retention window** — default **30 days**
(`BROADCAST_ARCHIVE_RETENTION_DAYS`, env-overridable) — measured from
`archived_at`. Purge is done by a periodic sweep following the existing
`SessionStore._sweep()` pattern (`packages/lcyt-backend/src/store.js`): on each
tick, hard-delete `broadcasts` where `status='archived'` and
`archived_at < now - retention`. Cascade drops its `broadcast_assets`; the
nullable `broadcast_id` on produced rows (`session_stats`, `caption_files`) is
set `NULL` (the produced content itself is *not* deleted — it reverts to the
"unassigned" bucket).

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
  actual_start      TEXT,                          -- set when the session binds
  actual_end        TEXT,                          -- set when the session ends
  youtube_video_ids TEXT,                          -- JSON array (target-array mode → multiple casts)
  youtube_broadcast_id TEXT,                        -- reserved: YouTube liveBroadcasts id for future two-way sync
  rundown_file_id   INTEGER,                       -- optional FK into caption_files (type='rundown') or planner doc ref
  archived_at       TEXT,                          -- set when soft-deleted; retention purge measures from here
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

**Strictly one session per broadcast** (1:1 per run). A broadcast that already
has a bound live session rejects a second bind. `POST /live` gains an optional
`broadcastId`:

- **Provided** → `store.create()` stamps `session.broadcastId`; the broadcast
  transitions to `live`, `actual_start` set. Reject (409) if that broadcast is
  already `live`.
- **Omitted (ad-hoc / test cast)** → **auto-create** a broadcast for this
  session (decision) — a `live` row titled from the session/timestamp — so every
  session always has exactly one broadcast and produced content always attaches.
  These land as ordinary broadcasts the user can rename, edit, or delete (archive)
  afterward; junk/test casts are cleaned up the same way as any other.

On session end (`store.onSessionEnd`, `packages/lcyt-backend/src/server.js`):
`session_stats.broadcast_id` is written, the broadcast → `completed`,
`actual_end` + `youtube_video_ids` recorded. `caption_files` written during the
session inherit `broadcast_id` from `session.broadcastId`
(`packages/lcyt-backend/src/routes/captions.js` write path). Because binding is
always present (provided or auto-created), `broadcast_id` on produced rows is
effectively always set going forward; pre-existing rows stay `NULL` (unassigned).

## API surface

`packages/lcyt-backend/src/routes/broadcasts.js` (new), mounted with `auth`:

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/broadcasts` | List (filter `?status=`, `?from=`/`?to=` for calendar range; default excludes `archived`) |
| `POST` | `/broadcasts` | Create (draft) |
| `GET` | `/broadcasts/:id` | One broadcast + linked assets + produced content refs |
| `PUT` | `/broadcasts/:id` | Edit title/desc/schedule/status |
| `DELETE` | `/broadcasts/:id` | **Archive** (sets `status='archived'`, `archived_at=now`); purged later by the retention sweep |
| `POST` | `/broadcasts/:id/restore` | Un-archive (back to `draft`/`scheduled`) while still within retention |
| `POST` | `/broadcasts/:id/duplicate` | Clone this broadcast (optionally into another project) — config only, no produced content (see below) |
| `POST` | `/broadcasts/:id/assets` | Link a reusable asset (`{ asset_type, asset_ref }`) |
| `DELETE` | `/broadcasts/:id/assets/:assetRowId` | Unlink |

Data-access logic in `src/db/broadcasts.js`; routes stay thin per the repo
convention.

## Duplication

Per decision, a broadcast can be **duplicated**, including **across projects**,
and duplication **never copies produced content.**

- **`POST /broadcasts/:id/duplicate`** with optional `{ targetApiKey }`:
  - **Copies:** title (suffixed "(copy)"), description, `broadcast_assets`
    links (the reusable graphics/cues/actions/icons/targets/rundown references),
    and — when duplicating within the same project — the schedule if the caller
    keeps it (otherwise cleared to `draft`).
  - **Does NOT copy:** `youtube_video_ids`, `youtube_broadcast_id`,
    `actual_start`/`actual_end`, `session_stats`, or any `caption_files`
    (the produced content). The clone starts `draft`, unbound, with no history.
  - **Cross-project (`targetApiKey`):** the same rules, plus the linked
    `asset_ref`s must resolve in the target project. Reusable assets that don't
    exist there are dropped from the clone (reported in the response), since a
    graphic/cue id is project-scoped. (Deep-copying the referenced assets
    themselves into the target project is out of scope here — that belongs to a
    broader "duplicate project" capability; see below.)
- **Project duplicate** — cloning a whole project (its config + broadcasts,
  excluding produced content) is a broader, adjacent capability that reuses the
  same "copy config, never copy produced" rule and this endpoint's per-broadcast
  logic. It is **noted here, specced elsewhere** (a projects-level plan), so the
  broadcast duplication logic is designed to compose into it (a project-duplicate
  walks the source project's broadcasts and calls the same clone routine with the
  new `targetApiKey`).

## Frontend

- **Broadcasts calendar + detail** — a `/broadcasts` route with a **calendar
  view from the start** (decision): scheduled broadcasts render on a month/week
  calendar keyed off `scheduled_start`/`scheduled_end`, with a list/agenda toggle
  for upcoming vs. past. `GET /broadcasts?from=&to=` feeds the visible range.
  Scheduling a broadcast ahead of time (create → set schedule → `scheduled`) is a
  primary flow, not an afterthought. `/broadcasts/:id` detail shows the schedule,
  linked assets, produced caption files/translations, Watch-on-YouTube link(s),
  and the bound/past session stats. Creating/duplicating and drag-to-reschedule
  live here.
- **Assets page** — its Broadcasts card lists `broadcasts` records (this plan)
  rather than `session_stats` rows; each row links to the detail page.
- **Asset linking** — from a reusable asset (graphic/cue/action) or from the
  broadcast detail, a "link to broadcast" affordance writes `broadcast_assets`.
- **Planner tie-in** — a broadcast's `rundown_file_id` points at a
  planner-produced rundown; the planner (`PlannerPage.jsx`) can "attach this
  rundown to a broadcast." (Rundown persistence itself is still the placeholder
  from `plan_assets_page.md`; this plan only reserves the FK.)

## YouTube Live schedule integration (phased)

The framing "a broadcast is an interface to the YouTube Live schedule" is the
direction, delivered in phases so v1 doesn't block on it:

- **v1 (this plan):** local schedule (`scheduled_start`/`end`) + captured
  `youtube_video_ids` on completion. `youtube_broadcast_id` column reserved.
- **Phase 2 (two-way sync):** using the existing YouTube auth already in
  `packages/lcyt-web/src/lib/youtubeApi.js` / `youtubeAuth.js`, reconcile a
  broadcast with a real `liveBroadcasts` resource — list the channel's scheduled
  broadcasts, link/create one for an LCYT broadcast (store
  `youtube_broadcast_id`), and mirror `scheduledStartTime`/lifecycle. Our status
  vocabulary was chosen to map onto YouTube's (`created`→draft, `ready`→scheduled,
  `testing`/`live`→live, `complete`→completed), so the reconciliation is a status
  map, not a redesign.
- Phase 2 is **out of scope for this plan's implementation** but its data hooks
  (`youtube_broadcast_id`, status vocabulary, `youtube_video_ids`) are laid down
  now so it's additive.

## Cross-plan alignment

- **`plan_assets_page.md`** — superseded YouTube-id delta (above); Broadcasts
  card upgraded to real records.
- **`plan_ai_roles_framework.md`** — the Asset Control Assistant's
  `asset.link`/broadcast-scoped tools have a real target once broadcasts exist;
  the Planner Assistant's rundown output can attach to a broadcast.
- **`plan_selfservice_config_backend.md`** — `caption_targets` remain
  project-level config; a broadcast may *reference* a subset via
  `broadcast_assets` (`asset_type='target'`) without moving the source of truth.

## Resolved decisions

1. **Ad-hoc sessions → auto-create.** `POST /live` without `broadcastId`
   auto-creates a `live` broadcast; every session always has exactly one. Test/
   junk casts are edited or deleted (archived) afterward like any other broadcast.
2. **Strictly one session per broadcast (1:1 per run).** A second bind to a
   `live` broadcast is rejected. Instead of reusing a broadcast, users
   **duplicate** it (or duplicate across projects) — duplication copies config +
   linked reusable assets, never produced content.
3. **Delete = archive; archived is purged after retention.** `DELETE` sets
   `archived`/`archived_at`; a periodic sweep hard-deletes archived rows older
   than `BROADCAST_ARCHIVE_RETENTION_DAYS` (default 30). `POST .../restore`
   un-archives within the window.
4. **Calendar from the start.** Scheduling ahead is a primary flow; `/broadcasts`
   ships a calendar view (+ agenda/list toggle), not just a sorted list.
   Recurrence (weekly service) is still deferred, but the calendar UI is not.

### Still open (smaller)

- **Auto-created broadcast title** — timestamp (`"Broadcast 2026-07-14 18:00"`),
  or blank/"Untitled" for the user to fill? (Lean: timestamp, editable.)
- **Cross-project duplicate with missing assets** — drop unresolved reusable
  links silently-but-reported (current spec), or block the duplicate until the
  target project has them? (Lean: drop + report.)

## Out of scope (v1)

- **Recurrence** (weekly service, RRULE) — the calendar view ships, but
  repeating broadcasts do not.
- **YouTube Live two-way sync** (Phase 2 above) — data hooks laid down, sync not
  built.
- **Project duplicate** — the whole-project clone is specced elsewhere; this
  plan only makes per-broadcast duplication compose into it.
- Rundown backend persistence (reserved FK only; store designed elsewhere).
- Automated pre-broadcast checks ("all linked assets present") — a natural
  follow-on once linkage exists.
