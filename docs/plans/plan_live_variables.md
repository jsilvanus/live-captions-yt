---
id: plan/live_variables
title: "Live Variables — Continuous Refresh, Live Operator Display, and Text-Block Expansion"
status: implemented
summary: "Forward-looking variable behaviours split out of plan_metacode_variable_unification so that plan can finish on its implemented core (registry/namespace/TTL). Three ideas: (1) the settled connector-fetch-timing decision (no load tier — a pointer-tier trigger on the first line covers 'on load'); (2) an always-updated variable that the operator sees live and normalized — implemented: bus-pushed {{name}} chip rendering in CaptionView (no polling, shared VariablesContext) plus a Production-page watchlist widget, AND a session-long, pointer-independent background refresh ('constant poll') as a deliberately separate opt-in mechanism (server-side PollScheduler) rather than any change to the !api:/api:/api!: metacode tiers, which stay pointer-scoped exactly as before — the interactive toggle lives in a Production workspace widget (ConnectorPollsPane, dialog-driven 'add an API call' + highlight-on-poll buttons), not the Setup Hub, since starting/stopping a poll is a live operational decision, not connector configuration; (3) variable-backed text blocks — implemented in a scoped form: {{name[N]}}/{{name[N*]}} (reusing the {{ }} sigil with a bracket length modifier, decided over the earlier <!-- lines: name --> marker sketch), block-only, materialize-once-then-freeze (a stronger, simpler freeze than 'freeze only while inside, re-expand on next arrival' — deferred as a follow-on), virtual lines displayed with a 20:1-style compound gutter number rather than borrowing new raw integers. Not done: idea 1's 'fire start-of-file triggers even under a restored pointer' robustness detail is decided but not wired into code (`InputBar.jsx`'s pointer-trigger effect keys only off the file's current pointer line, with no line-1-on-open path; verified 2026-07-20 audit); an aggregate cap on concurrently-polling constant-poll requests; live re-expand-on-arrival for {{name[N]}} blocks (kept as materialize-once-then-freeze); and caption-based ('c') TTL enforcement, deferred to ride on the Pub/Sub Event Bus's first caption.sent consumer."
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

**Not implemented (found in 2026-07-20 audit):** the paragraph above describes
intended behavior, but `InputBar.jsx`'s pointer-trigger effect (the one that
fires `!api:`/`api!:` triggers, around its `prefetchIntervalRef` `useEffect`)
keys only off `file.lineCodes[file.pointer]?.apiTriggers` — the file's
*current* pointer line — on every `fileStore.activeFile` change, including the
initial load with a restored non-zero pointer. There is no separate code path
that fires line-1's pointer-tier triggers before the saved pointer is applied,
and `onFileLoaded` (the `useFileStore`/`FileContext` callback that could carry
this) has no consumer anywhere in `InputBar.jsx` or `FileContext.jsx` today. A
file reopened with a saved pointer on line 40 does not refresh whatever
connector line 1 was meant to warm — the gap this section describes as closed
is still open in code.

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
(`useProductionData.js`'s `connectorRequests`, loaded from a single
`GET /connectors` call — the route joins each connector's `requests` in the
same response so this is one HTTP round trip, not `GET /connectors` followed
by an N-connector fan-out of `GET /connectors/:slug/requests`); each added
call renders as a button that **highlights (solid green, live-dot) when
polling is on** and
toggles on click (`D.actions.togglePoll`, optimistic update reconciled
against the real DB state). Removing a call from the widget only stops
*watching* it here — it does not stop the poll itself (mirrors the
`variables` pane's same watch/unwatch-vs-delete distinction).

**Done:** `db.js` (`constant_poll_enabled` column, `setConstantPoll()`,
`listConstantPollRequests()`), `poll-scheduler.js`, the `PUT .../poll` route
(re-keys/stops cleanly on request delete, connector delete, or either's slug
rename — no timer left running under a stale key), `GET /connectors` embeds
each connector's `requests` (avoids the N+1 the widget would otherwise need),
`initConnectors()` wiring, the `connectorPolls` Production widget, the
read-only Setup Hub status badge. Tests: `test/poll-scheduler.test.js`,
`test/routes.test.js`'s constant-poll describe block (fake in-process engine,
no real network I/O) and its `GET /connectors` embedding test.

**Not done:** no per-project/admin-wide cap on concurrently-polling requests
— each toggle is an independent server interval with only a per-request rate
floor, not an aggregate-load guard (flagged in
`packages/plugins/lcyt-connectors/CLAUDE.md`).

### Post-review fixes (2026-07-19)

A `/code-review` pass on this feature surfaced and fixed several real bugs:
- `poll-scheduler.js`'s constant-poll failures were silently swallowed
  (`.catch(() => {})`, no log) — now logged via `lcyt/logger` (`ok:false`
  results are inspected too, not just thrown rejections).
