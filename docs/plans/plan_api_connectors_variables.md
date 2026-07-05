---
id: plan/api_connectors_variables
title: "API Connectors & Variables — {{ }} Bindings and Metacode-Triggered Refresh"
status: draft
summary: "Design for a project-scoped variable system (`{{name}}` insertion, timing-agnostic, usable anywhere) backed by user-defined API Connectors (base URL, auth, headers) with nested Requests (method/path/query/body/response mapping). Refresh is triggered by a metacode, not by the insertion syntax itself, across three tiers: `<!-- !api:slug.slug -->` (on pointer arrival), `<!-- api:slug.slug -->` (async, fired at send), `<!-- api!:slug.slug -->` (prefetch, blocks briefly at send for freshness). Unifies the existing localStorage-only 'active codes' concept into the same variable model. Documentation only — no implementation."
related: plan/team_org_backend, plan/selfservice_config_backend, plan/ai_roles_framework, plan/cues, plan/dsk
---

# API Connectors & Variables — {{ }} Bindings and Metacode-Triggered Refresh

## Context

Today, `{{ }}`-style substitution does not exist anywhere in LCYT. The closest existing thing is "codes" — key/value pairs like `section`/`stanza`/`speaker` that an operator sets manually via UI widgets (`ActionsPanel`, `QuickActionsPopover`), stored in `localStorage` under `lcyt:active-codes` (`packages/lcyt-web/src/lib/metacode-active.js`, re-exported by `activeCodes.js`). `InputBar.jsx`'s `doSend()` reads them via `getActiveCodes()` (`InputBar.jsx:166`), merges in per-line codes from the file (`lineCodes` take priority), and attaches the result as `codes` on the outgoing caption. The backend never computes anything from `codes` — `applyMetacodeProcessors()` (`packages/lcyt-backend/src/metacode.js`) just hands it through to the DSK caption processor, which re-broadcasts it verbatim as an SSE `bindings` event (`packages/plugins/lcyt-dsk/src/caption-processor.js:159`). It is pure pass-through, end to end.

Separately, every existing metacode processor (`graphics:`, `cue:`, `sound:`/`bpm:`) follows one shape: a regex detects a pattern inside caption text, strips it, and fires a side effect — the pattern itself never survives into delivered text. This plan needs two different things and keeps them that way rather than forcing one shape to do both jobs:

1. **Insertion** — `{{name}}` — a pure, timing-agnostic *read* of a variable's current value. The opposite of a metacode: it doesn't get stripped, it gets *replaced with content that is delivered*.
2. **Trigger** — a metacode that fires an outbound API call and refreshes one or more variables as a side effect, producing no text of its own. This fits the existing metacode shape exactly, so it lives in the metacode family syntactically (`<!-- api:... -->`), parsed the same way `graphics:`/`cue:` are today.

Resolution order: variables (`{{ }}`) resolve **before** metacodes are parsed, so a metacode's own parameters could reference a resolved variable if ever needed — the reverse is never required.

## 1. Syntax

### 1.1 Insertion — `{{name}}`

A pure read of variable `name`'s current cached value. Works anywhere the app already renders caption/rundown/planner text — captions, planner blocks, DSK template text fields (natural follow-on, not scoped in detail here). Resolving `{{name}}` **never triggers a fetch** — it only ever reads whatever the variable currently holds.

- `{{_name}}` (leading underscore) is reserved for program/system-provided variables. `POST`/`PUT /variables` reject any user-supplied name starting with `_` (400). System variables (e.g. a running sequence number, current timestamp) are computed on demand by a small built-in registry, not stored rows — out of scope to fully spec here beyond reserving the namespace.
- If a variable has never resolved (no cached value, no default): renders as empty string. If it has a `default_value` but no live/cached value yet: renders the default. Both cases are the same "fallback chain" described in §4.

### 1.2 Trigger — `!api:`, `api:`, `api!:`

Three tiers, distinguished by *when* the call fires relative to the actual send instant and whether that send waits for it:

