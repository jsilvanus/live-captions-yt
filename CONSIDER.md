# Consider

Findings from `/code-review` and `/simplify` passes that were deliberately
**skipped** rather than fixed — real observations, judged not worth acting on
immediately (too invasive for the diff at hand, out of scope, or the "fix"
wouldn't actually be simpler). Logged here instead of silently dropped so a
future pass can revisit them with fresh eyes and full context, rather than
rediscovering the same tradeoff from scratch.

Each entry: what was found, why it was skipped, and where.

---

Resolved entries are moved to [`docs/CONSIDER-archive.md`](docs/CONSIDER-archive.md) (last sweep 2026-10-05); this file lists only what is still open or only partly resolved.

---

## `middleware/project-access.js`'s `resolveProjectId()` scavenges route `:id`/`:key` params generically, which is wrong on routers where that param isn't the project's api key

**Where:** `packages/lcyt-backend/src/middleware/project-access.js` (`resolveProjectId()`, used by both `createProjectAccessMiddleware` at request-auth time and, deliberately *not* reused by, `requireProjectRole()` — see that function's own doc comment added 2026-07-26).

**Finding:** `resolveProjectId()`'s candidate list includes generic `req.params?.id`/`req.params?.key` alongside `req.params?.apiKey`/`projectId` — fine for routes like `/keys/:key` where `:key` really is the project's api key, but actively wrong for a route like `PUT /targets/:id` where `:id` is a *target row's* id. When a request omits an explicit `X-Api-Key`/`X-Project-Id` header (relying solely on the JWT's own embedded `projectId`), `createProjectAccessMiddleware` still calls this scavenger first and picks up the wrong value — resolving to a garbage "project" that doesn't exist, so `getEffectiveProjectAccessLevel()` returns `null` and the request 403s with "Not a project member" even for a real, fully-authorized user. Also found and fixed alongside this: the scavenging loop itself had a genuine crash bug (`for (const candidate of candidates) { ... (candidate = candidate.trim()) ... }` — reassigning a `const` loop variable, `TypeError: Assignment to constant variable`), which this same investigation triggered for the first time via a previously-dead code path.

**Skipped (the design issue, not the crash — that part *was* fixed):** every real caller in this codebase's own convention always sends an explicit `X-Api-Key` header (confirmed via the DSK/mcp-tokens routes' documented "JWT Bearer or X-API-Key" pattern), which short-circuits `resolveProjectId()` before it ever reaches the scavenging loop — so this is very likely dormant in production today, not a live bug. Fixing the scavenger's design properly (e.g. dropping the generic `:id`/`:key` candidates, or making callers opt in to which param names are safe to scavenge per-router) touches the core auth middleware used by every project-scoped route in the app — too broad a change to make as a side effect of the Setup/Assets/Production role-gating pass that found it. `test/targets.test.js` was updated to always send `X-Api-Key` (matching real client behavior) rather than depend on the scavenger.

(Found during: Phase 2 Stream A, `plan_project_roles.md`, 2026-07-26.)

---

## `createOrgNetworkRulesRouter` mounted at `/` swallows unmatched requests as 401, not 404

**Where:** `packages/lcyt-backend/src/server.js` — `app.use(createOrgNetworkRulesRouter(db, createUserAuthMiddleware(jwtSecret)))`, no path prefix (matches every request path); `packages/plugins/lcyt-connectors/src/routes/network-rules.js`'s org-scoped router applies `router.use(userAuth)` unconditionally, with no path scoping of its own.

