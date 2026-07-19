---
id: plan/live_variables
title: "Live Variables — Continuous Refresh, Live Operator Display, and Text-Block Expansion"
status: in-progress
summary: "Forward-looking variable behaviours split out of plan_metacode_variable_unification so that plan can finish on its implemented core (registry/namespace/TTL). Three ideas: (1) the settled connector-fetch-timing decision (no load tier — a pointer-tier trigger on the first line covers 'on load'); (2) an always-updated variable that the operator sees live and normalized — implemented: bus-pushed {{name}} chip rendering in CaptionView (no polling, shared VariablesContext) plus a Production-page watchlist widget, AND a session-long, pointer-independent background refresh ('constant poll') as a deliberately separate opt-in mechanism (server-side PollScheduler) rather than any change to the !api:/api:/api!: metacode tiers, which stay pointer-scoped exactly as before — the interactive toggle lives in a Production workspace widget (ConnectorPollsPane, dialog-driven 'add an API call' + highlight-on-poll buttons), not the Setup Hub, since starting/stopping a poll is a live operational decision, not connector configuration; (3) variable-backed text blocks — implemented in a scoped form: {{name[N]}}/{{name[N*]}} (reusing the {{ }} sigil with a bracket length modifier, decided over the earlier <!-- lines: name --> marker sketch), block-only, materialize-once-then-freeze (a stronger, simpler freeze than 'freeze only while inside, re-expand on next arrival' — deferred as a follow-on), virtual lines displayed with a 20:1-style compound gutter number rather than borrowing new raw integers."
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

## 2. Always-updated, always-seen (live) variable — implemented

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

### Implementation status (2026-07-18)

**Done — live display, no polling:**
- `contexts/VariablesContext.jsx` — one shared `useVariables()` instance per app
  (one `GET /variables` + one `/events/stream` subscription), provided in
  `AppProviders.jsx`. `InputBar.jsx` now reads it instead of instantiating its
  own copy.
- `CaptionView.jsx` — plain `{{name}}` tokens in unsent caption lines render as
  a styled `.caption-line__var` chip showing the *live* resolved value, purely
  bus-driven (re-renders on the shared context's state, which only changes on
  a `variable.*` SSE event). Falls back to plain escaped text when
  `VariablesContext` isn't present (`FileProvider` used standalone).
