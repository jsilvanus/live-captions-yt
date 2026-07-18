---
id: plan/ai_roles_framework
title: "AI Roles Framework — Model + Harness Selection for Vision Roles and Agentic Chat Assistants (and beyond)"
status: in-progress
summary: "Extensible AI 'role' registry (ai_roles catalog + project_ai_role_configs) that replaces ad-hoc single-purpose AI config with a generic model+harness selection mechanism. Implemented: the catalog + config schema (in its ai_model_registry-amended form, provider_id FK from day one), both vision roles (Tracker/Describer — continuous_vision runtime, preview-JPEG frame source, OpenAI/Google/Anthropic vision adapters), the shared agentic_chat turn loop with its confirm/auto safety gate, Setup/Asset Control/Graphics Editor Assistant's chat-message route, and Production Assistant's suggestion queue. Planner Assistant migrated onto this framework (POST /roles/planner/assist, superseding /agent/generate-rundown|edit-rundown). The <AgentChatPanel> frontend is now shipped. Remaining: bridge-relayed provider support for agentic_chat/vision (turn loop and vision adapters currently only resolve direct, non-bridge providers), and Translation (still just a flagged future gap, not spec'd). Supersedes the 'AI Models — tracker/describer/assistant multi-role' gap noted in plan_team_org_backend.md's appendix."
related: plan/agent, plan/cues, plan/team_org_backend, plan/mcp, plan/ai_model_registry
---

> **Amended by `plan_ai_model_registry.md`:** `project_ai_role_configs`'s `model_provider`/`model_name`/`api_key_ref`/`api_url` columns (schema below) are superseded by a single `provider_id` FK into that plan's `ai_providers` registry — see its "Amendment to `project_ai_role_configs`" section. That plan also adds real Ollama auto-discovery, multiple simultaneous Ollama instances, and bridge-relayed private Ollama providers. Implement that plan's Phase 1 (registry) before or alongside this one; build the role-config schema below in its amended form directly rather than migrating later.

# AI Roles Framework — Model + Harness Selection for Vision Roles and Agentic Chat Assistants (and beyond)

## Context

