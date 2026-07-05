# `packages/plugins/lcyt-connectors` — API Connectors & Variables Plugin (v0.1.0)

Project-scoped `{{name}}` variable system backed by user-defined outbound API Connectors. Implements `docs/plans/plan_api_connectors_variables.md`. Imported by `lcyt-backend` as `lcyt-connectors`.

**Main entry:** `src/api.js`
**Usage in lcyt-backend:**
```js
import { initConnectors, createConnectorsRouter, createVariablesRouter } from 'lcyt-connectors';

const { bus, engine } = initConnectors(db, { filesControl: { resolveStorage } });
app.use('/connectors', createConnectorsRouter(db, auth));
app.use('/variables', createVariablesRouter(db, auth, bus, engine));
```

**Source files (`src/`):**
- `db.js` — Migrations for `api_connectors`, `api_requests`, `api_response_mappings`, `variables` (all `api_key`-scoped, unenforced FK). CRUD helpers for all four; `maskConnector()` strips `auth_config` from client responses (only exposes `authConfigured: boolean`); `resolveVariableValue()` implements the fallback chain (current → default → `''`).
- `interpolate.js` — Server-side `{{name}}` substitution (`interpolate`, `interpolatePairs` for header/query `{key,value}` arrays, `extractVariableNames`). Pure read — never triggers a refresh.
- `json-path.js` — Hand-rolled minimal JSONPath subset (`$`, `$.foo.bar`, `$.items[0].name`, bracket-quoted keys). No JSONPath library is installed anywhere in this monorepo; this covers `api_response_mappings.json_path` without adding one. Not a full JSONPath implementation (no wildcards/filters/recursive descent).
- `variables-bus.js` — `VariablesBus`: per-`api_key` SSE subscriber registry for `variable_updated` events, same shape as `packages/lcyt-backend/src/dsk-bus.js`.
- `resolution-engine.js` — `createResolutionEngine({ db, bus, filesControl })` → `fireRequest(apiKey, connectorSlug, requestSlug)`: interpolates `{{ }}` into path/query/headers/body from the current variable snapshot, applies connector auth (`none`/`api_key`/`bearer`/`basic`/`custom`), fires the HTTP call, maps the response onto variables per `response_type` (`json`/`text`/`raw` via JSONPath; `image`/`binary` via the injected `filesControl.resolveStorage(apiKey)` storage adapter — reuses `lcyt-files`' `putObject`/`publicUrl`, no separate blob store), and emits `variable_updated` SSE per updated variable.
- `routes/connectors.js` — `createConnectorsRouter(db, auth)`: nested CRUD for connectors → requests → response mappings. `auth_config` never serialized to the client.
- `routes/variables.js` — `createVariablesRouter(db, auth, bus, engine)`: variable CRUD, `GET /variables/events` SSE (same `?token=`-or-Bearer EventSource auth pattern as `routes/stt.js`), and `POST /variables/refresh` (fire-and-forget without `waitMs`; races the call against a 150–250ms-clamped `waitMs` otherwise — this is what the prefetch tier's blocking fallback calls under the hood).

**Prefetch-tier background loop ownership:** the repeating refresh loop for the prefetch tier (`api!:`) is **not** managed server-side. Per the plan (§6, §9), the frontend owns it: `InputBar.jsx`'s pointer-change effect starts/stops a `setInterval` calling `POST /variables/refresh` while the pointer sits on a line carrying an `api!:` trigger, cancelled the instant the pointer moves off. There is deliberately no `PrefetchManager` class here.

**Database:** `api_connectors`, `api_requests` (`UNIQUE(connector_id, slug)` — request slugs unique per connector, not globally), `api_response_mappings`, `variables` (`PRIMARY KEY (api_key, name)`). See `db.js` migrations for full schema, matching plan §3 exactly.

**API routes:** see root `CLAUDE.md`'s package index / `packages/lcyt-backend/CLAUDE.md`'s route table for the full list (`/connectors/*`, `/variables/*`).

## Frontend integration (packages/lcyt-web)

- `src/lib/metacode-parser.js` — `!api:`/`api:`/`api!:` line codes, dedicated regex (`API_TRIGGER_RE`) mirroring `cue:`'s handling: stripped from delivered text, one-shot per line (not persistent across lines like `section`/`stanza`), comma-separated multi-trigger support. Produces `lineCodes[i].apiTriggers = [{ connectorSlug, requestSlug, tier }]`.
- `src/lib/metacode-variables.js` — `interpolateVariables(text, snapshot)`: client-side `{{name}}` insertion, mirrors `interpolate.js` above.
- `src/hooks/useVariables.js` — `useVariables({ backendUrl, connected, getToken })`: fetches the initial snapshot (`GET /variables`), subscribes to `GET /variables/events` SSE, exposes `snapshot()` and `refresh(connectorSlug, requestSlug, waitMs?)`.
- `src/components/InputBar.jsx` — pointer-change effect fires pointer-tier triggers once and (re)starts/stops the prefetch-tier's background interval (default 3000ms — the frontend doesn't fetch the request's configured `prefetch_interval_ms` before starting the loop, so it uses the plan's stated default); `doSend()` fires send-tier triggers fire-and-forget, does one `waitMs`-bearing prefetch-tier top-up call, resolves `{{ }}` in the outgoing text via `interpolateVariables`, and merges `variables.snapshot()` into `codes` **additively** alongside the existing localStorage-backed `getActiveCodes()` (manual codes still win — this preserves `ActionsPanel`/`QuickActionsPopover` behavior unchanged rather than migrating them onto the new backend, which remains follow-on work per the plan's own scoping).
- `src/components/setup-hub/ConnectorsSection.jsx` — the Connector/Request/response-mapping/Variable management UI itself: a Setup Hub card with full CRUD inline in its expandable body, same convention as `CameraSection`/`BridgeSection`/`StorageSection` (no standalone page — see root `CLAUDE.md`'s Metacode Organization / Setup Hub conventions). Deep-linkable via `/setup/connectors`, which renders `SetupHubPage` with this card pre-expanded and scrolled into view (`SetupHubPage`'s `useRoute('/setup/connectors')`).

## Known gaps / follow-on work (see plan §9, §10)

- `ActionsPanel`/`QuickActionsPopover` still write to `localStorage` (`metacode-active.js`), not to `POST/PUT /variables` — migrating them is separate frontend work the plan itself scopes independently.
- No "stale/default used" (`variableFallbacks`) visible indicator on sent captions yet (plan §4's open UI question).
- `{{ }}` insertion is only wired into `InputBar.jsx`'s outgoing caption text, not yet into planner/DSK template text fields (plan §10.3).
- Variable history/audit (plan §10.4) not addressed — only the current value is kept.

## Test Coverage

**Test files:** `test/db.test.js`, `test/interpolate.test.js`, `test/json-path.test.js`, `test/resolution-engine.test.js` (mocks `globalThis.fetch`), `test/routes.test.js` (real `express` app + real HTTP requests via `fetch` against an ephemeral port). 41 tests total.

Frontend metacode-parser additions are tested in `packages/lcyt-web/test/fileUtils.test.js` (`describe('parseFileContent() — API connector triggers')`) and `packages/lcyt-web/test/metacode-variables.test.js`.

**Gaps:** no test coverage yet for `InputBar.jsx`'s pointer-effect/prefetch-interval wiring itself (no existing test file covers `InputBar.jsx` at all — matches the pre-existing gap noted in `lcyt-web/CLAUDE.md`).