- **`<!-- !api:connectorSlug.requestSlug -->`** — **pointer tier.** Fires the named request once, fire-and-forget, the moment the operator's pointer arrives at the line containing this metacode (the same `onPointerChanged` hook `useFileStore` already exposes). No relationship to the send instant beyond "whatever value is cached by then, if any" — placing it on line 1 reproduces "refresh on file load" for free, with no dedicated load-tier syntax needed.
- **`<!-- api:connectorSlug.requestSlug -->`** — **send tier (async).** Fires the named request at the instant the line is actually sent — not before — but asynchronously: the send does not wait for it. This particular caption goes out using whatever value was already cached (or the default); the call's result becomes available starting with the *next* read of that variable. This tier is for action-style calls tied to actual delivery (e.g. "notify X exactly when this line goes out") where prefetching ahead of time doesn't make sense and blocking would only add latency for no benefit.
- **`<!-- api!:connectorSlug.requestSlug -->`** — **prefetch tier.** The same pointer-arrival event as the pointer tier starts a background refresh loop for this request, refreshing on a short interval while the pointer remains on that line (default `3000ms`, configurable per-request as `prefetchIntervalMs`). The loop is cancelled the moment the pointer leaves the line. At the actual instant of send, the freshest already-resolved value is used; only if nothing has resolved yet does send block, and then only up to a small hard-capped timeout (default `200ms`, configurable per-request/connector, clamped to `150–250ms`). This is the tier for "I need the freshest defensible value right at send, and it's worth a small wait to get it" — e.g. a live viewer count.

All three are ordinary metacodes: detected via the existing HTML-comment convention, parsed into `lineCodes[i]` the same way `graphics:`/`cue:` already are (e.g. `lineCodes[i].apiTriggers = [{ connectorSlug, requestSlug, tier: 'pointer'|'send'|'prefetch' }]`), stripped from delivered text, fire a side effect, and never appear in the sent caption. Multiple triggers on one line use the same comma-separated convention `graphics:` already uses: `<!-- api!:weather.current,login.token -->`.

Addressing is `connectorSlug.requestSlug` — a composite, so request slugs only need to be unique **within their connector**, not globally across the project.

## 2. Resolution Model & Chaining

A request's `path`, `queryParams`, `headers`, and `body` may all contain `{{name}}` references (confirmed: chaining is wanted, e.g. a login connector's token variable used in another connector's `Authorization` header).

**Chaining reads the current cached value — it never cascades a refresh.** When a trigger fires request B and B's header contains `{{auth_token}}`, the engine substitutes whatever `auth_token` currently holds; it does **not** check whether `auth_token` is stale and go refresh connector A first. This is a deliberate simplification: it means there is no dependency graph, no topological ordering, and no cycle detection to build or maintain — chaining is "read what's there," not "go get it."

Practical consequence for authors: if request B depends on a variable that request A produces, A's own trigger must appear earlier in the file so its variable is warm before B fires (e.g. A's pointer-tier trigger on line 1). If A's variable was never resolved, B's interpolated field is simply empty string — B still fires (likely erroring upstream, e.g. an unauthenticated 401), and that failure surfaces through the same connector-call error path as any other failed request. Never a silent hang, never a hidden resolution step.

Interpolation happens **server-side only**, immediately before the outbound HTTP call fires, using the project's live variable snapshot. This is required regardless of the chaining question, because `auth_config` (bearer tokens, API keys, basic credentials) must never be sent to the client — see §7.

## 3. Backend Schema

Four tables, project-scoped (`api_key` FK, unenforced, matching the existing `ai_config`/`stt_config` convention):