LCYT already has one piece of AI infrastructure that looks like it should generalize but doesn't: `packages/plugins/lcyt-agent/src/ai-config.js` defines a single `ai_config` table — one row per API key — with columns for `embedding_provider`, `embedding_model`, `embedding_api_key`, `embedding_api_url`, and `fuzzy_threshold`. It was built for exactly one job: computing text embeddings for `lcyt-cues`'s semantic cue matching. But `AgentEngine` (`packages/plugins/lcyt-agent/src/agent-engine.js`) has since grown four more LLM-driven capabilities — `evaluateEventCue()` (Phase 3, event cues), `generateTemplate()`/`editTemplate()`/`suggestStyles()` (Phase 5, DSK graphics), and `generateRundown()`/`editRundown()` (Phase 6, planner assist) — and every one of them resolves its model/API settings by reading the *same* `ai_config` row through `_resolveApiSettings()`, which reuses `embedding_api_key`/`embedding_model`/`embedding_api_url` as if they were general chat-completion settings (see `agent-engine.js` lines 264–281). There is no way today to give the event-cue evaluator a different model, provider, or system prompt than the DSK generator, because they are not actually separate configurations — they are one embedding config wearing four hats. `analyseImage()` is a stub that returns `{ description: '', confidence: 0 }` — Phase 4 (video/image inference) was scoped in `docs/plans/plan_agent.md` but never built, precisely because "what these roles actually do behaviorally has never been specified" (per `plan_team_org_backend.md`'s appendix, item 7).

This plan is that specification, and it fixes the underlying structural problem at the same time: the request was never "add three or four more config rows next to `ai_config`" — it was explicitly, by the user's own framing, **a model + harness selection framework**: an extensible registry of AI "roles," where a role is a named capability (Video Tracker, Video Describer, Planner Assistant, Production Assistant, and — explicitly — more to come) and a project's configuration for that role is "which model, which harness/prompt/tool-scaffolding." The number-one design constraint is that adding role #5 next year must not require a schema migration.

**No backward-compatibility burden.** LCYT has no released users. This plan freely deprecates and replaces existing routes and DB usage (`ai_config`'s incidental chat-completion reuse, `/agent/generate-rundown`, `/agent/edit-rundown`) rather than keeping them alongside the new framework "just in case."

## Initial role set

The first version of this framework should support two vision roles and five **agentic_chat** roles — a chat-with-tools assistant, differing only in system prompt and tool allowlist, not in runtime shape:

- **Video Tracker** — a vision role that tracks a person or object across video frames and emits structured tracking output.
- **Video Describer** — a vision role that describes the scene from frames or short clips, either as free text or structured JSON.
- **Setup Assistant** — helps configure Setup Hub cards (caption targets, cameras, mixers, encoders, ingestion, etc.) via chat: fills in and submits the card's existing Add/Edit dialogs rather than writing to the DB directly.
- **Asset Control Assistant** — the same chat-driven-dialog pattern, scoped to the Assets page's tools instead of Setup Hub's.
- **Planner Assistant** — helps a human author a rundown or show plan from natural-language goals; formally absorbs the existing `generateRundown`/`editRundown` capability (see Runtime Shape 2).
- **Graphics Editor Assistant** (`role_code: 'dsk_designer'`) — formally absorbs the existing `generateTemplate`/`editTemplate`/`suggestStyles` capability. Already informally previewed in the Setup Hub's AI models card under this user-facing name (`AiModelsSection.jsx`, added 2026-07-06) ahead of this plan being implemented.
- **Production Assistant** — follows tracker/describer/STT/user signals and proposes or executes camera and mixer changes, with a confirm-by-default safety gate (see Runtime Shape 2).

**Why one runtime, not five.** An earlier draft of this plan gave Planner its own `request_response` `runtime_kind` and Production Assistant its own `event_driven_decision` `runtime_kind`, on the reasoning that "how a role gets triggered" differs (typed request vs. event stream). In practice the five roles above are identical in every way that matters for *code*: each is one LLM tool-calling turn (system prompt + conversation context + a tool allowlist drawn from the shared MCP-shaped tool-schema module specified in `plan/mcp`), gated by the same `confirm`/`auto` safety mode (see Runtime Shape 2), differing only in *what triggers a turn* (a chat message vs. an incoming sensor event) and *which tools are on the allowlist*. That's a harness-config difference, not a runtime difference — so all five collapse onto a single `agentic_chat` `runtime_kind`, and adding a sixth (a hypothetical "Translator-Assist" chat role, say) costs a catalog row, not a new manager class. Tracker and Describer keep their own `continuous_vision` `runtime_kind` (Runtime Shape 1) since they are genuinely a different shape — a polling loop with no tool use and no human-facing conversation.

This plan uses a role catalog that can grow without changing the schema; future roles can reuse `agentic_chat` or `continuous_vision`, or introduce a new `runtime_kind` if a genuinely new shape shows up (see "Translation" below for one candidate that isn't spec'd yet).

### Translation — flagged, not yet spec'd

`translation_vendor_config` and `translation_targets` (see `plan_selfservice_config_backend.md`) already exist in `lcyt-backend`'s schema — a project can configure a translation vendor and a list of language/output targets — but per this repo's own `CLAUDE.md`, "translation half has no frontend consumer yet": nothing calls a model against that config. Whisper-style speech translation (audio → translated text directly, as an alternative to STT-then-translate) doesn't fit either existing `runtime_kind` cleanly — it's closer to the STT adapter pattern (`lcyt-rtmp/src/stt-adapters/*.js`) than to `continuous_vision` or `agentic_chat`. This plan does not spec a `translation` role or `runtime_kind` — flagging it here only so the next person picking this up doesn't have to rediscover that the config half is already built and the execution half isn't.

### What already exists that this plan builds on

- **`lcyt-agent/src/agent-engine.js`** — `evaluateEventCue()` is a real, working LLM chat-completion call with a hand-built system prompt, tolerant JSON response parsing (`parseAssistantJson()`), and a confidence threshold. `analyseImage()` is an unimplemented stub — the only existing hook for a vision capability. `_callChatCompletion()` is a working OpenAI-compatible chat-completions client with retry/backoff — the template every new adapter in this plan reuses.
- **`lcyt-agent/src/ai-config.js`** — the single-row-per-key config table this plan partially supersedes (see "Relationship to `ai_config`" below).
- **`lcyt-cues/src/cue-engine.js`** — `CueEngine.evaluate()` / `evaluateEventCues()` is the closest existing analog to autonomous AI action-taking: it evaluates rules (including LLM-based `event_cue` rules) against live caption text and fires cue events, with per-rule cooldown enforcement (`rule.cooldown_ms` + a `Map<ruleId, lastFiredTs>`, see lines 234–238 and 316–320). Critically, **it only ever fires an internal cue event** — it has no HTTP-POST or device-control action type today. The Assistant role below is the direct evolution of this pattern into actually invoking production-control endpoints, and inherits its cooldown-enforcement mechanism nearly verbatim.
- **`lcyt-production/src/routes/cameras.js`** (`POST /production/cameras/:id/preset/:presetId`) and **`routes/mixers.js`** (`POST /production/mixers/:id/switch/:inputNumber`) — these are the literal tools an Assistant role needs. Both routes already delegate to plain, directly-callable methods (`registry.callPreset(id, presetId)`, `registry.switchSource(id, input)`) that don't require going back through HTTP — see below.
- **`lcyt-rtmp/src/stt-manager.js` + `hls-segment-fetcher.js` + `stt-adapters/*.js`** — the "continuously poll a media source → feed each unit to a pluggable model adapter → emit events" pattern this plan reuses for Tracker/Describer. `SttManager` wires `HlsSegmentFetcher` (polls a MediaMTX fMP4 HLS playlist, emits `segment` events) to one of three interchangeable adapters (`GoogleSttAdapter`, `WhisperHttpAdapter`, `OpenAiAdapter`), each a small `EventEmitter` with `start()`/`stop()` and either `sendSegment()` or `write()`. This is the shape Tracker and Describer need for video — but, per the task brief, extracting usable frames/clips from HLS for a vision model is genuinely new work, not a drop-in reuse of the audio pipeline (see "Runtime Shape 1" below).

---

## The Core Move: A Registry, Not Seven Hardcoded Columns

Two tables, cleanly separated by concern:

1. **`ai_roles`** — a developer-maintained catalog of *kinds* of AI capability. Small, rarely-written, read by both the backend (to know how to run a role) and the frontend (to know what to render in a settings UI). Seeded with seven rows today (Tracker, Describer, Setup Assistant, Asset Control Assistant, Planner Assistant, Graphics Editor Assistant, Production Assistant). Growing this list further is exactly what it's for.
2. **`project_ai_role_configs`** — one row per `(api_key, role_code)` pair: which model/provider a *specific project* uses for a *specific role*, and that role's harness (system prompt override, tool allowlist, output-schema, thresholds). This is the only table a project owner ever writes to.

The reason this is extensible without migrations is that **the row shape of both tables is generic across every role that will ever exist** — `harness_config` is a JSON blob whose *interpreted* keys differ per role (every `agentic_chat` role reads `toolAllowlist`, empty for Planner and populated for Setup/Asset Control/Graphics Editor/Production Assistant; Describer instead reads `outputMode`/`jsonSchema`), but the *column* never changes. What *does* differ structurally between roles is the **runtime** — Tracker/Describer are a continuous background loop, everything else is one shared tool-calling turn triggered differently per role (a chat message for Setup/Asset Control/Planner/Graphics Editor, an incoming sensor event for Production Assistant — see "Why one runtime, not five" above). That distinction is captured in a single catalog field, `runtime_kind`, which is the actual lever for "how much new code does a new role need":

- New role, same `runtime_kind` as an existing one (e.g. a future chat-with-tools role) → **zero new runtime code**, just a catalog row + harness defaults + a tool allowlist into the shared tool-schema module (`plan/mcp`), reusing the existing `agentic_chat` turn loop and generic route handler.
- New role, genuinely new `runtime_kind` → one new manager class, following the Tracker/Describer/agentic_chat precedent set here. Still zero schema change.

---

## Schema

### `ai_roles` — the catalog

```sql
CREATE TABLE IF NOT EXISTS ai_roles (
  role_code       TEXT PRIMARY KEY,            -- 'tracker' | 'describer' | 'setup_assistant' | 'asset_control_assistant' | 'planner' | 'dsk_designer' | 'assistant' | ...
  name            TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  input_types     TEXT NOT NULL DEFAULT '[]',  -- JSON array, e.g. '["video_frames","stt_transcript"]'
  output_type     TEXT NOT NULL,               -- 'action' | 'text' | 'structured_json' | 'suggestion'
  runtime_kind    TEXT NOT NULL,               -- 'continuous_vision' | 'agentic_chat'
  available_tools TEXT NOT NULL DEFAULT '[]',  -- JSON array of tool ids into the shared tool-schema module (plan/mcp); only meaningful for agentic_chat roles
  is_builtin      INTEGER NOT NULL DEFAULT 1,  -- 1 for the shipped rows; distinguishes future non-core roles
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Seed data (idempotent upsert on startup, mirrors how ROLE_BUNDLES-style
-- constants are seeded elsewhere in the codebase — see runAiMigrations()):
INSERT OR IGNORE INTO ai_roles (role_code, name, description, input_types, output_type, runtime_kind, available_tools) VALUES
  ('tracker',   'Tracker',
   'Vision model tracking a person/object across video frames.',
   '["video_frames"]', 'structured_json', 'continuous_vision', '[]'),
  ('describer', 'Describer',
   'Describes what is happening on screen, as text or structured JSON.',
   '["video_frames","video_segments"]', 'text', 'continuous_vision', '[]'),
  ('setup_assistant', 'Setup Assistant',
   'Chat assistant that configures Setup Hub cards by filling in and submitting their existing Add/Edit dialogs.',
   '["user_text"]', 'suggestion', 'agentic_chat',
   '["caption_target.create","caption_target.update","caption_target.delete","camera.create","camera.update","camera.delete","mixer.create","mixer.update","mixer.delete", "..."]'),
  ('asset_control_assistant', 'Asset Control Assistant',
   'Chat assistant scoped to the Assets page, same dialog-driving pattern as Setup Assistant.',
   '["user_text"]', 'suggestion', 'agentic_chat', '["asset.upload","asset.update","asset.delete", "..."]'),
  ('planner', 'Planner Assistant',
   'Assists a human writing a show rundown/plan from a natural-language goal.',
   '["user_text"]', 'text', 'agentic_chat', '[]'),
  ('dsk_designer', 'Graphics Editor Assistant',
   'Generates and edits DSK overlay templates and suggests styles from a natural-language goal.',
   '["user_text"]', 'suggestion', 'agentic_chat', '["dsk_template.generate","dsk_template.edit","dsk_template.suggest_styles"]'),
  ('assistant', 'Production Assistant',
   'Follows tracker/describer/STT/user signals and proposes or executes camera and mixer changes.',
   '["tracker_events","describer_events","stt_transcript","user_text"]', 'suggestion', 'agentic_chat',
   '["camera.preset","mixer.switch"]');
```

`output_type: 'suggestion'` (rather than `'action'`) is deliberate for every role whose tools can change live state: the role's *default* behavior is to propose, not act — see "Runtime Shape 2" below. A role's `output_type` describes what it produces in its safest/default configuration; `harness_config.mode` on the per-project config is what upgrades a `suggestion`-shaped role into one that actually calls `available_tools` without a human confirming first. Planner's `output_type: 'text'` reflects that it never calls tools at all — see Runtime Shape 2's Planner subsection.

The tool ids in `available_tools` (`caption_target.create`, `camera.preset`, `dsk_template.generate`, etc.) are not defined here — they are entries in the shared tool-schema module `packages/lcyt-tools` (name from `plan/mcp`), the single place a tool's JSON schema, handler, and MCP annotations (`destructiveHint`, `readOnlyHint`) live. `ai_roles.available_tools` and `project_ai_role_configs.harness_config.toolAllowlist` (a project-chosen subset of it) are just string references into that module's registry — adding a tool to the module makes it immediately assignable to any role's allowlist without touching this schema.

### `project_ai_role_configs` — per-project role configuration

```sql
CREATE TABLE IF NOT EXISTS project_ai_role_configs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  api_key         TEXT    NOT NULL,                         -- api_keys.key, unenforced FK (matches ai_config's existing convention)
  role_code       TEXT    NOT NULL REFERENCES ai_roles(role_code),
  enabled         INTEGER NOT NULL DEFAULT 0,
  model_provider  TEXT    NOT NULL DEFAULT 'none',           -- 'none'|'server'|'openai'|'google'|'anthropic'|'custom'
  model_name      TEXT    NOT NULL DEFAULT '',
  api_key_ref     TEXT    NOT NULL DEFAULT '',               -- credential; masked on read, same convention as ai_config.embedding_api_key
  api_url         TEXT    NOT NULL DEFAULT '',               -- for 'custom' / self-hosted endpoints
  harness_config  TEXT    NOT NULL DEFAULT '{}',             -- JSON: role-specific interpreted keys, see below
  updated_at      INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  UNIQUE (api_key, role_code)
);
CREATE INDEX IF NOT EXISTS idx_project_ai_role_configs_key ON project_ai_role_configs(api_key);
```

`harness_config` keys, by role (all optional, all defaulted in code — never a schema concern):

| Role | Keys | Meaning |
|---|---|---|
| Tracker | `targetLabel`, `pollIntervalMs` | what to track (e.g. `"person"`), how often to sample frames |
| Describer | `outputMode` (`'text'`\|`'json'`), `jsonSchema`, `systemPromptOverride`, `pollIntervalMs` | free text vs. structured description, and the schema when `outputMode: 'json'` |
| Setup / Asset Control / Graphics Editor / Production Assistant (all `agentic_chat` roles with tools) | `mode` (`'confirm'`\|`'auto'`), `autoConfirmed` (bool), `toolAllowlist` (array, subset of the role's `available_tools`), `cooldownMs`, `systemPromptOverride` | one shared safety gate (see Runtime Shape 2) — same two keys and same meaning for all four roles, not a per-role vocabulary |
| Planner | `systemPromptOverride`, `defaultTemplateId` | prompt customization only — `mode`/`toolAllowlist` don't apply since Planner never calls tools |

`mode`/`autoConfirmed` replace what an earlier draft of this plan called `mode: 'suggest'|'autonomous'` + `autonomousConfirmed` — same two-key shape (a mode plus a second, independently-set confirmation flag that must also be true to unlock the risky mode), renamed once so Setup/Asset Control's frontend-facing "confirm each step" vs. "just do it" toggle and Production Assistant's suggestion-queue toggle are the same config field with the same name, not two safety gates that happen to work identically. `confirm` renders differently per role depending on whether the role has direct UI access: Setup/Asset Control/Graphics Editor render it as a staged, highlighted walkthrough of the real Setup Hub dialog (see Runtime Shape 2); Production Assistant, which has no dialog to drive, renders it as the pending-suggestions queue already spec'd below. Both are the same `mode: 'confirm'` from the schema's point of view.

This table is a straightforward, wider sibling of the existing `stt_config` table (`lcyt-rtmp`) and `key_storage_config` table (`lcyt-files`) — both already established the "one JSON-payload config row per API key for a pluggable subsystem" shape; `project_ai_role_configs` just adds `role_code` to key on because, unlike STT or storage, a project can have several of these active side-by-side.

### Relationship to the existing `ai_config` table — a decision, not a hedge

**Recommendation: embeddings stay on `ai_config`, exactly as they are today; every LLM chat-completion capability (event cues, DSK generation, and now Planner) moves onto `project_ai_role_configs`.**

Embeddings do not fit the role shape at all, on three independent grounds:

1. **Output type.** A role's `output_type` is `action` / `text` / `structured_json` / `suggestion` — all describe an LLM turn. `computeEmbeddings()` returns a raw vector. There is no slot for it in the taxonomy, and inventing one (`'vector'`) would be a single-consumer special case, not a generalization.
2. **No harness.** Embeddings have no system prompt, no tool use, no confidence threshold in the agentic sense (the existing `fuzzy_threshold` column is a downstream `CueEngine` matching parameter, not an LLM-harness setting). There is nothing for `harness_config` to hold.
3. **It is a library call, not a "thing the project enables."** `computeEmbeddings()` is consumed internally by `CueEngine`'s semantic cue matching; a project doesn't "turn on the embeddings role," it turns on semantic cues, which happen to need embeddings under the hood — same relationship a Node app has with any utility dependency.

What *does* move: `evaluateEventCue()`, `generateTemplate()`/`editTemplate()`/`suggestStyles()`, and `generateRundown()`/`editRundown()` were never really about embeddings — they only ever read `ai_config`'s embedding fields because that was the one config row available at the time. This plan's Planner role formally migrates `generateRundown`/`editRundown` onto `project_ai_role_configs` (see Runtime Shape 3), which incidentally fixes the field-name conflation for that one capability. **Event-cue evaluation and DSK generation are explicitly out of scope for this plan** — they keep resolving settings via `ai_config` for now. They are natural candidates for their own `ai_roles` catalog rows later (an `event_cue` role and a `dsk_designer` role respectively — the latter is really already a fifth role in every way except being named one), but migrating them isn't required to ship Tracker/Describer/Assistant/Planner, and doing all six at once would be a much larger and riskier change than this plan needs to be. Flagging DSK generation here is itself useful evidence for the registry design: it shows a "role" already existing in practice, informally, before this framework existed to name it.

(2026-07-06: the Setup Hub's AI models card now previews this role under its user-facing name, **Graphics Assistant** — `role_code: 'dsk_designer'` when it's actually built, matching the `generateTemplate`/`editTemplate`/`suggestStyles` capability described above.)

---

## Runtime Shape 1 — Tracker & Describer: Continuous Vision Loops

Structurally, these are the video-equivalent of `SttManager`: a manager keeps one running session per enabled `(api_key, role_code)`, wired to a segment/frame source on one side and a pluggable provider adapter on the other, emitting result events as they arrive.

**Where the video frames come from is the one piece of this plan that is genuinely new, not a reuse of existing plumbing.** `HlsSegmentFetcher` already polls a MediaMTX fMP4 HLS playlist and emits raw segment buffers — but STT hands those buffers to an *audio* API that accepts arbitrary containers; a vision API needs actual decoded image frames (JPEGs), which fMP4 segments are not. Two frame sources, MVP and future:

- **MVP: reuse `PreviewManager`'s existing output.** The backend already runs a JPEG-thumbnail generator per key (`GET /preview/:key/incoming.jpg`, `PreviewManager` in `lcyt-rtmp`) at a configurable interval (`PREVIEW_INTERVAL_S`, default 5s). A `VisionFrameFetcher` for Tracker/Describer simply polls this already-public endpoint on its own timer (`harness_config.pollIntervalMs`) — zero new media pipeline, immediately available for every key that already has RTMP relay active. This was already the exact path `plan_agent.md`'s (never-built) Phase 4 sketched under "Preview image inference."
- **Future: real HLS keyframe/clip extraction**, for lower latency or for Describer's `video_segments` input type (a few seconds of motion rather than one still frame) — needs an ffmpeg-based keyframe puller analogous to the RTMP/WHEP audio path in `SttManager`. Not required to ship v1; the JPEG-polling MVP is sufficient to prove the framework and is a strict subset of the eventual richer source.

**Placement:** the new `TrackerManager`/`DescriberManager` (or one shared `VisionRoleManager` parameterized by role) lives in **`lcyt-agent`**, not `lcyt-rtmp`. This is a deliberate departure from the STT precedent, where the adapters (`stt-adapters/*.js`) live alongside the audio plumbing in `lcyt-rtmp` — but `lcyt-agent` didn't exist as "the central AI service" when STT was built; it does now, and its own module docstring already states the intent that *other plugins delegate AI calls to the agent rather than calling APIs directly*. Consuming the preview-JPEG endpoint over plain HTTP from `lcyt-agent` is not a new architectural pattern — it's exactly what `HlsSegmentFetcher` already does against MediaMTX (an HTTP fetch against a URL, no in-process coupling to another plugin's internals) — it just means the *consumer* of that pattern is the AI plugin instead of the RTMP plugin.

**Events** (in-process `EventEmitter`, mirrored to SSE via `GET /roles/tracker/events` / `GET /roles/describer/events`, same shape as `/stt/events`):

```
tracker_update   { apiKey, ts, objects: [{ id, label, confidence, bbox: { x, y, w, h } }] }   // bbox normalized 0–1
describer_update { apiKey, ts, text?: string, json?: object }                                  // per harness_config.outputMode
```

Both roles are strictly non-action: `output_type` is `structured_json` (Tracker) and `text`/`structured_json` (Describer). **Neither ever calls a camera/mixer endpoint.** That is reserved for Assistant alone — see below for why that boundary is deliberate, not an oversight. (Whether Tracker output eventually drives literal camera auto-framing is a real future capability, but it is a *consumer* of `tracker_update` events, not something Tracker does itself — see Open Questions.)

Routes (mirrors the existing `/stt/*` shape exactly):

```
POST /roles/tracker/start | /roles/describer/start   { }  — start the loop for the session's api_key
POST /roles/tracker/stop  | /roles/describer/stop
GET  /roles/tracker/status | /roles/describer/status
GET  /roles/tracker/events | /roles/describer/events  — SSE
```

---

## Runtime Shape 2 — Agentic Chat: One Tool-Calling Turn Loop, Five Roles, One Safety Gate

All five `agentic_chat` roles (Setup, Asset Control, Planner, Graphics Editor, Production Assistant) share one runtime. What differs per role is *what triggers a turn* and *which tools are on the allowlist* — never the turn mechanics, the transport, or the safety-gate vocabulary.

### Shared mechanics, built once

- **Tool-calling loop (backend, in `lcyt-agent`):** one small generic turn-loop function, living next to `_callChatCompletion`, using the standard OpenAI-compatible `tools`/`tool_calls` wire format (send `messages` + `tools` → get `message.tool_calls[]` → dispatch each call into the shared tool-schema module's handler → append `role: 'tool'` results → repeat until a plain text reply). This is deliberately **hand-rolled, not an agent-framework dependency** (LangChain, Vercel AI SDK, an Anthropic- or OpenAI-specific Agents SDK) — `lcyt-agent` is intentionally provider-agnostic (`ai-config.js`'s `none`/`server`/`openai`/`custom` modes exist so a project can point at any OpenAI-compatible endpoint, including self-hosted), and every one of those frameworks would either assume one vendor's API shape or add a dependency for what is, in practice, not much code once you're not also inventing the wire format.
- **Tool schemas + handlers:** defined exactly once, in the shared `packages/lcyt-tools` module specified by `plan/mcp` — the same schemas the MCP servers expose to external clients (Claude Desktop, Claude Code, etc.) and the same schemas `available_tools`/`toolAllowlist` above reference by id. A tool added there is immediately usable by any role and any MCP client; see `plan/mcp` for the module's shape, the in-process linked-transport wiring into `lcyt-agent`, and the `destructiveHint`/`readOnlyHint` annotation convention.
- **Streaming (backend → frontend):** reuses this codebase's existing SSE convention (the same shape as `/stt/:key/live`, `/music/:key/live`) rather than a chat-framework's own transport — `GET /roles/:roleCode/events` emits token deltas plus tool-call-in-progress/tool-call-result events, per session.
- **Frontend:** one shared `<AgentChatPanel>` component (message list, input, SSE subscription), parameterized by `role_code` and mounted once per surface (Setup Hub, Assets page, Planner, Graphics Editor) rather than four bespoke chat UIs. For roles that drive existing UI (Setup, Asset Control, Graphics Editor), dialogs opt into a small shared `useGuidedAction` primitive — "I can be opened, highlighted, have field X set, and have my own submit/confirm button located" — so each dialog needs a thin, uniform hook-up rather than bespoke DOM-scripting per card. No such pattern exists anywhere in `lcyt-web` today; this is new frontend work regardless of backend design, confirmed by inspection (no `openAdd`/`setField`/step-plan/highlight pattern found anywhere in the codebase).
- **Safety gate:** `harness_config.mode: 'confirm'|'auto'` + `autoConfirmed` (see schema section above), the same two-key shape for every tool-bearing role. **`confirm` renders differently depending on whether the role has direct UI access:**
  - Setup / Asset Control / Graphics Editor (roles that can drive a real dialog): a staged walkthrough — the panel opens the target card's existing dialog, highlights it, fills fields one at a time via `useGuidedAction`, and waits for the human's own click on the dialog's own submit button.
  - Production Assistant (no dialog to drive — its "actions" are device calls, not form submissions): the pending-suggestions queue described below.
  - `auto` mode skips the wait and calls/submits immediately in both cases — **except delete/destructive operations, which always go through the target's existing confirm-delete dialog regardless of `mode`.** This is a hard rule carried from the original task brief, not a per-role choice: `auto` upgrades "the AI decides and acts," never "the AI bypasses a safety dialog a human would otherwise have to click through."
  - `mode: 'auto'` requires **two independent fields both set** — `mode: 'auto'` *and* `autoConfirmed: true` — mirroring the `{ confirm: true }` pattern already used elsewhere in this codebase's plans for irreversible actions (see `plan_team_org_backend.md`'s `POST /orgs/:id/members/:userId/transfer-ownership`). The config UI should present `autoConfirmed` behind its own distinct confirmation dialog, not as a sibling checkbox next to `mode`.

### Setup Assistant / Asset Control Assistant / Graphics Editor Assistant — Chat Driving Existing Dialogs

Trigger is a chat message: `POST /roles/:roleCode/message { text }`. The turn loop runs with a tool allowlist scoped to the surface (Setup Hub CRUD tools for `setup_assistant`, Assets tools for `asset_control_assistant`, DSK template tools for `dsk_designer`), dispatches into the shared module, and the frontend executes the result per the `confirm`/`auto` behavior above. `dsk_designer` formally absorbs the existing `generateTemplate`/`editTemplate`/`suggestStyles` capability and `POST /agent/generate-template` / `POST /agent/edit-template` — same supersession reasoning as Planner below.

### Production Assistant — Event-Driven Trigger, Suggestion Queue

**Trigger sources**, all in-process subscriptions (no network round-trip — Assistant runs in the same backend process as the emitters it listens to):
- `tracker_update` / `describer_update` from the vision-role manager
- `transcript` from `SttManager` (already emitted today)
- direct user nudges — a lightweight `POST /roles/assistant/prompt { text }`, analogous to today's `POST /agent/context`

On each trigger (rate-limited — see below), Assistant runs the shared turn loop with context (recent tracker/describer/STT/user entries, same shape as `AgentEngine.getContext()`) and a tool allowlist built **dynamically per project** from that project's actual `prod_cameras`/`prod_mixers` rows, filtered to `harness_config.toolAllowlist` (a subset of `camera.preset`/`mixer.switch`). Regenerating the tool list from the live camera/mixer tables on every turn is cheap (two `SELECT`s) and guarantees the LLM never sees a stale device list.

In `confirm` mode, the chosen tool call is captured but not executed — recorded in a per-key pending-suggestions queue (in-memory, same shape as `AgentEngine`'s context window map) and emitted as an `assistant_suggestion` SSE event: `{ id, tool, args, reasoning, ts }`:
```
GET    /roles/assistant/suggestions              — list pending suggestions for the session's key
POST   /roles/assistant/suggestions/:id/confirm  — executes the suggested tool call now
POST   /roles/assistant/suggestions/:id/reject   — discards it
GET    /roles/assistant/events                   — SSE: assistant_suggestion, assistant_action
```
(The confirm/reject UI itself — presumably a panel on the Production or Dashboard page — is out of scope for this plan; it is a frontend follow-up once the API exists.) In `auto` mode the chosen tool call executes immediately (`registry.callPreset()` / `registry.switchSource()`, called in-process — see "Wiring" below), and `assistant_action` is emitted **after** execution, as an audit record, not a gate.

**Rate limiting** mirrors `CueEngine`'s existing `cooldown_ms` / `Map<ruleId, lastFiredTs>` pattern almost exactly: `harness_config.cooldownMs`, enforced per-project regardless of *which* tool the LLM picked (prevents an LLM from flapping between two cameras every few seconds even if each individual call looks reasonable in isolation). Unlike `CueEngine`'s cooldown (fully user-configurable, including to `0`), this plan recommends a **server-enforced floor** — e.g. never below 3000ms — applied in code regardless of the configured value, specifically for `mode: 'auto'`. `confirm` mode is already self-limiting (a human has to act on each suggestion); `auto` mode is the one place a misconfigured `harness_config` could otherwise produce a genuinely disruptive live-broadcast failure mode, so the floor is not user-overridable.

**Wiring (composition root):** `lcyt-backend/src/server.js` already owns both `registry`/`bridgeManager` (from `initProductionControl()`) and, after this plan, the Assistant runtime (from `lcyt-agent`). It injects the former into the latter via a setter, exactly like the existing `cueEngine.setAgentEvaluateFn((apiKey, desc, opts) => agent.evaluateEventCue(apiKey, desc, opts))` line already does for event cues — no new dependency-injection pattern, no circular package imports between `lcyt-agent` and `lcyt-production`.

### Planner Assistant — Chat Trigger, No Tools

`packages/lcyt-web/src/components/PlannerPage.jsx` is, today, 100% client-local: its draft is held in React state, persisted only to `localStorage` (`PLANNER_DRAFT_KEY`), and round-tripped through `serializePlan()`/`deserializePlan()` for file import/export. There is no backend rundown-storage table and this plan does not add one — a Planner-assist endpoint works over "current plan context" passed in the request, not a persisted-plan feature, and that is exactly what already exists.

In fact, **`POST /agent/generate-rundown` and `POST /agent/edit-rundown` (Phase 6, already implemented in `agent-engine.js` and already wired into `PlannerPage.jsx`'s "✨ AI Assist" panel) are, functionally, the Planner role already shipped** — they just predate this framework and so live outside it, hardcoded into `AgentEngine` with no per-project model/prompt configurability. This plan's job for Planner is narrow: give it a real `project_ai_role_configs` row (so `systemPromptOverride` and model/provider become project-configurable instead of baked into `agent-engine.js`'s `RUNDOWN_METACODE_REFERENCE` string) and unify the two existing routes into one:

```
POST /roles/planner/assist
  Body: { currentPlan?: string, goal: string, templateId?: string }
  Behavior:
    - currentPlan omitted or empty → generate from scratch (optionally seeded
      from AgentEngine.RUNDOWN_TEMPLATE_LIBRARY[templateId], unchanged from today)
    - currentPlan present → edit existing content per `goal`
  Response: { ok: true, content: string }   — same rundown-text-with-metacodes
                                                shape /agent/generate-rundown
                                                already returns today
```

`PlannerPage.jsx` needs no response-shape changes at all — it already calls `deserializePlan(data.content)` to turn returned text into blocks (`caption`/`heading`/`audio-start`/`audio-stop`/`graphics`/`codes`/`stanza`/`empty-send`); only the URL and the merged generate/edit request shape change. **This formally supersedes and replaces `POST /agent/generate-rundown` / `POST /agent/edit-rundown`** (`plan_agent.md` Phase 6) — both should be removed, along with their two separate frontend call sites, as part of implementing this plan; keeping three routes doing the same job is not warranted given no back-compat requirement. Planner never calls tools, so `POST /roles/planner/assist` skips the shared turn loop's tool-dispatch step entirely — it's the degenerate one-turn, zero-tools case of the same mechanism, not a separate code path.

Because Planner has no continuous loop and never touches tools, it needs none of the start/stop/SSE machinery Tracker/Describer/the tool-bearing roles get — just `POST /roles/planner/assist` plus the standard `GET/PUT /roles/planner/config`.

---

## Extensibility: What "We'll Need More" Actually Costs

| Scenario | New schema? | New code |
|---|---|---|
| New role, existing `runtime_kind` (e.g. a future "Translator-Assist" request/response role) | No | 1 `ai_roles` row + harness defaults; likely reuses a generic `/roles/:roleCode/assist` handler shaped like Planner's |
| New role, new `runtime_kind` (e.g. a hypothetical continuous audio-quality auditor) | No | 1 `ai_roles` row + 1 new manager class, following the Tracker/Describer/Assistant precedent |
| New model provider for an existing role (e.g. adding Mistral vision to Tracker/Describer) | No | 1 new adapter file matching the shared vision-adapter interface below |
| DSK generation / event-cue evaluation formally join the registry later | No | Migrate their `_resolveApiSettings()` call sites onto `project_ai_role_configs`; add 1–2 catalog rows |

The one thing that is never required, for any of the above, is touching `ai_roles`' or `project_ai_role_configs`' column list. That was the entire point of separating "catalog of kinds" from "per-project instance config" in the first place.

---

## Vision-Model Provider Adapters

Tracker and Describer both need "send image(s) + a text prompt to a multimodal model, get text or structured output back." Unlike STT — where REST vs. gRPC vs. Whisper-HTTP vs. OpenAI genuinely differ in transport — vision-capable chat APIs are comparatively uniform: OpenAI, Google, and Anthropic all expose "chat completions with an image content part," differing mainly in envelope shape (`image_url` vs. `inline_data` vs. base64 `image` blocks). Following the exact file-per-provider convention of `stt-adapters/`:

```
packages/plugins/lcyt-agent/src/vision-adapters/
  openai-vision.js     — GPT-4o-style: chat completions, image_url content parts (base64 data URI)
  google-vision.js      — Gemini: generateContent REST endpoint, inline_data parts
  anthropic-vision.js   — Claude: Messages API, base64 image content blocks
```

Common interface (mirrors the STT adapters' `EventEmitter` + `start()`/`stop()` shape, adapted for request/response rather than streaming):

```js
class SomeVisionAdapter {
  constructor({ model, apiKey, apiUrl }) { /* … */ }
  async analyse(imageBuffers /* Buffer[] */, promptText, opts = {}) {
    // opts.outputMode: 'text' | 'json'; opts.jsonSchema when 'json'
    return { text: string|null, json: object|null, raw: string };
  }
}
```

`openai-vision.js` can share the bulk of `_callChatCompletion()`'s retry/backoff logic already written in `agent-engine.js` — only the message-content construction (image parts) differs from the existing text-only call.

---

## Routes Summary

```
GET    /roles/catalog                          — list ai_roles catalog (read-only, drives frontend role picker)
GET    /roles/:roleCode/config                  — get project's config for a role (masked credential)
PUT    /roles/:roleCode/config                  — update project's config for a role

POST   /roles/tracker/start     | /roles/describer/start
POST   /roles/tracker/stop      | /roles/describer/stop
GET    /roles/tracker/status    | /roles/describer/status
GET    /roles/tracker/events    | /roles/describer/events        — SSE

POST   /roles/assistant/prompt                  — one-off human nudge into Assistant's context
GET    /roles/assistant/suggestions             — pending suggestions (confirm mode)
POST   /roles/assistant/suggestions/:id/confirm | /reject
GET    /roles/assistant/events                  — SSE: assistant_suggestion, assistant_action

POST   /roles/setup_assistant/message           | /roles/asset_control_assistant/message | /roles/dsk_designer/message
  Body: { text, conversationId? }                — one chat turn; runs the shared turn loop against the role's tool allowlist
GET    /roles/setup_assistant/events            | /roles/asset_control_assistant/events  | /roles/dsk_designer/events
                                                    — SSE: token deltas, tool_call_started, tool_call_result, staged_action (per confirm/auto mode)

POST   /roles/planner/assist                    — { currentPlan?, goal, templateId? } → { ok, content }
                                                    (supersedes /agent/generate-rundown, /agent/edit-rundown)
```

All routes require session JWT Bearer auth (same as today's `/ai/*` and `/agent/*` routes) except `GET /roles/catalog`, which is static/public like `GET /ai/status`.

---

## Effort Estimate

- Schema: two additive tables, no back-fill (small).
- `ai_roles` seed data + `db/ai-roles.js` / `db/project-ai-role-configs.js` helpers (small — mirrors `ai-config.js`'s existing CRUD shape).
- `routes/roles.js` — catalog + config CRUD (small-medium).
- Tracker/Describer: `VisionFrameFetcher` (new, MVP = preview-JPEG polling) + `VisionRoleManager` + 3 vision adapters + SSE routes (medium — the adapters are the STT-adapter template; the frame fetcher is the only genuinely new subsystem).
- Shared `agentic_chat` turn loop (one function in `lcyt-agent`, next to `_callChatCompletion`) + dispatch into the shared tool-schema module from `plan/mcp` (small-medium — this is the one piece all five tool-bearing/chat roles depend on, so it's worth building and testing once before any individual role).
- Production Assistant: decision-loop trigger wiring (tracker/describer/STT/prompt subscriptions), dynamic tool-allowlist builder from `prod_cameras`/`prod_mixers`, suggestion queue + confirm/reject routes, `server.js` wiring to `registry`/`bridgeManager` (medium-large — the safety-gate logic and its tests are the highest-scrutiny part of this whole plan).
- Setup Assistant / Asset Control Assistant / Graphics Editor Assistant: `POST /roles/:roleCode/message` + SSE events route (thin, reuses the shared turn loop) per role (small each, once the shared loop exists) — plus the genuinely new frontend work: `<AgentChatPanel>`, `useGuidedAction`, and wiring each Setup Hub / Assets / Graphics Editor dialog to opt into it (medium-large; no existing pattern to build on, confirmed by inspection).
- Planner: migrate `generateRundown`/`editRundown` onto `project_ai_role_configs`, add `POST /roles/planner/assist`, remove the two superseded routes + update `PlannerPage.jsx`'s two fetch call sites (small).
- Full test coverage: catalog seeding, config CRUD, each runtime's start/stop/status lifecycle, the shared turn loop's tool-dispatch and confirm-vs-auto branching (the highest-value tests in the plan, since every tool-bearing role depends on this one code path), cooldown floor enforcement, Planner generate-vs-edit branching.

Frontend UI beyond the two `PlannerPage.jsx` call-site changes is real, separate follow-on work once the API surface exists — but note this plan now includes, not defers, the `<AgentChatPanel>`/`useGuidedAction` design itself (see Runtime Shape 2), since "how does chat drive an existing dialog" is core to what Setup/Asset Control/Graphics Editor Assistant *are*, not an implementation detail that can be decided later. Which of the five agentic_chat roles gets built first is an open question below, not decided by this plan.

---

## Open Questions (Not Punted — Genuinely Need Product Input)

1. **Describer's `structured_json` schema shape has no single right answer.** This plan recommends `harness_config.jsonSchema` be an arbitrary, project-supplied JSON schema (not one LCYT-wide fixed shape) — but what *default/starter* schema the config UI should offer new users is a product decision, not something inferable from the codebase.
2. **Vision provider priority order.** OpenAI (GPT-4o-style), Google (Gemini), and Anthropic (Claude) are all spec'd as initial adapter targets, but which ships first is a real product call — likely driven by which the operator/user already holds API keys for, or by per-frame cost at the expected polling frequency (see #4), neither of which is knowable from this codebase alone.
3. **Whether/how Tracker output should drive actual camera auto-framing.** The task brief mentions this as Tracker's "likely" downstream use, but this plan deliberately keeps Tracker non-action (see Runtime Shape 1) and doesn't spec an auto-framing consumer. Is that consumer itself a future Assistant behavior (Assistant subscribes to `tracker_update` and calls `camera.preset`, which the framework already supports unmodified), or a separate, non-AI feature (a literal PID-loop-style auto-framer)? Needs a product decision before that specific capability is built, though nothing in this plan blocks it either way.
4. **Default polling interval for Tracker/Describer's continuous loops.** `PreviewManager`'s existing default is 5s, chosen for thumbnail-freshness, not vision-API cost/latency tradeoffs. Once there's a real per-frame cost figure for the chosen initial provider(s), the sensible default interval could be very different from 5s. Not resolvable without live usage/cost data.
5. **Physical placement of the Tracker/Describer runtime code (`lcyt-agent` vs. `lcyt-rtmp`).** This plan recommends `lcyt-agent`, reasoning that it is explicitly meant to be the project's "central AI service" and that HTTP-polling `lcyt-rtmp`'s already-public preview/HLS endpoints is architecturally equivalent to `HlsSegmentFetcher`'s existing pattern either way. If there's a strong preference for co-locating with `lcyt-rtmp`'s existing ffmpeg/MediaMTX expertise instead (matching where the STT adapters live today), that's a one-line change to this plan's placement recommendation, not a redesign.
6. **Build order for the five `agentic_chat` roles.** Setup Assistant, Asset Control Assistant, Planner (migration of already-shipped functionality), Graphics Editor Assistant (migration of already-shipped functionality), and Production Assistant are five separately-shippable chunks once the shared turn loop + tool-schema module exist. Planner and Graphics Editor are migrations of capability that already works today (lower risk, mostly plumbing); Setup and Asset Control are net-new chat-driven-dialog UI (higher risk, no existing pattern); Production Assistant is the highest-stakes (live camera/mixer control). This plan does not commit to an order — it's a product/priority call, not something inferable from the code.
7. **How much of Translation to build now.** This plan flags Translation (see "Initial role set") as a real gap with existing config scaffolding and zero execution, but doesn't spec a role or runtime for it. Whether it's worth fully speccing alongside this pass, or left as a flagged gap for a later plan, is a scope call, not an architecture one.
