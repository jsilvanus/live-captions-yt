---
id: plan/ai_model_registry
title: "AI Model Registry — Site & Project Provider Catalog, Ollama Auto-Discovery, Bridge-Relayed Local Models"
status: in-progress
summary: "ai_providers / ai_provider_models / ai_provider_grants: a registry of model *sources* (cloud API, self-hosted Ollama, in-process 'deer' runtimes) that sits underneath plan_ai_roles_framework.md's per-role config. Phase 1 (registry core: schema, CRUD, grants, direct-reachable discovery), Phase 2 (bridge-relayed providers: model_call bridge command with a per-call timeout override, Dockerized bridge+Ollama deployment mode), and Phase 3 (wiring project_ai_role_configs' provider_id through to the agentic_chat turn loop and all three vision adapters for *inference*, not just discovery) are implemented — resolveRoleProviderSettings()/invokeModelCall() and the OpenAI/Google/Anthropic vision adapters all dispatch through bridgeManager.sendCommand({type:'model_call'}) for a bridge-relayed provider, same as direct ones. Phase 3's frontend model-picker (wiring `GET /ai/providers/:id/models` into the role-config UI) remains unbuilt — the Setup Hub's "AI models" card (`AiModelsSection.jsx`) is a separate, disconnected `ai_model_configs` CRUD path that doesn't reference this registry and isn't read by any inference code; it should not be counted as fulfilling this phase. Phase 4 ('deer' in-process runtimes) remains unscoped, pending inspection of the actual jsilvanus/deer package APIs. Amends project_ai_role_configs to reference this registry instead of embedding provider/credential fields per role; supersedes plan_agent.md's Phase 8 (Local Model Support) stub."
related: plan/ai_roles_framework, plan/agent, plan/prod, plan/api_connectors_variables
---

# AI Model Registry — Site & Project Provider Catalog, Ollama Auto-Discovery, Bridge-Relayed Local Models

## Context

`plan_ai_roles_framework.md` designs *what a role does* (currently: two vision roles, Tracker and Describer, plus five `agentic_chat` roles — Setup, Asset Control, Planner, Graphics Editor, and Production Assistant) and gives each project a `project_ai_role_configs` row per role with `model_provider` (`'none'|'server'|'openai'|'google'|'anthropic'|'custom'`), `model_name`, `api_key_ref`, `api_url`. That's the right shape for *role behavior*, but it conflates two concerns that don't actually vary together: "which model does this role use" and "where does that model live and how do we credential/reach it." As soon as a project wants two roles to share one OpenAI key, or wants a self-hosted Ollama box, that plan's per-role columns force **duplicating the same provider connection across every role config row** — the same API key pasted into every role's config, one copy per row, all of them going stale independently when the key rotates.

It also has no answer for the two things this plan is actually about:

