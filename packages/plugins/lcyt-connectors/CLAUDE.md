# `packages/plugins/lcyt-connectors` — API Connectors & Variables Plugin (v0.1.0)

Project-scoped `{{name}}` variable system backed by user-defined outbound API Connectors. Implements `docs/plans/plan_api_connectors_variables.md`. Imported by `lcyt-backend` as `lcyt-connectors`.

**Main entry:** `src/api.js`
**Usage in lcyt-backend:**
```js
import {
  initConnectors, createConnectorsRouter, createVariablesRouter,
  createGlobalNetworkRulesRouter, createOrgNetworkRulesRouter,
} from 'lcyt-connectors';

const { bus, engine, scheduler } = initConnectors(db, { filesControl: { resolveStorage } });
app.use('/connectors', createConnectorsRouter(db, auth));
app.use('/variables', createVariablesRouter(db, auth, bus, engine, scheduler, jwtSecret));
app.use('/admin/connector-network-rules', createGlobalNetworkRulesRouter(db, createAdminMiddleware(db, jwtSecret)));
app.use(createOrgNetworkRulesRouter(db, createUserAuthMiddleware(jwtSecret)));
```

**Source files (`src/`):**
- `db.js` — Migrations for `api_connectors`, `api_requests`, `api_response_mappings`, `variables`, `connector_network_rules` (all `api_key`-scoped except the last, which is `scope`/`org_id`-scoped; unenforced FK throughout). The `variables` table carries TTL columns (`expires_at` ISO, `expires_at_seq`, `revert_mode` `baseline`|`literal`|`previous`, `revert_value`, `prev_value`) — additive `ALTER TABLE` migrations back-fill pre-existing DBs. `upsertManualVariable()` accepts a `ttl` (writes those columns, captures `prev_value` for `previous` mode; no `ttl` clears them — last-write-wins); `applyRevert()` recomputes `current_value` from the stored revert mode and clears the TTL columns; `materializeExpired()` lazily reverts all rows past due; `serializeVariableRow()` is the shared JSON/SSE shape (adds `expiresAt`/`revertMode`). CRUD helpers for all five tables; `maskConnector()` strips `auth_config` from client responses (only exposes `authConfigured: boolean`); `resolveVariableValue()` implements the fallback chain (current → default → `''`); `getApiKeyOrgId()`/`getOrgRole()` read the core `api_keys`/`organizations`/`org_members` tables owned by `lcyt-backend` (not this plugin) to resolve a project's org and a user's role in it — wrapped defensively since those tables may not exist in an isolated test DB.
- `interpolate.js` — Server-side `{{name}}` substitution (`interpolate`, `interpolatePairs` for header/query `{key,value}` arrays, `extractVariableNames`). Pure read — never triggers a refresh.
- `json-path.js` — Hand-rolled minimal JSONPath subset (`$`, `$.foo.bar`, `$.items[0].name`, bracket-quoted keys). No JSONPath library is installed anywhere in this monorepo; this covers `api_response_mappings.json_path` without adding one. Not a full JSONPath implementation (no wildcards/filters/recursive descent).
- `network-guard.js` — SSRF guard for every outbound connector fetch. See "Network policy" below.
- `variables-bus.js` — `VariablesBus`: publishes the canonical `variable.updated` topic through the shared `EventBus` (`lcyt/event-bus`, injected via `initConnectors(db, { eventBus })`; a private bus is created when omitted, keeping isolated tests standalone). The `GET /variables/events` stream keeps its exact `variable_updated` wire shape via `rename`/`envelope:false`. Same delegation pattern as `DskBus`/`RolesBus` (`plan_pubsub_event_bus.md`).
- `ttl.js` — `parseValueTtl(rawValue)`: pure parser for the `=>` variable-TTL annotation (`"Prayer => 20s:Hymn"` → `{ value: 'Prayer', ttl: { ms, captions, revertMode, revertValue } }`). End-anchored, so a trailing `=> x` that isn't a valid `<count><unit>` spec stays literal. Duplicated verbatim in `lcyt-web`'s `src/lib/metacode-ttl.js` (same convention as `interpolate.js`/`metacode-variables.js`). See `docs/plans/plan_metacode_variable_unification.md` "Variable TTL / expiry".
- `ttl-scheduler.js` — `createTtlScheduler({ db, bus })`: active revert of **time-based** variable TTLs. A write with an `expires_at` gets a `setTimeout`; on fire (or `restore()` at startup for persisted expiries) the row is reverted via `applyRevert()` and a `variable_updated` event emitted, so live SSE consumers see the revert without waiting for a caption. `reschedule()` cancels any pending timer first (last-write-wins). Caption-based TTLs (`expires_at_seq`) are **not** handled here — they revert at a send-path hook (follow-on, see "Known gaps").
- `resolution-engine.js` — `createResolutionEngine({ db, bus, filesControl })` → `fireRequest(apiKey, connectorSlug, requestSlug)`: interpolates `{{ }}` into path/query/headers/body from the current variable snapshot, resolves the project's `org_id` and runs `network-guard.js`'s `checkUrlAllowed()` **before** ever calling `fetch()` (returns `{ ok: false, error: <reason> }` without any network I/O if blocked), applies connector auth (`none`/`api_key`/`bearer`/`basic`/`custom`), fires the HTTP call, maps the response onto variables per `response_type` (`json`/`text`/`raw` via JSONPath; `image`/`binary` via the injected `filesControl.resolveStorage(apiKey)` storage adapter — reuses `lcyt-files`' `putObject`/`publicUrl`, no separate blob store), and emits `variable_updated` SSE per updated variable.
- `routes/connectors.js` — `createConnectorsRouter(db, auth)`: nested CRUD for connectors → requests → response mappings. `auth_config` never serialized to the client.
- `routes/variables.js` — `createVariablesRouter(db, auth, bus, engine, scheduler, jwtSecret)`: variable CRUD, `GET /variables/events` SSE (`?token=`-or-Bearer EventSource auth, verified with `jwt.verify(token, jwtSecret)` — **not** a raw base64 decode; see "SSE authentication" below), and `POST /variables/refresh` (fire-and-forget without `waitMs`; races the call against a 150–250ms-clamped `waitMs` otherwise — this is what the prefetch tier's blocking fallback calls under the hood). **TTL:** `POST`/`PUT /variables` accept a structured `ttl` field *or* an inline `=>` annotation in the value (parsed via `ttl.js`, wins when it parses to a valid TTL); each write calls `scheduler.reschedule()` (a write with no TTL clears any pending expiry — last-write-wins). `PUT` also accepts `source` (`'file'` for namespace-unification file-code writes, else `'manual'`); `upsertManualVariable` gained the `source` param. `GET /variables` runs `materializeExpired()` first (lazy revert of anything due, pushed to SSE) so reads are correct even after a restart. Serialized rows now expose `expiresAt` + `revertMode`. The router now takes a `scheduler` arg (from `initConnectors`) ahead of `jwtSecret`.
- `routes/network-rules.js` — `createGlobalNetworkRulesRouter(db, adminAuth)` (mount at `/admin/connector-network-rules`) and `createOrgNetworkRulesRouter(db, userAuth)` (mount at the router root — it defines its own `/orgs/:orgId/connector-network-rules` paths). See "Network policy" below.

**Prefetch-tier background loop ownership:** the repeating refresh loop for the prefetch tier (`api!:`) is **not** managed server-side. Per the plan (§6, §9), the frontend owns it: `InputBar.jsx`'s pointer-change effect starts/stops a `setInterval` calling `POST /variables/refresh` while the pointer sits on a line carrying an `api!:` trigger, cancelled the instant the pointer moves off. There is deliberately no `PrefetchManager` class here.

**Database:** `api_connectors`, `api_requests` (`UNIQUE(connector_id, slug)` — request slugs unique per connector, not globally), `api_response_mappings`, `variables` (`PRIMARY KEY (api_key, name)`), `connector_network_rules` (`scope` 'global'|'org', `org_id` nullable, `rule_type` 'allow'|'deny', `pattern`). See `db.js` migrations for full schema, matching plan §3 (plus the network-rules table added for the SSRF guard, not in the original plan doc).

**API routes:** see root `CLAUDE.md`'s package index / `packages/lcyt-backend/CLAUDE.md`'s route table for the full list (`/connectors/*`, `/variables/*`, `/admin/connector-network-rules*`, `/orgs/:orgId/connector-network-rules*`).

## Network policy (SSRF guard)

A connector's `base_url` + a request's `path`/`query_params` are entirely user-controlled, and the resolution engine fetches them server-side — without a guard, this is a textbook SSRF vector (cloud metadata endpoints like `169.254.169.254`, internal-network services, `localhost`-bound admin panels, etc.). `network-guard.js`'s `checkUrlAllowed(db, url, orgId)` runs before every outbound `fetch()` call in `resolution-engine.js`.

**Defaults (always applied, resolved via real DNS lookup — not just the literal hostname string, so a public-looking hostname resolving to a private IP is still caught):** blocks loopback, RFC1918 private ranges, link-local/CGNAT, IETF-reserved, and multicast addresses, for both IPv4 and IPv6 (`net.BlockList` under the hood). Non-`http(s)` schemes are rejected unconditionally, with no override.

**Two override tiers**, both stored in `connector_network_rules` and evaluated in this order (first match wins) — see `network-guard.js`'s top-of-file doc comment for the full precedence table:
1. **org `deny`** — enforced; cannot be bypassed by any `allow`, including that org's own.
2. **global `deny`** — site-wide, admin-managed.
3. **org `allow`** — lets an org's owner/admin permit something the defaults would otherwise block *for that org only* (the intended use case: a locally-running Ollama instance at `127.0.0.1:11434` that only that org's connectors should reach).
4. **global `allow`** — site-wide.
5. otherwise: blocked if it resolves to a restricted address, allowed if it doesn't.

**Rule pattern syntax:** exact hostname (`api.example.com`), wildcard subdomain (`*.example.com`), exact IP (`127.0.0.1`), or CIDR (`10.0.0.0/8`); any of these may have a `:port` suffix (or `[::1]:11434` for bracketed IPv6) to scope the rule to one port — a pattern without a port matches that host/IP on any port.

**Management routes:**
- `GET/POST/DELETE /admin/connector-network-rules[/:id]` — global rules, admin auth (`createAdminMiddleware` — `X-Admin-Key` or an `is_admin` user).
- `GET/POST/DELETE /orgs/:orgId/connector-network-rules[/:id]` — org rules, user JWT auth (`createUserAuthMiddleware`). Any org member (owner, `org_members.role` of `'admin'` or `'member'`) can `GET`; only the owner (`organizations.owner_user_id`) or an `'admin'` role can `POST`/`DELETE`.

**Known limitation:** DNS-resolved addresses are checked once, immediately before the fetch; this doesn't defend against a TOCTOU DNS-rebinding attack where the name re-resolves to a different (restricted) IP between the check and the actual `fetch()` call. Node's `fetch()` doesn't expose a way to pin the resolved IP for a subsequent request, so closing this fully would need a custom `dns.lookup` override or an HTTP agent that resolves once and reuses that address. Not implemented — flagged as a follow-on if this plugin's threat model needs to defend against actively malicious connector operators (today's tiers already assume a project's own connector configuration is at least not adversarial to itself, only that its *targets* might be).

## SSE authentication

`GET /variables/events` accepts a `?token=` query param (since `EventSource` can't set headers) and verifies it with `jwt.verify(token, jwtSecret)` — a real signature check, not a raw base64 decode of the JWT payload segment. (An earlier version of this route — copied from `lcyt-backend/src/routes/stt.js`'s same pattern — only base64-decoded the payload and read `apiKey` out of it without verifying anything, despite a comment claiming it matched `routes/events.js`'s approach; `events.js` actually does call `jwt.verify()`. That gap meant anyone could hand-craft a `header.payload.signature`-shaped string with any `apiKey` claim and subscribe to that project's `variable_updated` stream. `routes/stt.js` had the same gap and has since been fixed the same way — see `lcyt-backend/CLAUDE.md`.)

## Frontend integration (packages/lcyt-web)

- `src/lib/metacode-parser.js` — `!api:`/`api:`/`api!:` line codes, dedicated regex (`API_TRIGGER_RE`) mirroring `cue:`'s handling: stripped from delivered text, one-shot per line (not persistent across lines like `section`/`stanza`), comma-separated multi-trigger support. Produces `lineCodes[i].apiTriggers = [{ connectorSlug, requestSlug, tier }]`.
- `src/lib/metacode-variables.js` — `interpolateVariables(text, snapshot)`: client-side `{{name}}` insertion, mirrors `interpolate.js` above.
- `src/hooks/useVariables.js` — `useVariables({ backendUrl, connected, getToken })`: fetches the initial snapshot (`GET /variables`), subscribes to `GET /variables/events` SSE, exposes `snapshot()`, `refresh(connectorSlug, requestSlug, waitMs?)`, and `writeFileCode(name, value, ttl?)` — the namespace-unification write that mirrors a persistent file metacode into the durable store via `PUT /variables/:name` with `source: 'file'` (value string-coerced; `ttl` from the code's `=>` annotation).
- `src/components/InputBar.jsx` — pointer-change effect fires pointer-tier triggers once and (re)starts/stops the prefetch-tier's background interval (default 3000ms — the frontend doesn't fetch the request's configured `prefetch_interval_ms` before starting the loop, so it uses the plan's stated default); `doSend()` fires send-tier triggers fire-and-forget, does one `waitMs`-bearing prefetch-tier top-up call, resolves `{{ }}` in the outgoing text via `interpolateVariables`, and merges `variables.snapshot()` into `codes` **additively** alongside the existing localStorage-backed `getActiveCodes()` (manual codes still win — this preserves `ActionsPanel`/`QuickActionsPopover` behavior unchanged rather than migrating them onto the new backend, which remains follow-on work per the plan's own scoping).
- `src/components/setup-hub/ConnectorsSection.jsx` — the Connector/Request/response-mapping/Variable management UI itself: a Setup Hub card (`id="connectors"`) with full CRUD inline in its expandable body, same convention as every other Setup Hub card (`CameraSection`/`BridgeSection`/`StorageSection`/etc. — no standalone page). Deep-linkable via `/setup/connectors`: `SetupCard`'s own `id` prop matches against wouter's `useRoute('/setup/:card')` and pre-expands + scrolls itself into view — this is generic to every Setup Hub card, not special-cased for connectors.

## Known gaps / follow-on work (see plan §9, §10)

- `ActionsPanel`/`QuickActionsPopover` still write to `localStorage` (`metacode-active.js`), not to `POST/PUT /variables` — migrating them is separate frontend work the plan itself scopes independently.
- No "stale/default used" (`variableFallbacks`) visible indicator on sent captions yet (plan §4's open UI question).
- `{{ }}` insertion is only wired into `InputBar.jsx`'s outgoing caption text, not yet into planner/DSK template text fields (plan §10.3).
- Variable history/audit (plan §10.4) not addressed — only the current value is kept.
- **Variable TTL — caption-based (`c`) enforcement** is not wired: the schema stores `expires_at_seq` and `parseValueTtl` produces `captions`, but nothing decrements/compares against a project caption count yet. Needs a project-scoped sent counter incremented from `lcyt-backend`'s send path (see `docs/plans/plan_metacode_variable_unification.md`). Time-based (`s`/`m`/`ms`) TTL is fully implemented.
- **Variable TTL — frontend wiring** (`=>` parsing into `parseFileContent` and file-metacode assignments POSTing to `/variables`) is part of the namespace-unification phase (Option A), not this one. `metacode-ttl.js`/`ttl.js` (`parseValueTtl`) ship now as the ready building block; the durable-write path that consumes them is follow-on.

## Test Coverage

**Test files:** `test/db.test.js`, `test/interpolate.test.js`, `test/json-path.test.js`, `test/resolution-engine.test.js` (mocks `globalThis.fetch`), `test/network-guard.test.js` (default-restricted ranges, global/org allow/deny precedence, IPv4-mapped IPv6, pattern parsing — all using literal IPs so no real DNS/network is needed), `test/network-rules-routes.test.js` (admin + org CRUD, role enforcement), `test/routes.test.js` (real `express` app + real HTTP requests via `fetch` against an ephemeral port, including signed-vs-forged-JWT SSE auth cases + inline-`=>` TTL POST/last-write-wins), `test/ttl.test.js` (`parseValueTtl` — 19 cases), `test/ttl-variables.test.js` (TTL storage/revert modes, `materializeExpired`, active scheduler timer revert + last-write-wins cancel + `restore()`).

Frontend metacode-parser additions are tested in `packages/lcyt-web/test/fileUtils.test.js` (`describe('parseFileContent() — API connector triggers')`) and `packages/lcyt-web/test/metacode-variables.test.js`.

**Gaps:** no test coverage yet for `InputBar.jsx`'s pointer-effect/prefetch-interval wiring itself (no existing test file covers `InputBar.jsx` at all — matches the pre-existing gap noted in `lcyt-web/CLAUDE.md`).
