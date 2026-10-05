# Consider — archive

Resolved entries moved out of `CONSIDER.md` on 2026-10-05, kept verbatim for history.

---

## ~~DSK live-graphics-operate routes left ungated by the Setup-tier pass — the `/graphics` page's own access tier was never decided~~ — RESOLVED 2026-09-10

**Where:** `packages/plugins/lcyt-dsk/src/routes/dsk-templates.js` — `POST /:apikey/templates/:id/activate`, `POST /:apikey/template` (one-off render), `POST /:apikey/broadcast`, `POST /:apikey/graphics`, `POST /:apikey/renderer/start`, `POST /:apikey/renderer/stop`. Also `packages/lcyt-web/src/components/DskControlPage.jsx`, `packages/plugins/lcyt-dsk/test/dsk-templates-routes.test.js` (new).

**Original finding:** `plan_project_roles.md`'s route-mapping list names `lcyt-dsk`'s `dskTemplatesRouter`/`dskViewportsRouter` as Setup Hub's "viewports" card (**template CRUD**, **viewport CRUD**) — and those are now gated at `'setup'` tier. But the same router also exposes live graphics-operate actions on the same file: activating a template live, pushing broadcast data, starting/stopping the RTMP renderer, rendering a one-off template. These read as Production-tier (or a genuinely separate `/graphics` page tier) rather than Setup config, but `plan_project_roles.md`'s decided page model only names Setup/Assets/Production — the Graphics page (`/graphics/editor`, `/graphics/control`, `/graphics/viewports` in `lcyt-web`'s routing table) was never assigned a tier at all.

**Resolved:** assigned these six routes to the `'production'` tier — the same three-tier model (`route-access.js`'s `'setup'|'assets'|'production'`) already used for `lcyt-production`'s CRUD-vs-live-control split on cameras/mixers/encoders/bridge, not a new tier. A new local `requireProduction()` gate in `dsk-templates.js` (alongside the existing `requireSetup()`) applies it. The key wrinkle a naive copy of `requireSetup()` would have broken: `DskControlPage.jsx` (`/graphics/control` sidebar mode) is these routes' only real caller today, and it authenticates with a plain caption-session JWT (`session.getSessionToken()`) that carries no `req.user.userId` at all — there is no login-based `project_members` role to resolve for it, including in minimal-mode deployments with no user accounts. `requireSetup()`'s fail-**closed**-without-a-userId behavior would have 403'd every request from that page. `requireProduction()` instead fails **open** in that specific case (already-established precedent — mirrors `lcyt-production`'s `route-access.js` failing open when `req.session?.apiKey` is entirely absent) and only fails closed once a real per-user project-access JWT is present — which is exactly `DskControlPage.jsx`'s *standalone* mode (`/dsk-control/:key`, which reuses an already-logged-in tab's persisted `projectAccessToken`): a viewer/editor-role team member opening that page in a second tab can no longer trigger activate/broadcast/renderer-control, only operator+. Net effect: closes the real gap (a login-based non-operator team member misusing production controls) with zero regression to the session-token-based control-panel flow that predates per-user roles. New route-level test file `dsk-templates-routes.test.js` covers both branches (session-only auth fails open; real-user auth is checked against `'production'` and can be rejected/accepted).

(Found during: Phase 2 Stream B, `plan_project_roles.md`, 2026-07-26. Resolved 2026-09-10.)

---

## ~~DSK still authenticates via X-API-Key~~ — RESOLVED 2026-09-10

**Where:** `packages/plugins/lcyt-dsk/src/middleware/editor-auth.js` (deleted), `packages/lcyt-web/src/components/DskEditorPage.jsx`/`DskViewportsPage.jsx`/`setup-hub/ViewportsSection.jsx`/`DskControlPage.jsx`/`hooks/useDskMetacodeSources.js`, `packages/plugins/lcyt-dsk/src/routes/dsk-templates.js`/`dsk-viewports.js`'s `requireSetup()`, `docs/plans/plan_authentication_refactor.md`.

**Original finding:** `plan_authentication_refactor.md` explicitly listed the DSK Editor's `X-API-Key` credential as "being replaced by project membership-based auth in the refactor" — that never actually happened; `requireSetup()` carried a stopgap exemption for `authKind === 'apikey'` requests.

**Resolved:** `editor-auth.js`'s `X-API-Key` branch is deleted outright — `editorAuthOrBearer` is JWT-only now, and `requireSetup()`'s `authKind === 'apikey'` exemption is gone, so every DSK Setup-tier write goes through the same real per-user role check as any other Setup-tier route, no bypass. Frontend: `DskEditorPage.jsx`, `DskViewportsPage.jsx`, and `setup-hub/ViewportsSection.jsx` (all Setup-tier DSK writes) now send `Authorization: Bearer <projectAccessToken>` — the same `session.projectAccessToken` field `ProductionCamerasPage.jsx`/`ProductionMixersPage.jsx`/etc. already used, set by `activateProject()` when a project is entered from `/projects`. `DskControlPage.jsx`'s sidebar mode (`/graphics/control`) uses the plain session token instead (`session.getSessionToken()`), since its routes (activate/broadcast/renderer start-stop) aren't Setup-tier gated — see the sibling "DSK live-graphics-operate routes" entry above.