- Production workspace — **answered "where does the operator see it"**: a new
  `variables` pane type (`components/production/workspace/panes/index.jsx`'s
  `VariablesPane`), a per-instance-configurable key→value watchlist ("right
  column" = value column). Required extending the pane model from a bare type
  string to `{ type, settings }` (`layout.js`'s `paneType`/`paneSettings`/
  `changePaneSettings`) — additive, no storage-version bump, old saved layouts
  keep working unchanged.

### Constant poll — decided & implemented (2026-07-19)

The bus only distributes a *change* to subscribers instantly (no polling to
*see* an update) — it does not itself keep a connector-backed variable's
*source* fresh. Something still has to actually call the connector on an
interval, and that's what was missing: `api!:`'s prefetch loop is
pointer-scoped (`InputBar.jsx` clears its `setInterval` the instant the
pointer leaves the line), so a live-display consumer watching a variable the
operator isn't currently pointed at sees a value that stopped updating.

**Decided:** constant poll is a **separate, explicit, opt-in** mechanism —
never an implicit change to what writing `!api:`/`api:`/`api!:` inline does.
The metacode tiers stay exactly pointer-scoped and frontend-owned, as
originally designed. Backend: a server-side `PollScheduler`
(`packages/plugins/lcyt-connectors/src/poll-scheduler.js`) toggled via
`PUT /connectors/:connectorSlug/requests/:requestSlug/poll`. Once enabled, a
`setInterval` (reusing the request's `prefetch_interval_ms`, floored at
1000ms) keeps calling the resolution engine's `fireRequest()` for the whole
server session — independent of any browser tab, caption pointer, or
operator session — until explicitly disabled. Persisted
(`api_requests.constant_poll_enabled`) and restored on server restart
(`PollScheduler.restore()`), mirroring `ttl-scheduler.js`'s shape.

**Decided (UI placement) — Production, not Setup Hub.** Starting/stopping a
continuous poll is a live, in-the-moment operational call ("watch this value
closely for the rest of the service"), not connector configuration — so the
interactive control lives in the Production workspace, not the Setup Hub
Connectors card. `ConnectorsSection.jsx`'s `RequestRow` keeps only a
**read-only** "● polling" status badge (config surface still shows the
current state; it just can't change it). The actual toggle is a new
`connectorPolls` production pane (`ConnectorPollsPane`,
`components/production/workspace/panes/index.jsx`) — a widget matching the
`variables` pane's per-instance-configurable shape: "+ Add API call" opens a
`Dialog` with a `<select>` of known connector.request pairs
(`useProductionData.js`'s `connectorRequests`, loaded from `GET /connectors`
+ per-connector `GET /connectors/:slug/requests`); each added call renders as
a button that **highlights (solid green, live-dot) when polling is on** and
toggles on click (`D.actions.togglePoll`, optimistic update reconciled
against the real DB state). Removing a call from the widget only stops
*watching* it here — it does not stop the poll itself (mirrors the
`variables` pane's same watch/unwatch-vs-delete distinction).

**Done:** `db.js` (`constant_poll_enabled` column, `setConstantPoll()`,
`listConstantPollRequests()`), `poll-scheduler.js`, the `PUT .../poll` route
(re-keys/stops cleanly on request delete, connector delete, or either's slug
rename — no timer left running under a stale key), `initConnectors()` wiring,
the `connectorPolls` Production widget, the read-only Setup Hub status badge.
Tests: `test/poll-scheduler.test.js`, `test/routes.test.js`'s constant-poll
describe block (fake in-process engine, no real network I/O).

**Not done:** no per-project/admin-wide cap on concurrently-polling requests
— each toggle is an independent server interval with only a per-request rate
floor, not an aggregate-load guard (flagged in
`packages/plugins/lcyt-connectors/CLAUDE.md`).

## 3. Variable-backed text blocks — implemented (scoped)

Distinct from inline `{{name}}` (single value, one line, resolved at send): a
**block** expands a variable's (long) text into multiple **visible, navigable,
sendable** caption lines so the operator can step through them. Use case: an
`api:` call fetches a long text into a variable, normalized (reusing
`normalizeLines.js`) into caption-width lines the operator sends one at a time.

### Decisions — settled 2026-07-18

1. **Syntax — `{{name[N]}}` / `{{name[N*]}}`**, not `<!-- lines: name -->` or
   `{{{name}}}`. Reuses the existing `{{ }}` sigil (the variable is being
   *read*, same as plain insertion) with a bracket length modifier: `N` = soft
   wrap (break at the closest whitespace before `N` chars), `N*` = hard wrap
   (slice at exactly `N` chars, ignoring words). **Block-only**: the marker
   must be the line's entire content — used inline mixed with other text it is
   left as literal, unresolved text (not a product decision worth the
   complexity of partial-line virtual expansion; see rejected alternative
   below).
2. **Expansion — materialize-once-then-freeze**, a *stronger* version of the
   originally-recommended "materialize-on-arrival + freeze while inside."
   Blocks expand once, at file parse time (load, raw-edit save, or reactively
   the first time a previously-unresolved variable arrives), using whatever
   value is available then. They are **not** reflowed by later variable
   changes — an explicit reparse (reload the file / re-save from raw-edit
   mode) re-expands with the then-current value. Chosen over full
   arrival/exit-tracked re-materialization to avoid dynamically shifting line
   counts under the operator's pointer while mid-block (see "Hard part"
   below) — a real simplification, flagged as a scope cut, not an oversight.
3. **Not-yet-fetched fallback — `⏳ … loading…` placeholder**, as
   recommended. Tagged `varBlockPending: true`; a reactive effect
   (`contexts/FileContext.jsx`) re-parses any file with a pending block
   whenever the shared variable snapshot changes, so the block materializes
   for real the moment the value arrives (still a one-time materialization —
   see #2).

**Rejected alternative (inline-anywhere):** letting `{{name[N]}}` sit inside a
line with other text was considered and rejected — what happens to `"Quote: "`
on a wrapped continuation line has no clean answer, and it would make the
virtual-line model N:1 with partial-content stitching instead of the clean 1
source line → N virtual lines mapping block-only gives us.

### Hard part — resolved

Expanded lines are **virtual** (not written back into the raw `.txt`).
`useFileStore`'s 1:1 `lines[]`/`lineCodes[]`/`lineNumbers[]`/pointer model is
preserved *unmodified*: expansion (`lib/metacode-varblocks.js`'s
`expandVarBlocks()`) runs as a pure post-processing pass immediately after
`parseFileContent()`, producing real (not sparse/lazy) entries in those same
parallel arrays — so every existing pointer/`goto`/gutter/advance code path
works for free. Virtual segments share their source line's *raw* line number
(`lineNumbers[i]` stays a plain integer — `goto`/`findLineIndexForRaw` need
that, so it is never restyled into a display string) but are tagged
`virtual: true` / `virtualBlock: name` / `virtualIndex`, from which
`CaptionView.jsx` derives the **gutter display** `20:1`, `20:2`, `20:3`
(`${rawLineNumber}:${virtualIndex + 1}`) — a virtual line reads as generated,
not as if the file actually grew new numbered lines. `rawText` (what gets
saved/persisted) is never touched by expansion, so save/serialize skipping
virtual lines is true by construction rather than requiring an explicit
filter.

### Implementation status (2026-07-19)

**Done:** `lib/metacode-varblocks.js` (`parseVarBlockMarker`, `wrapValue`,
`expandVarBlocks`, `hasVarBlocks`); `metacode-parser.js` detects the block-only
marker and attaches `codes.varBlock` (pure, no variable access);
`hooks/useFileStore.js` applies `expandVarBlocks()` after every parse
(`loadFile`, `updateFileFromRawText`, `loadFileFromText`, initial-mount
restore) via an optional `getVariablesSnapshot` option;
`contexts/FileContext.jsx` supplies the shared snapshot and re-parses files
with pending blocks reactively; `CaptionView.jsx` styles pending/virtual lines
distinctly (`caption-line--var-pending` / `caption-line--virtual`) and shows
the `20:1`-style compound gutter number for virtual lines instead of the raw
integer. Tests: `test/metacode-varblocks.test.js`, `fileUtils.test.js`'s
block-marker describe block.

**Not done:** live re-expand-on-arrival (re-materializing a block fresh each
time the pointer re-enters it, per the originally-recommended semantics) —
would need dynamic pointer-index remapping as the expanded segment count
changes underneath a fixed integer pointer; deferred as a follow-on given
materialize-once-then-freeze already delivers the core value (navigable,
sendable virtual lines) without that risk. A `{{name[N]}}` used inline mixed
with other text is left unexpanded by design (#1), not a bug.

## Dependencies & sequencing

- **Idea 1** is decided; it constrains the connectors frontend wiring only.
- **Idea 2** depended on `plan_pubsub_event_bus.md` (live push) — the bus has
  since shipped, and the live-display half is now implemented on top of it
  (`variable.*` topic via the shared `useVariables()`/`VariablesContext`). The
  background-refresh half remains open (see "Not done" above).
- **Idea 3** depended on the file/pointer-model work; that dependency turned
  out to be avoidable — expansion runs as a pure post-processing pass over
  `parseFileContent()`'s output rather than requiring changes to
  `useFileStore`'s pointer model itself (see "Hard part — resolved" above).
- **Caption-based (`c`) TTL enforcement** (Phase 1b of
  `plan_metacode_variable_unification.md`) does **not** require the event bus, but
  its clean wiring is a `caption.sent` subscription, so it should **ride on the
  event bus as that topic's first consumer** rather than adding a throwaway direct
  send-path hook now. The revert emit itself reuses the existing `VariablesBus`;
  only the "count captions per project + revert `expires_at_seq` rows on the send
  that crosses the threshold" trigger waits on the bus. Time-based TTL already
  covers the common cases, so `c` is not urgent.

## Index Entry

```
| [plan_live_variables.md](plans/plan_live_variables.md) | Live Variables — Continuous Refresh, Live Operator Display, Text-Block Expansion | (1) DECIDED fetch-timing (no load tier — a first-line pointer trigger covers "on load"). (2) Live display implemented: bus-pushed `{{name}}` chip rendering in CaptionView (shared `VariablesContext`, no polling) + a Production-page `variables` watchlist widget (pane model extended to per-instance settings); session-long background refresh implemented as "constant poll" — a deliberately separate opt-in mechanism (server-side `PollScheduler`), not any change to the `!api:`/`api:`/`api!:` metacode tiers, with its interactive toggle placed in a Production workspace widget (`connectorPolls` pane — dialog-driven "add an API call", highlight-on-poll buttons) rather than Setup Hub, since starting/stopping a poll is a live decision, not connector config. (3) `{{name[N]}}`/`{{name[N*]}}` variable-backed text blocks implemented (block-only, soft/hard wrap, virtual lines via a pure post-parse expansion pass — no `useFileStore` pointer-model changes needed, `20:1`-style gutter display); materializes once then freezes rather than live re-expand-on-arrival (deferred follow-on). | |
```