- The request-update route (`PUT /connectors/:connectorSlug/requests/:requestSlug`)
  unconditionally stopped+restarted an active poll on *any* field edit,
  firing one unplanned extra live request each time — now only re-keys when
  the slug or `prefetch_interval_ms` actually changed.
- `useProductionData.js`'s `togglePoll` never reverted its optimistic UI
  update on a failed `PUT .../poll`, and reloaded the entire connector list
  on success instead of using the PUT's own returned row — both fixed.
- `VariablesContext.Provider`'s value wasn't memoized (unlike its sibling
  context values in `AppProviders.jsx`), so every direct consumer re-rendered
  on any unrelated `AppProviders` re-render — now wrapped in `useMemo`.
- `packages/plugins/lcyt-connectors/README.md`'s quick-start example was
  stale (pre-`pollScheduler` 2-arg `createConnectorsRouter` call) — fixed to
  match the current signature.

### Post-review fixes, round 2 (2026-07-19)

A second `/code-review` pass on the same feature surfaced and fixed five more:
- **Freeze violation across sibling blocks:** `expandVarBlocks()` recomputed
  *every* pending or resolved block on each reparse, so resolving one
  `{{name[N]}}` block could silently reflow or refreeze a different,
  already-resolved sibling block elsewhere in the same file — violating the
  "materialize-once-then-freeze" semantics from §3 for anything but the block
  that actually changed. Fixed by threading the file's own already-expanded
  arrays in as `opts.previous = { lines, lineCodes, lineNumbers }`; a new
  `buildFrozenMap(previous)` lets the main loop reuse an already-materialized
  run verbatim (matched by raw source line number) instead of recomputing it,
  so only a block whose backing variable actually changed re-expands.
  `useFileStore.refreshVarBlocks()` now passes the file's current arrays as
  `previous`; the raw-text-edit path (`updateFileFromRawText`) still does a
  fully fresh expansion with no `previous`, correct there since the source
  text itself changed.
- **Missing chip rendering in two `CaptionView.jsx` branches:** the
  empty-send label and the meta/action-label spans rendered `{{name}}` as
  raw JSX text instead of resolving it live like the rest of the line —
  fixed by routing both through `renderTextWithVariables()` /
  `dangerouslySetInnerHTML`, same as the normal-text render path.
- **Stale watchlist keys on rename:** the Production `connectorPolls` pane's
  watchlist stored `connectorSlug.requestSlug` composite strings, which broke
  silently on a connector or request rename (same class of bug as the
  `poll-scheduler.js` rekeying problem below). Fixed by keying watched
  entries by the request's stable `requestId` instead, with
  `resolveWatchedEntry(known, key)` falling back to the legacy composite-string
  match so layouts saved before this change keep resolving.
- **Duplicated watchlist add/remove logic:** `VariablesPane` and
  `ConnectorPollsPane` each hand-rolled their own add/remove-from-a-settings-array
  code. Extracted into a shared `useWatchlist(settings, onSettingsChange, field)`
  hook in `panes/index.jsx`.
- **`PollScheduler` keyed by mutable slug strings:** `start()`/`stop()` were
  keyed by `(apiKey, connectorSlug, requestSlug)`, so every rename path in
  `routes/connectors.js` had to explicitly re-key or stop the affected poll
  timer(s) — an easy spot to miss on a future route change. Rewritten to key
  by the request's stable database `id`: every fire resolves the current
  `api_key`/`connectorSlug`/`requestSlug` fresh from the DB
  (`getConstantPollTarget`), so a rename now needs **zero** scheduler
  interaction anywhere, and a deleted request or an out-of-band
  `constant_poll_enabled=0` self-heals on its next fire instead of depending
  on every mutation path remembering to call `stop()`. See
  `packages/plugins/lcyt-connectors/CLAUDE.md`.

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

**Correction (2026-07-19 code review):** "unmodified" above was true for the
initial parse, but not for the *reactive* re-expand path — a background
variable resolution (`FileContext.jsx`'s effect) could change a file's line
count while the operator's pointer was sitting on a later, unrelated line,
and the original `updateFileFromRawText()` pointer clamp
(`Math.min(file.pointer, lines.length-1)`) kept the same *array index*, not
the same *logical line* — silently moving the active/highlighted caption to
different content mid-broadcast. Fixed with a dedicated
`useFileStore.refreshVarBlocks(id)` that remaps the pointer by raw source
line number (via `metacode-runtime.js`'s existing `findLineIndexForRaw`,
the same helper `goto:` uses) instead of clamping the raw index — manual
raw-text edits still use `updateFileFromRawText`'s original index-clamp
behavior, which is correct there since the raw text itself changed. Also
fixed: one-shot codes on a block's marker line (`timer`, `goto`, `apiTriggers`,
`cue`, `actions`) were being copied onto *every* wrapped virtual segment,
so they re-fired once per segment instead of once for the block — now only
the first segment carries them (`metacode-varblocks.js`'s
`stripOneShotCodes`). And an empty-valued block (`{{name[N]}}` resolving to
`''`) was classified as a metadata-only line, losing its double-click-to-send
gesture — `CaptionView.jsx`'s `isMetaOnly` now excludes virtual lines.