```sql
CREATE TABLE IF NOT EXISTS api_connectors (
  id           TEXT    PRIMARY KEY,             -- client-generated UUID
  api_key      TEXT    NOT NULL,
  name         TEXT    NOT NULL,
  slug         TEXT    NOT NULL,                 -- metacode-addressable; unique per api_key
  base_url     TEXT    NOT NULL,
  auth_type    TEXT    NOT NULL DEFAULT 'none',  -- none | api_key | bearer | basic | custom
  auth_config  TEXT    NOT NULL DEFAULT '{}',    -- JSON; shape depends on auth_type; never sent to client (see §7)
  headers      TEXT    NOT NULL DEFAULT '[]',    -- JSON array [{ key, value }]; value may contain {{ }}
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (api_key, slug)
);

CREATE TABLE IF NOT EXISTS api_requests (
  id                  TEXT    PRIMARY KEY,
  connector_id        TEXT    NOT NULL REFERENCES api_connectors(id) ON DELETE CASCADE,
  name                TEXT    NOT NULL,
  slug                TEXT    NOT NULL,                 -- unique per connector, not per project
  method              TEXT    NOT NULL,                 -- GET|POST|PUT|DELETE|OPTIONS|PATCH
  path                TEXT    NOT NULL,                 -- appended to connector base_url; may contain {{ }}
  query_params        TEXT    NOT NULL DEFAULT '[]',    -- JSON array [{ key, value }]; value may contain {{ }}
  body_type           TEXT    NOT NULL DEFAULT 'raw',   -- raw|text|json
  body_content        TEXT,                              -- may contain {{ }}
  response_type       TEXT    NOT NULL DEFAULT 'auto',   -- auto|json|text|image|binary|raw
  prefetch_interval_ms INTEGER NOT NULL DEFAULT 3000,    -- prefetch-tier background refresh interval
  timeout_ms          INTEGER NOT NULL DEFAULT 200,      -- prefetch-tier hard cap (clamped 150-250 in code)
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (connector_id, slug)
);

CREATE TABLE IF NOT EXISTS api_response_mappings (
  id             TEXT    PRIMARY KEY,
  request_id     TEXT    NOT NULL REFERENCES api_requests(id) ON DELETE CASCADE,
  json_path      TEXT    NOT NULL DEFAULT '$',   -- '$' = whole body; JSONPath otherwise (only meaningful for json/auto+json)
  variable_name  TEXT    NOT NULL,
  skip_if_null   INTEGER NOT NULL DEFAULT 1,     -- "map only if not null" — keep previous value on null/missing extraction
  sort_order     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_api_response_mappings_request ON api_response_mappings(request_id);

CREATE TABLE IF NOT EXISTS variables (
  api_key         TEXT    NOT NULL,
  name            TEXT    NOT NULL,                 -- rejects leading '_' at the route layer, not here
  current_value   TEXT,                              -- text; for image/binary responses, a storage reference (see §6)
  default_value   TEXT,
  source           TEXT    NOT NULL DEFAULT 'manual', -- manual | connector
  source_request_id TEXT REFERENCES api_requests(id) ON DELETE SET NULL,
  resolved_at     TEXT,
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (api_key, name)
);
```

One request can populate several variables at once (multiple rows in `api_response_mappings`), matching the user's own connector design: the API call itself has no direct output — firing it is a pure side effect that refreshes whichever variables its mappings target. Captions only ever read variables via `{{name}}`, never a connector call directly.

`response_type` handling in the resolution engine:
- `json` (or `auto` sniffing a JSON `Content-Type`): each mapping's `json_path` is evaluated against the parsed body.
- `text`/`raw` (or `auto` sniffing non-JSON): `json_path` is ignored; the whole response body (as string) maps to the mapping's `variable_name`. A request with this response type should have exactly one mapping with `json_path: '$'`.
- `image`/`binary`: the fetched blob is stored via the same storage-adapter interface `lcyt-files` already defines (local/S3/WebDAV — see `packages/plugins/lcyt-files/src/storage.js`), and the variable's `current_value` becomes a reference (servable URL or file id), not raw bytes. Reuses existing infrastructure rather than inventing a second blob-storage path.

## 4. Prefetch, Fallback, Timing

