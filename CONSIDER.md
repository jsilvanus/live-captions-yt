# Consider

Findings from `/code-review` and `/simplify` passes that were deliberately
**skipped** rather than fixed — real observations, judged not worth acting on
immediately (too invasive for the diff at hand, out of scope, or the "fix"
wouldn't actually be simpler). Logged here instead of silently dropped so a
future pass can revisit them with fresh eyes and full context, rather than
rediscovering the same tradeoff from scratch.

Each entry: what was found, why it was skipped, and where.

---

## ~~Server settings (plan_env_to_ui_settings.md) Phase 5 — plugin call-site migration is partial~~ (RESOLVED)

**Where:** `packages/plugins/lcyt-rtmp`, `packages/plugins/lcyt-dsk`, `packages/plugins/lcyt-production`'s `MediaMtxClient`, `packages/plugins/lcyt-agent`'s embedding functions, plus `lcyt-files`/`lcyt-music` from the first Phase 5 pass.

**Resolved 2026-07-21:** all four originally-deferred plugins are now wired to a duck-typed `settings` param, following the same pattern established for `lcyt-files`/`lcyt-music`:
- **`lcyt-rtmp`** — `RtmpRelayManager`, `CropManager`, `SttManager`, `RadioManager`, `HlsManager`, `PreviewManager`, `NginxManager`, `HlsSubsManager` all accept `settings`. Most of this turned out to be `initRtmpControl()` finally passing settings-resolved values into constructor overrides those classes already supported (`mediamtxHlsBase`, `webrtcBase`, `segmentDuration`, etc.) — not new class surface. Where a value truly was module-load-time (RTMP host/app defaults, CEA-708 timing, crop's ZMQ port base) or read fresh per call with no constructor path (`SttManager`'s STT provider/language/audioSource, `GoogleSttAdapter`'s apiKey/mode), the read site itself now consults `this._settings` first. CEA-708 offset/duration/max-backtrack went from restart-only to genuinely hot (read per caption).
- **`lcyt-dsk`** — `images.js` (`GRAPHICS_ENABLED` gate + upload size/quota limits, now hot, read per-request), `dsk-rtmp.js`/`dsk-templates.js` (RTMP host/app + renderer local-server URL, resolved once at router construction, including the `DSK_LOCAL_RTMP → RADIO_LOCAL_RTMP` and `DSK_LOCAL_SERVER → DSK_PAGE_BASE_URL` cross-setting fallback chains, preserved via a small resolver checking `settings.source()`). `renderer.js`'s own module-load-time `DSK_LOCAL_SERVER` (the Playwright singleton) is deliberately still untouched — genuinely construction-time-only, correctly `apply: 'restart'`, and restructuring a long-lived renderer process wasn't worth it for this pass.
- **`lcyt-production`'s `MediaMtxClient`** — the "half-fix risk" reasoning in this entry's original text was wrong: both `MediaMtxClient` copies (`lcyt-production`, `lcyt-rtmp`) already accept explicit `{ baseUrl, webrtcBaseUrl, user, password }` constructor opts, falling back to `process.env` only when a given opt is omitted. Wiring it was just passing settings-resolved values at each `new MediaMtxClient()` call site (`initProductionControl`, `initRtmpControl`) — no widening needed at all.
- **`lcyt-agent`** — `AgentEngine` now takes `settings` in its constructor opts (`initAgent(db, opts)` already forwarded `opts` wholesale, so no signature change there), used by `isServerEmbeddingAvailable()`/`computeEmbeddings()` for the server-default provider path only — per-project `ai_config` overrides still always win. Wiring this surfaced a real, separate bug (see next entry) in how `server.js` called `computeEmbeddings`.

**Resolved 2026-07-21 (second pass):** `VISION_PREVIEW_BASE_URL` (`lcyt-agent`'s `VisionFrameFetcher`) and `CAMERA_PREVIEW_BASE_URL` (`lcyt-production`'s `camera-thumbnail.js`) are now wired — `VisionRoleManager` takes `settings` in its constructor and resolves `ai.vision_preview_base_url` once per `start()` call, threaded into the fetcher's constructor opts; `createProductionRouter()` resolves `production.camera_preview_base_url` once at construction, threaded into `captureCameraThumbnail()`'s opts. `CAMERA_THUMBNAILS_DIR` was never actually part of this gap — it's deliberately Tier A/env-only (`registry.js`'s `bootstrap.camera_thumbnails_dir`), left untouched.

Full test sweep after this pass: all 18 Node.js workspaces pass (`npm test` at repo root), including 1106 lcyt-backend, 247 lcyt-rtmp, 106 lcyt-dsk, 181 lcyt-agent, 110 lcyt-cues, 158 lcyt-production tests.

---

## Bug found while resolving the above: `computeEmbeddings` credential collision in cue semantic matching — RESOLVED

**Where:** `packages/lcyt-backend/src/server.js` (was `_cueEngine.setEmbeddingFn(computeEmbeddings)`), `packages/plugins/lcyt-cues/src/cue-engine.js` (`_embedFn(texts, { apiKey, rule })`), `packages/plugins/lcyt-agent/src/embeddings.js` (`computeEmbeddings(texts, opts)`).

**Finding:** `CueEngine` calls its injected `_embedFn` with `{ apiKey, rule }`, where `apiKey` is the *project's* api_key (used elsewhere in the same evaluator for tracker-state/ai-config lookups). `server.js` wired this directly to the bare `computeEmbeddings` function from `embeddings.js`, whose `opts.apiKey` means something completely different: the *embedding provider's credential*, sent as `Authorization: Bearer ${apiKey}`. Every `cue[semantic]:phrase` match was therefore sending the project's api_key as the embeddings API bearer token instead of `EMBEDDING_API_KEY` — silently breaking semantic cue matching whenever a real embedding key was configured (auth failure) rather than using it.

**Fixed:** rewired through `AgentEngine.computeEmbeddings(texts, apiKey)`, which already correctly keeps the two meanings apart (resolves per-project `ai_config` first, only falls back to the server-level default for the `'server'` provider) — matching what `lcyt-agent/src/api.js`'s own doc comment recommended all along. Found and fixed as a side effect of adding `SettingsService` support to the same method, not a separate pass.

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

## `VariablesBus` duplicates `DskBus`'s SSE subscriber/broadcast logic — RESOLVED (2026-07-12)

**Resolved by** `plan_pubsub_event_bus.md`: the shared `EventBus`
(`packages/lcyt/src/event-bus.js`, exported as `lcyt/event-bus`) now owns the
`Map<projectId, Set<...>>` + write-with-prune-on-failure bookkeeping. `DskBus`,
`VariablesBus`, and `RolesBus` are thin wrappers that publish canonical topics
through it and keep their exact public signatures + SSE wire shape. The
duplicated connection-handling code is gone.

**Where (original):** `packages/plugins/lcyt-connectors/src/variables-bus.js` vs.
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

## ~~`packages/lcyt-tools`'s shared registry isn't wired into an external-facing MCP transport yet~~ (RESOLVED)

**Where:** `packages/lcyt-backend/src/routes/mcp-endpoint.js` (new, Phase 1 of
plan_unified_external_control.md).

**Resolution:** Implemented as an in-process MCP endpoint (Streamable HTTP
JSON-RPC) inside `lcyt-backend` at `POST /mcp`, backed by the same
`_toolRegistry` the composition root builds. Auth via
`createProjectAccessMiddleware` with `mcp:connect` scope. Per-tool scope
enforcement, destructive-tool staging for confirmation, rate limiting, and audit.
Decision taken: in-process in `lcyt-backend`, not a separate process.

(Resolved: 2026-07-12, plan_unified_external_control.md Phase 1.)

---

## ~~Bridge-relayed and `deer`-kind AI providers aren't supported by the `agentic_chat` turn loop or vision adapters~~ (RESOLVED)

**Where:** `packages/plugins/lcyt-agent/src/agentic-turn.js`'s `resolveRoleProviderSettings()`
and `invokeModelCall()`, consumed by `routes/roles-chat.js`, `routes/production-assistant.js`,
`routes/planner.js`, `routes/vision-roles.js`, `agent-engine.js`, and
`vision-adapters/{openai,google,anthropic}-vision.js`.

**Original finding:** `resolveRoleProviderSettings()` returned `null` for any provider with
`bridge_instance_id` set, which every route turned into a `503 AI provider not configured or
unsupported` — so the `model_call` bridge command built in Phase 2 of
`plan_ai_model_registry.md` had no real caller: discovery (`GET /api/tags`) worked over a
bridge, inference did not.

**Resolved (2026-07-13, `fafb55c` "Add bridge-aware model invocation for backend roles"):**
`invokeModelCall(apiSettings, payload, opts)` now branches on `apiSettings.transport ===
'bridge'`, dispatching `bridgeManager.sendCommand(instanceId, { type: 'model_call', endpoint,
headers, payload })` instead of a direct `fetch()`. `resolveRoleProviderSettings()` returns
`{ transport: 'bridge', bridgeManager, bridgeInstanceId }` settings for a bridge-relayed
provider (still `null` only when no `bridgeManager` was injected, or for `kind: 'deer'`, which
remains genuinely unscoped — Phase 4). `agent-engine.js`'s `_callChatCompletion` and every
`agentic_chat` route now call through `invokeModelCall`, and `server.js` constructs every one
of those routers with the composition root's `productionBridgeManager`, so bridge relay works
end-to-end for the turn loop.

**Update (2026-07-18):** the OpenAI-compatible vision adapter (used for `vendor: 'ollama'`,
the only vendor a bridge-relayed provider actually uses in practice) already routed through
`invokeModelCall` and thus already supported bridge transport, but `google-vision.js` and
`anthropic-vision.js` still did a raw `fetch()` unconditionally — a bridge-relayed provider
assigned to Tracker/Describer with a `google`/`anthropic` vendor would have silently ignored
`transport: 'bridge'` and either failed (backend can't reach a LAN-only endpoint) or, worse,
hit a same-named endpoint the backend *can* reach that wasn't the intended target. Closed by
routing both adapters through `invokeModelCall` too, same as OpenAI's adapter — Google keeps
its `?key=` query-param auth via `invokeModelCall`'s `endpointPath` option (not a bearer
header), Anthropic keeps its `x-api-key`/`anthropic-version` headers via the `headers` option.
Test coverage added in `test/vision-adapters.test.js` for all three vendors' bridge path.

(Found during: implementing plan_ai_roles_framework.md's `agentic_chat` turn loop and vision
roles, 2026-07-07. Resolved 2026-07-13/2026-07-18.)

---

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

## Direct-spawn ffmpeg sites not migrated onto the runner factory

**Where:** `packages/plugins/lcyt-rtmp/src/{hls-manager,stt-manager}.js`,
`packages/plugins/lcyt-music/src/{music-manager,pcm-extractor}.js`,
`packages/plugins/lcyt-dsk/src/renderer.js`

**Finding:** plan_metering_audit §4.1 called for migrating these direct
`spawn('ffmpeg', …)` sites onto `createFfmpegRunner()`. They instead use the
plan's pre-approved fallback (manual start/close timing into the same
accounting sink) because the runner handle's API differs from a raw
`ChildProcess` (`stop()` instead of `.kill()`, object-arg `'close'`, no
`.stdin` passthrough on all backends) and each manager has tests/behaviour
sensitive to exact process semantics. Accounting is identical either way; the
migration would only buy uniformity (and `FFMPEG_RUNNER=docker/worker` support
for these auxiliary pipelines). Revisit if these paths ever need non-local
runners.

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