**Finding:** Because this router is mounted at `/` (not e.g. `/orgs/:orgId/connector-network-rules`), every request that reaches this point in `server.js`'s middleware chain without a valid user Bearer token gets a 401 `"Missing or invalid Authorization header"` from this router's internal auth check — even for paths this router has no route for at all, and even for requests where the *intended* behavior is a plain 404 (an unmounted/disabled route). Confirmed via `plan_env_to_ui_settings.md`'s Phase 4 work: converting `RTMP_RELAY_ACTIVE`'s route-mount `if` into a request-time hot gate (`packages/lcyt-backend/src/server.js`'s `/rtmp` mount) revealed that `GET /rtmp` with RTMP disabled and no auth returns 401 from this router, not a 404 — but a same-environment boot of the pre-Phase-4 code (`git stash`, same request) reproduces the identical 401, so this is pre-existing and not a regression from the hot-gate change.

**Why skipped:** out of scope for the settings migration — fixing it means either scoping this router's mount path properly or moving `router.use(userAuth)` to only the routes that need it inside `network-rules.js`, both of which are `lcyt-connectors`-plugin changes unrelated to server settings. Flagging here since any future work relying on "an unmounted/disabled route 404s" (like the settings plan's own hot-gate design assumption) should know this specific global-catch-all sits ahead of most late-mounted routers in `server.js`'s file order and will intercept first.

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


## `/legacy` route broken — remove in favor of `/captions`

**Where:** `packages/lcyt-web/src/main.jsx` (lines 90, 136, 163)

**Finding:** The `/legacy` route renders the caption editor as a standalone page (`<App />`), parallel to `/captions` which renders it embedded in the sidebar. However, the routing logic uses a static `path` variable captured at module load time:

```javascript
const path = window.location.pathname;  // evaluated once
function getStandalonePage() {
  if (path.startsWith('/legacy'))  page = <App />;  // uses stale path
}
```

**Why broken:** Client-side navigation to `/legacy` from a sidebar page (e.g., clicking the "Legacy" nav item added 2026-07-15) doesn't update the static `path` variable. The router never realizes you've navigated to a standalone page and renders the wrong component. The route only works via direct URL navigation or page reload.

**Why skipped:** Now that `/captions` provides the same caption editor functionality and is properly routed through wouter (dynamic), `/legacy` is redundant. Rather than fix the static-path routing architecture (a broader refactoring), just remove `/legacy` entirely and rely on `/captions` + the sidebar toggle.

**Recommendation:** Delete `/legacy` from `isStandalonePath()`, remove the check from `getStandalonePage()`, and remove the hardcoded legacy link from `Sidebar.jsx`'s main section (already done as part of the Legacy nav item refactor, 2026-07-15). Keep `/captions` as the canonical caption editor route (embedded in sidebar, accessible via legacy nav toggle).

(Found during: routing consolidation pass, 2026-07-15.)

---

**Update 2026-10-06:** kept on purpose. Juha wants to discuss the route first; do not remove it until that is settled.

---

## Auth Middleware: 10 Altitude Issues Require Unified Token & Access-Control Model — mostly RESOLVED 2026-09-10

**Where:** `packages/lcyt-backend/src/middleware/project-access.js` and related route/DB files