- **Pointer tier** (`!api:`): fires once, fire-and-forget, on pointer arrival. Updates the `variables` row, updates the in-memory per-project cache, emits an SSE `variable_updated` event. No further action at send — whatever is cached by then is what gets used.
- **Send tier** (`api:`): fires once, fire-and-forget, at the instant the line is sent. Does not block the send and does not prefetch ahead of time — the call's result lands after this particular send has already gone out, available starting with the next read of that variable.
- **Prefetch tier** (`api!:`): pointer arrival starts a repeating background refresh (`prefetch_interval_ms`, default 3000ms) that continues only while the pointer remains on that line; cancelled the instant the pointer moves off. Because the refresh loop starts at the same moment as the pointer tier, by the time a human actually hits send a fresh value is very likely already cached — no blocking in the common case. If nothing has resolved yet (e.g. the very first pointer arrival, request still in flight), send blocks up to `timeout_ms` (default 200ms, clamped 150–250ms) waiting for that in-flight call.
- **Fallback chain** applies only to the **prefetch tier**, since it's the only one making a freshness promise at send in the first place: last-cached value (any age) → the variable's `default_value` → omit (renders as empty string in composed text). Never blocks indefinitely, never fails the send. Pointer- and send-tier variables simply hold whatever they hold — no explicit fallback machinery beyond the general "no value yet → default → empty" rule from §1.1.
- **Visible indicator**: when a send used the prefetch tier's fallback path (not a value refreshed within this send), the outgoing caption carries a `variableFallbacks: string[]` field alongside `codes`, so `InputBar`/`SentLog` can show a small "stale/default" badge next to that entry — mirroring how caption delivery errors are already surfaced today. A silent degrade would be worse than a visible one.

## 5. Bindings Reconciliation

§3's existing finding stands: unify the *value source*, keep the DSK `bindings` SSE transport exactly as-is. Concretely, this plan makes `codes` and `variables` the same concept — every "code" (section, stanza, speaker, …) is itself a variable; the operator manually setting one via `ActionsPanel` is setting a variable with `source: 'manual'`, exactly parallel to a connector-backed one.

**What changes:** `InputBar.jsx:166`'s `manualCodes = getActiveCodes()` becomes a call into the new variables layer — a `useVariables()` hook backed by the `variable_updated` SSE stream plus a local cache — that returns the full current variable snapshot (`{ [name]: value }`, both `manual` and `connector` sourced) instead of only what's in `localStorage`. The merge order is unchanged: `{ ...resolvedVariables, ...lineCodes }`, per-line codes still take priority. The manual set-a-variable UI (`ActionsPanel`, `QuickActionsPopover`) stays exactly as it is today, mechanically — it's simply one more way to set a variable now, alongside a connector.

**What stays untouched:** the backend `codes` param through `applyMetacodeProcessors`, the DSK caption processor's `bindings` SSE emission (`caption-processor.js:159`), and `CueEngine`'s `section`-match rule type. All three only ever read whatever plain object they're handed — they never cared where it came from.

## 6. New Backend Surface

Reuses the existing async-SSE pattern already used for STT (`/stt/start` + `/stt/events`) rather than inventing a new one:

```
GET/POST/PUT/DELETE /connectors                              — API Connector CRUD (auth_config masked on read)
GET/POST/PUT/DELETE /connectors/:connectorSlug/requests       — nested Request CRUD, including query/body/response fields
GET/POST/PUT/DELETE /connectors/:connectorSlug/requests/:requestSlug/mappings — response mapping CRUD

GET    /variables                — snapshot: { [name]: { value, source, defaultValue, resolvedAt } }
GET    /variables/events         — SSE: variable_updated { name, value, source, resolvedAt }
POST   /variables                — create a manual variable { name, value?, defaultValue? } (400 if name starts with '_')
PUT    /variables/:name          — update a manual variable's value/default
DELETE /variables/:name          — remove a manual variable

POST   /variables/refresh        — { connectorSlug, requestSlug, waitMs? }
                                     waitMs omitted  → fire-and-forget, 202, result arrives via variable_updated SSE
                                     waitMs provided → races the call against waitMs; 200 with resolved values if it
                                                        lands in time, else 202 (call continues in background, SSE
                                                        carries the eventual update). This is what the prefetch-tier's
                                                        hard-cap-timeout behavior calls under the hood.
```

