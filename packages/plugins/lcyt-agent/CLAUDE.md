# `packages/plugins/lcyt-agent` — AI Agent Plugin (v0.1.0)

Central AI service for LCYT. Owns AI configuration (per-user embedding/LLM provider settings), embedding computation, context window management, LLM-based event cue evaluation, the AI model provider registry (`plan_ai_model_registry.md`), and the AI Roles Framework (`plan_ai_roles_framework.md`) — role catalog, the shared `agentic_chat` turn loop, Production Assistant's suggestion queue, and the Tracker/Describer continuous-vision roles. Other plugins delegate AI calls to the agent. Imported by `lcyt-backend` as `lcyt-agent`.

**Main entry:** `src/api.js`
**Usage in lcyt-backend:**
```js
import {
  initAgent, createAgentRouter, createAiRouter, computeEmbeddings,
  createAdminAiProvidersRouter, createProjectAiProvidersRouter,
  createRolesRouter, createRolesChatRouter, createProductionAssistantRouter,
  createVisionRolesRouter, createPlannerRouter,
} from 'lcyt-agent';
import { createToolRegistry, createInProcessMcpBridge } from 'lcyt-tools';

const {
  agent, providerRegistry, rolesBus, assistantManager, visionRoleManager,
} = await initAgent(db);

providerRegistry.setBridgeManager(productionBridgeManager); // setter injection, after both plugins init

// Shared tool registry (plan/mcp) — built from cross-plugin deps only the
// composition root holds together (caption targets, production, dsk, agent).
const toolRegistry = createToolRegistry({ db, captionTargets: {...}, production: {...}, agent, assets: {...} });
const toolBridge = createInProcessMcpBridge(toolRegistry);
const toolsContext = { tools: toolRegistry.tools, callTool: (name, args, ctx) => toolBridge.callToolAs(ctx.apiKey, name, args) };

cueEngine.setEmbeddingFn(computeEmbeddings);
cueEngine.setAiConfigFn((apiKey) => agent.getAiConfig(apiKey));
cueEngine.setAgentEvaluateFn((apiKey, desc, opts) => agent.evaluateEventCue(apiKey, desc, opts));

app.use('/ai/providers', createProjectAiProvidersRouter(db, auth, { bridgeManager }));
app.use('/ai', createAiRouter(db, auth));
app.use('/agent', createAgentRouter(db, auth, agent));
app.use('/admin/ai-providers', createAdminAiProvidersRouter(db, adminAuth, { bridgeManager }));
app.use('/roles', createRolesRouter(db, auth));                                   // catalog + config CRUD
app.use('/roles', createRolesChatRouter(db, auth, toolsContext, rolesBus));        // setup/asset_control/dsk_designer + generic events
app.use('/roles', createVisionRolesRouter(db, auth, visionRoleManager));           // tracker/describer start/stop/status
app.use('/roles/assistant', createProductionAssistantRouter(db, auth, toolsContext, assistantManager, agent, { listCameras, listMixers, registry }));
app.use('/roles/planner', createPlannerRouter(db, auth, agent));
```

**Source files (`src/`):**
- `api.js` — `initAgent(db)` (runs every migration, constructs `AgentEngine`/`RolesBus`/`ProductionAssistantManager`/`VisionRoleManager`, returns a small `providerRegistry` handle) + all route factories. Re-exports AI config, embedding, provider-registry, ai-roles, and agentic-turn utilities.
- `agent-engine.js` — `AgentEngine`: context window management (per-API-key, max 50 entries), `evaluateEventCue()`/`generateTemplate()`/`editTemplate()`/`suggestStyles()` (still resolve settings from `ai_config` — explicitly out of scope for the roles migration), `generateRundown()`/`editRundown()` (now take an already-resolved `apiSettings` object instead of an `apiKey` — Planner resolves via the roles framework, see `routes/planner.js`), `analyseImage()` stub (superseded by the vision roles below, not filled in).
- `ai-config.js` — Per-API-key AI model settings DB helpers (`ai_config` table). Provider modes: `none`, `server`, `openai`, `custom`. Still the source of settings for the four `AgentEngine` methods above.
- `embeddings.js` — OpenAI-compatible `/v1/embeddings` API client. `computeEmbeddings()`, `cosineSimilarity()`, `isServerEmbeddingAvailable()`.
- `db.js` — `agent_events` and `agent_context` table migrations.