**Original findings:** `/simplify` review surfaced 10 interrelated altitude issues in the auth refactor (PR #252). A 2026-09-10 repo-study pass re-verified each against the current code (issuance sites, `req.auth` usage repo-wide, the `test/project-access.test.js` contract) before touching anything, since this middleware gates nearly every route in the app (1161 backend tests as of that date, not the 368 this entry originally cited). Status per finding:

1. ✅ **Fragile token-type detection** — issuance already wrote both `type` (coarse `'user'|'device'`) and `kind` (fine `'user'|'project'|'device'`) at issuance (`routes/auth.js`'s `issueProjectToken()`, `routes/device-roles.js`'s device-login handler); verification just repeated the same OR-chains inline in 3 places. Extracted `classifyToken(payload)` — one pure function, same precedence as before (device → session-shape → user-shape → reject), no behavior change. `test/project-access.test.js`'s `body.auth.kind` assertions (`'project'`/`'external'`/`'device'`) still pass unchanged.

2. **Overly exhaustive project ID resolution** — still open. `resolveProjectId()`'s ~15-location scavenging is real, but several routes' specific behavior depends on exactly this search order (see `requireProjectRole()`'s own comment about `:id` param collisions on routes like `PUT /targets/:id`, where `:id` means something else entirely). Narrowing this needs a per-route audit of what each route actually sends — a separate, larger pass.

3. ✅ (partially) **Four duplicate resolve+validate+attach patterns** — `handleTokenAuth()`/`attachProjectContext()` (already extracted before this pass) cover the shared attach step. One live duplicate this pass found that the original finding didn't name: `routes/project-slug.js` had its own local `verifyUserToken()`, narrower than the shared `middleware/user-auth.js`'s `extractAndVerifyUserToken()` (no cookie/`?token=` fallback). Swapped to the shared helper — `lcyt_identity` cookie and `?token=` now work on slug routes like everywhere else (new test in `test/project-slug.test.js`).

4. **Scope checking only on external tokens** — confirmed real, but it's a functional gap, not a dedup: `POST /auth/project-token` accepts a client-supplied `scopes` array and bakes it into the issued JWT, but nothing in `project-access.js` ever enforces it for user/project/device token kinds (only `tokenHasScope()` on the external branch). Turning on enforcement now is a product decision (what caller ever sets this? is silent-full-access the intended fallback today?), not a mechanical fix — left alone.

5. **Session tokens bypass membership verification** — by design for 2 of the 3, not a bug: session tokens (`routes/live.js`) are self-scoped to the one apiKey minted at `/live`, external tokens are pre-scoped to a project at `POST /mcp-tokens` creation time by a member (the membership check already happened once, upstream). Device tokens are the one asymmetric case (checks `isDeviceRoleActive()` but never rechecks the project itself) — see the new revoked-key entry below, which subsumes this more broadly.

6. ✅ Same as #3 above — the `project-slug.js` duplicate was the live instance of this.

7. ✅ **Inconsistent request context attachment** — already resolved before this pass, not by it: `attachProjectContext()` sets `req.auth`/`req.project`/`req.session`/`req.user` with the same guaranteed shape across all 4 branches (verified: 69 usages of `req.auth` across 13 files, all assuming this shape). This finding was stale. Tightened the `req.project.projectRole` doc comment to state plainly it's display-only, never a gate — the actual residual risk here was a comment easy to misread, not a missing shape.

8. ✅ (partially) **Ad-hoc scope serialization** — real, but narrower than described: only `db/mcp-tokens.js`'s DB-stored external-token scopes have the JSON/CSV ambiguity (a JWT payload can't have it — it's JSON by construction). `serializeScopes()` now always normalizes to a canonical JSON array at write time (a bare string or comma list gets split/converted instead of stored raw); `parseScopes()`'s CSV-fallback stays for reading back any pre-existing non-JSON row. New test in `test/mcp-tokens.test.js`.

9. ✅ **`normalizeUserPayload()` defined but inconsistently used** — device branch now calls it instead of extracting `userId`/`email`/`siteRole` inline. Confirmed behavior-neutral for real device tokens (which carry none of those fields today, so both paths already resolved to `null`).

10. ✅ **Device-roles router re-implements auth** — already resolved before this pass (grep confirms `routes/device-roles.js` uses the shared `extractAndVerifyUserToken()` at all 7 of its call sites); the entry's own note said this was fixed by commit `482b83b`.

**New, broader finding surfaced by this pass** (not one of the original 10 — see its own entry below): `getEffectiveProjectAccessLevel()`/`getMemberAccessLevel()` never check `api_keys.active`, so a revoked project key doesn't invalidate an already-issued JWT of *any* kind, not just session/device. Left out of this pass — different, broader risk profile than the 10 findings above.

**What's genuinely still open:** #2 (`resolveProjectId()` scavenging) and #4 (uniform scope enforcement) — both are real product/architecture decisions, not mechanical fixes, exactly as the original entry said. Everything else above was either already stale (shape, dedup) or closeable as a same-behavior refactor plus 2 small, test-covered fixes (device normalizeUserPayload, scope serialization). 1163/1163 backend tests pass after this pass (2 new).

(Found during: `/simplify` review on auth-refactor-plan (PR #252), 2026-07-11. Re-studied and partially resolved 2026-09-10.)

---


## Per-plugin SSE registries not individually gauged

**Where:** `packages/lcyt-backend/src/metrics/index.js` (`setSseGauge`),
`src/routes/stt.js`, `src/routes/mcp-endpoint.js`,
`packages/plugins/lcyt-production/src/bridge-manager.js`

**Finding:** plan_metering_audit §4.4 listed 8 SSE registries for connection
gauges. Implemented: `viewer` (viewerSubs) and one `event-bus` gauge covering
every bus-backed subscription (events-stream, DskBus, VariablesBus, RolesBus)
via `EventBus.sseSubscriberCount()`. The remaining bespoke registries (STT
per-connection listeners, MCP endpoint sessions, bridge-manager SSE channels)
would each need their own size accessor threaded through; skipped as low-value
for the live panel v1.

---

## PR #282 (Cue Rules editor + composite condition trees) — remaining cleanup findings

**Where:** `packages/lcyt-web/src/components/{planner/PlannerAssistPanel,NamedActionsManager,CuesPage}.jsx`,
`packages/plugins/lcyt-cues/src/routes/cues.js`

**Finding:** a scheduled `/code-review --comment` pass on PR #282 posted 10
correctness/efficiency findings as inline PR comments (the diff-comment
budget) and logged 9 reuse/simplification/convention findings here for a
follow-up pass. That follow-up fixed 6 of them:

- ✅ `isLeafNode()`/`CueEngine._isLeafNode()` duplication — extracted to
  `packages/plugins/lcyt-cues/src/condition-tree.js`, imported by both.
- ✅ The inlined `req.session?.apiKey`/401 check (~10 call sites in
  `routes/cues.js`) — extracted to `requireApiKey()` in the new
  `packages/plugins/lcyt-cues/src/routes/helpers.js`, mirroring the
  `lcyt-actions` convention.
- ✅ `CuesPage.jsx`'s hand-rolled authed-fetch wrapper — extracted to the new
  `packages/lcyt-web/src/hooks/useAuthedFetch.js` and adopted by
  `NamedActionsManager.jsx` too (replacing its narrower `authHeaders()`
  pattern), rather than the other way around, since `CuesPage`'s version was
  the more complete abstraction (a full fetch wrapper vs. a bare
  headers-getter).
- ✅ The copy-pasted "parse action JSON + `insertCueEvent`" block (7 sites in
  `cue-engine.js`) — collapsed into a single `_recordFired(apiKey, rule,
  matched)` helper.
- ✅ `_nodeIsAsync()`/`_orderByCost()` re-walking the whole composite tree on
  every `evaluateComposite()` call — added `_precomputeOrder()`, run once in
  `_loadRules()`/`_loadNamedConditions()` right after parsing, which mutates
  each tree's group nodes' children into pre-sorted order and marks them
  `__ordered`; `evaluateComposite()` skips re-sorting when that flag is set.
  Ad hoc trees (inline cues, whose `localDefs` vary call to call) still sort
  per-call as before. Regression test added confirming the cheap-before-async
  ordering still holds through the DB-rule load path.
- ✅ `cue-processor.js:173`'s `console.warn(...)` (new in this PR) — now
  `logger.warn(...)`.

Three were evaluated and intentionally left as-is:

- `PlannerAssistPanel.jsx`'s `.planner-assist-panel__tab` CSS, on closer look,
  isn't actually a blind duplicate of `.settings-tab`/`.settings-tab--active`:
  it uses `flex: 1` (two tabs split the 280px sidebar's width evenly, a
  segmented-control look) versus `.settings-tab`'s `flex: 0 0 auto` (sized to
  content, meant for a horizontally-scrollable multi-tab bar), plus a
  different color token and font-size. Forcing reuse would visually regress
  the Planner's tab bar from an even split to left-aligned, content-sized
  tabs. Left alone; revisit only if the two are deliberately unified as a
  design decision, not as a code-reuse pass.
- `NamedActionsManager.jsx`'s ~150-line CRUD-dialog state machine (a third
  copy of the pattern `CuesManager`/`LanguagesManager` also use) — a shared
  `useCrudDialog` hook is the right shape long-term, but the three managers'
  field sets, validation, and slug-locking rules differ enough that extracting
  one safely is a real design task, not a mechanical dedup; deferred rather
  than risking a rushed abstraction across three already-shipped, tested
  components.
- `treeContainsTrackLeaf()` staying duplicated between `CuesPage.jsx`
  (browser) and `routes/cues.js` (Node backend plugin) — the frontend can't
  depend on a backend plugin's internals without breaking the
  frontend/backend architecture boundary, so genuine code sharing would need
  a new isomorphic shared package just for this one ~15-line predicate. Both
  copies were already fixed to correctly resolve `ref` nodes (the actual bug);
  the duplication itself is an accepted cross-runtime tradeoff, not something
  left broken.

All fixes verified: 110 backend tests (9 new), 428 + 430 frontend tests, all
passing.

---

## `CAMERA_CONTROL_TYPES` duplicated between `routes/cameras.js` and `crud.js`

**Where:** `packages/plugins/lcyt-production/src/routes/cameras.js`,
`packages/plugins/lcyt-production/src/crud.js`

**Finding:** Both files independently declare the same
`CAMERA_CONTROL_TYPES` array (camera `control_type` validation) — a
pre-existing duplication (the file header comment on `crud.js` already flags
it: "kept deliberately separate from the route files ... see CONSIDER.md for
the follow-up to de-duplicate") that `plan_ingest_feeds.md`'s new `'rtmp'`
control type had to be added to in both places to keep the HTTP route and
the in-process `lcyt-tools`/MCP path consistent. Still not de-duplicated —
doing so would mean routing `crud.js`'s callers through the same validation
helper as the Express routes, a small refactor but touching both files'
public shape.

**Why skipped:** out of scope for `plan_ingest_feeds.md`'s ingestion work;
noted so the next control-type addition doesn't silently miss one copy again.

---

## Egress relay-slot UI: localStorage list doesn't sync from `GET /stream`, and only one of three consumers got the new source picker

**Where:** `packages/lcyt-web/src/lib/relayConfig.js`,
`packages/lcyt-web/src/components/setup-hub/EgressSection.jsx`,
`packages/lcyt-web/src/components/panels/RelayPanel.jsx` /
`broadcast/StreamTab.jsx`, `components/panels/RelaySlotRow.jsx`

**Finding:** `plan_ingest_feeds.md` needed a per-slot "source" picker
(Program / Vertical Crop / named feed camera) so an operator can route
different incoming feeds to different egress targets. Two pre-existing
architectural facts made this bigger than it looked while implementing it:

1. The relay-slot list the UI edits (`relayConfig.js`, `buildInitialRelayList`)
   is **entirely localStorage-backed** and never fetched from `GET /stream` —
   it independently POSTs to the backend on every change but never reads the
   backend's actual configured slots back. This predates this plan; not
   touched here.
2. `RelaySlotRow` (the shared per-slot editor) is used by **three** call
   sites — `EgressSection.jsx` (Setup Hub), and `RelayPanel.jsx` (used by
   `StreamTab.jsx`, the `/broadcast` page). The new `feedCameras` prop (the
   camera list that drives the source picker) was only wired into
   `EgressSection.jsx`. `RelayPanel.jsx`/`StreamTab.jsx` don't fetch or pass
   it, so the picker simply doesn't render there (the prop defaults to `[]`,
   backward compatible) — those two surfaces are still Program-only.

**Why skipped:** fixing #1 is a real backend-sync rewrite of the relay-slot
data model, unrelated in size to "add a dropdown," and risked destabilizing
the existing (untested) Egress UI without being able to visually verify the
result in this pass. Fixing #2 is smaller — wire the same `feedCameras` fetch
into `RelayPanel.jsx`/`StreamTab.jsx` and pass it through — and is the more
likely next step; noted here so it isn't lost.

---

## No frontend UI to create/configure `ai_providers` rows — admin-side CRUD is API-only

**Where:** `packages/plugins/lcyt-agent/src/routes/ai-providers-admin.js`,
`packages/lcyt-web/src/components/setup-hub/AiRoleModelsSection.jsx`

**Finding:** while building the Setup Hub AI role→model picker
(`plan_ai_model_registry.md` Phase 3), confirmed the admin-level provider CRUD
routes are fully implemented and tested — create/update/delete a provider,
model discovery, per-project grants (`ai-providers-admin.js`) — but no page in
`lcyt-web` ever calls any of them. `AiRoleModelsSection.jsx` reads providers via
the project-scoped `GET /ai/providers` (providers already granted to the
project) and shows an empty-state note when there are none, but there's no
"add a provider" flow anywhere in the UI — a provider has to be created by a
direct API call today, same shape of gap `plan_ai_model_registry.md`'s original
Tier 1 line described for role config before this pass closed that half.

**Why skipped:** out of scope for the Phase 3 task, which was scoped to wiring
*existing* providers into role config, not building provider CRUD itself.
Building it would need a new admin-facing page/section (provider list, create
dialog with per-vendor auth fields, model-discovery trigger, per-project grant
management) — a real, separately-schedulable chunk of UI work, not a small
addition to the role-picker card.

(Found during: `plan_ai_model_registry.md` Phase 3 implementation, 2026-07-20.)

---

## Server settings (plan_env_to_ui_settings.md) Phase 5 — two small env-only gaps remain unregistered

**Where:** `packages/lcyt-backend/src/storage/s3.js` (5 raw `process.env.S3_*` reads: `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`), `packages/plugins/lcyt-cues/src/cue-engine.js` (3 raw `process.env.CUE_EVENT_TIMEOUT_MS` reads)

**Finding:** Both are real remaining `process.env` direct-reads that haven't been migrated to the settings system or registered in `registry.js`. `S3_*` are used by `packages/lcyt-backend/src/storage/s3.js`'s `isS3Enabled()`, `buildS3Url()`, and `uploadDirectoryToS3()` functions, which are called from `packages/lcyt-backend/src/db/videos.js`'s `syncVideoRecordingToStorage()` — the S3 upload path for recorded videos. `CUE_EVENT_TIMEOUT_MS` is an undeclared env var with no registry entry at all (defaults to `'5000'` via `parseInt(..., 10)` in three places inside the cue evaluator), used to timeout event-cue matching when a `match_timeout` field is set on a rule.

**Why skipped:** Each needs a different resolution:
- **S3 configuration:** All five `S3_*` vars are infrastructure/credentials; `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` should probably be Tier A (env-only, never DB) like other secrets. But `isS3Enabled()`, `buildS3Url()`, and `uploadDirectoryToS3()` have no `settings` parameter threaded through them — they're called from deeply-nested DB helpers, not route/plugin composition roots. Wiring settings down through the call chain (`db/videos.js` → storage helpers → settings) or lifting the S3-check/build logic out of these generic helpers would both be invasive and non-local to this pass. Worth its own, focused threading pass once a future change does need these to be reconfigurable without restart.
- **`CUE_EVENT_TIMEOUT_MS`:** No registry entry exists at all. Adding one (`retention.cue_event_timeout_ms`? — needs a category/description choice and a default value decision: the current implicit `5000` or something else?), registering it in `registry.js`, and threading `settings` into `CueEngine` would be straightforward individually but are three separate decisions (categorization, default, threading location) that feel like a `lcyt-cues`-specific pass rather than a finishing touch on the backend settings refactor that this phase is.

**Recommendation:** Log both in a future pass specifically scoped to S3/storage configuration and cue-engine behavior — they're real, confirmed, non-speculative gaps, just not part of the current phase's already-tight scope (app URL, retention, STT/metrics/AI defaults).

(Found during: settings migration Phase 5 completion audit, 2026-07-21.)

---

## Bridge security IP-allow/deny checks apply the same rule shape to http_request/model_call as to tcp_send, despite being a coarser fit

**Where:** `packages/plugins/lcyt-production/src/bridge-manager.js`'s `_checkSecurity()`/`_resolveIpTarget()`, `packages/lcyt-bridge/src/bridge.js`'s equivalent local check, `packages/plugins/lcyt-production/src/bridge-security.js`

**Finding:** The new per-bridge `bridge_security_rules` `ip` rule kind (host/CIDR/wildcard pattern, optional `:port`) is evaluated identically for all five bridge command types: `tcp_send`/`atem_switch`/`obs_switch` (a real raw socket target) and `http_request`/`model_call` (an arbitrary HTTP(S) URL, parsed down to just its hostname:port for the check). This reuses one evaluator (`checkIpAllowed()`) and one rule table for both cases, which is simple and consistent, but a URL target has properties a raw TCP target doesn't — path, query string, scheme — that an operator might reasonably want to restrict (e.g. "only allow `/Monarch/sdk/*` paths") and that this rule shape can't express. It also doesn't do the DNS-resolution-based SSRF hardening `lcyt-connectors`' `network-guard.js` does for connector URLs (deliberately, per `bridge-security.js`'s doc comment — bridge targets are treated as LAN IPs/hostnames configured directly on the device, not arbitrary user-supplied URLs), which is a reasonable default for this feature's threat model but means an `http_request`/`model_call` command through a bridge doesn't get the same protection a connector's outbound fetch does.

**Why skipped:** Building a second, URL-aware rule kind (path/query matching, and/or reusing `network-guard.js`'s DNS-resolving `checkUrlAllowed()`) is real additional scope beyond what this pass's plan called for (TCP command allow/deny + target IP allow/deny, the two things explicitly asked for) and would mean either importing `lcyt-connectors` into `lcyt-production` (a new cross-plugin dependency this repo's convention avoids — see `mediamtx-client.js`'s "copied to avoid a cross-plugin dependency" precedent) or duplicating `network-guard.js`'s DNS-resolution logic a second time. The current host:port-only check still closes the real gap (an unauthenticated/compromised caller directing a bridge to hit an arbitrary internal HTTP endpoint), just without path-level granularity or DNS-rebinding protection.

**Recommendation:** If the bridge's `http_request`/`model_call` surface grows (more encoder types, more third-party APIs relayed through a bridge), revisit with either a `path` pattern field on `ip`-kind rules or a dedicated `url`-kind rule that wraps `network-guard.js`'s evaluator.

**Addendum (2026-07-26 code review) — RESOLVED 2026-09-10:** a related, separate gap in the same area — `lcyt-bridge/src/bridge.js`'s `_httpRequest()`/`_modelCall()` called plain `fetch(url, init)` with no `redirect` option, so a 3xx response was followed transparently, landing the bridge's actual outbound request on a denied host via the second hop with neither the backend's nor the bridge's own IP check ever seeing it. Rather than the per-hop re-validation this entry originally sketched, redirects are now blocked outright: `redirect: 'error'` on both fetch calls in `_httpRequest()`/`_modelCall()`, so any 3xx response is rejected before it's ever followed (surfaces as a normal command-failure result via the existing try/catch in `_handleCommand()`, not a crash). `bridge-manager.js` was checked and has no outbound `fetch()` of its own to fix — it only relays the command over SSE and does the pre-flight IP-target resolution.

(Found during: `plan`-driven bridge TCP command / IP security layer implementation, 2026-07-26; addendum found during the follow-up code-review pass the same day. Addendum resolved 2026-09-10.)

---

## Bridge security: pattern-matching and URL→host:port extraction duplicate existing code in lcyt-connectors (and elsewhere) rather than reusing it

**Where:** `packages/plugins/lcyt-production/src/bridge-security.js`'s `parseHostPattern`/`matchesHostPattern` vs. `packages/plugins/lcyt-connectors/src/network-guard.js`'s `parsePattern`/`hostMatches`; `packages/plugins/lcyt-production/src/bridge-manager.js`'s `_resolveIpTargets()` URL-to-host:port snippet vs. the same few lines already written in `network-guard.js`'s `checkUrlAllowed()` and in `packages/lcyt/src/sender.js`

**Finding:** `bridge-security.js`'s pattern parser (bracket-IPv6 handling, the "trailing `:N` is a port unless the remainder itself has a colon" heuristic, `*.example.com` wildcard matching, CIDR-via-`BlockList`) is copied near-verbatim from `network-guard.js`'s `parsePattern`/`hostMatches`, including matching comments — not a coincidental similar shape, but the same logic re-typed. Separately, `{ host: u.hostname.replace(/^\[|\]$/g, ''), port: Number(u.port) || (u.protocol === 'https:' ? 443 : 80) }` (turn a `URL` into a bare host + default-aware port) is now written a third/fourth time across the codebase with no shared helper (`network-guard.js`, `lcyt/src/sender.js`, and now `bridge-manager.js`/`bridge.js`'s `_resolveIpTargets()`).

**Why skipped:** This repo has an explicit, documented convention for exactly this situation — copy small, stable, protocol-level logic across package boundaries rather than adding a cross-plugin dependency (`packages/plugins/lcyt-production/src/mediamtx-client.js`'s doc comment: "Copied from lcyt-rtmp's client to avoid a cross-plugin dependency — keep in sync"; `lcyt-bridge`'s own `security-policy.js` already follows this same convention relative to `bridge-security.js` itself). `lcyt-connectors` is not currently a dependency of `lcyt-production`, and adding one just to share ~40 lines of pattern-parsing would be a heavier structural change than the duplication it removes. The real gap is that this specific instance of the convention was never written down — `CAMERA_CONTROL_TYPES`'s three-copy duplication (documented in `packages/plugins/lcyt-production/CLAUDE.md`) shows the pattern is normally expected to be logged when introduced, and this one wasn't.

**Recommendation:** If this pattern-matching logic needs a bugfix in one place (as already happened once this pass — see the CIDR-empty-prefix and IPv6-case-sensitivity fixes applied 2026-07-26), check whether `network-guard.js` has (or should get) the same fix. If a fifth copy of the URL→host:port snippet ever shows up, that's the threshold to extract it into the shared `lcyt` core library instead of continuing to copy it.

(Found during: code-review pass on the bridge security layer, 2026-07-26.)

---

## The broadcast panel's ambiguity candidate list never clears

**Where:** `packages/lcyt-web/src/components/broadcast/BroadcastPlatformPanel.jsx` — the `candidates` state

**Finding:** When the backend answers `409 ambiguous_credential`, the panel stores the returned candidate list and renders the account picker from it (`connectedAccounts = candidates || liveCredentialsFor(...)`). That state is never cleared afterwards, so for the rest of the panel's mounted lifetime the picker shows the candidate snapshot rather than live credential state — if a channel is disconnected in another tab meanwhile, it keeps appearing as an option. Choosing it then fails with a clear 404/409 from the backend rather than doing anything wrong, so this is a staleness annoyance, not a correctness hole.

**Why skipped:** the clean fix is to re-fetch credentials on the 409 instead of trusting the inline candidate list, but the whole reason the backend returns candidates inline is to avoid that extra round-trip. Getting both (use the inline list now, refresh in the background) is fiddly state coordination for a window that closes as soon as the panel is collapsed and reopened, and the failure mode is already a clear error rather than a wrong action.

**Recommendation:** revisit if multi-channel projects turn out to reconfigure accounts often enough for anyone to actually hit it.

(Found during: self-review of the broadcast platform sync branch, 2026-07-27.)

---


## Crop stdin repositioning: not verified on a real RTSP/MediaMTX source or fffleet worker, and `-re`-free latency unmeasured

**Where:** `packages/plugins/lcyt-rtmp/src/crop-manager.js`, `test/crop-stdin.test.js`.

The ~120 ms (4 frame) stdin-command delay was measured on a local `-re` lavfi source with the `spawn` runner. A live RTSP input has its own jitter buffer, so the real delay will be larger and is not measured. The fleet path (`FleetFfmpegRunner.stdin` -> `job.write`) relies on the fffleet worker leaving ffmpeg's stdin open for `kind: 'stream'` jobs without `-nostdin`; not exercised here. `DockerFfmpegRunner` starts the container with stdin ignored, so docker is restart-only (could be done with `docker run -i` + piping `proc.stdin` instead of host stdin).

Also noticed (not changed): `LocalFfmpegRunner` has no public `stdin`, so `RtmpRelayManager.writeCaption()` (CEA-708 stdin path, `proc.stdin`) only works through the fleet runner or `spawnFfmpeg`; `test/rtmp-manager.unit.test.js` asserts that. Adding a `stdin` getter to the local runner would silently change that path, so the crop manager reads `handle.proc.stdin` instead.