The frontend's trigger logic — in the same places `useFileStore`'s `onPointerChanged` and `InputBar.jsx`'s `doSend()` already live — calls `POST /variables/refresh` at three distinct moments: the **pointer tier** fires from `onPointerChanged` (no `waitMs`); the **prefetch tier**'s background loop is (re)started from the same `onPointerChanged` callback (no `waitMs`, repeating on `prefetchIntervalMs`), and `doSend()` makes one more call for it with `waitMs: timeout_ms` immediately before assembling `codes`, to get the freshest value or fall back; the **send tier (async)** fires from `doSend()` at the moment of send with no `waitMs` — fire-and-forget, non-blocking, its result only affects future reads.

## 7. Auth & Secrets

`auth_config` is stored server-side only and masked on read (same convention as `ai_config`/`stt_config`'s credential fields and `project_ai_role_configs.api_key_ref`). `{{ }}` interpolation of request path/query/headers/body happens exclusively server-side, immediately before the outbound HTTP call fires — never in the browser — both because secrets may be embedded in those fields (a static bearer token, or a chained `{{auth_token}}`) and because the actual HTTP call itself must originate server-side regardless.

## 8. Validation

- Variable names starting with `_` are rejected by `POST`/`PUT /variables` (400) — reserved for the future system-variable registry (§1.1).
- Connector/request slugs follow the same lowercase, hyphen-separated slug convention used elsewhere in this codebase; connector slugs unique per project, request slugs unique per connector (§1.2).

## 9. Effort Estimate

- Schema: four additive tables, no back-fill (small-medium).
- Connector/Request/Mapping CRUD routes, `auth_config` masking (medium — mirrors `ai_config`/`project_ai_role_configs`'s existing CRUD shape).
- Resolution engine: `{{ }}` interpolation into request fields, response-type-aware mapping (JSON/text/image via `lcyt-files` storage adapters), prefetch loop + hard-cap timeout + fallback chain (medium-large — the highest-scrutiny part of this plan, alongside Assistant's safety gate in `plan_ai_roles_framework.md`).
- `metacode-parser.js` additions: `!api:`/`api:`/`api!:` line-code parsing, mirroring the existing `cue:`/`graphics:` parsing exactly.
- `InputBar.jsx`/`useFileStore` wiring: `onPointerChanged` → `POST /variables/refresh` for both the pointer tier (fire-and-forget) and the prefetch tier's repeating background loop; `doSend()` → one fire-and-forget call for the send tier, plus one `waitMs`-bearing call for the prefetch tier's final freshness check, before assembling `codes` (small, one call site per §5).
- `{{name}}` insertion rendering wherever caption/rundown/planner text is displayed or composed (small-medium — several call sites, no new data model).
- Frontend Connector/Request/Variable management UI (new pages under `/setup` or a new `/variables` route) — real but separate follow-on work, same caveat every sibling plan in this batch makes about frontend scope.

## 10. Open Questions

1. **Exact UI placement for the "stale/default used" badge** (§4) — SentLog row, a dedicated status chip, or both — a product/UI call, not inferable from the codebase.
2. **Default `prefetch_interval_ms`/`timeout_ms` tuning** — the 3000ms/200ms defaults proposed here are reasoned from the product's latency promise, not from live measurement against real connector latencies; likely needs revisiting once real connectors are in use (same caveat `plan_ai_roles_framework.md` makes about its own polling-interval default).
3. **`{{ }}` inside DSK template text fields** — a natural extension (a template's text layer showing a live variable) but not scoped here; would reuse this same insertion mechanism if pursued.
4. **Variable history/audit** — whether operators want to see past resolved values for a connector-backed variable (debugging a flaky third-party API) is not addressed; today's design only keeps the current value.

## 11. Index Entry

Add to `docs/PLANS.md`'s Draft table:

```
| [plan_api_connectors_variables.md](plans/plan_api_connectors_variables.md) | API Connectors & Variables — {{ }} Bindings and Metacode-Triggered Refresh | Project-scoped variable system ({{name}} insertion, timing-agnostic) backed by user-defined API Connectors (base URL, auth, headers) with nested Requests (method/path/query/body, response mapping to variables). Refresh triggered by metacode (`api:`/`api!:`), not by insertion syntax. Unifies the existing localStorage-only "active codes" into the same variable model — codes becomes the resolved variable snapshot at send time. | |
```
</content>
