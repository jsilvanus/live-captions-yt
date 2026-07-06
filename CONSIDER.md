# Consider

Findings from `/code-review` and `/simplify` passes that were deliberately
**skipped** rather than fixed — real observations, judged not worth acting on
immediately (too invasive for the diff at hand, out of scope, or the "fix"
wouldn't actually be simpler). Logged here instead of silently dropped so a
future pass can revisit them with fresh eyes and full context, rather than
rediscovering the same tradeoff from scratch.

Each entry: what was found, why it was skipped, and where.

---

## DSK Editor / DSK Control chrome ignores the site's light/dark theme

**Where:** `packages/lcyt-web/src/components/DskEditorPage.jsx`,
`packages/lcyt-web/src/components/DskControlPage.jsx`

**Finding:** Both pages hardcode their entire UI chrome to a fixed dark
palette via raw hex literals (`#111`/`#0d0d0d` page background, `#1e1e1e`
inputs, `#2a2a2a`/`#1e1e1e` buttons, etc.) — dozens to ~60 occurrences per
file, scattered through individual inline `style={{...}}` props in addition
to the ~7 shared style-constant objects (`btnStyle`, `inputStyle`, etc.) each
file defines at module scope. Neither page reads `--color-*` from
`shared-styles/tokens.css`, so they stay dark regardless of the user's
light/dark theme setting, unlike the rest of the app (Setup Hub sections,
Planner, Broadcast, sidebar — all already theme-aware).

**Why skipped:** Converting just the shared style-constant objects would
leave the many one-off inline hex colors (borders, labels, thumbnail/preview
backgrounds) still hardcoded dark, producing a half-themed page that could
look worse than the current consistent dark aesthetic — e.g. light-colored
buttons floating on a canvas that's still hard-coded dark, or vice versa. A
correct fix needs its own pass auditing every inline style in both files
(one is ~2000 lines), not a few minutes bolted onto an unrelated redesign
task. Also worth deciding deliberately: some graphics/creative tools keep a
fixed dark chrome by design (regardless of app theme) — confirm that's not
the intent here before retheming.

**Fixed in the same pass:** the root cause of why *most* pages already work
was actually broken for one common case — `--color-surface`,
`--color-surface-elevated`, `--color-text-dim`, `--color-active-line`,
`--color-active-line-border`, `--color-sent-flash`, `--color-panel`, and
`--color-accent-dim` were only ever defined inside the
`@media (prefers-color-scheme: dark)` block and the explicit
`[data-theme="dark"]`/`[data-theme="light"]` overrides — never in the
unconditional base `:root`. A user on "system" theme (the default) with
their OS in **light** mode got none of the three blocks and so got these
vars undefined. Added light-mode defaults for all eight to the base `:root`
in `packages/shared-styles/tokens.css`.

(Found during: sidebar icon/redesign + theme pass, 2026-07-05.)

---

## `VariablesBus` duplicates `DskBus`'s SSE subscriber/broadcast logic

**Where:** `packages/plugins/lcyt-connectors/src/variables-bus.js` vs.
`packages/lcyt-backend/src/dsk-bus.js`

**Finding:** `VariablesBus`'s `addSubscriber`/`removeSubscriber`/
`emitVariableUpdated` (Map<apiKey, Set<Response>>, write-with-prune-on-failure
emit) is a line-for-line copy of `DskBus`'s `addDskSubscriber`/
`removeDskSubscriber`/`emitDskEvent`. `VariablesBus`'s own header comment
admits it "mirrors" `dsk-bus.js`.

**Why skipped:** `DskBus` also carries DSK-specific graphics-state fields and
is load-bearing for the DSK feature elsewhere in the app. Extracting a shared
`SseSubscriberBus` base class is the right fix, but doing it safely means
touching `dsk-bus.js` and re-verifying DSK's SSE behavior — outside the
tested surface of the connectors-plugin diff that surfaced this. Do it as its
own change with DSK regression coverage in scope, not as a side effect of an
unrelated feature branch.

(Found during: `/simplify` on `claude/api-connectors-variables-0wce55`, 2026-07-05.)

---

## `useVariables.js` hand-rolls fetch instead of using `lib/api.js`'s `createApi()`

**Where:** `packages/lcyt-web/src/hooks/useVariables.js` (and
`packages/lcyt-web/src/components/setup-hub/ConnectorsSection.jsx`'s local
`useApi()`)

**Finding:** Both do raw `fetch(..., { headers: { Authorization: ... } })`
with manual `.ok` checking — exactly the boilerplate `lib/api.js`'s
`createApi(senderRef, backendUrlRef)` exists to eliminate, and which
`useSession.js` already uses internally.

**Why skipped:** `createApi` takes `senderRef`/`backendUrlRef` — refs
internal to `useSession`, not currently exposed on its public return value.
Wiring `useVariables`/`ConnectorsSection` through it would mean widening
`useSession`'s contract (e.g. exposing its internal `api` object), which is
consumed by many unrelated components across the app. Reasonable to do, but
as a deliberate `useSession` API change with its own review, not folded into
a feature diff that doesn't otherwise touch `useSession`'s public shape.

(Found during: `/simplify` on `claude/api-connectors-variables-0wce55`, 2026-07-05.)

---

## `db.js`'s three `update*` functions repeat the same coalesce-with-fallback shape

**Where:** `packages/plugins/lcyt-connectors/src/db.js` — `updateConnector`,
`updateRequest`, `updateMapping`

**Finding:** All three build a `next = { col: fields.x !== undefined ? fields.x : existing.col, ... }`
object by hand, one line per column, then spell the same columns again in the
`UPDATE ... SET` string.

**Why skipped:** Checked whether a generic `coalesceFields(existing, fields, columnMap)`
helper would actually shrink this — it wouldn't. Two of the three tables need
per-field transforms that read the *existing* row, not just the incoming
value (`auth_config`/`headers` need `JSON.stringify`; `prefetch_interval_ms`/
`timeout_ms` need clamping against the existing value). A column-map generic
enough to express that ends up needing a transform function per field anyway,
which is roughly as much code as the current three explicit blocks — and
harder to read at each call site. Only 3 call sites total, which doesn't
clear the bar for an abstraction. Left as-is on purpose, not an oversight.

(Found during: `/simplify` on `claude/api-connectors-variables-0wce55`, 2026-07-05.)

---

## New `ON DELETE CASCADE` on `caption_targets`/`translation_vendor_config`/`translation_targets` is inert — `PRAGMA foreign_keys` is never enabled

**Where:** `packages/lcyt-backend/src/db/schema.js` (the three new tables from
`plan_selfservice_config_backend.md` §1) vs. `packages/lcyt-backend/src/db/keys.js`'s
`deleteKey()` and `routes/keys.js`'s `DELETE /keys/:key?permanent=true` handler.

**Finding:** All three new tables declare `api_key TEXT ... REFERENCES api_keys(key)
ON DELETE CASCADE`, matching the same declaration already used by
`project_features`/`project_members`/`project_member_permissions`/`project_device_roles`.
But nowhere in the codebase is `PRAGMA foreign_keys = ON` ever issued on the
`better-sqlite3` connection (checked via grep), and SQLite disables FK
enforcement by default — so every `ON DELETE CASCADE` in this schema,
including the three new ones, is currently a no-op. `deleteKey()` is a bare
`DELETE FROM api_keys WHERE key = ?`; the permanent-delete route
(`routes/keys.js`) only manually cleans up DSK images before calling it.
Permanently deleting a project key today already leaves orphaned rows behind
in every one of those "cascading" child tables — this change adds three more
tables to that existing gap rather than introducing a new one.

**Why skipped:** Pre-existing, repo-wide gap (not specific to this diff) —
fixing it means either (a) turning on `PRAGMA foreign_keys = ON`, which risks
surfacing latent FK-violation errors from years of already-orphaned rows in
production-shaped databases the moment it's enabled, or (b) adding manual
`DELETE FROM <table> WHERE api_key = ?` cleanup for every child table (there
are now 7+) inside `deleteKey()`/the permanent-delete route — a real fix, but
one that touches shared deletion code far outside this plan's scope and
deserves its own audit + test pass across all affected tables, not three
lines added incidentally by a config-CRUD feature.

(Found during: `/code-review` on `claude/selfservice-config-backend-djp52h`, 2026-07-06.)