**AI Model Registry (`plan_ai_model_registry.md`):**
- `provider-registry.js` — `ai_providers`/`ai_provider_models`/`ai_provider_grants` migrations + CRUD. `createProvider`/`updateProvider`/`deleteProvider`/`getProvider` (raw, includes `api_key_ref`) + `maskProvider()` (strips it, exposes `credentialConfigured`, derives `reachability: 'direct'|'bridge'` from `bridge_instance_id`). `listSiteProviders`/`listVisibleProviders`/`isProviderVisible` implement default-deny grant-based visibility (site-scope providers invisible to a project until granted via `setGrant`; project-scope providers always private to their owner). Model catalog: `listProviderModels`/`addManualModel`/`updateModel`/`deleteModel` — only ever populated for `kind: 'ollama'` providers.
- `discovery.js` — `discoverProvider(db, provider, { bridgeManager })`: real work only for `kind: 'ollama'` (`GET {base_url}/api/tags`, direct `fetch` or via `bridgeManager.sendCommand({type:'http_request'})` when `bridge_instance_id` is set); `api`/`deer` kinds short-circuit to `{ ok: true, skipped: true }`. `inferCapabilities()` heuristic (embed/vision/chat). `upsertDiscoveredModels()` — upsert-not-delete, absent models keep a stale `last_seen_at`.
- `routes/ai-providers-admin.js` — `createAdminAiProvidersRouter`: `GET/POST/PUT/DELETE /admin/ai-providers[/:id]`, `POST /:id/discover`, model CRUD, `GET/PUT /:id/grants[/:apiKey]`.
- `routes/ai-providers-project.js` — `createProjectAiProvidersRouter`: `GET/POST/PUT/DELETE /ai/providers[/:id]` (own project-scope only for write; granted site-scope is read-only — 403 on write), `POST /:id/discover`, `GET /:id/models`.

**AI Roles Framework (`plan_ai_roles_framework.md`):**
- `ai-roles.js` — `ai_roles` catalog (seeded, `BUILTIN_ROLES`: `tracker`, `describer`, `setup_assistant`, `asset_control_assistant`, `planner`, `dsk_designer`, `assistant`) + `project_ai_role_configs` (in its `ai_model_registry`-amended form — `provider_id` FK, not per-role credential columns). `getRoleConfig`/`setRoleConfig`/`defaultRoleConfig`. `effectiveMode(harnessConfig)` — the confirm/auto safety gate: `'auto'` requires **both** `mode: 'auto'` AND `autoConfirmed: true`, else `'confirm'`.
- `routes/roles.js` — `GET /roles/catalog` (public), `GET/PUT /roles/:roleCode/config` (generic — works for every role code in the catalog).
- `agentic-turn.js` — the shared tool-calling loop for every `agentic_chat` role. `runAgenticTurn({ apiSettings, systemPrompt, messages, tools, callTool, apiKey, shouldExecute, maxIterations })`: OpenAI-compatible `tools`/`tool_calls` wire format; a whole model exchange is held back as `pendingActions` (never partially executed) the moment ANY of its tool calls fails `shouldExecute`. `defaultShouldExecute` (read-only tools only) is Production Assistant's gate; `makeDialogShouldExecute(mode)` (read-only always, destructive never, else per mode) is the chat-driven-dialog roles' gate — implements the hard rule that deletes always go through the confirm dialog regardless of mode. `resolveRoleProviderSettings(providerRow, modelName)` returns `null` for bridge-relayed or `deer`-kind providers — **not yet supported by the turn loop or vision adapters**, flagged in CONSIDER.md.
- `roles-bus.js` — `RolesBus`: publishes canonical `role.<roleCode>.<event>` topics through the shared `EventBus` (`lcyt/event-bus`, injected via `initAgent(db, { eventBus })`; a private bus is created when omitted, keeping isolated tests standalone). Per-role isolation is preserved by the roleCode topic segment (each subscriber matches only its own `role.<roleCode>.*`); role events are consumed from unified `/events/stream` subscriptions (`role.<roleCode>.*`). Same delegation pattern as `DskBus`/`VariablesBus` (`plan_pubsub_event_bus.md`).
- `routes/roles-chat.js` — `createRolesChatRouter`: `POST /roles/:roleCode/message` for the three chat-driven-dialog roles (`setup_assistant`, `asset_control_assistant`, `dsk_designer` — Planner excluded, see below) — runs one full turn synchronously, emits `tool_call_started`/`tool_call_result`/`staged_action`/`reply` as SSE events as it goes, and also returns the result directly in the response. Also exports `resolveToolAllowlist(role, harnessConfig, allTools)`, reused by `routes/production-assistant.js`. Role events are consumed through `/events/stream` (`role.<roleCode>.*`).
- `production-assistant.js` — `ProductionAssistantManager`: Assistant's tool calls (`camera.preset`/`mixer.switch`, both `destructiveHint`) are always held back by the turn loop's default gate, so this manager decides what happens to the one proposed action per trigger — queue it (`confirm` mode, `assistant_suggestion` SSE event) or execute + audit it (`auto` mode, `assistant_action` SSE event, emitted *after* execution). `AUTO_COOLDOWN_FLOOR_MS` (3000) is hard-enforced only for `auto` mode; `confirm` mode honours a configured `cooldownMs` down to 0 (self-limiting — a human gates each suggestion). `confirmSuggestion`/`rejectSuggestion` for the pending queue.
- `routes/production-assistant.js` — `POST /roles/assistant/prompt`, `GET /roles/assistant/suggestions`, `POST /roles/assistant/suggestions/:id/confirm|reject`. Builds the system prompt with a fresh camera/mixer list from `lcyt-production` on every trigger.
- `vision-frame-fetcher.js` — `VisionFrameFetcher` (`EventEmitter`): polls `GET {previewBaseUrl}/preview/:key/incoming` (the already-public preview-JPEG endpoint from `lcyt-rtmp`'s `PreviewManager`) on a timer, emits `frame` (Buffer) / `error`. Skips overlapping polls; treats 404 (no preview yet) as expected, not an error. `previewBaseUrl` defaults to `VISION_PREVIEW_BASE_URL` env var or `http://localhost:$PORT` (same convention as `lcyt-dsk`'s `DSK_LOCAL_SERVER`).
- `vision-adapters/{openai,google,anthropic}-vision.js` — one `analyse(imageBuffers, promptText, opts)` interface per vendor, each wrapping the real multimodal API (OpenAI chat completions + `image_url` parts, Gemini `generateContent` + `inline_data`, Claude Messages API + base64 image blocks). `vision-adapters/index.js`'s `createVisionAdapter(vendor, settings)` selects by vendor; `'custom'` defaults to the OpenAI-compatible adapter.
- `vision-role-manager.js` — `VisionRoleManager`, one class parameterized by role (`tracker`/`describer`): one running session per `(apiKey, roleCode)`, wiring a `VisionFrameFetcher`'s frames through the selected vision adapter and emitting `tracker_update`/`describer_update` on the shared `RolesBus`. Adapter errors are logged and skipped, never crash the polling loop. Both roles are strictly non-action — neither ever calls a camera/mixer tool (reserved for Assistant alone).
- `routes/vision-roles.js` — `POST /roles/:roleCode/start|stop`, `GET /roles/:roleCode/status`, restricted to `tracker`/`describer`. Events handled by `routes/roles-chat.js`'s generic route (see above).
- `routes/planner.js` — `POST /roles/planner/assist { currentPlan?, goal, templateId? }` → `{ ok, content }`. Supersedes `POST /agent/generate-rundown`/`edit-rundown` (removed from `routes/agent.js`) — currentPlan omitted/empty generates from scratch (optionally seeded from `AgentEngine.RUNDOWN_TEMPLATE_LIBRARY[templateId]` or `harness_config.defaultTemplateId`); present, edits it per `goal`. `harness_config.systemPromptOverride` is appended after the built-in metacode-reference guidelines, not a full replacement (the model still needs that reference for valid output). `GET/PUT /roles/planner/config` needed no new code — `routes/roles.js`'s config CRUD is already generic per role.
- `routes/agent.js` — `GET /agent/status`, `GET/POST/DELETE /agent/context`, `GET /agent/events`, `POST /agent/generate-template`/`edit-template`/`suggest-styles` (unchanged — DSK generation stays on `ai_config`, out of scope for the roles migration). `generate-rundown`/`edit-rundown` removed (see `routes/planner.js`).