1. **Where models come from is now three-tiered, not one enum.** Per the earlier discussion in this thread: **API** (cloud vendor, reachable from anywhere with internet), **Ollama** (a self-hosted OpenAI/Ollama-compatible HTTP server — could be on the same box as the backend, on the office LAN, or, per the user's actual setup, reachable *only* from `lcyt-bridge`'s network, not the backend's), and **deer** (`github.com/jsilvanus/deer`, npm `embedeer`/`chattydeer`/`seedeer` — in-process, no network hop at all, only exists wherever that specific Node process runs). `plan_ai_roles_framework.md`'s `model_provider` enum has no `ollama` or `deer` value and, more importantly, no field capturing *reachability* — whether a call to this provider can be made directly from the backend process or has to be dispatched through a bridge relay (see `plan_prod.md` / this thread's SSE-vs-gRPC discussion — the bridge already has a generic `http_request` command that's the right primitive for this).
2. **Ollama specifically needs a model catalog, not just a URL.** An Ollama endpoint can have any number of models pulled onto it (`llama3.1:8b`, `llama3.1:70b`, `nomic-embed-text`, `llava`, ...), and that set changes whenever someone runs `ollama pull`/`ollama rm` — a role config that free-types a model name has no way to know what's actually available, and the admin/user has no discovery UI. `GET /api/tags` on the Ollama server is the source of truth; nothing in this codebase queries it today.

This plan adds the missing layer underneath `project_ai_role_configs`: a registry of **providers** (connections to a model source) and, where discoverable, the **models** available on each. `plan_ai_roles_framework.md`'s role configs are amended to reference a `provider_id` from this registry instead of carrying their own credential/URL fields (see "Amendment to `project_ai_role_configs`" below). `plan_agent.md`'s Phase 8 ("Local Model Support (Ollama)" — auto-detection, embedding endpoint, chat completion) is a one-paragraph stub written before any of this was designed; this plan supersedes it in full.

**No backward-compatibility burden** — same standing note as `plan_ai_roles_framework.md`: LCYT has no released users, `project_ai_role_configs` is itself still unimplemented, so this plan freely revises its schema rather than shipping both shapes.

---

## The Three Provider Kinds

| `kind` | Reachability | Credential shape | Discovery |
|---|---|---|---|
| `api` | Anywhere with internet — vendor-hosted (OpenAI, Google, Anthropic) or a "custom" OpenAI-compatible endpoint (LiteLLM, vLLM, LocalAI, ...) | `api_key_ref`, usually a `base_url` override only for `custom` | **None, by design.** `model_name` is always free text for `api`-kind providers — no discovery call, no seed/curated catalog. See "Discovery Mechanics" below for why this is scoped to Ollama only. |
| `ollama` | Either directly reachable from the backend (same box/network) **or only reachable via a specific `lcyt-bridge` instance** — this plan treats that as a per-provider setting, not a separate kind | none typically (Ollama has no built-in auth), optional `api_key_ref` for a reverse-proxied/authenticated deployment | `GET {base_url}/api/tags` — real discovery, this plan's main new capability |
| `deer` | In-process — only "reachable" from whatever Node process has the package installed and loaded | none (no network call at all) | **Deferred — Phase 4, not built in this pass.** No network discovery possible; static/manual catalog entries only, and even that needs a look at the real `embedeer`/`chattydeer`/`seedeer` APIs first (unknown from this codebase — see Open Questions) |

The critical design point: **`ollama` is one `kind`, not "local-ollama" vs. "bridge-ollama" as two kinds.** Whether a given Ollama provider is reachable directly or only through a bridge is a property of *that provider instance* (`bridge_instance_id` set or not) — an admin/project can have three Ollama providers, one directly reachable, two behind two different bridges, and they're all just rows in the same table with the same discovery logic, dispatched over a different transport underneath. This is what makes "multiple possible Ollamas" and "private over-bridge Ollama" the same feature, not two.

**`deer` ships greyed-out, not omitted.** The schema keeps `'deer'` as a valid `kind` value from day one (so nothing has to migrate later), and the provider-creation UI lists it as a disabled option with a "Coming soon" tooltip — same convention `AiModelsSection.jsx` already uses for the not-yet-built role split. No backend code (`kind: 'deer'` branch in discovery, inference dispatch, seed catalog) ships until Phase 4. See "Implementation Plan" below.

---

## Schema

### `ai_providers` — the registry of model sources

```sql
CREATE TABLE IF NOT EXISTS ai_providers (
  id                  TEXT PRIMARY KEY,                    -- uuid
  scope               TEXT NOT NULL,                        -- 'site' | 'project'
  owner_api_key       TEXT,                                 -- required when scope='project'; NULL for 'site' (unenforced FK, matches ai_config convention)
  kind                TEXT NOT NULL,                        -- 'api' | 'ollama' | 'deer'
  vendor              TEXT NOT NULL DEFAULT 'custom',        -- 'openai' | 'google' | 'anthropic' | 'ollama' | 'deer' | 'custom'
  name                TEXT NOT NULL,                         -- admin/user-facing label, e.g. "Office GPU box"
  base_url            TEXT NOT NULL DEFAULT '',              -- required for api/custom/ollama; unused for deer
  api_key_ref         TEXT NOT NULL DEFAULT '',              -- masked on read; usually empty for ollama/deer
  bridge_instance_id  TEXT,                                  -- FK -> prod_bridge_instances(id), unenforced, cross-plugin like the Assistant role's tool wiring.
                                                              -- NULL = directly reachable from the backend process.
                                                              -- set = every request/discovery call for this provider is dispatched
                                                              -- through that bridge's SSE command channel (see "Bridge-relayed providers").
  enabled             INTEGER NOT NULL DEFAULT 1,
  last_discovery_at   TEXT,
  last_discovery_error TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ai_providers_owner ON ai_providers(owner_api_key);
```

`reachability` (direct vs. bridge-relayed) is deliberately **derived** from `bridge_instance_id IS NOT NULL`, not its own column — storing it separately would let the two drift.

### `ai_provider_models` — the model catalog per provider

```sql
CREATE TABLE IF NOT EXISTS ai_provider_models (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id     TEXT    NOT NULL REFERENCES ai_providers(id),
  model_name      TEXT    NOT NULL,                          -- e.g. 'llama3.1:8b', 'gpt-4o-mini', 'nomic-embed-text'
  capabilities    TEXT    NOT NULL DEFAULT '[]',              -- JSON array subset of 'embedding'|'vision'|'chat'|'translation'
  source          TEXT    NOT NULL DEFAULT 'manual',          -- 'discovered' | 'manual'
  enabled         INTEGER NOT NULL DEFAULT 1,                 -- admin/project can hide a discovered model without it reappearing next sweep
  parameter_size  TEXT,                                       -- from Ollama's details.parameter_size, informational only
  quantization    TEXT,                                       -- from Ollama's details.quantization_level
  discovered_at   TEXT,
  last_seen_at    TEXT,                                       -- updated every discovery sweep the model is still present in
  UNIQUE (provider_id, model_name)
);
CREATE INDEX IF NOT EXISTS idx_ai_provider_models_provider ON ai_provider_models(provider_id);
```

This table only ever gets rows for `kind: 'ollama'` providers (see "Discovery Mechanics" — `api`-kind providers are deliberately never cataloged). `capabilities` is a best-effort guess for discovered models (see "Capability inference" below) and an explicit admin choice for manually-entered ones — always editable, never load-bearing enough that a wrong guess breaks anything; a role config resolver treats it as a filter/hint for the picker UI, not a hard gate.

### `ai_provider_grants` — project visibility into site-scope providers

```sql
CREATE TABLE IF NOT EXISTS ai_provider_grants (
  api_key      TEXT    NOT NULL,
  provider_id  TEXT    NOT NULL REFERENCES ai_providers(id),
  enabled      INTEGER NOT NULL DEFAULT 1,
  UNIQUE (api_key, provider_id)
);
CREATE INDEX IF NOT EXISTS idx_ai_provider_grants_key ON ai_provider_grants(api_key);
```

A **site-scope** provider is invisible to a project until an admin grants it a row here (default-deny, same posture as `connector_network_rules`' default-deny-private-IP stance) — this is how a shared "office GPU Ollama" gets handed out to specific projects without every project seeing every other project's private connections. A **project-scope** provider needs no grant row at all: it's implicitly visible only to its own `owner_api_key`, full stop.

---

## Bridge-Relayed Providers

This is the direct implementation of the SSE-relay pattern from the earlier discussion in this thread. When `ai_providers.bridge_instance_id` is set:

- **Discovery** (`GET {base_url}/api/tags`) is dispatched as the bridge's existing generic command: `bridgeManager.sendCommand(instanceId, { type: 'http_request', method: 'GET', url: `${base_url}/api/tags` })` — this primitive already exists (`packages/plugins/lcyt-production/src/bridge-manager.js`, `packages/lcyt-bridge/src/bridge.js:167-176`) and needs no new bridge-side code at all for discovery specifically.
- **Inference calls** (an actual request from any role against this model) need a new bridge command type, since `http_request` alone can't also pull a video frame from a backend-served URL first. Add `model_call`: `{ type: 'model_call', requestId, sourceUrl?, endpoint, prompt, outputMode }` — the bridge fetches `sourceUrl` (e.g. the project's `/preview/:key/incoming.jpg`) itself when present, POSTs to the local `endpoint` (this provider's `base_url` + the Ollama chat/generate path), and reports the structured result back via the existing `POST /bridge/status`. This keeps raw image bytes off the SSE channel entirely (the bridge pulls, the backend never pushes binary down the command stream) — see this thread's SSE-vs-gRPC discussion for why that framing was chosen.
- **Timeout:** `BridgeManager`'s `COMMAND_TIMEOUT_MS` is currently one hardcoded global constant (`bridge-manager.js:15`, 10s). `model_call` needs its own, much longer allowance — local inference on modest hardware can legitimately take 30–120s. This plan requires making the timeout per-command-type (or accepting a `timeoutMs` override in `sendCommand()`) as a prerequisite, not an afterthought — a 10s timeout would make bridge-relayed Ollama unusable for anything beyond the smallest models.
- **Availability:** a bridge-relayed provider's discovery/inference calls fail immediately (not just time out) when `bridgeManager.isConnected(instanceId)` is false — surface this distinctly in the provider list UI (`"offline — bridge disconnected"` vs. `"unreachable — request failed"`) since the former is expected/transient (bridge agent not running right now) and the latter usually means a config error.

**Network exposure caveat, flagged not solved:** `network-guard.js`'s SSRF guard applies to providers the backend calls *directly* (`bridge_instance_id IS NULL`) — same rationale as connectors, since an admin/project-entered `base_url` is still server-fetched input. For bridge-relayed providers the backend never resolves the URL itself, so that guard doesn't apply — but that shifts the question to "can a project point a bridge-relayed provider's `base_url` at anything the bridge can reach, including other devices on that LAN?" Today's `model_call`/`http_request` commands take an arbitrary URL by design (that's the whole point), so this needs its own bridge-scoped allowlist discipline eventually (mirroring `connector_network_rules`' org-scoped allow-list, but keyed on `bridge_instance_id` instead of `org_id`). Not solved in this plan — flagged as a follow-on hardening item, since a careless or malicious project shouldn't be able to use "call any URL through my bridge" as a pivot into someone else's home/office LAN.

---

## Deployment Mode: Dockerized Bridge + Ollama (docker-compose)

`lcyt-bridge` today is distributed as a `pkg`-compiled desktop executable (`npm run build:win|mac|linux`, `packages/lcyt-bridge/CLAUDE.md`) with an optional system-tray icon — the right shape for "sits on a desktop next to the AMX/Roland hardware." But `packages/lcyt-bridge/package.json`'s `start` script is just `node src/index.js`, and `tray.js` is already a dynamic, gracefully-optional import (`src/index.js:93-101` skips it if unavailable) — nothing about the bridge's actual runtime requires `pkg` or a desktop environment. That makes a **second, simpler deployment mode** available for free: a plain Docker container running `node src/index.js`, configured via the same `BACKEND_URL`/`BRIDGE_TOKEN` env vars it already reads.

This matters specifically for Ollama, which itself is very commonly run in Docker (`ollama/ollama` official image) rather than installed natively. Put both containers on one Docker Compose network:

```yaml
# docker/lcyt-bridge-ollama/docker-compose.yml (example — not a managed deployment)
services:
  ollama:
    image: ollama/ollama
    volumes: [ollama-data:/root/.ollama]
    networks: [bridge-net]
    # deliberately NOT published to the host — only bridge-net can reach it

  lcyt-bridge:
    build: ../../packages/lcyt-bridge     # new Dockerfile, plain `node src/index.js`
    environment:
      BACKEND_URL: https://api.lcyt.fi
      BRIDGE_TOKEN: ${BRIDGE_TOKEN}
    networks: [bridge-net]
    restart: unless-stopped

networks:
  bridge-net: {}

volumes:
  ollama-data: {}
```

The project's `ai_providers.base_url` for this Ollama provider is then a **Docker-internal service name**, `http://ollama:11434` — not a real LAN IP/port. That's completely transparent to the rest of this plan's design: a bridge-relayed provider's `base_url` is already "whatever this bridge instance can reach," and Docker's internal DNS satisfies that exactly the same as a raw LAN address would.

**Why this is a real safety improvement, not just a convenience:** Ollama has no built-in authentication — anything that can reach its HTTP port can call any model on it. The common failure mode when people run Ollama "for LAN access" is binding it to `0.0.0.0` and exposing it on the whole home/office network (or worse, port-forwarding it to the internet). Compose-networking it with the bridge instead means **Ollama is reachable from exactly one thing: the bridge container** — nothing else on the LAN, let alone the internet, can reach it, because it's simply never bound to any host-facing interface. This directly narrows Open Question #2's "bridge-scoped URL allowlisting" concern for the single most common case (an operator running their own Ollama for their own bridge): the allowlisting problem that question flags is about a bridge being tricked into calling an *unintended* URL on its LAN, and here there effectively is no other reachable URL on `bridge-net` to be tricked into calling.

This should ship as a documented example (`docker/lcyt-bridge-ollama/` — new Dockerfile for `lcyt-bridge` alongside the existing `docker/lcyt-ffmpeg/` and `docker/lcyt-dsk-renderer/` convention, plus a `docker-compose.yml` and README), not a required path — the pkg-exe/tray mode remains the right choice for someone who also needs this same bridge instance to reach AMX/Roland hardware over TCP on their real LAN. A single bridge instance can do both at once (same process, same SSE connection, `tcp_send`/`atem_switch`/`obs_switch` commands still resolve real LAN hosts while `model_call`/Ollama discovery resolve the compose-internal one) — nothing here requires choosing one mode exclusively.

---

## Discovery Mechanics

### Ollama (`kind: 'ollama'`)

`GET {base_url}/api/tags` (direct or bridge-relayed per above) returns:

```json
{ "models": [
  { "name": "llama3.1:8b", "model": "llama3.1:8b", "size": 4920000000,
    "digest": "...", "modified_at": "...",
    "details": { "family": "llama", "families": ["llama"], "parameter_size": "8.0B", "quantization_level": "Q4_0" } }
] }
```

Each entry upserts into `ai_provider_models` (`source: 'discovered'`, `discovered_at`/`last_seen_at` set to now, `parameter_size`/`quantization` copied from `details`). Rows previously discovered but absent from the latest sweep are **not deleted** — a role config might point at a model that's temporarily offline or being re-pulled; they're just left with a stale `last_seen_at` for a human to clean up manually later (`DELETE /ai/providers/:id/models/:modelId`). No hard-delete-on-sweep, ever.

**Capability inference** (best-effort, always admin/user-editable afterward):
- name/family contains `embed` → `['embedding']`
- family in a known vision set (`llava`, `bakllava`, `llama3.2-vision`, `moondream`, ...) → `['vision', 'chat']`
- everything else → `['chat']`

This is a heuristic, not a contract — Ollama's `/api/tags` doesn't self-report capabilities, so getting it wrong for an unfamiliar model family is expected and cheap to fix via the models list UI.

**Trigger points:** on provider create, on provider update when `base_url`/`bridge_instance_id` changes, and a manual "Refresh models" action (`POST /ai/providers/:id/discover`). No background poller for v1 — the model set on an Ollama box only changes when a human runs `ollama pull`/`ollama rm`, so on-demand discovery is sufficient; a periodic sweep (e.g. daily) is a cheap later addition if drift becomes annoying in practice, not a launch requirement.

### API providers (`kind: 'api'`) — deliberately no catalog

`ai_provider_models` is scoped to Ollama only. `openai`/`google`/`anthropic`/`custom` providers never get catalog rows, discovered or seeded — `model_name` is a plain free-text field wherever an `api`-kind provider is selected (the role-config UI, provider setup, anywhere else a model name is chosen). This was a deliberate scope cut, not an oversight: cloud vendors ship new models often enough that any seed/curated list drifts stale immediately and becomes one more thing to maintain per release, whereas the actual problem this plan exists to solve (an Ollama box's model set being invisible without discovery) doesn't apply to cloud providers at all — a human typing `gpt-4o-mini` or `claude-opus-4-8` already knows what they want, they don't need LCYT to enumerate OpenAI's or Anthropic's catalog for them. `GET {base_url}/v1/models` *would* work for OpenAI-wire-compatible endpoints (including most `custom` deployments), but is intentionally not built — keeping "discovery" as an Ollama-only concept avoids a second, partially-working discovery path for a case nobody asked for.

---

## Amendment to `project_ai_role_configs` (`plan_ai_roles_framework.md`)

Replace the provider/credential columns with a reference into this registry:

```diff
 CREATE TABLE IF NOT EXISTS project_ai_role_configs (
   id              INTEGER PRIMARY KEY AUTOINCREMENT,
   api_key         TEXT    NOT NULL,
   role_code       TEXT    NOT NULL REFERENCES ai_roles(role_code),
   enabled         INTEGER NOT NULL DEFAULT 0,
-  model_provider  TEXT    NOT NULL DEFAULT 'none',
-  model_name      TEXT    NOT NULL DEFAULT '',
-  api_key_ref     TEXT    NOT NULL DEFAULT '',
-  api_url         TEXT    NOT NULL DEFAULT '',
+  provider_id     TEXT,                                      -- FK -> ai_providers(id); NULL = role disabled/unconfigured
+  model_name      TEXT    NOT NULL DEFAULT '',                -- picked from ai_provider_models(provider_id) for an 'ollama' provider; free text for 'api' providers (no catalog exists to validate against — see Discovery Mechanics)
   harness_config  TEXT    NOT NULL DEFAULT '{}',
   updated_at      INTEGER NOT NULL DEFAULT (strftime('%s','now')),
   UNIQUE (api_key, role_code)
 );
```

This is the whole point of separating the two concerns: however many roles exist share one OpenAI key via one `ai_providers` row (rotate the key once, every role picks it up), and a project's private bridge-relayed Ollama becomes assignable to any role (e.g. Describer using the office GPU box's `llava` model) exactly the same way as picking a cloud model — same `provider_id` + `model_name` pair, the resolver underneath doesn't care which kind it is.

`AgentEngine._resolveApiSettings()` (`agent-engine.js:269-282`) is superseded by a registry lookup: given `provider_id`, load the `ai_providers` row, branch on `bridge_instance_id` (direct fetch vs. `sendCommand`) and `kind` (api/ollama request shape vs. in-process `deer` call), rather than today's single `cfg.embeddingModel`-reuse hack.

---

## Routes

Site-level (admin auth — mirrors `/admin/connector-network-rules`):

```
GET    /admin/ai-providers                       — list all site-scope providers (credentials masked)
POST   /admin/ai-providers                        — create
PUT    /admin/ai-providers/:id
DELETE /admin/ai-providers/:id
POST   /admin/ai-providers/:id/discover            — trigger discovery now, returns the resulting model list
GET    /admin/ai-providers/:id/models
POST   /admin/ai-providers/:id/models              — manually add a model row (ollama providers only — pre-register a model before it's pulled; api providers have no catalog, see Discovery Mechanics)
PUT    /admin/ai-providers/:id/models/:modelId     — edit capabilities / toggle enabled
DELETE /admin/ai-providers/:id/models/:modelId
GET    /admin/ai-providers/:id/grants              — which projects currently have this provider granted
PUT    /admin/ai-providers/:id/grants/:apiKey      — { enabled } grant/revoke for a project
```

Project-level (session JWT auth):

```
GET    /ai/providers                     — providers visible to this project: granted site-scope + own project-scope (credentials masked)
POST   /ai/providers                     — create a project-scope provider (e.g. the project's own bridge-relayed Ollama)
PUT    /ai/providers/:id                 — only if owner_api_key matches this project; a merely-granted site provider is read-only here
DELETE /ai/providers/:id                 — only own project-scope providers
POST   /ai/providers/:id/discover        — works for either scope, subject to visibility
GET    /ai/providers/:id/models
```

---

## Implementation Plan

Composition-root wiring confirmed against the existing code (not assumed): `lcyt-agent` is initialized and mounted in `packages/lcyt-backend/src/server.js` (`initAgent(db)` at line 227, `app.use('/ai', createAiRouter(...))` / `app.use('/agent', createAgentRouter(...))` at lines 426-427). `initProductionControl(db)` (`packages/plugins/lcyt-production/src/api.js:28-44`) already returns `bridgeManager`, destructured in server.js at lines 173-177. Cross-plugin access follows the existing setter-injection convention (`_cueEngine.setAgentEvaluateFn(...)`, server.js:238-241) — server.js is the only place that ever holds both instances; no plugin imports another plugin's package. Admin routes use `createAdminMiddleware(db, jwtSecret)` (`lcyt-backend/src/middleware/admin.js:52`), passed into the router the same way `lcyt-connectors`' `createGlobalNetworkRulesRouter(db, adminAuth)` does. Migrations run via a plain `runXMigrations(db)` function called once inside the plugin's `init*()`, exactly like `ai-config.js`'s `runAiMigrations` today.

### Phase 1 — Registry core: schema, CRUD, grants, direct-reachable discovery

New files, all in `packages/plugins/lcyt-agent/src/`:
- **`provider-registry.js`** — `runProviderRegistryMigrations(db)` (the three `CREATE TABLE` statements above); `createProvider`/`updateProvider`/`deleteProvider`/`getProvider`; `maskProvider(row)` (strips `api_key_ref`, exposes `credentialConfigured: boolean` — same masking convention as `ai-config.js`'s `getAiConfig()` and connectors' `maskConnector()`); `listVisibleProviders(db, apiKey)` = `SELECT ... WHERE scope='project' AND owner_api_key=? UNION SELECT ... FROM ai_providers p JOIN ai_provider_grants g ON g.provider_id=p.id WHERE g.api_key=? AND g.enabled=1`; `setGrant(db, providerId, apiKey, enabled)`; `listProviderModels`/`addManualModel`/`updateModel`/`deleteModel`.
- **`discovery.js`** — `discoverProvider(db, provider, { bridgeManager })`: only does real work for `provider.kind === 'ollama'` (`GET {base_url}/api/tags`); `api` and `deer` providers short-circuit to a no-op immediately (no catalog is ever built for them — a `kind: 'api'` provider's `discover()` call is a deliberate no-op, not an unimplemented stub). Branches on `provider.bridge_instance_id` (`null` → direct `fetch`; set → `bridgeManager.sendCommand(instanceId, { type: 'http_request', method: 'GET', url })`, parse `result.body`). `upsertDiscoveredModels(db, providerId, entries)` — upsert-not-delete per the "Discovery Mechanics" section above. `inferCapabilities(entry)` heuristic. Updates `ai_providers.last_discovery_at`/`last_discovery_error`.
- **`routes/ai-providers-admin.js`** — `createAdminAiProvidersRouter(db, adminAuth, { bridgeManager })`: `router.use(adminAuth)`, then the site-level routes table below.
- **`routes/ai-providers-project.js`** — `createProjectAiProvidersRouter(db, auth, { bridgeManager })`: the project-level routes table below, ownership-checked against `req.apiKey`.

Edits:
- **`packages/plugins/lcyt-agent/src/api.js`** — `initAgent(db, opts = {})` gains `runProviderRegistryMigrations(db)` alongside the existing `runMigrations`/`runAiMigrations` calls, and returns a new `providerRegistry` handle (a small object wrapping the functions above, with `setBridgeManager(bridgeManager)`) next to `agent`.
- **`packages/plugins/lcyt-agent/src/index.js`** (public re-exports) — add `createAdminAiProvidersRouter`, `createProjectAiProvidersRouter`.
- **`packages/lcyt-backend/src/server.js`** — after both `initProductionControl(db)` and `initAgent(db)` have run:
  ```js
  const { agent, providerRegistry } = await initAgent(db);
  providerRegistry.setBridgeManager(productionBridgeManager);
  ...
  app.use('/admin/ai-providers', createAdminAiProvidersRouter(db, createAdminMiddleware(db, jwtSecret), { bridgeManager: productionBridgeManager }));
  app.use('/ai/providers', createProjectAiProvidersRouter(db, auth, { bridgeManager: productionBridgeManager }));
  ```
  This mirrors the existing `_cueEngine.setXxxFn(...)` block exactly — no circular import, server.js is the only file that touches both plugin instances.

`deer` in this phase: schema's `kind` column accepts `'deer'` (so no later migration), but `discovery.js` short-circuits to a no-op for it and the seed catalog step is skipped — nothing else references it yet.

Tests: `packages/plugins/lcyt-agent/test/provider-registry.test.js` (CRUD, masking, grant-based visibility resolution — site+granted vs. project-own vs. neither) and `test/discovery.test.js` (mock `global.fetch` for direct discovery; a fake `bridgeManager.sendCommand` for the relayed path; upsert-present/absent/reappeared-model cases; capability heuristic edge cases) — both follow the existing `node:test` + in-memory `better-sqlite3` pattern already used in `test/agent-engine.test.js` (`runMigrations(db)` + `runAiMigrations(db)` called in a shared `createDb()` helper; add `runProviderRegistryMigrations(db)` alongside).

### Phase 2 — Bridge-relayed providers: `model_call` command + Docker deployment mode

- **`packages/plugins/lcyt-production/src/bridge-manager.js`** — `sendCommand(instanceId, command, { timeoutMs = COMMAND_TIMEOUT_MS } = {})`: replace the single hardcoded 10s timeout (line 15, used at line 133) with a per-call override. This is a prerequisite, not optional — a 10s timeout makes any real local inference call fail.
- **`packages/lcyt-bridge/src/bridge.js`** — new branch in `_handleCommand()` (alongside `tcp_send`/`atem_switch`/`http_request`/`obs_switch`, lines 147-189): `model_call` — `{ requestId, sourceUrl?, endpoint, prompt, outputMode }`. If `sourceUrl` present, fetch it (reuse the existing `_httpRequest()` helper, lines 207-225) and pass the bytes/base64 along; POST to `endpoint` (this provider's Ollama `base_url` + `/api/generate` or `/api/chat`, with an `images: [base64]` array for vision-capable calls); return the parsed result via `_postStatus`.
- **`docker/lcyt-bridge/Dockerfile`** — new, plain `FROM node:20-slim`, `npm ci --omit=dev`, `CMD ["node", "src/index.js"]` — no `pkg`/tray involved, matching `packages/lcyt-bridge/package.json`'s existing `"start": "node src/index.js"` script and `tray.js`'s already-graceful optional import.
- **`docker/lcyt-bridge-ollama/docker-compose.yml`** + README — the example from "Deployment Mode" above (bridge + `ollama/ollama`, private `bridge-net`, Ollama never published to the host).

Tests: extend `packages/plugins/lcyt-production/test/bridge-manager.test.js` for the `timeoutMs` override; extend `packages/lcyt-bridge/test/bridge.test.js` for `model_call` dispatch (mock `fetch`, assert `_postStatus` payload shape).

### Phase 3 — Wire into `project_ai_role_configs` (depends on `plan_ai_roles_framework.md` landing)

- **Done.** Schema diff from "Amendment to `project_ai_role_configs`" applied.
- **Done.** `agent-engine.js`'s `_callChatCompletion` and every `agentic_chat`/vision route (`routes/roles-chat.js`, `routes/production-assistant.js`, `routes/planner.js`, `routes/vision-roles.js`) resolve settings via `agentic-turn.js`'s `resolveRoleProviderSettings(providerRow, modelName, { bridgeManager })` + `invokeModelCall()`, which branches on `kind`/`bridge_instance_id` to build the actual request (direct `fetch()` vs. `bridgeManager.sendCommand({type:'model_call', ...})`) — `server.js` constructs every one of those routers with the composition root's `productionBridgeManager`. All three vision adapters (`vision-adapters/{openai,google,anthropic}-vision.js`) route through the same `invokeModelCall()`, so bridge relay works for Tracker/Describer regardless of vendor, not just the OpenAI-compatible (Ollama) one. See `packages/plugins/lcyt-agent/CLAUDE.md` and the (resolved) CONSIDER.md entry for detail.
- **Not done — frontend, outside this plan's backend scope.** Role-config UI's model picker still needs to become `GET /ai/providers/:id/models` for an `ollama`-kind provider (falling back to free text only if that specific provider hasn't been discovered yet / has zero rows); an `api`-kind provider stays a free-text `model_name` field, by design — there's no catalog to pick from. No `lcyt-web` component calls `/ai/providers` yet (re-checked via grep, 2026-07-20) — today a role's `provider_id`/`model_name` can only be set by a direct API call, not through the Setup Hub UI.

  **Do not mistake the Setup Hub's "AI models" card for this.** `AiModelsSection.jsx` (Setup Hub, `id="ai-models"`) and its backend (`routes/ai-models.js`, mounted at `/ai/models` in `server.js`) are a real, working, but entirely separate CRUD path: a standalone `ai_model_configs` table (`ai-models.js`, `runAiModelMigrations`) with its own `provider: 'api'|'ollama'` + free-text `model_name`/`api_url`/`api_key_ref` columns, hardcoded to `role_code: 'assistant'` only in the UI. It does **not** reference `ai_providers`/`ai_provider_models`/`ai_provider_grants` at all, has no discovery persistence (its "Discover models" button calls `GET {url}/api/tags` directly from the browser, not through `discovery.js`/`bridgeManager`), and — critically — `getAiModelConfig()` has zero call sites outside `ai-models.js`/`routes/ai-models.js` itself: nothing in `agentic-turn.js`, `production-assistant.js`, or any role route ever reads from `ai_model_configs`. It is unconnected, dead-end plumbing sitting alongside the real registry, not an alternate implementation of this phase's model picker. This should either be wired into the real registry or removed; flagged here so the next person doesn't count it as Phase 3's frontend being done.

### Phase 4 — `deer` (future, unscoped)

Blocked on inspecting the real `embedeer`/`chattydeer`/`seedeer` package APIs (not installed or referenced anywhere in this repo today — see Open Question 1). Until then it stays exactly what Phase 1 ships: a valid-but-inert `kind` value and a greyed-out UI option. No effort estimated here on purpose — sizing it before knowing those packages' actual shape would be a guess.

---

## Open Questions

1. **`deer` package API surface is unknown from this codebase.** `embedeer`/`chattydeer`/`seedeer` (and the underlying `jsilvanus/deer` project) aren't installed or referenced anywhere in this repo yet — this plan describes `kind: 'deer'` structurally (in-process, no network, static catalog) but the actual integration (how a model gets loaded in-process, what capability each package covers — the naming suggests `embedeer`≈embedding, `chattydeer`≈chat, `seedeer`≈something else, possibly vision or seeding/generation) needs a look at those packages' real APIs before this kind can move past "reserved enum value."
2. **Bridge-scoped URL allowlisting for `model_call`/`http_request`** is flagged above as unsolved — needed before this is safe to expose to less-trusted projects, not needed for a single-operator deployment where the project owner and the bridge owner are the same person (today's actual use case). The Dockerized bridge+Ollama deployment mode (above) substantially de-risks the common case in practice — Ollama is network-isolated to the bridge container, nothing else reachable to allowlist against — but doesn't help a bridge that also has real LAN access for `tcp_send`/`atem_switch` to other hardware, so the underlying question stands for that mode.
3. **Should site-scope provider creation be gated by a feature flag / org policy** the way `plan_site_feature_policies.md` gates other capabilities, so that a self-hosted LCYT operator can turn off "projects may register their own providers" entirely? Not resolved here — depends on how this interacts with that plan's tri-state policy model, which wasn't designed with provider registration in mind.
