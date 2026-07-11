# Consider

Findings from `/code-review` and `/simplify` passes that were deliberately
**skipped** rather than fixed — real observations, judged not worth acting on
immediately (too invasive for the diff at hand, out of scope, or the "fix"
wouldn't actually be simpler). Logged here instead of silently dropped so a
future pass can revisit them with fresh eyes and full context, rather than
rediscovering the same tradeoff from scratch.

Each entry: what was found, why it was skipped, and where.

---

## DSK Control chrome still ignores the site's light/dark theme

**Where:** `packages/lcyt-web/src/components/DskControlPage.jsx`

**Finding:** Hardcodes its entire UI chrome to a fixed dark palette via raw
hex literals (`#0d0d0d` page background, `#1e1e1e` inputs, button variants,
etc.) — ~60 occurrences, both in the ~7 shared style-constant objects
(`btnStyle`, `inputStyle`, etc.) and scattered one-off inline `style={{...}}`
props. Doesn't read `--color-*` from `shared-styles/tokens.css`, so it stays
dark regardless of the user's theme setting, unlike the rest of the app.

**Update (2026-07-06):** `DskEditorPage.jsx` (the Graphics Editor — same
pattern, same author) has been fully converted to theme tokens: all chrome
(shared style constants + inline styles) now uses `var(--color-*)`, leaving
only the actual template-content default colors (a newly-created rect's
default fill, etc. — real overlay-graphic properties, not UI) and a couple of
input placeholder-text hints untouched, since those aren't chrome. Verified
in both themes via screenshots. `DskControlPage.jsx` (the broadcast control
panel) has **not** been converted yet — same fix, same shared-style-constant
pattern, not done in this pass. Do it as a follow-up using the same approach
(map each repeated hex to the semantically-closest `--color-*` token, leaving
any genuine content-color defaults alone).

**Why skipped (DskControlPage only):** out of scope for the pass that fixed
the Editor — no reason it can't follow the exact same recipe next time.

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

## `SetupHubPage`'s "Run setup wizard" link nests an `<a>` inside wouter's `<Link>`

**Where:** `packages/lcyt-web/src/components/setup-hub/SetupHubPage.jsx` —
`<Link href="/setup/wizard"><a className="btn btn--ghost btn--sm">...</a></Link>`

**Finding:** React logs a `validateDOMNesting` warning (`<a> cannot appear as
a descendant of <a>`) on every `/setup` render. The wouter version in use
already renders an `<a>` itself for `<Link>`, so wrapping a second `<a>`
inside it is the pre-v3 wouter idiom and no longer needed — `<Link
className="btn btn--ghost btn--sm">🧙 Run setup wizard</Link>` (no nested
`<a>`) is the fix.

**Why skipped:** Noticed incidentally while testing the Setup Hub card
redesign (icons/grid/dialogs); unrelated to that diff and not the only place
in the codebase that may use the older `<Link><a>` pattern — worth a repo-wide
sweep for the same idiom rather than a one-off fix here.

(Found during: Setup Hub card redesign pass, 2026-07-06.)

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

**Update (2026-07-11): the premise is stale.** The installed `better-sqlite3`
enables `PRAGMA foreign_keys` **by default** (verified: `new Database(':memory:')`
reports `foreign_keys = 1`; no explicit pragma exists in the codebase, but none
is needed). So the `ON DELETE CASCADE` declarations are live, not inert — FK
constraint errors are real (a test writing `DELETE FROM organizations` before
`DELETE FROM api_keys` fails with `SQLITE_CONSTRAINT_FOREIGNKEY`). The residual
concern inverts: rather than orphaned rows, deployments upgraded from an era of
already-orphaned rows may hit FK violations on writes touching them. Worth a
short audit pass of `deleteKey()`/permanent-delete against live-FK semantics,
then this entry can close.

**Update (2026-07-11): RESOLVED.** Ran the audit. Full inventory of every
`REFERENCES` declaration in `packages/lcyt-backend/src/db/schema.js`:

- **`api_keys(key)` children (core schema):** `caption_targets`,
  `translation_vendor_config`, `translation_targets`, `project_features`,
  `project_members` (→ `project_member_permissions` cascades transitively via
  `member_id`), `project_device_roles` — **every one is `ON DELETE CASCADE`**.
  So the original finding's premise was doubly stale: not only is FK
  enforcement live, but there is no NO-ACTION `api_keys(key)` child table in
  the core schema left for `deleteKey()` to break on. Confirmed empirically —
  `deleteKey()` on a key with rows in all six tables did not throw.
- **`users(id)` / `organizations(id)` references — this is where the real
  breakage was:**
  - `organizations.owner_user_id` — **NOT NULL, no `ON DELETE` action.**
    Deleting a user who owns an org threw `SQLITE_CONSTRAINT_FOREIGNKEY`.
    Reproduced both in the self-service `DELETE /auth/me` flow (a user who is
    the *sole* member of their own org — the route's existing pre-check only
    blocked the "owns an org **with other members**" case, so a solo-owned
    org fell through to `deleteUserAccount()` and threw) and via direct
    `db/orgs.js` calls.
  - `api_keys.org_id` — no `ON DELETE` action. Deleting an org with member
    projects threw the same error; `DELETE /orgs/:id` had no existing test
    covering this at all.
  - `org_members.invited_by`, `project_members.invited_by`,
    `project_features.granted_by`, `user_features.granted_by`,
    `site_feature_policies.updated_by`, `org_feature_overrides.set_by` — all
    nullable, no `ON DELETE` action. Lower-severity (audit-trail
    attribution, not ownership) but still a real, enforced constraint that
    could block a user delete if that user had ever invited/granted/set
    anything referenced by one of these columns.
  - `api_keys.user_id` — nullable, no `ON DELETE` action, but already handled
    correctly pre-existing (`UPDATE api_keys SET user_id = NULL` in the admin
    route, and `deleteOwnedProjectsForUser()` deleting the key outright in
    the self-service path).

  **Fix:** `packages/lcyt-backend/src/db/orgs.js` gained
  `reassignOrDeleteOwnedOrgs(db, userId)` — for each org the user owns,
  promotes another member (admin-ranked first, then earliest-joined) to
  owner, or if the user is the org's sole member, detaches its projects
  (`api_keys.org_id = NULL`, same semantic as the sibling fix below) and
  deletes the org outright. `deleteOrganization(db, orgId)` now detaches
  member projects before deleting the org row (`api_keys.org_id = NULL`,
  wrapped in `db.transaction`), matching the Caption Target Architecture
  convention that an org vanishing must never delete or break its projects.
  `packages/lcyt-backend/src/db/users.js` gained `clearUserReferences(db,
  userId)` to null out the six audit-trail columns above, and
  `deleteUserAccount()` (self-service `DELETE /auth/me`) now calls
  `reassignOrDeleteOwnedOrgs()` + `clearUserReferences()` before deleting
  `org_members`/`users` rows. `packages/lcyt-backend/src/routes/admin.js`'s
  `DELETE /admin/users/:id` gained an `ownedOrgs` count to its existing
  `?force=true` gate (alongside `activeProjects`) and calls the same two
  helpers on force-delete. `deleteKey()` itself was left functionally
  unchanged for the CASCADE tables (correctly no-op, the engine already
  handles them) but was additionally wrapped in `db.transaction` and now
  explicitly cleans up the **undeclared-FK** `api_key` tables
  (`caption_usage`, `session_stats`, `caption_errors`, `auth_events`,
  `sessions`, `caption_files`, `icons`, `viewer_key_daily_stats`,
  `mcp_tokens`, plus `rtmp_stream_stats`/`rtmp_relays` when present) so a
  permanent key delete doesn't silently orphan rows there — this part isn't
  FK-required (no constraint is declared on those columns) but closes the
  data-hygiene half of the original finding.

  **Chosen semantics (documented for anyone revisiting):** a user's owned
  *projects* survive a user delete (unlink, don't delete — matches the
  pre-existing admin-route behavior this audit found already in place); a
  user's owned *organizations* are transferred to another member when
  possible, torn down only when the user was the org's sole member; an org's
  member *projects* always survive an org delete (detach, don't delete).

  **Ambiguity flagged, not resolved:** `DELETE /admin/users/:id?force=true`
  auto-transfers org ownership to another member without any additional
  confirmation step (unlike `DELETE /auth/me`, which blocks outright rather
  than silently reassigning when other members exist). This mirrors the
  existing `activeProjects` force-unlink behavior's "force means force"
  posture, but a site admin silently losing visibility into who now owns a
  team is a real product question or worth a confirmation UI. Not resolved
  here — flagging for whoever next touches `DELETE /admin/users/:id`.

  **Residual, per-plugin (not fixed here — plugin files are out of scope for
  this pass):** every plugin table that keys off `api_key` (`lcyt-agent`:
  `ai_config`, `ai_model_configs`, `project_ai_role_configs`, `agent_events`,
  `agent_context`, `ai_providers.owner_api_key`, `ai_provider_grants`;
  `lcyt-connectors`: `api_connectors`, `variables`; `lcyt-cues`: `cue_rules`,
  `cue_events`; `lcyt-dsk`: `dsk_templates`, `dsk_viewports` (its "images"
  actually live in `lcyt-backend`'s own `caption_files` table — already
  covered by `deleteKey()`'s cleanup above); `lcyt-files`:
  `key_storage_config`; `lcyt-music`: `music_events`, `music_config`;
  `lcyt-rtmp`: `rtmp_relays` (already cleaned up defensively via the
  `try/catch` in `deleteKey()`/`cleanRevokedKeys()`, but only when the table
  exists), `rtmp_stream_stats` (same), `stt_config`, `stt_source_languages`,
  `radio_config`) declares its `api_key` column with **no FK constraint at
  all** — same undeclared-reference shape as `lcyt-backend`'s own
  `caption_usage`/`mcp_tokens`/etc. before this pass. None of them will
  throw `SQLITE_CONSTRAINT_FOREIGNKEY` on a key delete (no constraint is
  declared to violate), but none of them get cleaned up by `deleteKey()`
  either, since `lcyt-backend` doesn't reach into plugin internals (see the
  Plugin Architecture convention in the root `CLAUDE.md`) — a permanent key
  delete today orphans rows in all of these. Each plugin's own delete/cleanup
  path (if any) should audit this on its own
  schedule.

(Audited 2026-07-11: 888/888 `packages/lcyt-backend` tests pass, including
new failing-first-then-fixed coverage for all four paths above —
`test/keys.test.js` (`deleteKey()` cascade + orphan cleanup),
`test/orgs.test.js` (`DELETE /orgs/:id` with member projects),
`test/admin.test.js` (`DELETE /admin/users/:id` owned-org block/transfer/
teardown), `test/auth.test.js` (`DELETE /auth/me` solo-owned-org teardown +
still-blocks-with-other-members).)

---

## `packages/lcyt-tools`'s shared registry isn't wired into an external-facing MCP transport yet

**Where:** `packages/lcyt-tools/src/index.js` (new, plan/mcp), vs.
`packages/lcyt-mcp-http/src/server.js`.

**Finding:** `plan_mcp.md` specifies one real MCP `Server` registering the
shared tool schema, reachable both by external clients (over real MCP
transport) and by `lcyt-agent` (over an in-process linked transport). This
pass built the registry (`createToolRegistry`) and the in-process half
(`createInProcessMcpBridge`, tested end-to-end with a real
`InMemoryTransport`-connected Client/Server pair) — but did not wire the
external-transport half into `lcyt-mcp-http`.

**Why skipped:** `lcyt-mcp-http` is a **separate OS process** from
`lcyt-backend` (`packages/lcyt-mcp-http/src/server.js` runs its own
`app.listen(PORT)`), connected to the same SQLite file only via `DB_PATH`. It
has no in-process handle to the live `DeviceRegistry`/`BridgeManager`/
`AgentEngine` instances the new tools need (`camera.preset`/`mixer.switch`
need live device/bridge connections; `dsk_template.*` needs a configured
`AgentEngine`) — those only exist inside the running `lcyt-backend` process.
Confirmed by inspection: `lcyt-mcp-http`'s *existing* production/graphics
tools already work around this by proxying HTTP calls back to
`lcyt-backend` with a static, global `X-Admin-Key`/`X-API-Key` (not the
per-connection `apiKey` scoping the new registry's handlers assume) — so
"just register the same tools there" would either require re-implementing
every new tool as an HTTP proxy (defeating the point of building direct,
in-process handlers) or exposing a *new* MCP-reachable endpoint inside
`lcyt-backend` itself (a real, undecided architecture question: new route,
new auth model for external MCP clients hitting the backend directly) —
neither of which plan/mcp actually specifies, so building either now would be
guessing at unspecified product surface rather than executing something
already designed. Left for whoever picks up wiring the external-client half:
decide where that MCP endpoint should live before extending it.

(Found during: implementing plan/mcp's shared tool-schema module, 2026-07-07.)

---

## Bridge-relayed and `deer`-kind AI providers aren't supported by the `agentic_chat` turn loop or vision adapters

**Where:** `packages/plugins/lcyt-agent/src/agentic-turn.js`'s `resolveRoleProviderSettings()`,
consumed by `routes/roles-chat.js`, `routes/production-assistant.js`, `routes/planner.js`,
and `routes/vision-roles.js`.

**Finding:** `plan_ai_model_registry.md` designs `ai_providers.bridge_instance_id` so a
project's Ollama can be reachable only through a specific `lcyt-bridge` instance's LAN, and
Phase 2 of that plan (implemented) added a `model_call` bridge command specifically so
inference could be relayed that way. But `resolveRoleProviderSettings()` — the one function
every `agentic_chat` role (Setup/Asset Control/Graphics Editor Assistant, Production
Assistant, Planner) and both vision roles (Tracker/Describer) use to turn a
`project_ai_role_configs.provider_id` into usable settings — returns `null` for any provider
with `bridge_instance_id` set or `kind: 'deer'`, which every one of those routes then turns
into a `503 AI provider not configured or unsupported`. So the `model_call` bridge command
built in Phase 2 has no real caller yet: discovery (`GET /api/tags`) works over a bridge,
inference does not.

**Why skipped:** Wiring bridge-relayed inference through the turn loop means dispatching a
full multi-turn, tool-calling chat-completions exchange through `bridgeManager.sendCommand()`
instead of a direct `fetch()` — `model_call`'s current shape (`{ sourceUrl?, endpoint, model,
prompt, outputMode }`) was built for vision's single-prompt-plus-image inference, not for an
iterative conversation with a `tools` array and `tool_calls` responses. Extending it to carry
a full OpenAI-style `messages`/`tools` payload and get a structured `tool_calls` response back
over the bridge's request/response round-trip is a real design question (does the bridge parse
tool-call JSON itself, or just relay bytes both ways?) that plan_ai_model_registry.md doesn't
answer — building it now would be guessing at an unspecified wire contract rather than
executing something already designed. `deer` is unimplemented everywhere in this codebase
(Phase 4, unscoped, pending inspection of the actual `jsilvanus/deer` package APIs), so its
`null` here is expected, not a gap.

(Found during: implementing plan_ai_roles_framework.md's `agentic_chat` turn loop and vision
roles, 2026-07-07.)

---

## `AdminProjectDetailPage.jsx`'s revoke flow sends a vestigial no-op `PATCH`

**Where:** `packages/lcyt-web/src/components/AdminProjectDetailPage.jsx`,
`handleRevoke()`

**Finding:** Before calling the real `POST /admin/batch/projects` with
`action: 'revoke'`, the handler first fires
`adminFetch(backendUrl, '/admin/projects/:key', { method: 'PATCH', body:
JSON.stringify({ owner: project.owner }) })` — its own inline comment admits
this is `// no-op for owner, triggers revoke separately`. The response isn't
even checked (`res` is unused). This looks like leftover code from an earlier
implementation that used `PATCH` directly for the status change before the
batch-action route existed.

**Why skipped:** Found while reconciling the Admin pages against the Claude
Design mockup (Profile/Team/Admin session) — fixing it (delete the dead
`PATCH` call) is a one-line, zero-risk cleanup, but it's unrelated to that
session's UI-reconciliation scope and touching a `handleRevoke` fetch call
felt worth a deliberate look (e.g. confirm nothing server-side relies on that
PATCH's audit-log side effect) rather than a drive-by delete.

(Found during: Profile/Team/Admin Claude Design reconciliation, 2026-07-08.)

---

## `FeaturePicker.jsx`'s "Restream fanout" toggle uses the wrong feature code

**Where:** `packages/lcyt-web/src/components/FeaturePicker.jsx` —
`{ code: 'restream-fanout', label: 'Restream fanout', ... }`

**Finding:** The real backend feature code is `restream` (see
`FEATURE_DEPS` in `packages/lcyt-backend/src/db/project-features.js` and
`FEATURE_LABELS` in `AdminUserDetailPage.jsx`/`AdminProjectDetailPage.jsx`,
both of which correctly use `restream`). `FeaturePicker.jsx` has always used
`restream-fanout` instead — a code that doesn't exist anywhere server-side —
so toggling "Restream fanout" in any `FeaturePicker` consumer (project
creation, org team defaults) silently sets a feature flag the backend never
checks, while the real `restream` flag stays whatever it defaulted to. The
new `FeaturePolicyGrid.jsx` (built this session for Admin Site Features/Team
overrides) uses the correct `restream` code — this bug is isolated to
`FeaturePicker.jsx`.

**Why skipped:** Real bug, but `FeaturePicker` is consumed by
`ProjectsPage.jsx` (create-project form), `TeamPage.jsx` (team feature
defaults), and others — fixing the code string is one line, but verifying no
stored feature sets anywhere already depend on the wrong string (unlikely
given it never matched a real backend code, but worth a quick grep/data check
first) felt like it deserved its own small pass rather than a side-effect fix
buried in an unrelated UI-reconciliation diff.

(Found during: Profile/Team/Admin Claude Design reconciliation, 2026-07-08 —
building `FeaturePolicyGrid.jsx` required re-deriving the real feature-code
list from `plan_site_feature_policies.md`, which is what surfaced the
mismatch.)

## Server-STT delivery doesn't compose translated caption text for YouTube/viewer targets

**Where:** `packages/plugins/lcyt-rtmp/src/stt-manager.js` (`_deliverTranscript`)

**Finding:** The server-STT delivery path computes `captionLang` from
`captions`-target translation rows but never uses it: YouTube targets get
`sender.send(trimmed, ts)` (original text only) and viewer broadcasts set
`composedText: trimmed`. The client-driven path (`routes/captions.js`)
composes via `composeCaptionText(text, captionLang, translations,
showOriginal)` and does per-target routed composition via
`translationsByTargetId`, so a "captions"-target translation changes what
YouTube/viewers see there but not in server-STT mode. Viewers still receive
the raw `translations` map, so viewer pages can render translations — the gap
is the composed text (and per-target routing / `show_original` handling).

**Why skipped:** Reproducing `captions.js`'s Phase 5 per-target composition
(routed `caption_target_id`, per-row `show_original`, `<br>` composition)
inside `_deliverTranscript` is a real chunk of duplicated logic; the right fix
is probably extracting the composition/fan-out block from `routes/captions.js`
into a shared helper (like `caption-file-writer.js` did for archiving) and
using it from both paths — its own pass, not a side effect of the archiving
fix that surfaced it.

(Found during: caption/translation pipeline audit after `plan_batch_options`,
2026-07-10 — the same audit fixed the sibling gap where `_deliverTranscript`
translated for `backend-file` targets and then dropped the result; archiving
is now wired via `createSessionCaptionFileWriter` + `setDeliveryHelpers`.)

**Update (2026-07-10): RESOLVED.** The extraction pass ran the same day:
`src/caption-fanout.js` (`createCaptionFanout({ db })`) now owns the
extra-target delivery block, `routes/captions.js` calls it (move-not-change —
route tests unchanged as the regression proof), and `SttManager` receives it
plus `composeCaptionText` via `setDeliveryHelpers`. Server-STT now composes
YouTube/viewer/primary-sender text (per-row `show_original`, vendor-config
fallback), honours per-target routing, and registers viewer key owners — a
stats-attribution miss the extraction also surfaced and fixed. The old
`broadcastToViewers` injection was removed.

## `lcyt-rtmp`'s `test/rtmp-manager.unit.test.js` is not in the package's test script and has bit-rotted

**Where:** `packages/plugins/lcyt-rtmp/package.json` `test` script vs.
`packages/plugins/lcyt-rtmp/test/rtmp-manager.unit.test.js`.

**Finding:** The rtmp `test` script lists test files explicitly and omits
`rtmp-manager.unit.test.js` — so it has never run in CI. Adding it surfaces
one failing case ("awaits runner.start and writeCaption returns false when no
fifo writer"), i.e. the test has drifted from the current `RtmpRelayManager`
behavior. Same class of gap as `lcyt-dsk`'s `test/index.js` (which was
silently skipping `dsk-slug-routes.test.js`, fixed in Phase 2/3).

**Why skipped:** Out of scope for the Phase 5 colorkey change that surfaced it
— fixing means either repairing the stale assertions against current behavior
or deleting the file, which deserves its own look at what it was meant to
cover. Left the rtmp `test` script listing my new `dsk-composite-filter.test.js`
but not `rtmp-manager.unit.test.js`.

(Found during: plan_dsk_viewport_settings Phase 5, 2026-07-11.)

---

## Auth Middleware: 10 Altitude Issues Require Unified Token & Access-Control Model

**Where:** `packages/lcyt-backend/src/middleware/project-access.js` and related route/DB files

**Findings:** `/simplify` review surfaced 10 interrelated altitude issues in the auth refactor (PR #252):

1. **Fragile token-type detection** — Token type is inferred from prefix (`lcytmcp_`) + payload field introspection (`payload.kind`, `payload.type`, etc.) across 4 token branches rather than from a canonical JWT field. Runtime derivation vs. issuance-time validation.

2. **Overly exhaustive project ID resolution** — `resolveProjectId()` searches ~15 locations (headers, route params, body, query) instead of enforcing a single convention (e.g., always `X-Project-Id` header for scoped endpoints, hierarchical route param for others).

3. **Four duplicate resolve+validate+attach patterns** — External/session/user/device token branches each repeat: resolve projectId → check not-null → call accessLevel check → attach context → next(). Fixed with `handleTokenAuth()` factory (commit `8581b2c`), but only locally — the underlying polymorphism remains.

4. **Scope checking only on external tokens** — `requiredScope` validation lives only in the external-token branch, but user/project/device tokens also carry scopes. Inconsistent enforcement.

5. **Session tokens bypass membership verification** — Only user tokens call `getMemberAccessLevel()`; session/external/device tokens are accepted unconditionally. Different access-control standards per token type.

6. **Scattered access-control concerns** — Membership checks happen in middleware, routes, and DB modules independently. Routes re-implement token extraction (`verifyUserToken` duplicated in 4 files — partially fixed in commits `e028e06`/`482b83b`, but keys.js patterns remain) instead of trusting middleware.

7. **Inconsistent request context attachment** — `req.user`, `req.auth`, `req.project`, `req.session` are conditionally set depending on token type. No guaranteed shape across all flows.

8. **Ad-hoc scope serialization** — `serializeScopes()` / `parseScopes()` try JSON.parse with CSV fallback, applied at every read/verification. Suggests scopes aren't normalized at issuance time.

9. **`normalizeUserPayload()` defined but inconsistently used** — Reusable, but `project-access.js` extracts fields inline instead of calling it, and it's not called by device-token branch.

10. **Device-roles router re-implements auth** — `verifyUserToken()` (now using shared `extractAndVerifyUserToken()` after commit `482b83b`) was duplicated in routes instead of relying on middleware to attach context.

**Root cause:** The middleware adds **polymorphism at the middleware layer** (4 token types) without first refactoring the **underlying domain model** (token structure, access-control gate, request context shape). Result: each branch has its own special cases + defensive logic, and routes don't trust the middleware to do auth consistently.

**What fixed:** Commits `e028e06`, `8581b2c`, `482b83b` addressed the **local reuse/simplification issues**:
- Consolidated `resolveProjectId` loops (29 lines saved)
- Extracted `handleTokenAuth()` factory (32 lines saved)
- Unified user-token extraction helper (33 lines saved)
- Removed dead code + optimized scope parsing (4 lines saved)

**What remains:** The **altitude issues** (10 findings) all point to the same architectural gap: token payloads, membership-check gate, and request context need to be unified *first*, before adding polymorphism. Doing so now would require:

- Redesign all 4 token payloads to have canonical field names (`type` instead of `kind`, etc.)
- Extract a single membership-check gate that applies after token verification, regardless of type
- Define a consistent request context object (`req.auth` or `req.context`) with guaranteed shape
- Establish canonical scope format (e.g., always JSON array in DB), normalized at token creation

These are **design-level changes**, not local refactorings. Worth revisiting after this pass ships, with explicit product/architecture alignment on the unified model.

**Why skipped:** Fixing the altitude issues would mean re-architecting 4 token types + unifying access control across 3+ layers (middleware/routes/DB), then re-testing all auth flows (368 backend tests exist; many would need assertion updates). Out of scope for a focused `/simplify` pass. This pass delivered measurable local cleanup (98 lines saved, 5 reusable helpers extracted), leaving the broader unification for a future architectural pass with its own scope and test coverage.

(Found during: `/simplify` review on auth-refactor-plan (PR #252), 2026-07-11.)