## `/production/cameras` WHIP + kiosk pages remain unauthenticated even after the cross-tenant `sourceCameraId` auth fix

**Where:** `packages/plugins/lcyt-production/src/routes/cameras.js`
(`isUnauthenticatedCameraRoute()`), `packages/lcyt-web/src/components/CameraStreamPage.jsx`,
`packages/lcyt-web/src/components/LcytMixerPage.jsx`, `packages/lcyt-web/src/components/DeviceLoginPage.jsx`

**Finding:** Fixing the cross-tenant `sourceCameraId` finding (a project
could reference any other project's camera via a relay slot) required real
auth on the camera CRUD routes — `owner_api_key` + `canAccessCamera()` +
`opts.auth` wired to `scopedAuth('production')` in `server.js`. But
`CameraStreamPage.jsx` and `LcytMixerPage.jsx` are capability-URL kiosk pages
(a dedicated device opens a bare URL and pushes its webcam / drives the
mixer — no login flow at all) that send no Authorization header of any kind.
Blanket-applying auth would break them, so `isUnauthenticatedCameraRoute()`
carves out `/whip`, `/whip-url`, and the thumbnail-serving routes explicitly,
leaving them exactly as open as before this pass. A real device-role JWT
mechanism already exists (`DeviceLoginPage.jsx` → `POST
/auth/device-login` → `routes/device-roles.js`'s `deviceLoginHandler`,
issuing a `{kind:'device', type:'device', apiKey, projectId, deviceRole,
roleId, permissions}` token fully compatible with
`createProjectAccessMiddleware`) but neither kiosk page reads or sends it —
it's stored in `sessionStorage['lcyt-device']` and never used again.

**Also found in the same area (separate bug, not fixed):**
`DeviceLoginPage.jsx` redirects to `/production/camera/${apiKey}` (passing
the *project's apiKey* as the `:key` route param) while `CameraStreamPage.jsx`
treats `:key` as a raw `cameraId`. These are different values — the redirect
target looks like it would 404 or resolve the wrong camera today, independent
of the auth question.

**Why skipped:** wiring the device-role JWT into two kiosk pages that
currently have zero auth UI is a real feature addition (reading the token
from `sessionStorage`, sending it as `Authorization: Bearer`, handling
expiry/re-login), not a natural extension of the CRUD-route auth fix — and
fixing the `DeviceLoginPage.jsx` route-param mismatch first would be a
prerequisite so the redirect even lands on the right camera. Scoped the
cross-tenant fix to CRUD routes only (list/get/create/update/delete/preset/
thumbnail-capture) and left WHIP/kiosk auth as this follow-up.

(Found during: `/code-review` cross-tenant `sourceCameraId` fix,
plan_ingest_feeds.md, 2026-07-19.)

## `prod_mixers` has no `owner_api_key`/ownership scoping, unlike `prod_cameras`

**Where:** `packages/plugins/lcyt-production/src/db.js`,
`packages/plugins/lcyt-production/src/routes/mixers.js`

**Finding:** The cross-tenant `sourceCameraId` fix added `owner_api_key` to
`prod_cameras` and real auth + `canAccessCamera()` gating to
`routes/cameras.js`. `prod_mixers` has the identical shape problem in
principle (no project/tenant column at all, `routes/mixers.js` has no
`opts.auth`), but nothing in `plan_ingest_feeds.md`'s named-feed/egress work
ever references a mixer by cross-project ID the way relay slots reference
cameras via `sourceCameraId` — there's no equivalent attack surface exercised
by this plan, so it wasn't in scope for this pass.

**Why skipped:** doing mixers the same way is a same-shaped, mechanical
follow-up (additive `owner_api_key` column, `canAccessCamera`-equivalent
gate, `opts.auth` wiring, ownership-filtering tests) but is a separate
change with its own review, not a hidden dependency of the sourceCameraId
fix.

(Found during: `/code-review` cross-tenant `sourceCameraId` fix,
plan_ingest_feeds.md, 2026-07-19.)

## ~~`AiModelsSection.jsx`/`ai_model_configs` is dead-end plumbing, disconnected from the `ai_providers` registry~~ (RESOLVED)

**Where:** `packages/lcyt-web/src/components/setup-hub/AiModelsSection.jsx`,
`routes/ai-models.js`, standalone `ai_model_configs` table (all in
`packages/plugins/lcyt-agent`).

**Finding:** While auditing `plan_ai_model_registry.md`'s frontmatter, found
that this component + route + table look like they could be Phase 3's
still-missing role-config model-picker UI, but they're entirely separate
plumbing: `getAiModelConfig()` has zero call sites outside its own module —
nothing in the `agentic_chat` turn loop, vision adapters, or
`project_ai_role_configs` reads from it. It never got wired to the
`ai_providers`/`ai_provider_models`/`provider_id` registry the plan actually
built.

**Resolution (ROADMAP.md Tier 0, 2026-07-20):** Took the "delete it" branch
of the finding's own decision (repurposing into the real Phase 3 UI is
Tier 1 scope — `plan_ai_model_registry.md` — and building it now would have
been throwaway effort against a card that didn't exist yet). Deleted
`AiModelsSection.jsx`, `packages/plugins/lcyt-agent/src/ai-models.js`,
`packages/plugins/lcyt-agent/src/routes/ai-models.js`, the `/ai/models`
mount in `lcyt-backend/src/server.js`, and the `ai_model_configs` migration
call — existing deployments keep any already-created (now-orphaned) table,
harmless since nothing reads it. Removed its two mount points
(`SetupHubPage.jsx`'s `ai-models` card, `AdminAiModelsPage.jsx`) and the
now-dead `listAiModels`/`createAiModel`/`updateAiModel`/`deleteAiModel`
helpers from `lib/aiAdminApi.js`. `AdminAiModelsPage.jsx` (`/admin/ai-models`
— hidden from the Admin tab bar, still reachable by direct URL, see
`HIDDEN.md`) keeps its route and now hosts only `McpAccessSection`, which
was already independently mounted on the Setup Hub. Updated the stale
"Phase 3 not done" callout in `plan_ai_model_registry.md` and the two other
plan docs that referenced this card by name.

(Found during: docs/plans frontmatter audit, 2026-07-20. Resolved same day.)

## ~~Recording/VOD marks `storage_type='s3'` but nothing ever uploads the segments there~~ (RESOLVED)

**Where:** `packages/lcyt-backend/src/db/videos.js` (`startVideoRecording`/
`finishVideoRecording`), `packages/lcyt-backend/src/routes/live.js`
(`configureMediaMtxRecording`).

**Finding:** While auditing `plan_recording_vod.md`'s frontmatter, found that
`isS3Enabled()` being true makes a `videos` row get `storage_type='s3'`, but
MediaMTX always writes recorded HLS/fMP4 segments to local disk — no
watcher/uploader moves them to S3 afterward (the plan called for reusing
worker-daemon's `createS3UploadFn` or the `lcyt-files` S3 adapter, but
neither is invoked from the recording path). An S3-configured deployment
would 404 on VOD playback for any broadcast recorded this way, since
`GET /videos/:id/playlist.m3u8` would look for segments at an S3 location
nothing ever populated.

**Resolution (ROADMAP.md Tier 0, 2026-07-20):** Added `uploadDirectoryToS3()`
to `packages/lcyt-backend/src/storage/s3.js` — a small authenticated
PutObject-based uploader (`@aws-sdk/client-s3`, added as an optional
dependency mirroring `lcyt-files`' pattern) that walks a local recording
directory and uploads every file under the same `${storageKey}/<relative
path>` layout the existing (unsigned-fetch) playback read path already
expects, so no change was needed on the read side. `db/videos.js` gained
`syncVideoRecordingToStorage(db, apiKey, videoId)`, which uploads and
records the real `size_bytes`, or — on upload failure — downgrades the row
to `storage_type='local'` so playback still works against the local files
MediaMTX already wrote, instead of the previous silent 404. Wired into both
recording-finish paths in `routes/live.js` (`stopSessionRecording()` and the
`DELETE /live` teardown handler) via `scheduleRecordingStorageSync()`, which
waits `RECORDING_UPLOAD_DELAY_MS` (default 3000ms) before reading the
directory to give MediaMTX's `record:no` patch time to flush the final
segment to disk. Deliberately kept the existing key/URL scheme (not
`lcyt-files`' `S3_PREFIX`-based `keyDir()` layout) rather than reusing that
adapter directly, since the two were never aligned to begin with and
reusing it would have required also rewriting the already-working read
path. Tests: `packages/lcyt-backend/test/videos.test.js` (upload success,
upload-failure fallback, local-storage no-op) against a new lightweight
mock S3 server (`test/helpers/mock-s3-server.js`, PUT-only).

(Found during: docs/plans frontmatter audit, 2026-07-20. Resolved same day.)

---

## `crop_preset` has no working named-action or cue-triggered path — premise mismatch, not built

**Where:** `packages/plugins/lcyt-actions` (named actions), `packages/plugins/lcyt-cues`
(cue engine), `packages/lcyt-web/src/lib/metacode-actions.js` (named-action execution)

**Finding:** `docs/plans/plan_vertical_crop.md` Phase 4 asked for a `crop_preset`
"named-action/cue/tool" — recall a crop preset "the same way other production
actions are today," by analogy with `camera.preset`/`mixer.switch`. Investigating
before implementing (per this session's instructions) found that analogy doesn't
hold:

- **Named actions execute entirely client-side.** `lcyt-actions`' own `CLAUDE.md`
  states it plainly: "Parsing, `@`-ref expansion..., and send-time execution all
  live in the web client." `lcyt-web/src/lib/metacode-actions.js`'s `applyAtoms()`
  only knows `api:`/`!api:`/`api!:` (connector triggers), `audio:start`/`stop`, and
  generic persistent variable/graphics/section assignment atoms — there is no
  camera/mixer/production-control atom at all, for *any* device, today. Adding
  `crop_preset:` as the first one would mean inventing that category, and doing it
  requires an `lcyt-web` change — explicitly out of scope for the session that did
  this work ("no `lcyt-web` conflict").
- **Cue-fired actions are descriptive-only.** `cue_rules.action` (and
  `cue_events.action`) is arbitrary JSON, but `cue-processor.js` only ever does one
  thing with it: attach it to the `cue_fired` SSE event for the *frontend* to
  interpret (today: jump the rundown pointer). No cue firing, for any action type,
  executes a backend side effect. Making `crop_preset` the first one would mean
  building a new backend cue-action-dispatcher — a bigger, more architecturally-loaded
  change than "follow the existing pattern," since there is no existing pattern of
  a cue driving hardware to follow.

**What *was* built instead:** the one piece of "recall a crop preset the same way
other production actions are today" that has a real, precedented, backend-only
mechanism — a `crop.list_presets`/`crop.activate_preset` AI-tool pair
(`packages/lcyt-tools/src/tools/crop.js`), registered exactly like
`camera.preset`/`mixer.switch` and added to the Production Assistant role's
`available_tools` (`packages/plugins/lcyt-agent/src/ai-roles.js`).

**Why skipped:** forcing the named-action/cue halves would mean either violating
this task's explicit `lcyt-web`-untouched constraint, or inventing new
cue-execution architecture speculatively (against this repo's "no speculative
abstractions beyond what's asked" convention) for a single action type with no
sibling to generalize from yet. A future pass that actually wants
cue/named-action-driven device control should design that capability for
camera/mixer/crop together, not bolt one narrow case onto an architecture that
doesn't support the concept at all.

(Found during: `plan_vertical_crop.md` Phase 4/5 implementation, 2026-07-20.)

---

## AI-tool-driven mixer switches / camera preset recalls don't trigger vertical-crop follow

**Where:** `packages/lcyt-tools/src/tools/mixers.js` (`mixer.switch`),
`packages/lcyt-tools/src/tools/cameras.js` (`camera.preset`),
`packages/plugins/lcyt-production/src/routes/mixers.js` and `routes/cameras.js`

**Finding:** `plan_vertical_crop.md` Phase 4's production-follow notifications
(`registry.notifyProgramChanged()`/`notifyCameraPresetRecalled()`) are fired from
the **HTTP route handlers** in `lcyt-production`, not from
`DeviceRegistry.switchSource()`/`callPreset()` themselves — this is deliberate:
a bridge-relayed switch (the common case for real roland/amx/atem/monarch_hdx
hardware) returns early from the route without ever calling `switchSource()`, so
the route is the only place that sees both the direct and bridge-relayed
transports succeed. But `lcyt-tools`' `mixer.switch`/`camera.preset` tool
handlers (used by the Production Assistant AI role and any MCP client) call
`registry.switchSource()`/`callPreset()` **directly**, bypassing the HTTP route
entirely — so an AI-tool-driven or MCP-driven mixer switch or PTZ preset recall
never fires the production-follow notification, and the vertical crop will not
follow it, even though the operator-UI-driven equivalent does.

**Why skipped:** out of scope for this task, which was scoped to
`lcyt-production`/`lcyt-rtmp` and asked to hook into "wherever mixer-switch and
PTZ-preset-recall events already fire in `lcyt-production`" — that's the routes,
which is what got wired. Closing this gap would mean adding the same
`registry.notifyProgramChanged()`/`notifyCameraPresetRecalled()` calls to
`tools/mixers.js`'s `mixer.switch` and `tools/cameras.js`'s `camera.preset`
handlers (both already receive `ctx.apiKey`, they just don't use it today since
cameras/mixers are project-wide tables) — a small, mechanical follow-up, not a
design question, whenever AI-tool-driven crop-follow parity is wanted.

(Found during: `plan_vertical_crop.md` Phase 4 implementation, 2026-07-20.)

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

## `/code-review` findings on PR #289, fixed vs. logged (2026-07-20)

A full 8-angle `/code-review` pass on the Tier 0 + Tier 1 batch (mcp docs,
vertical-crop Phase 4/5, AI model registry UI, org-baseline resolver)
surfaced several real bugs — fixed directly (see the fix commit's message
for the full list: `auth.js` client-supplied `projectRole` privilege cap,
`mixers.js`'s `/switch` route dropped from the auth carve-out breaking
`LcytMixerPage.jsx`'s kiosk cut button, `cameras.js`'s preset-recall
notification using the wrong identifier so vertical-crop production-follow
via camera preset silently never matched a row bound through the real UI,
`getEffectiveProjectAccessLevel()`'s redundant DB round-trips on the
owner/admin fast path, `CropManager._followState`'s unbounded per-apiKey
growth, `videos.bytes` metering not counting S3-uploaded recordings, and
sequential (not bounded-concurrent) S3 segment uploads) — plus several real
but lower-priority findings logged here instead of rushed into the same
pass:

- **Duplicated ownership-gate pattern.** The `row.user_id !== user.userId
  ? getEffectiveProjectAccessLevel(...) : <owner shortcut>` gate is
  copy-pasted (minor variations) across `routes/project-features.js` (×2),
  `routes/project-slug.js`, `routes/project-observability.js`, and
  `routes/device-roles.js`'s local `requireOwnerOrAdmin`. A shared
  `requireProjectAccess(db, req, res, { minLevel })` helper would make the
  next access-model change a one-place edit instead of five. Not extracted
  now — touching all five auth-critical files for a pure refactor right
  before a CI-gate-then-merge added more regression risk than the cleanup
  was worth in that window.
- **Duplicated `useApi()` hook.** `packages/lcyt-web/src/components/setup-hub/AiRoleModelsSection.jsx`
  copies `ConnectorsSection.jsx`'s `useApi()` hook (token check, header
  building, fetch, JSON-parse, error-throw) verbatim instead of a shared
  module. Matches this directory's existing (undocumented) per-file
  convention, so not a new regression, but worth extracting if a third
  Setup Hub section needs the same pattern.
- **Duplicated S3 client construction.** `packages/lcyt-backend/src/storage/s3.js`'s
  `createS3Client()` reimplements the same region/endpoint/credentials
  wiring as `packages/plugins/lcyt-files/src/adapters/s3.js`'s
  `createS3Adapter()`. The two adapters deliberately use different key
  schemes (already documented above in this file), but that doesn't require
  duplicating client construction — a shared helper could serve both.
- **Duplicated mock S3 test server.** `packages/lcyt-backend/test/helpers/mock-s3-server.js`
  is a trimmed copy of `packages/plugins/lcyt-files/test/helpers/mock-s3-server.js`
  rather than an import/reuse of it.
- **`console.warn` vs. `lcyt/logger`.** The root `CLAUDE.md` says to use
  `lcyt/logger` over `console.*`, but `packages/lcyt-backend/src/server.js`
  (41 `console.*` calls, zero `logger` usage) and all of
  `packages/plugins/lcyt-production` (`bridge-manager.js`, `crud.js`,
  `registry.js`) use `console.warn`/`console.error`/`console.info`
  exclusively — a pre-existing, file-and-package-wide gap this session's new
  code matched rather than deviated from. Fixing just the newly-added lines
  would be inconsistent with their own surrounding code; a real fix needs a
  dedicated migration pass per package (and, for `lcyt-production`, adding
  `lcyt` as a declared dependency, which it doesn't have today).
- **Unanchored `/whip` carve-out regex.** Both `routes/cameras.js`'s
  `isUnauthenticatedCameraRoute()` and `routes/mixers.js`'s
  `isUnauthenticatedMixerRoute()` use `/\/whip(-url)?(\/|$)/`, which matches
  any path segment literally named `whip`/`whip-url`, not just the
  `/:id/whip` route — currently unexploitable since ids are
  server-generated `randomUUID()`s, but the guard itself provides no defense
  if that ever changes (e.g. custom/slug ids). Pre-existing pattern in
  `cameras.js`, copied (not introduced) by `mixers.js`'s new carve-out.
- **`CropManager.applyForSource()`'s camera-preset-recall branch never
  passes `mixerId`** to `resolveCropPresetForSource()` (defaults to `null`),
  so a `crop_source_map` row that specifies *both* `cameraId` and `mixerId`
  gets excluded on a preset-recall event even when its camera/preset match.
  Narrow: `lcyt-web`'s crop editor (`useCropEditor.js`) never sets `mixerId`
  on a camera-preset binding created through the UI — only reachable via a
  direct `POST /crop/source-map` call that deliberately combines both
  fields.
- **Org member listing stays explicit-only.** The Altitude angle flagged
  that `routes/project-members.js` (`GET /keys/:key/members` etc.) was
  deliberately left off the `getEffectiveProjectAccessLevel()` sweep — an
  org-baseline `member` can now read captions/DSK/cues/etc. on a project but
  still gets 403 listing that project's explicit members. This is the
  intended design (membership management is an ownership-tier concern, see
  `plan_team_org_backend.md`'s "One place this must NOT apply"), not a bug —
  noted here only because a future reader re-auditing the sweep list
  shouldn't assume it's an oversight.

(Found during: `/code-review` pass on PR #289, 2026-07-20.)

---

## Org-baseline access reaches every scopedAuth router, not just the 6 tested — interim fix + follow-up plan

**Where:** `packages/lcyt-backend/src/middleware/project-access.js`, `packages/lcyt-backend/src/routes/mcp-tokens.js`, `packages/plugins/lcyt-agent/src/routes/ai-providers-project.js`, `docs/plans/plan_project_roles.md` (new)

**Finding:** `getEffectiveProjectAccessLevel()`'s sweep (this same PR) was scoped/tested against 6 specific routes, but because it lives in the single shared `middleware/project-access.js` gate, it actually reaches **every** `scopedAuth('<resource>')`-mounted router — dsk, cue, token, ai, agent, role, connector, action, variable, operator, production. Two of those, `POST /mcp-tokens` (mint a personal, exportable MCP access token) and `POST/PUT/DELETE /ai/providers` (add a credentialed AI provider), do no further role check beyond "the middleware let me through" — so an org member with only baseline access (even the org `viewer` tier) could mint a durable, exportable credential for a project they were never explicitly invited to, right from the Setup Hub UI's own "Generate token" button.

**Resolution:** discussed with the project owner, who specified a fuller target model (per-project visibility private/team, a configurable org-baseline ceiling of viewer/editor — never admin — a unified owner/admin/editor/viewer role vocabulary, and page-scoped write gates: Setup=explicit-admin-only, Assets=editor+, Production=still-undecided). Building that full model was explicitly scoped OUT of this PR (still evolving — the Production/operator question is open) in favor of a narrow, well-tested interim fix: `POST /mcp-tokens`/`PATCH`/`DELETE` and `POST/PUT/DELETE /ai/providers` now require **explicit** `project_members` owner/admin (`getMemberAccessLevel`, not the org-baseline-inclusive resolver) regardless of the broader gate. `GET` on both stays on the broad gate.

**Left open, tracked in `docs/plans/plan_project_roles.md`:** every other Setup-shaped route still has only the broad org-baseline gate — `lcyt-dsk`'s template/viewport routers, `lcyt-connectors` (also credential-bearing, same risk class as ai/providers), `lcyt-production`'s camera/mixer/encoder/bridge CRUD (entangled with the still-undecided Production/operator question), `lcyt-rtmp`'s egress/ingestion/radio config, `targets`/`translation`/`stt config`/`icons`/`storage`. These need the same treatment once the full role model is designed.

(Found during: `/code-review` pass on PR #289, 2026-07-20 — design conversation follow-up.)

---

## Perception job dispatch/auth-header logic duplicated across three packages

**Where:** `packages/lcyt-backend/src/ffmpeg/worker-runner.js` (pre-existing), `packages/plugins/lcyt-production/src/perception-manager.js`, `packages/lcyt-worker-daemon/src/perception-job.js` (both new, `plan_video_perception.md` Phase 2)

**Finding:** All three files independently implement the same shape — "JSON headers + an optional internal-auth token header + POST/DELETE to whichever of `ORCHESTRATOR_URL`/`WORKER_DAEMON_URL` is configured, preferring the orchestrator" — with three different error-handling conventions (`worker-runner.js` throws, `perception-manager.js` throws, `perception-job.js` logs-and-swallows). `perception-manager.js` already factors its own internal `_headers()`/`_post()`/`_delete()` helpers cleanly; the duplication is *across* files, not within any one of them. A future change to how the internal-auth token is passed (signed header, rotated secret, etc.) needs to be found and updated in three places by hand instead of one.

**Why skipped:** the three files live in three different npm workspace packages (`lcyt-backend`, `lcyt-production`, `lcyt-worker-daemon`). A real fix means either extracting the shared logic into the common `lcyt` core library (touching a dependency all three packages share) or accepting the duplication as a cost of the package boundary. `worker-runner.js` in particular is pre-existing, stable, tested ffmpeg-job-dispatch code with no relationship to this PR's actual diff — refactoring it here to shave duplication off a brand-new, unrelated feature (perception jobs) is a real regression-risk-to-payoff mismatch for a cosmetic finding, not a correctness bug. Worth doing as its own focused pass if/when a fourth dispatch consumer shows up (the repo's own stated threshold for promoting a duplicated pattern, per `ROADMAP.md` §0's precedent for `DeviceRegistry`'s callback-to-EventBus promotion question) or when the auth-token scheme actually needs to change and the duplication becomes a real maintenance cost rather than a theoretical one.

(Found during: `/code-review` pass on `plan_video_perception.md` Phases 2-3, 2026-07-21 — reuse angle.)

---

## Server settings (plan_env_to_ui_settings.md) Phase 5 — two small env-only gaps remain unregistered

**Where:** `packages/lcyt-backend/src/storage/s3.js` (5 raw `process.env.S3_*` reads: `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`), `packages/plugins/lcyt-cues/src/cue-engine.js` (3 raw `process.env.CUE_EVENT_TIMEOUT_MS` reads)

**Finding:** Both are real remaining `process.env` direct-reads that haven't been migrated to the settings system or registered in `registry.js`. `S3_*` are used by `packages/lcyt-backend/src/storage/s3.js`'s `isS3Enabled()`, `buildS3Url()`, and `uploadDirectoryToS3()` functions, which are called from `packages/lcyt-backend/src/db/videos.js`'s `syncVideoRecordingToStorage()` — the S3 upload path for recorded videos. `CUE_EVENT_TIMEOUT_MS` is an undeclared env var with no registry entry at all (defaults to `'5000'` via `parseInt(..., 10)` in three places inside the cue evaluator), used to timeout event-cue matching when a `match_timeout` field is set on a rule.

**Why skipped:** Each needs a different resolution:
- **S3 configuration:** All five `S3_*` vars are infrastructure/credentials; `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` should probably be Tier A (env-only, never DB) like other secrets. But `isS3Enabled()`, `buildS3Url()`, and `uploadDirectoryToS3()` have no `settings` parameter threaded through them — they're called from deeply-nested DB helpers, not route/plugin composition roots. Wiring settings down through the call chain (`db/videos.js` → storage helpers → settings) or lifting the S3-check/build logic out of these generic helpers would both be invasive and non-local to this pass. Worth its own, focused threading pass once a future change does need these to be reconfigurable without restart.
- **`CUE_EVENT_TIMEOUT_MS`:** No registry entry exists at all. Adding one (`retention.cue_event_timeout_ms`? — needs a category/description choice and a default value decision: the current implicit `5000` or something else?), registering it in `registry.js`, and threading `settings` into `CueEngine` would be straightforward individually but are three separate decisions (categorization, default, threading location) that feel like a `lcyt-cues`-specific pass rather than a finishing touch on the backend settings refactor that this phase is.

**Recommendation:** Log both in a future pass specifically scoped to S3/storage configuration and cue-engine behavior — they're real, confirmed, non-speculative gaps, just not part of the current phase's already-tight scope (app URL, retention, STT/metrics/AI defaults).

(Found during: settings migration Phase 5 completion audit, 2026-07-21.)