**Backward compatibility:** `packages/lcyt-backend/src/ai/index.js` re-exports from `lcyt-agent`.

**Environment variables:**
| Variable | Purpose | Default |
|---|---|---|
| `VISION_PREVIEW_BASE_URL` | Base URL `VisionFrameFetcher` polls for preview JPEGs | `http://localhost:$PORT` |

**Tests:** `packages/plugins/lcyt-agent/test/*.test.js` — uses `node:test`. Notably: `provider-registry.test.js`, `discovery.test.js`, `ai-providers-routes.test.js`, `ai-roles.test.js`, `roles-routes.test.js`, `agentic-turn.test.js`, `roles-chat-routes.test.js`, `production-assistant.test.js`, `production-assistant-routes.test.js`, `vision-adapters.test.js`, `vision-frame-fetcher.test.js`, `vision-role-manager.test.js`, `vision-roles-routes.test.js`, `planner-routes.test.js`, and `roles-mount-order.test.js` (integration-level regression test mounting every role router together in `server.js`'s real order — the only way to catch the Express routing-collision class of bug described in `routes/roles-chat.js`'s module comment).

---

`computeEmbeddings()` and `evaluateEventCue()` here are the delegation targets for `packages/plugins/lcyt-cues`'s `semantic` and `event_cue` match types — see its `CLAUDE.md`. The shared tool registry consumed by the `agentic_chat` roles lives in `packages/lcyt-tools` — see its `CLAUDE.md`.
