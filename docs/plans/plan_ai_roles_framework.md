---
id: plan/ai_roles_framework
title: "AI Roles Framework — Model + Harness Selection for Video Tracker, Video Describer, Planner Assistant, Production Assistant (and beyond)"
status: draft
summary: "Design for an extensible AI 'role' registry (ai_roles catalog + project_ai_role_configs) that replaces ad-hoc single-purpose AI config with a generic model+harness selection mechanism. Specifies the initial roles of Video Tracker (vision object tracking), Video Describer (scene description), Planner Assistant (rundown-writing assist), and Production Assistant (event-driven camera/mixer decision-making with a suggest-only vs. autonomous safety gate), with room for more roles later. Supersedes the 'AI Models — tracker/describer/assistant multi-role' gap noted in plan_team_org_backend.md's appendix."
related: plan/agent, plan/cues, plan/team_org_backend
---

# AI Roles Framework — Model + Harness Selection for Video Tracker, Video Describer, Planner Assistant, Production Assistant (and beyond)

## Context

LCYT already has one piece of AI infrastructure that looks like it should generalize but doesn't: `packages/plugins/lcyt-agent/src/ai-config.js` defines a single `ai_config` table — one row per API key — with columns for `embedding_provider`, `embedding_model`, `embedding_api_key`, `embedding_api_url`, and `fuzzy_threshold`. It was built for exactly one job: computing text embeddings for `lcyt-cues`'s semantic cue matching. But `AgentEngine` (`packages/plugins/lcyt-agent/src/agent-engine.js`) has since grown four more LLM-driven capabilities — `evaluateEventCue()` (Phase 3, event cues), `generateTemplate()`/`editTemplate()`/`suggestStyles()` (Phase 5, DSK graphics), and `generateRundown()`/`editRundown()` (Phase 6, planner assist) — and every one of them resolves its model/API settings by reading the *same* `ai_config` row through `_resolveApiSettings()`, which reuses `embedding_api_key`/`embedding_model`/`embedding_api_url` as if they were general chat-completion settings (see `agent-engine.js` lines 264–281). There is no way today to give the event-cue evaluator a different model, provider, or system prompt than the DSK generator, because they are not actually separate configurations — they are one embedding config wearing four hats. `analyseImage()` is a stub that returns `{ description: '', confidence: 0 }` — Phase 4 (video/image inference) was scoped in `docs/plans/plan_agent.md` but never built, precisely because "what these roles actually do behaviorally has never been specified" (per `plan_team_org_backend.md`'s appendix, item 7).

This plan is that specification, and it fixes the underlying structural problem at the same time: the request was never "add three or four more config rows next to `ai_config`" — it was explicitly, by the user's own framing, **a model + harness selection framework**: an extensible registry of AI "roles," where a role is a named capability (Video Tracker, Video Describer, Planner Assistant, Production Assistant, and — explicitly — more to come) and a project's configuration for that role is "which model, which harness/prompt/tool-scaffolding." The number-one design constraint is that adding role #5 next year must not require a schema migration.

**No backward-compatibility burden.** LCYT has no released users. This plan freely deprecates and replaces existing routes and DB usage (`ai_config`'s incidental chat-completion reuse, `/agent/generate-rundown`, `/agent/edit-rundown`) rather than keeping them alongside the new framework "just in case."

## Initial role set

The first version of this framework should support four roles explicitly:

- **Video Tracker** — a vision role that tracks a person or object across video frames and emits structured tracking output.
- **Video Describer** — a vision role that describes the scene from frames or short clips, either as free text or structured JSON.
- **Planner Assistant** — a request/response role that helps a human author a rundown or show plan from natural-language goals.
- **Production Assistant** — an event-driven role that proposes or executes production actions such as camera presets or mixer switches, with a suggest-only default and an explicit autonomy gate.

This plan uses a role catalog that can grow beyond those four without changing the schema; future roles can reuse the same runtime patterns or introduce a new runtime kind if needed.

### What already exists that this plan builds on

- **`lcyt-agent/src/agent-engine.js`** — `evaluateEventCue()` is a real, working LLM chat-completion call with a hand-built system prompt, tolerant JSON response parsing (`parseAssistantJson()`), and a confidence threshold. `analyseImage()` is an unimplemented stub — the only existing hook for a vision capability. `_callChatCompletion()` is a working OpenAI-compatible chat-completions client with retry/backoff — the template every new adapter in this plan reuses.
- **`lcyt-agent/src/ai-config.js`** — the single-row-per-key config table this plan partially supersedes (see "Relationship to `ai_config`" below).
- **`lcyt-cues/src/cue-engine.js`** — `CueEngine.evaluate()` / `evaluateEventCues()` is the closest existing analog to autonomous AI action-taking: it evaluates rules (including LLM-based `event_cue` rules) against live caption text and fires cue events, with per-rule cooldown enforcement (`rule.cooldown_ms` + a `Map<ruleId, lastFiredTs>`, see lines 234–238 and 316–320). Critically, **it only ever fires an internal cue event** — it has no HTTP-POST or device-control action type today. The Assistant role below is the direct evolution of this pattern into actually invoking production-control endpoints, and inherits its cooldown-enforcement mechanism nearly verbatim.
- **`lcyt-production/src/routes/cameras.js`** (`POST /production/cameras/:id/preset/:presetId`) and **`routes/mixers.js`** (`POST /production/mixers/:id/switch/:inputNumber`) — these are the literal tools an Assistant role needs. Both routes already delegate to plain, directly-callable methods (`registry.callPreset(id, presetId)`, `registry.switchSource(id, input)`) that don't require going back through HTTP — see below.
- **`lcyt-rtmp/src/stt-manager.js` + `hls-segment-fetcher.js` + `stt-adapters/*.js`** — the "continuously poll a media source → feed each unit to a pluggable model adapter → emit events" pattern this plan reuses for Tracker/Describer. `SttManager` wires `HlsSegmentFetcher` (polls a MediaMTX fMP4 HLS playlist, emits `segment` events) to one of three interchangeable adapters (`GoogleSttAdapter`, `WhisperHttpAdapter`, `OpenAiAdapter`), each a small `EventEmitter` with `start()`/`stop()` and either `sendSegment()` or `write()`. This is the shape Tracker and Describer need for video — but, per the task brief, extracting usable frames/clips from HLS for a vision model is genuinely new work, not a drop-in reuse of the audio pipeline (see "Runtime Shape 1" below).

---

## The Core Move: A Registry, Not Four Hardcoded Columns

Two tables, cleanly separated by concern:

1. **`ai_roles`** — a developer-maintained catalog of *kinds* of AI capability. Small, rarely-written, read by both the backend (to know how to run a role) and the frontend (to know what to render in a settings UI). Seeded with four rows today. Growing this list to five, ten, or twenty rows is exactly what it's for.
2. **`project_ai_role_configs`** — one row per `(api_key, role_code)` pair: which model/provider a *specific project* uses for a *specific role*, and that role's harness (system prompt override, tool allowlist, output-schema, thresholds). This is the only table a project owner ever writes to.

The reason this is extensible without migrations is that **the row shape of both tables is generic across every role that will ever exist** — `harness_config` is a JSON blob whose *interpreted* keys differ per role (Assistant reads `toolAllowlist`; Describer reads `outputMode`/`jsonSchema`; Planner reads neither), but the *column* never changes. What *does* differ structurally between roles is the **runtime** — Tracker is a continuous background loop, Assistant is an event-driven decision loop, Planner is a stateless request/response endpoint. That distinction is captured in a single catalog field, `runtime_kind`, which is the actual lever for "how much new code does a new role need":

- New role, same `runtime_kind` as an existing one (e.g. a future "Translator-Assist" request/response role) → **zero new runtime code**, just a catalog row + harness defaults, usually reusing an existing generic route handler.
- New role, genuinely new `runtime_kind` → one new manager class, following the Tracker/Describer/Assistant/Planner precedent set here. Still zero schema change.

---

## Schema

### `ai_roles` — the catalog

```sql
CREATE TABLE IF NOT EXISTS ai_roles (
  role_code       TEXT PRIMARY KEY,            -- 'tracker' | 'describer' | 'assistant' | 'planner' | ...
  name            TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  input_types     TEXT NOT NULL DEFAULT '[]',  -- JSON array, e.g. '["video_frames","stt_transcript"]'
  output_type     TEXT NOT NULL,               -- 'action' | 'text' | 'structured_json' | 'suggestion'
  runtime_kind    TEXT NOT NULL,               -- 'continuous_vision' | 'event_driven_decision' | 'request_response'
  available_tools TEXT NOT NULL DEFAULT '[]',  -- JSON array of tool ids; only meaningful for 'action' roles
  is_builtin      INTEGER NOT NULL DEFAULT 1,  -- 1 for the four shipped rows; distinguishes future non-core roles
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
  ('assistant', 'Assistant',
   'Follows tracker/describer/STT/user signals and proposes or executes camera and mixer changes.',
   '["tracker_events","describer_events","stt_transcript","user_text"]', 'suggestion', 'event_driven_decision',
   '["camera.preset","mixer.switch"]'),
  ('planner',   'Planner',
   'Assists a human writing a show rundown/plan from a natural-language goal.',
   '["user_text"]', 'text', 'request_response', '[]');
```

`output_type: 'suggestion'` for Assistant (rather than `'action'`) is deliberate: Assistant's *default* behavior is to propose, not act — see "Runtime Shape 2" below. A role's `output_type` describes what it produces in its safest/default configuration; `harness_config.mode` on the per-project config is what upgrades a `suggestion`-shaped role into one that actually calls `available_tools`.

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
| Assistant | `mode` (`'suggest'`\|`'autonomous'`), `autonomousConfirmed` (bool), `toolAllowlist` (array, subset of the role's `available_tools`), `cooldownMs`, `systemPromptOverride` | the safety gate (see Runtime Shape 2) |
| Planner | `systemPromptOverride`, `defaultTemplateId` | prompt customization only — no continuous-loop or tool keys apply |

This table is a straightforward, wider sibling of the existing `stt_config` table (`lcyt-rtmp`) and `key_storage_config` table (`lcyt-files`) — both already established the "one JSON-payload config row per API key for a pluggable subsystem" shape; `project_ai_role_configs` just adds `role_code` to key on because, unlike STT or storage, a project can have several of these active side-by-side.

### Relationship to the existing `ai_config` table — a decision, not a hedge

**Recommendation: embeddings stay on `ai_config`, exactly as they are today; every LLM chat-completion capability (event cues, DSK generation, and now Planner) moves onto `project_ai_role_configs`.**

Embeddings do not fit the role shape at all, on three independent grounds:

1. **Output type.** A role's `output_type` is `action` / `text` / `structured_json` / `suggestion` — all describe an LLM turn. `computeEmbeddings()` returns a raw vector. There is no slot for it in the taxonomy, and inventing one (`'vector'`) would be a single-consumer special case, not a generalization.
2. **No harness.** Embeddings have no system prompt, no tool use, no confidence threshold in the agentic sense (the existing `fuzzy_threshold` column is a downstream `CueEngine` matching parameter, not an LLM-harness setting). There is nothing for `harness_config` to hold.
3. **It is a library call, not a "thing the project enables."** `computeEmbeddings()` is consumed internally by `CueEngine`'s semantic cue matching; a project doesn't "turn on the embeddings role," it turns on semantic cues, which happen to need embeddings under the hood — same relationship a Node app has with any utility dependency.

What *does* move: `evaluateEventCue()`, `generateTemplate()`/`editTemplate()`/`suggestStyles()`, and `generateRundown()`/`editRundown()` were never really about embeddings — they only ever read `ai_config`'s embedding fields because that was the one config row available at the time. This plan's Planner role formally migrates `generateRundown`/`editRundown` onto `project_ai_role_configs` (see Runtime Shape 3), which incidentally fixes the field-name conflation for that one capability. **Event-cue evaluation and DSK generation are explicitly out of scope for this plan** — they keep resolving settings via `ai_config` for now. They are natural candidates for their own `ai_roles` catalog rows later (an `event_cue` role and a `dsk_designer` role respectively — the latter is really already a fifth role in every way except being named one), but migrating them isn't required to ship Tracker/Describer/Assistant/Planner, and doing all six at once would be a much larger and riskier change than this plan needs to be. Flagging DSK generation here is itself useful evidence for the registry design: it shows a "role" already existing in practice, informally, before this framework existed to name it.

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

## Runtime Shape 2 — Assistant: Event-Driven Decisions, With a Safety Gate

This is the one role in the initial four whose default behavior must not be "AI autonomously does the thing." Firing a caption cue (today's `event_cue` ceiling) is reversible and low-stakes; switching what video feed is live on a real broadcast is not. This plan treats that difference as a hard requirement, not a nice-to-have.

**Trigger sources**, all in-process subscriptions (no network round-trip — Assistant runs in the same backend process as the emitters it listens to):
- `tracker_update` / `describer_update` from the manager above
- `transcript` from `SttManager` (already emitted today)
- direct user nudges — a lightweight `POST /roles/assistant/prompt { text }`, analogous to today's `POST /agent/context`

**Decision step:** on each trigger (rate-limited — see below), Assistant runs one LLM tool-use turn: a system prompt (`harness_config.systemPromptOverride` or a sensible built-in default) plus recent context (recent tracker/describer/STT/user entries, same shape as `AgentEngine.getContext()`), plus tool definitions built **dynamically per project** from that project's actual `prod_cameras`/`prod_mixers` rows, filtered to `harness_config.toolAllowlist` (itself a subset of the `assistant` catalog row's `available_tools`: `camera.preset`, `mixer.switch`). Regenerating the tool list from the live camera/mixer tables on every turn is cheap (two `SELECT`s) and guarantees the LLM never sees a stale device list.

**The safety gate — two modes, and a two-key turn to unlock the risky one:**

- **`mode: 'suggest'` (default, and the only mode a project starts in).** The LLM's chosen tool call is captured but **not executed**. It is recorded in a per-key pending-suggestions queue (in-memory, same shape as `AgentEngine`'s context window map) and emitted as an `assistant_suggestion` SSE event: `{ id, tool, args, reasoning, ts }`. A human confirms or dismisses it:
  ```
  GET    /roles/assistant/suggestions              — list pending suggestions for the session's key
  POST   /roles/assistant/suggestions/:id/confirm   — executes the suggested tool call now
  POST   /roles/assistant/suggestions/:id/reject    — discards it
  GET    /roles/assistant/events                    — SSE: assistant_suggestion, assistant_action
  ```
  (The confirm/reject UI itself — presumably a panel on the Production or Dashboard page — is out of scope for this plan; it is a frontend follow-up once the API exists.)
- **`mode: 'autonomous'`.** Requires **two independent fields both set**, not one toggle: `mode: 'autonomous'` *and* `autonomousConfirmed: true` in `harness_config`. This mirrors the `{ confirm: true }` pattern already used elsewhere in this codebase's plans for irreversible actions (see `plan_team_org_backend.md`'s `POST /orgs/:id/members/:userId/transfer-ownership`) — a project cannot slide into unattended camera control via a single flipped boolean or a copy-pasted config blob; the config UI should present `autonomousConfirmed` behind its own distinct confirmation dialog, not as a sibling checkbox next to `mode`. In this mode, the chosen tool call executes immediately (`registry.callPreset()` / `registry.switchSource()`, called in-process — see "Wiring" below), and `assistant_action` is emitted **after** execution, as an audit record, not a gate.

**Rate limiting** mirrors `CueEngine`'s existing `cooldown_ms` / `Map<ruleId, lastFiredTs>` pattern almost exactly: `harness_config.cooldownMs`, enforced per-project regardless of *which* tool the LLM picked (prevents an LLM from flapping between two cameras every few seconds even if each individual call looks reasonable in isolation). Unlike `CueEngine`'s cooldown (fully user-configurable, including to `0`), this plan recommends a **server-enforced floor** — e.g. never below 3000ms — applied in code regardless of the configured value, specifically for `mode: 'autonomous'`. Suggest mode is already self-limiting (a human has to act on each suggestion); autonomous mode is the one place a misconfigured `harness_config` could otherwise produce a genuinely disruptive live-broadcast failure mode, so the floor is not user-overridable.

**Wiring (composition root):** `lcyt-backend/src/server.js` already owns both `registry`/`bridgeManager` (from `initProductionControl()`) and, after this plan, the Assistant runtime (from `lcyt-agent`). It injects the former into the latter via a setter, exactly like the existing `cueEngine.setAgentEvaluateFn((apiKey, desc, opts) => agent.evaluateEventCue(apiKey, desc, opts))` line already does for event cues — no new dependency-injection pattern, no circular package imports between `lcyt-agent` and `lcyt-production`.

---

## Runtime Shape 3 — Planner: Request/Response, No New Persistence

`packages/lcyt-web/src/components/PlannerPage.jsx` is, today, 100% client-local: its draft is held in React state, persisted only to `localStorage` (`PLANNER_DRAFT_KEY`), and round-tripped through `serializePlan()`/`deserializePlan()` for file import/export. There is no backend rundown-storage table and this plan does not add one — per the task brief, a Planner-assist endpoint should work over "current plan context" passed in the request, not a persisted-plan feature, and that is exactly what already exists.

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

`PlannerPage.jsx` needs no response-shape changes at all — it already calls `deserializePlan(data.content)` to turn returned text into blocks (`caption`/`heading`/`audio-start`/`audio-stop`/`graphics`/`codes`/`stanza`/`empty-send`); only the URL and the merged generate/edit request shape change. **This formally supersedes and replaces `POST /agent/generate-rundown` / `POST /agent/edit-rundown`** (`plan_agent.md` Phase 6) — both should be removed, along with their two separate frontend call sites, as part of implementing this plan; keeping three routes doing the same job is not warranted given no back-compat requirement.

Because Planner has no continuous loop and never touches tools, it needs none of the start/stop/SSE machinery Tracker/Describer/Assistant get — just `POST /roles/planner/assist` plus the standard `GET/PUT /roles/planner/config`.

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
GET    /roles/assistant/suggestions             — pending suggestions (suggest mode)
POST   /roles/assistant/suggestions/:id/confirm | /reject
GET    /roles/assistant/events                  — SSE: assistant_suggestion, assistant_action

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
- Assistant: decision-loop manager, dynamic tool-definition builder from `prod_cameras`/`prod_mixers`, suggestion queue + confirm/reject routes, `server.js` wiring to `registry`/`bridgeManager` (medium-large — the safety-gate logic and its tests are the highest-scrutiny part of this whole plan).
- Planner: migrate `generateRundown`/`editRundown` onto `project_ai_role_configs`, add `POST /roles/planner/assist`, remove the two superseded routes + update `PlannerPage.jsx`'s two fetch call sites (small).
- Full test coverage: catalog seeding, config CRUD, each runtime's start/stop/status lifecycle, Assistant's suggest-vs-autonomous branching and cooldown floor enforcement (the highest-value tests in the plan), Planner generate-vs-edit branching.

No frontend UI is speced in detail here beyond the two `PlannerPage.jsx` call-site changes required by superseding its existing routes — a Tracker/Describer/Assistant control panel (status, live suggestions, confirm/reject) is real, separate follow-on work once this API surface exists, same caveat `plan_team_org_backend.md` makes for its own frontend.

---

## Open Questions (Not Punted — Genuinely Need Product Input)

1. **Describer's `structured_json` schema shape has no single right answer.** This plan recommends `harness_config.jsonSchema` be an arbitrary, project-supplied JSON schema (not one LCYT-wide fixed shape) — but what *default/starter* schema the config UI should offer new users is a product decision, not something inferable from the codebase.
2. **Vision provider priority order.** OpenAI (GPT-4o-style), Google (Gemini), and Anthropic (Claude) are all spec'd as initial adapter targets, but which ships first is a real product call — likely driven by which the operator/user already holds API keys for, or by per-frame cost at the expected polling frequency (see #4), neither of which is knowable from this codebase alone.
3. **Whether/how Tracker output should drive actual camera auto-framing.** The task brief mentions this as Tracker's "likely" downstream use, but this plan deliberately keeps Tracker non-action (see Runtime Shape 1) and doesn't spec an auto-framing consumer. Is that consumer itself a future Assistant behavior (Assistant subscribes to `tracker_update` and calls `camera.preset`, which the framework already supports unmodified), or a separate, non-AI feature (a literal PID-loop-style auto-framer)? Needs a product decision before that specific capability is built, though nothing in this plan blocks it either way.
4. **Default polling interval for Tracker/Describer's continuous loops.** `PreviewManager`'s existing default is 5s, chosen for thumbnail-freshness, not vision-API cost/latency tradeoffs. Once there's a real per-frame cost figure for the chosen initial provider(s), the sensible default interval could be very different from 5s. Not resolvable without live usage/cost data.
5. **Physical placement of the Tracker/Describer runtime code (`lcyt-agent` vs. `lcyt-rtmp`).** This plan recommends `lcyt-agent`, reasoning that it is explicitly meant to be the project's "central AI service" and that HTTP-polling `lcyt-rtmp`'s already-public preview/HLS endpoints is architecturally equivalent to `HlsSegmentFetcher`'s existing pattern either way. If there's a strong preference for co-locating with `lcyt-rtmp`'s existing ffmpeg/MediaMTX expertise instead (matching where the STT adapters live today), that's a one-line change to this plan's placement recommendation, not a redesign.