### Implementation status (2026-07-19)

**Done:** `lib/metacode-varblocks.js` (`parseVarBlockMarker`, `wrapValue`,
`expandVarBlocks`, `hasVarBlocks`, `pendingVarBlockNames`, one-shot-code
stripping on non-first segments); `metacode-parser.js` detects the block-only
marker and attaches `codes.varBlock` (pure, no variable access);
`hooks/useFileStore.js` applies `expandVarBlocks()` after every parse
(`loadFile`, `updateFileFromRawText`, `loadFileFromText`, initial-mount
restore) via an optional `getVariablesSnapshot` option, plus a dedicated
`refreshVarBlocks()` for the reactive background path (pointer-safe, see
correction above); `contexts/FileContext.jsx` supplies the shared snapshot
and reactively re-expands only files whose *specific* pending variable name
has resolved (not on every unrelated `variable.*` tick — a real waste under
constant-poll); `CaptionView.jsx` styles pending/virtual lines distinctly
(`caption-line--var-pending` / `caption-line--virtual`) and shows
the `20:1`-style compound gutter number for virtual lines instead of the raw
integer, and (round 2) resolves `{{name}}` in its empty-send/meta-label
branches too. Tests: `test/metacode-varblocks.test.js` (incl. one-shot-code
stripping, `pendingVarBlockNames`, and the round-2 `opts.previous`
frozen-reuse cases — sibling-block isolation, no accidental freeze without
`previous`, a still-pending block gets a fresh resolve attempt),
`fileUtils.test.js`'s block-marker describe block, and
`test/components/useFileStore.test.jsx`'s `refreshVarBlocks()` pointer-remap
test.

**Not done:** live re-expand-on-arrival (re-materializing a block fresh each
time the pointer re-enters it, per the originally-recommended semantics) —
would need dynamic pointer-index remapping as the expanded segment count
changes underneath a fixed integer pointer; deferred as a follow-on given
materialize-once-then-freeze already delivers the core value (navigable,
sendable virtual lines) without that risk. A `{{name[N]}}` used inline mixed
with other text is left unexpanded by design (#1), not a bug.

## Dependencies & sequencing

- **Idea 1** is decided; it constrains the connectors frontend wiring only —
  the fetch-timing model itself needs no further code, but the file-open
  robustness detail (firing line-1 triggers under a restored pointer) is
  decided and not yet wired (see §1's "Not implemented" note).
- **Idea 2** depended on `plan_pubsub_event_bus.md` (live push) — the bus has
  since shipped, and both halves are now implemented on top of it: the
  live-display half (`variable.*` topic via the shared
  `useVariables()`/`VariablesContext`) and the background-refresh half
  (server-side constant poll, see above). Only the aggregate
  concurrently-polling cap remains open (see "Not done" above).
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
| [plan_live_variables.md](plans/plan_live_variables.md) | Live Variables — Continuous Refresh, Live Operator Display, Text-Block Expansion | (1) DECIDED fetch-timing (no load tier — a first-line pointer trigger covers "on load"). (2) Live display implemented: bus-pushed `{{name}}` chip rendering in CaptionView (shared `VariablesContext`, no polling) + a Production-page `variables` watchlist widget (pane model extended to per-instance settings); session-long background refresh implemented as "constant poll" — a deliberately separate opt-in mechanism (server-side `PollScheduler`), not any change to the `!api:`/`api:`/`api!:` metacode tiers, with its interactive toggle placed in a Production workspace widget (`connectorPolls` pane — dialog-driven "add an API call", highlight-on-poll buttons) rather than Setup Hub, since starting/stopping a poll is a live decision, not connector config. (3) `{{name[N]}}`/`{{name[N*]}}` variable-backed text blocks implemented (block-only, soft/hard wrap, virtual lines via a pure post-parse expansion pass — no `useFileStore` pointer-model changes needed, `20:1`-style gutter display); materializes once then freezes rather than live re-expand-on-arrival (deferred follow-on). **Not done:** idea 1's file-open-under-restored-pointer robustness fix (decided, not wired); an aggregate constant-poll concurrency cap; live re-expand-on-arrival; caption-based (`c`) TTL enforcement (rides on the event bus). | |
```
