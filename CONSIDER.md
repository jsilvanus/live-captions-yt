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