**A real regression this surfaced, also fixed:** `DskControlPage.jsx` is *also* reachable as a fully standalone page at `/dsk-control/:key`, rendered with no `<AppProviders>`/`SessionContext` at all (`main.jsx`'s `getStandalonePage()`) — it relied entirely on the now-retired `X-API-Key` and had no other way to authenticate. Rather than inventing a new no-login credential mechanism, it now falls back to the same localStorage-persisted project session every other logged-in page reads (`lib/projectSession.js`'s `readPersistedSessionConfig()`), used only when that persisted session's `apiKey` matches this page's own `:key` (never a leftover token for a different project); shows a "log in to this project in another tab first" message otherwise. This matches the page's real intended usage — the same already-logged-in operator opening it in a second tab/screen — rather than a genuinely credential-less kiosk flow. The DSK *output* page (`/dsk/:slugOrKey`, the actual green-screen overlay) was never affected by any of this — always public, still is.

(Found during: Phase 2 Stream B, `plan_project_roles.md`, 2026-07-26. Resolved 2026-09-10.)

---

## `lcyt-production`'s `encoders.js` and `bridge.js` had no session/user/device auth wired in at all before this pass — now fixed, but the two routers previously had a real, wide-open gap

**Where:** `packages/plugins/lcyt-production/src/routes/encoders.js`, `packages/plugins/lcyt-production/src/routes/bridge.js`, `packages/plugins/lcyt-production/src/api.js` (`createProductionRouter`).

**Finding (not skipped — fixed as part of this pass, logged for the record since it's a bigger change than "add a tier check"):** `cameras.js`/`mixers.js` already had `opts.auth` wiring (from earlier plans — `plan_ingest_feeds.md`'s cross-tenant review finding, `plan_vertical_crop.md` §4), but `createEncodersRouter`/`createBridgeRouter` had no `opts` parameter at all — encoder CRUD/start/stop/test and bridge instance CRUD/command-dispatch were fully unauthenticated beyond the bridge-agent's own separate per-instance token on its two SSE/callback routes. This pass threaded `opts.auth`/`opts.deps` through both routers (optional, so existing route-level tests that construct them directly keep working unauthenticated unless they opt in) and `server.js` now always supplies both in production, closing a real pre-existing hole as a side effect of adding the Setup/Production tier split.

(Found during: Phase 2 Stream E, `plan_project_roles.md`, 2026-07-26.)

---

## ~~`bridge.js`'s `GET /instances/:id/env` re-downloads a bridge instance's plaintext auth token to any project member, not just admins~~ — RESOLVED 2026-09-10

**Where:** `packages/plugins/lcyt-production/src/routes/bridge.js`, `GET /instances/:id/env`, `packages/plugins/lcyt-production/test/bridge-routes.test.js`.

**Original finding:** This route regenerates and returns the bridge agent's `.env` file, which contains its plaintext per-instance auth token (the credential `bridgeManager.authenticate()` checks on the agent's own SSE/callback channel). It's a GET, and every other GET in this router is left open to any project member who passes the broader `scopedAuth('production')` gate (same blanket policy as every other Setup-tier route, `plan_project_roles.md`, decided 2026-07-26: "GET stays open to any project member") — but unlike template/config reads, this one discloses a live credential, not configuration. A non-admin project member (editor/operator/viewer with org-baseline access) could re-download it.

**Resolved:** took the dedicated look the finding asked for and made the narrow exception: `requireSetup` (already a local const in this file, built from `requireTier()`) is now applied directly to this one route, despite it being a GET — `requireTier()` has no built-in method exemption of its own (unlike `lcyt-backend`'s `requireProjectRole()`); the "GETs stay open" behavior everywhere else in this router is simply that no route ever attaches the gate to a GET, not an automatic bypass baked into `requireTier()` — so attaching it here enforces admin/owner on this one read exactly as intended, with no ripple effect on any other route. New tests confirm a non-admin project member now 403s and a real admin/owner still succeeds.

(Found during: Phase 2 Stream E, `plan_project_roles.md`, 2026-07-26. Resolved 2026-09-10.)

---

## ~~`lcyt-rtmp`'s ingestion/radio/stream config routes, `routes/icons.js`, and `lcyt-files`' `/file/storage-config` can't be gated at 'setup' tier~~ — RESOLVED 2026-09-10

**Where:** `packages/plugins/lcyt-rtmp/src/routes/{ingestion,stream,radio,crop}.js`, `packages/plugins/lcyt-rtmp/src/api.js` (`createRtmpRouters`), `packages/lcyt-backend/src/routes/icons.js`, `packages/plugins/lcyt-files/src/routes/files.js` (the `/storage-config` trio), `packages/lcyt-backend/src/server.js`, `packages/lcyt-backend/src/routes/content.js`, `packages/lcyt-backend/src/middleware/project-access.js`.

**Original finding:** all of these were mounted with the plain `createAuthMiddleware(jwtSecret)` (`middleware/auth.js`) — the ephemeral session-JWT-only auth used by `/live`/`/captions`/`/mic` — not `scopedAuth()`/`createProjectAccessMiddleware`. The plain middleware never populates a real `userId`, and `requireProjectRole()` needs one to resolve a role at all, so dropping it in as-is would 403 every request unconditionally rather than gate it correctly. `icons.js`/`lcyt-files` additionally read `req.session.sessionId` + `store.get(sessionId)` directly, tying them to a **live** `/live` session existing.

**Resolved.** The investigation that unblocked this (recorded here as the recipe for the next router that hits the same wall):

1. **The "whole router group shares one auth instance" fear was overstated.** `createRtmpRouters(db, auth, managers, opts)` only threads `auth` into the four config-shaped sub-routers (`ingestion.js`, `stream.js`, `radio.js`'s `/config` pair, `crop.js`) — the public/callback ones (`rtmp.js`, `feed-rtmp.js`, `stream-hls.js`, `preview.js`) never accept an `auth` parameter at their factory signature at all. Swapping what `auth` value flows into `createRtmpRouters()` cannot touch them, full stop — no "narrow vs. broad" tradeoff to make.
2. **`createProjectAccessMiddleware` already back-fills `req.session.apiKey = authInfo.projectId`** for exactly this kind of legacy call site (`attachProjectContext()`) — this is *why* `targets.js`/`translation.js`/`stt.js` migrated cleanly before this pass: every handler in the four rtmp config routers already read `req.session.apiKey` directly, zero handler-body changes needed, just swap the injected middleware + add `requireProjectRole(db, 'setup')` (which self-exempts GET/HEAD/OPTIONS, so reads stay open to any project member with no per-route sprinkling needed).
3. **`icons.js`/`lcyt-files`'s "requires a live session" dependency was incidental, not load-bearing** — every handler that did `store.get(sessionId)` only ever read `.apiKey` off the result; the "session not found" 404 gate was an artificial requirement (uploading an icon or configuring S3 storage has no real reason to need an active broadcast running). Dropped the `store.get()` indirection entirely in favor of `req.session.apiKey`, same fix as #2.
4. **One real gotcha, found and fixed along the way:** `stream.js`'s domain-allowlist check (`requireRtmpDomain`, gated on `ALLOWED_RTMP_DOMAINS`) reads `req.session.domain` — a field only a legacy plain `/live`-session JWT ever carries, and one `createProjectAccessMiddleware`'s back-fill did **not** propagate (it only ever set `.apiKey`/`.projectId`). Swapping the auth middleware without fixing this would have 403'd *every* request through this check the moment a deployment sets a non-wildcard `ALLOWED_RTMP_DOMAINS`/`ALLOWED_DOMAINS` (the default), including plain reads — a real regression, not a narrowing. Fixed by threading `domain` through `attachProjectContext`'s session-kind branch (`req.session.domain = authInfo.domain` when present) so a genuine session JWT keeps working exactly as before, and by changing `requireRtmpDomain` to treat "no domain on this token" (any project-scoped JWT) as "not this legacy throttle's concern" rather than always-deny. **Lesson for next time: before swapping a route's auth middleware, grep the route's own handlers for every `req.session.*` field it reads, not just `.apiKey` — `createProjectAccessMiddleware`'s back-compat shim only forwards fields it's been explicitly taught to forward.**

Net effect: `ingestion.js`/`stream.js`/`radio.js`'s `/config` pair/`crop.js` now require explicit project admin/owner for writes (GET stays open); `icons.js`'s POST/DELETE and `lcyt-files`' `/storage-config` PUT/DELETE do the same. Full test suites green: lcyt-backend (1172), lcyt-rtmp (249), lcyt-files (91).

(Found during: Phase 2 Stream A/D, `plan_project_roles.md`, 2026-07-26. Resolved 2026-09-10.)

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

## ~~Direct-spawn ffmpeg sites not migrated onto the runner factory~~ — RESOLVED 2026-10-05

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

**Resolved 2026-10-05 (PR #312):** STT, music, PCM decode and DSK now go through `spawnFfmpeg` (lcyt-compute). The HLS manager deliberately stays local (it re-muxes a local RTMP stream).

---

## ~~`/production/cameras` WHIP + kiosk pages remain unauthenticated even after the cross-tenant `sourceCameraId` auth fix~~ — RESOLVED 2026-09-10

**Where:** `packages/plugins/lcyt-production/src/routes/cameras.js`
(`isUnauthenticatedCameraRoute()`), `packages/plugins/lcyt-production/src/routes/mixers.js`
(`isUnauthenticatedMixerRoute()`), `packages/lcyt-web/src/components/CameraStreamPage.jsx`,
`packages/lcyt-web/src/components/LcytMixerPage.jsx`, `packages/lcyt-web/src/components/DeviceLoginPage.jsx`,
`packages/lcyt-web/src/lib/deviceSession.js` (new).

**Original finding:** Fixing the cross-tenant `sourceCameraId` finding (a project
could reference any other project's camera via a relay slot) required real
auth on the camera CRUD routes — `owner_api_key` + `canAccessCamera()` +
`opts.auth` wired to `scopedAuth('production')` in `server.js`. But
`CameraStreamPage.jsx` and `LcytMixerPage.jsx` are capability-URL kiosk pages
(a dedicated device opens a bare URL and pushes its webcam / drives the
mixer — no login flow at all) that sent no Authorization header of any kind.
Blanket-applying auth would have broken them, so `isUnauthenticatedCameraRoute()`
carved out `/whip`, `/whip-url`, and the thumbnail-serving routes
unconditionally, leaving them exactly as open as before that pass. A real
device-role JWT mechanism already existed (`DeviceLoginPage.jsx` → `POST
/auth/device-login` → `routes/device-roles.js`'s `deviceLoginHandler`,
issuing a `{kind:'device', type:'device', apiKey, projectId, deviceRole,
roleId, permissions}` token fully compatible with
`createProjectAccessMiddleware`) but neither kiosk page read or sent it —
it just sat in `sessionStorage['lcyt-device']`, unused.

**Resolved:** wired the existing device-role JWT into both kiosk pages via a
new shared `lib/deviceSession.js` (`readDeviceSession()` +
`resolveKioskConnection()`): each page now resolves its backend URL (an
explicit `?server=` param, then the persisted device session's own
`backendUrl`, then the page's pre-existing `lcyt_backend_url` localStorage
override) and sends `Authorization: Bearer <token>` on every WHIP/sources/
switch request when a device session is present. On the backend,
`isUnauthenticatedCameraRoute()`/`isUnauthenticatedMixerRoute()` were changed
from an *unconditional* carve-out for `/whip`/`/whip-url`/`/sources` to a
*conditional* one — exactly mirroring the pre-existing pattern
`isUnauthenticatedMixerRoute()`'s `/switch` route already used
(`hasAuthCredentials(req)`-gated): a request with no credentials at all
stays exactly as open as before (no regression for any deployment with no
device roles configured), while a credentialed request — a device-role JWT
or a full project-access JWT alike — now goes through `auth()` normally and
is subject to `canAccessCamera()`/`canAccessMixer()` ownership checks, which
were added to the WHIP/sources handlers themselves (previously only the CRUD
routes and, for mixers, `/switch` enforced ownership at all). Route-level
tests added to `cameras-routes.test.js`/`mixers-routes.test.js` confirm a
credentialed cross-tenant request now 404s while the credential-less kiosk
path is unaffected.

**Also found and fixed in the same area:** `DeviceLoginPage.jsx`'s 'mixer'
role redirected straight to `/production/lcyt-mixer/${connectedRole.apiKey}`
— passing the *project's apiKey* as `LcytMixerPage.jsx`'s `:key` route param,
which it actually treats as a raw `mixerId` — the identical apiKey-vs-id
mismatch already found and fixed for the 'camera' role's redirect on
2026-09-10 (see the historical note below), just not caught for 'mixer' at
the same time. Same root cause (no per-device camera/mixer binding exists
anywhere in the data model — `deviceLoginHandler`'s response carries no such
id, `project_device_roles`'s generic `config` blob is never populated with
one), so the fix is the same: the 'mixer' case is removed and every role
type now falls through to the same project-preloaded captioning UI.

*(Historical note, preserved from the original entry: `DeviceLoginPage.jsx`
used to redirect 'camera' role logins to `/production/camera/${apiKey}` with
the identical apiKey-vs-cameraId mismatch — found and fixed 2026-09-10,
before the WHIP/kiosk auth wiring above was tackled.)*

(Found during: `/code-review` cross-tenant `sourceCameraId` fix,
plan_ingest_feeds.md, 2026-07-19. Resolved 2026-09-10.)

---

## ~~`prod_mixers` has no `owner_api_key`/ownership scoping, unlike `prod_cameras`~~ — RESOLVED 2026-09-10

**Where:** `packages/plugins/lcyt-production/src/db.js`,
`packages/plugins/lcyt-production/src/routes/mixers.js`

**Original finding:** The cross-tenant `sourceCameraId` fix added `owner_api_key` to
`prod_cameras` and real auth + `canAccessCamera()` gating to
`routes/cameras.js`. `prod_mixers` had the identical shape problem in
principle (no project/tenant column at all, `routes/mixers.js` had no
`opts.auth`) — nothing in `plan_ingest_feeds.md`'s named-feed/egress work
exercised the gap, so it wasn't fixed as part of that pass.

**Resolved:** mirrored the camera fix exactly — additive nullable
`owner_api_key` column (legacy/pre-existing rows stay in the open/unowned
bucket), a `canAccessMixer()`-equivalent ownership check, `opts.auth` wired
into `createMixersRouter`, and the credential-less kiosk `switch` carve-out
(`isUnauthenticatedMixerRoute`) preserved unchanged. Test coverage mirrors
`cameras-routes.test.js`'s cross-tenant suite: owner CRUD, a different
project getting 404 (not a leak) on read/update/delete/switch, `GET /`
filtering out other projects' owned mixers while keeping legacy unowned ones
visible, and `owner_api_key` never serialized back to the client.

(Found during: `/code-review` cross-tenant `sourceCameraId` fix,
plan_ingest_feeds.md, 2026-07-19. Resolved 2026-09-10.)

---

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

---

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

## ~~AI-tool-driven mixer switches / camera preset recalls don't trigger vertical-crop follow~~ — RESOLVED 2026-10-04

**Resolved:** `lcyt-production`'s new `commands.js` (`ProductionCommands`) is now the single path for camera preset recall and mixer switching; the HTTP routes and `lcyt-tools`' `camera.preset`/`mixer.switch` all call it, and it fires the production-follow notifications (and applies the owner check the tools used to skip). See `docs/plans/plan_backend_actions.md`. Original finding kept below.


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

## ~~Org-baseline access reaches every scopedAuth router, not just the 6 tested~~ — interim fix + follow-up plan, RESOLVED

**Where:** `packages/lcyt-backend/src/middleware/project-access.js`, `packages/lcyt-backend/src/routes/mcp-tokens.js`, `packages/plugins/lcyt-agent/src/routes/ai-providers-project.js`, `docs/plans/plan_project_roles.md` (new)

**Finding:** `getEffectiveProjectAccessLevel()`'s sweep (this same PR) was scoped/tested against 6 specific routes, but because it lives in the single shared `middleware/project-access.js` gate, it actually reaches **every** `scopedAuth('<resource>')`-mounted router — dsk, cue, token, ai, agent, role, connector, action, variable, operator, production. Two of those, `POST /mcp-tokens` (mint a personal, exportable MCP access token) and `POST/PUT/DELETE /ai/providers` (add a credentialed AI provider), do no further role check beyond "the middleware let me through" — so an org member with only baseline access (even the org `viewer` tier) could mint a durable, exportable credential for a project they were never explicitly invited to, right from the Setup Hub UI's own "Generate token" button.

**Resolution:** discussed with the project owner, who specified a fuller target model (per-project visibility private/team, a configurable org-baseline ceiling of viewer/editor — never admin — a unified owner/admin/editor/viewer role vocabulary, and page-scoped write gates: Setup=explicit-admin-only, Assets=editor+, Production=still-undecided). Building that full model was explicitly scoped OUT of this PR (still evolving — the Production/operator question is open) in favor of a narrow, well-tested interim fix: `POST /mcp-tokens`/`PATCH`/`DELETE` and `POST/PUT/DELETE /ai/providers` now require **explicit** `project_members` owner/admin (`getMemberAccessLevel`, not the org-baseline-inclusive resolver) regardless of the broader gate. `GET` on both stays on the broad gate.

**Left open at the time, tracked in `docs/plans/plan_project_roles.md` — now closed:** `lcyt-dsk`'s template/viewport routers, `lcyt-connectors`, `targets`/`translation`/`stt config` were all gated in the 2026-07-26 phase plan (commit `c083332`, "Phase 2 Streams A+C: Setup-tier gates on targets/translation/stt/connectors/roles" — `/connectors` specifically got `scopedAuth('connector')` + `requireProjectRole(db, 'setup')` in `server.js`, same shape as everything else here); `lcyt-production`'s camera/mixer/encoder/bridge CRUD got the (by-then-decided) `operator` tier the same pass. `lcyt-rtmp`'s egress/ingestion/radio config and `icons`/`storage` were the two pieces that phase plan explicitly deferred on a separate auth-model blocker (ephemeral-session-only middleware, no resolvable `userId`) — both migrated onto `scopedAuth()`/`requireProjectRole('setup')` 2026-09-10, see this file's own resolved entry for that migration's recipe. Every route this entry named is now gated; nothing outstanding from this specific finding.

(Found during: `/code-review` pass on PR #289, 2026-07-20 — design conversation follow-up. Fully resolved as of 2026-09-10.)

---

## ~~Bridge security: atem_switch commands never carry a port, so a port-qualified IP rule can never match them~~ — RESOLVED 2026-09-10

**Where:** `packages/plugins/lcyt-production/src/bridge-manager.js`'s `_resolveIpTargets()`, `packages/lcyt-bridge/src/bridge.js`'s duplicate, `packages/plugins/lcyt-production/src/adapters/mixer/atem.js`

**Original finding:** `_resolveIpTargets()` always resolved `port: null` for `atem_switch` commands, since the command object never carried one. `matchesHostPattern()`'s port-suffix check meant a rule written with a `:port` suffix (e.g. `"192.168.1.100:9910"`) could never match — a host-only pattern still worked and was the safe workaround.

**Resolved:** threaded a real `port` field through the whole path instead of taking either of the two previously-rejected shortcuts. `getSwitchCommand()` (`adapters/mixer/atem.js`) now includes `port: connectionConfig.port ?? ATEM_DEFAULT_PORT` (`atem-connection`'s own `DEFAULT_PORT`, 9910 — the same value this adapter's `connect()` and `AtemPool` have always dialed, so existing rows with no configured port see zero behavior change); a mixer's `connectionConfig` can now optionally set its own `port`. `_resolveIpTargets()` in both `bridge-manager.js` and `lcyt-bridge/src/bridge.js` use the command's real port instead of hardcoding `null`. A port-qualified rule now correctly matches/blocks an `atem_switch` command; host-only rules keep working exactly as before.

(Found during: code-review pass on the bridge security layer, 2026-07-26. Resolved 2026-09-10.)

---

## ~~Bridge security: the "stay unauthenticated despite opts.auth" carve-out pattern is now hand-rolled a third time~~ — RESOLVED 2026-09-10

**Where:** `packages/plugins/lcyt-production/src/auth-bypass.js` (new), `packages/plugins/lcyt-production/src/routes/bridge.js`'s `isUnauthenticatedBridgeRoute()`, `packages/plugins/lcyt-production/src/routes/mixers.js`'s `isUnauthenticatedMixerRoute()`, `packages/plugins/lcyt-production/src/routes/cameras.js`'s `isUnauthenticatedCameraRoute()` + its own copy of `hasAuthCredentials(req)`.

**Original finding:** Three routers each independently implemented "let this path through even when `opts.auth` is configured, because it authenticates a different way" as a local regex/path-matching function, wired up with hand-copied `if (auth) { router.use((req,res,next) => matcher(req) ? next() : auth(req,res,next)) }` boilerplate. `routes/bridge.js`'s own comment acknowledged the reinvention ("mirrors routes/cameras.js's isUnauthenticatedCameraRoute()") rather than factoring it into a shared helper. The three copies weren't even structurally aligned — `mixers.js`'s matcher took `req` and was conditional via `hasAuthCredentials(req)`; `cameras.js`'s and `bridge.js`'s took a bare `path` and were unconditional — so there was no single place to audit "which routes in this plugin are intentionally public despite `opts.auth`." A predicted trigger for finally extracting a shared helper ("if a fourth router ever needs this carve-out") arrived the same day from an unrelated angle: wiring the device-role JWT into `CameraStreamPage.jsx`/`LcytMixerPage.jsx` (the WHIP/kiosk auth follow-up, see the resolved entry above) required `cameras.js`'s carve-out to become conditional exactly like `mixers.js`'s, which meant either extracting `hasAuthCredentials()` or copying it a second time.

**Resolved:** two independent fixes landed the same day and were merged together. (1) Added `auth-bypass.js` exporting `createAuthWithBypass(auth, matcher)` — returns `null` when `auth` is falsy (preserving each router's `if (authMiddleware) router.use(...)` opt-in pattern), otherwise wraps `auth` so any request `matcher(req)` matches skips it; all three routers now call it instead of hand-rolling the wrapper. (2) `cameras.js`'s matcher was brought in line with `mixers.js`'s shape — `isUnauthenticatedCameraRoute(req)` now takes `req` and its `/whip`/`/whip-url` carve-out is conditional via its own `hasAuthCredentials(req)` copy (thumbnail routes stay unconditionally open — browsers never attach `Authorization` to `<img src>`). Net effect: the router-level wiring boilerplate is unified across all three routers (one shared factory, not three copies); the *matcher* functions themselves are deliberately still separate per router (genuinely different rules: `bridge.js`'s three carve-out routes are always bridge-agent-token-authed with no credentialed/uncredentialed distinction to make, so it stays unconditional and keyed on `path`; `cameras.js`/`mixers.js` are now both conditional and keyed on `req`, but `hasAuthCredentials()` itself is still a small copy in each — a fifth+ router needing it is the next natural trigger to share that one helper too, same recommendation as the sibling "URL→host:port" duplication entry above). `packages/plugins/lcyt-production` test suite: 287/287 (2 new cross-tenant/device-token tests added for `cameras.js`'s newly-conditional carve-out).

(Found during: code-review pass on the bridge security layer, 2026-07-26. Resolved 2026-09-10.)

---

## ~~`GET /keys` only lists projects a user directly owns~~ — FIXED 2026-07-31

**Where:** `packages/lcyt-backend/src/routes/keys.js`'s `_userListKeys` (the handler behind `GET /keys`), `packages/lcyt-backend/src/db/project-members.js`.

**Original finding (2026-07-31, Phase 3 pass):** `_userListKeys` called `getKeysByUserId(db, user.userId)`, which only returned projects the calling user directly owned, and unconditionally set `myAccessLevel: 'owner'` on every returned row — it never consulted `getEffectiveProjectAccessLevel()`. An invited project member (editor/operator/viewer/admin) or an org owner/admin relying on the org-admin override (`plan_project_roles.md`, decided 2026-07-26) had no way to see that project via `GET /keys` at all, so `ProjectSettingsPage.jsx`/`ProjectsPage.jsx` — both built exclusively from this endpoint — were only reachable by a project's direct owner. This also meant the Phase 3 owner/admin-gated UI (Team-visibility toggle/ceiling picker, per-member role-change select) had no way to be exercised end-to-end by a real non-owner.

**Fix:** added `getAccessibleProjectsForUser(db, userId)` (`db/project-members.js`) — unions directly-owned projects, explicit `project_members` rows, and team-visible (`restricted = 0`) projects belonging to an org the user is a member of, computing each project's real effective level via `getEffectiveProjectAccessLevel()` (owned rows keep the cheap `'owner'` fast path, since nothing can ever outrank it). `_userListKeys` now calls this instead of `getKeysByUserId` + a hardcoded level. Covered by `packages/lcyt-backend/test/keys-accessible-listing.test.js` (explicit member, org-admin override, org-baseline ceiling, restricted-project exclusion, stranger sees nothing, no-org project unaffected).

**Follow-on UI fix:** `ProjectSettingsPage.jsx`'s Danger Zone tab (delete/rename project) was previously always rendered regardless of access level, harmlessly, since only owners could ever reach the page before this fix. `DELETE`/`PATCH /keys/:key` are enforced backend-side as strict `api_keys.user_id === userId` ownership (not even project `'admin'` qualifies), so now that non-owners can reach the page, the tab is hidden unless `myAccessLevel === 'owner'` (with a fallback off the tab if the previously-selected tab is no longer visible). Covered by new cases in `ProjectSettingsPage.test.jsx`.

(Originally found during: `plan_project_roles.md` Phase 3 — `ProjectSettingsPage.jsx` Team visibility + role-assignment UI, 2026-07-31. Fixed same day per explicit follow-up request.)

---

## RESOLVED — YouTube broadcast privacy is now configurable (auto-start/stop still hardcoded)

**Where:** `packages/plugins/lcyt-platforms/src/adapters/youtube.js`'s `createScheduled()`/`updateSchedule()`, `broadcasts.privacy_status`

**Original finding:** every broadcast was created with `status.privacyStatus: 'unlisted'` and `contentDetails.enableAutoStart/enableAutoStop: false`, hardcoded, with no way to change them.

**Resolved 2026-07-30** (repo owner asked for it, keeping unlisted as the default): `broadcasts.privacy_status` is a real column (additive migration, `NOT NULL DEFAULT 'unlisted'`), validated against `PRIVACY_STATUSES` on both create and update, accepted by the broadcasts routes, threaded into `createScheduled`/`updateSchedule`, and exposed as a Visibility select in the broadcast Platforms panel. `updateSchedule` only sends the `status` part when a visibility was actually supplied, so an ordinary edit cannot silently reset what the operator set on YouTube.

**Still open:** `enableAutoStart`/`enableAutoStop` remain hardcoded to `false`. That matches the explicit Go Live / End Stream buttons this feature ships, so it is not currently a gap — revisit only if someone wants YouTube to start the broadcast automatically when the encoder connects.

---

## RESOLVED — cue-triggered actions: per-device cooldown, loop guard, missing atoms

**Where:** `packages/plugins/lcyt-actions/src/{executor,cue-dispatcher}.js`, `packages/lcyt-backend/src/server.js`

**Original finding (2026-10-04):** only a per-rule cooldown existed, the loop guard was a 3 s time window, `graphics:` and `obs:` atoms were missing and `crop:` took a preset id only.

**Resolved 2026-10-04:** the executor now enforces a per-device cooldown for cue runs (default 1 s, keyed by the physical device so `mixer:` and `obs:` share it). The run's causation travels in an AsyncLocalStorage context, so a cue that fires inside a running action is exactly one level deeper; the time window stays only as a fallback for device feedback that arrives later with no context. `graphics:` (including `graphics[viewport]:`), `obs:<mixer>.<scene>` and `crop:<preset name>` are implemented; `mixer:` also accepts an input by name.

**Resolved 2026-10-05:** a per-project rate cap on cue-started runs (default 20 per 60 s, settings `production.action_rate_max_runs` / `production.action_rate_window_s`) bounds such loops; refused runs publish `action.skipped { reason: 'rate_limit' }`.

---

## ~~Action steps store device labels, not ids (renames break saved atoms)~~ — RESOLVED 2026-10-05

**Where:** `packages/lcyt-web/src/components/ActionStepBuilder.jsx`, `packages/lcyt-web/src/lib/action-atoms.js`

**Finding (2026-10-04):** the agreed design said the id is stored behind the scenes on save so renames do not break saved actions. The cue editor writes the label slug (`camera:pulpit.wide`) into `action.run` as typed and does not rewrite it to an id.

**Why skipped:** the expression is free text that users also edit by hand, so a rewrite on save would change what they typed and make the field unreadable again. The server already accepts ids, and ambiguous labels are rejected there, so nothing runs against the wrong device; a renamed device just makes the step fail with a clear error.

**Resolved 2026-10-05:** the server rewrites device references to ids when an action or a cue rule's `action.run` is saved and shows the current label slugs again when it is read (`executor.rewriteDeviceRefs`, handler hooks `toIds`/`toLabels`), so the field stays readable and a rename no longer breaks a saved step. Unresolvable or ambiguous references are stored as typed.

---

## ~~`crop_preset` has no working named-action or cue-triggered path~~ — RESOLVED 2026-10-04 (PR #310)

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

**Resolved 2026-10-04 (PR #310):** actions now run on the server (`lcyt-actions` executor) and the `crop:<preset>` atom recalls a crop preset by id or name slug; cue rules reach it through `action.run`.

---

## ~~Perception job dispatch/auth-header logic duplicated across three packages~~ — RESOLVED 2026-10-05

**Where:** `packages/lcyt-backend/src/ffmpeg/worker-runner.js` (pre-existing), `packages/plugins/lcyt-production/src/perception-manager.js`, `packages/lcyt-worker-daemon/src/perception-job.js` (both new, `plan_video_perception.md` Phase 2)

**Finding:** All three files independently implement the same shape — "JSON headers + an optional internal-auth token header + POST/DELETE to whichever of `ORCHESTRATOR_URL`/`WORKER_DAEMON_URL` is configured, preferring the orchestrator" — with three different error-handling conventions (`worker-runner.js` throws, `perception-manager.js` throws, `perception-job.js` logs-and-swallows). `perception-manager.js` already factors its own internal `_headers()`/`_post()`/`_delete()` helpers cleanly; the duplication is *across* files, not within any one of them. A future change to how the internal-auth token is passed (signed header, rotated secret, etc.) needs to be found and updated in three places by hand instead of one.

**Why skipped:** the three files live in three different npm workspace packages (`lcyt-backend`, `lcyt-production`, `lcyt-worker-daemon`). A real fix means either extracting the shared logic into the common `lcyt` core library (touching a dependency all three packages share) or accepting the duplication as a cost of the package boundary. `worker-runner.js` in particular is pre-existing, stable, tested ffmpeg-job-dispatch code with no relationship to this PR's actual diff — refactoring it here to shave duplication off a brand-new, unrelated feature (perception jobs) is a real regression-risk-to-payoff mismatch for a cosmetic finding, not a correctness bug. Worth doing as its own focused pass if/when a fourth dispatch consumer shows up (the repo's own stated threshold for promoting a duplicated pattern, per `ROADMAP.md` §0's precedent for `DeviceRegistry`'s callback-to-EventBus promotion question) or when the auth-token scheme actually needs to change and the duplication becomes a real maintenance cost rather than a theoretical one.

(Found during: `/code-review` pass on `plan_video_perception.md` Phases 2-3, 2026-07-21 — reuse angle.)

**Resolved 2026-10-05:** two of the three copies (the worker runner and the worker daemon) were deleted when `lcyt-orchestrator` and `lcyt-worker-daemon` were retired; perception dispatch is now only the fffleet path in `perception-manager.js`.

## Asset Control Assistant's tools have no dialog to drive on the Assets page

**Where:** `packages/lcyt-web/src/components/AssetsPage.jsx`, `packages/lcyt-tools/src/tools/assets.js`, `docs/plans/plan_ai_roles_framework.md`

**Finding:** `plan_ai_roles_framework.md` describes Asset Control Assistant as "the same dialog-driving pattern as Setup Assistant... scoped to the Assets page's tools" — but its actual tools (`asset.update`/`asset.delete`, `packages/lcyt-tools/src/tools/assets.js`) operate on `lcyt-dsk`'s image-layer asset library (`listImages`/`updateImageSettings`/`deleteImage`), which is rendered as the Media Library inside `DskEditorPage.jsx`, not as any card on `AssetsPage.jsx` — `AssetsPage.jsx`'s 8 cards are graphics templates, cue rules, actions, icons, caption files, broadcasts, thumbnails, and videos, none of which correspond to `asset.*`'s target rows. So mounting `RoleAssistantPanel` (this pass's new `useGuidedAction`-driven chat panel) on `AssetsPage.jsx`, per the plan's stated scope, means its `pendingActions` never resolve to a real dialog — they render as plain "no interactive dialog is wired up for this yet" chat text (see `RoleAssistantPanel.jsx`'s fallback path) rather than opening/pre-filling a form.

**Skipped because:** fixing it for real means either (a) registering guided-action targets for `asset.update`/`asset.delete` inside `DskEditorPage.jsx`'s Media Library instead, which puts the chat panel on the wrong page relative to where its tools' dialogs actually live, or (b) building an image-asset management section on `AssetsPage.jsx` itself that doesn't exist today — both are a real, separate scope decision (which page should own DSK image assets), not something to resolve as a side effect of wiring up the chat panel this pass was scoped to add. The chat panel and its useful non-dialog capabilities (`asset.list` reads, proposing changes with a plain-text description) still work; only the "walk the human through the real form" behavior is unavailable for this one role.

(Found during: Lane 4 — Setup Assistant / Asset Control Assistant frontend, plan_ai_roles_framework.md's remaining Tier 1 item, 2026-07-21.)

---

**Resolved:** option (b): `AssetsPage.jsx` has an Images card (Edit/Delete) and `components/assets/useImageAssets.jsx` registers the `asset.update`/`asset.delete` guided-action dialogs.
