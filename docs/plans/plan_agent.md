---
id: plan/agent
title: "AI Agent Capabilities (lcyt-agent)"
status: in-progress
summary: "AI Agent plugin for video/image inference, LLM-driven scene description, AI event cues, embedding-based matching, SVG graphics AI creation, and AI-assisted rundown generation. Provides the central AI service for LCYT."
related: plan/cues
---

# AI Agent Capabilities (lcyt-agent)

**Status:** In progress
**Plugin:** `packages/plugins/lcyt-agent/`
**Related plans:** [Cue Engine Plan](plan_cues.md) (Phases 5-8 depend on the agent)

---

## Overview

The `lcyt-agent` plugin is the **central AI service** for LCYT. It provides:

- AI configuration management (per-user embedding/LLM provider settings)
- Text embedding computation (OpenAI-compatible APIs)
- Context window management (STT transcripts, explanations, scene descriptions)
- Event cue evaluation via LLM chat completions
- Video/image inference via vision-capable LLMs (planned)
- SVG graphics AI creation and editing (planned)
- AI-assisted rundown generation for the planner (planned)

Other plugins (e.g. `lcyt-cues` CueEngine) delegate AI calls to the agent rather than calling APIs directly.

---

## Current Status

### Phase 1 — AI Configuration & Embeddings (Implemented)

**AI config DB** (`ai_config` table) — per-API-key settings for:
- Embedding provider: `none`, `server`, `openai`, `custom`
- Embedding model, API key, API URL
- Fuzzy threshold for cue matching

**Embedding computation** — OpenAI-compatible `/v1/embeddings` API calls with support for:
- Server-level defaults (env vars: `EMBEDDING_API_URL`, `EMBEDDING_API_KEY`, `EMBEDDING_MODEL`)
- Per-user OpenAI keys
- Custom embedding endpoints (LocalAI, Ollama, LiteLLM)

**Routes:**
- `GET /ai/config` — get per-key AI configuration (masked API key)
- `PUT /ai/config` — update embedding provider, model, API key, threshold
- `GET /ai/status` — server capability info (is server embedding available?)

### Phase 2 — Context Window & Agent Engine (Implemented)

**AgentEngine** manages per-API-key context windows:
- `addContext(apiKey, type, text)` — add transcript, explanation, scene, event entries
- `getContext(apiKey)` — retrieve recent context (max 50 entries, configurable)
- `clearContext(apiKey)` — clear context for a key

**Routes:**
- `GET /agent/status` — capabilities and config state
- `GET /agent/context` — current context window
- `POST /agent/context` — add a context entry manually
- `DELETE /agent/context` — clear context window
- `GET /agent/events` — recent agent events

### Phase 3 — Event Cue Evaluation via LLM (Implemented)

**`evaluateEventCue(apiKey, description, opts)`** — uses LLM chat completions to determine if a described event has occurred based on the context window.

- Builds system + user prompts from context window entries
- Calls OpenAI-compatible `/v1/chat/completions` endpoint
- Parses structured JSON response (`{ matched, confidence, reasoning }`)
- Respects configurable confidence threshold (default 0.7)
- Falls back gracefully when no AI config or context is available

**Integration with CueEngine:**
```js
cueEngine.setAgentEvaluateFn((apiKey, desc, opts) => agent.evaluateEventCue(apiKey, desc, opts));
```

Event cue rules (`match_type: 'event_cue'`) are evaluated asynchronously. Results arrive via `cue_fired` SSE events with `source: 'event_cue'`.

---

## Phase 4 — Video/Image Inference (Superseded by `plan_ai_roles_framework.md`'s Tracker/Describer roles)

This phase's MVP scope (preview-JPEG polling → vision LLM → SSE event) is now implemented, but as `plan_ai_roles_framework.md`'s Tracker and Describer roles rather than as a bare `analyseImage()` method on `AgentEngine` — that stub is superseded, not filled in. See that plan's Runtime Shape 1 for the actual implementation: `VisionFrameFetcher` (polls `GET /preview/:key/incoming`), `VisionRoleManager` (one manager parameterized by role), and `vision-adapters/{openai,google,anthropic}-vision.js`. `tracker_update`/`describer_update` SSE events replace the `scene_description` event this phase originally sketched.

Video-segment/HLS-keyframe inference (this phase's "Video stream inference" idea, for lower latency or clip-based description) remains unimplemented — the JPEG-polling MVP is what shipped, matching that plan's own scoping ("a strict subset of the eventual richer source").

---

## Phase 5 — AI SVG Graphics Creator (Implemented)

### Motivation

The DSK graphics editor currently requires manual creation of SVG overlays and template layers. An AI-powered creator allows operators to describe what they want and have the AI generate or edit DSK graphics templates.

### Capabilities

- **Create from prompt**: "Create a lower-third with the speaker's name and title" → generates template JSON with `text`, `rect`, and `image` layers
- **Edit by prompt**: "Make the background darker" or "Move the logo to the top-right" → modifies existing template JSON
- **Style suggestions**: Given a template, suggest colour schemes, font pairings, and layout improvements
- Layer id normalisation and schema validation ensure safe, editor-compatible output

### Integration points

- DSK template JSON shape (layers: text, rect, ellipse, image)
- Template CRUD routes (`/dsk/:apikey/templates`)
- DSK editor page (`/graphics/editor`) — collapsible "✨ AI Assist" panel in the Properties sidebar

### Implementation plan

- [x] `generateTemplate(apiKey, prompt, opts)` method on AgentEngine
- [x] `editTemplate(apiKey, template, prompt, opts)` method on AgentEngine
- [x] `suggestStyles(apiKey, template, opts)` method on AgentEngine
- [x] REST route: `POST /agent/generate-template` → returns template JSON
- [x] REST route: `POST /agent/edit-template` → returns modified template JSON
- [x] REST route: `POST /agent/suggest-styles` → returns style suggestion array
- [x] Frontend integration in DskEditorPage — collapsible "✨ AI Assist" panel with Generate / Edit / Styles buttons
- [x] DSK template layer generation via LLM structured output with schema validation
- [x] Style and colour suggestion endpoint

### Routes added

```
POST /agent/generate-template   { prompt, width?, height? }  → { ok, template }
POST /agent/edit-template       { template, prompt }         → { ok, template }
POST /agent/suggest-styles      { template }                 → { ok, suggestions }
```

All routes require session JWT Bearer authentication and return `503` when no AI provider is configured.

---

## Phase 6 — AI-Assisted Rundown Creation (Implemented)

### Motivation

The planner page currently requires manual creation of rundown files with metacodes. An AI assistant can generate or modify rundowns from natural language instructions.

### Capabilities

- **Create rundown from prompt**: "Create a church service rundown with opening prayer, readings, sermon, and closing" → generates rundown file with sections, cues, and timers
- **Edit by prompt**: "Add a 5-second silence cue before the sermon" or "Insert a music cue after the offering" → modifies existing rundown
- **Smart metacode insertion**: AI understands the full LCYT metacode syntax and inserts appropriate `<!-- section: -->`, `<!-- cue: -->`, `<!-- explanation: -->`, `<!-- graphics: -->`, etc.
- **Template library**: Built-in rundown templates for: church service, concert, conference, sports

### Integration points

- Rundown file format (metacode-annotated text)
- Planner page (`/planner`) — collapsible "✨ AI Assist" panel with template selector
- Session Bearer JWT required for agent calls

### Implementation plan

- [x] `generateRundown(apiSettings, prompt, opts)` method on AgentEngine
- [x] `editRundown(apiSettings, content, prompt, opts)` method on AgentEngine
- [x] `AgentEngine.RUNDOWN_METACODE_REFERENCE` — metacode syntax reference injected into all prompts
- [x] `AgentEngine.RUNDOWN_TEMPLATE_LIBRARY` — built-in templates (church_service, concert, conference, sports)
- [x] REST route: `POST /roles/planner/assist` → generates or edits rundown text
- [x] Frontend integration in PlannerPage — collapsible "✨ AI Assist" panel with template dropdown, prompt input, Generate and Edit buttons
- [x] Metacode-aware prompt engineering (full syntax reference in every prompt)
- [x] Template library with common event structures

### Routes (migrated to `plan_ai_roles_framework.md`'s Planner role)

`POST /agent/generate-rundown` / `POST /agent/edit-rundown` (below) are **removed** — superseded by one merged route, `POST /roles/planner/assist`, which resolves its model/provider through `project_ai_role_configs` + the `ai_providers` registry instead of `ai_config` (`generateRundown`/`editRundown` now take an already-resolved `apiSettings` object rather than an `apiKey` to look up internally):

```
POST /roles/planner/assist   { currentPlan?, goal, templateId? }   → { ok, content }
```

`currentPlan` omitted/empty generates from scratch; present, edits it per `goal`. Requires session JWT Bearer auth and a real, enabled `project_ai_role_configs` row for the `planner` role.

---

## Phase 7 — Multi-Modal Scene Understanding (Planned)

### Motivation

Combine all available signals for comprehensive scene understanding:
- Audio analysis (music, speech, silence, BPM from `lcyt-music`)
- Video analysis (preview frames, keyframes)
- STT transcripts
- Operator context (`<!-- explanation:... -->`)

### Capabilities

- **Continuous narration**: running description of the scene for accessibility
- **Intelligent section detection**: automatically detect section changes based on visual + audio cues
- **Content moderation**: flag inappropriate content in real-time
- **Automated graphics**: suggest DSK overlay changes based on content
- **Multi-signal aggregation**: combine audio labels, visual analysis, and STT for holistic understanding

### Implementation plan

- [ ] Multi-signal aggregation in AgentEngine
- [ ] Streaming LLM analysis with context window
- [ ] Scene transition detection algorithm
- [ ] Integration with DSK graphics system
- [ ] Content moderation pipeline
- [ ] Automated caption enhancement based on scene context

---

## Phase 8 — Local Model Support (Superseded by `plan_ai_model_registry.md`)

This phase was a one-paragraph stub written before local-model support had a real design. It's superseded in full by **`plan_ai_model_registry.md`**, which specifies an `ai_providers`/`ai_provider_models` registry (site- and project-scoped), real Ollama auto-discovery via `GET /api/tags`, support for multiple simultaneous Ollama instances, and — for the user's actual deployment shape — Ollama instances reachable only through a specific `lcyt-bridge` instance's LAN rather than the backend's, including a Dockerized bridge+Ollama deployment mode. See that plan for the current implementation phases.

---

## Model Configuration Modes

| Mode | Config field | How it works |
|---|---|---|
| **None** | `embeddingProvider: 'none'` | AI features disabled (default) |
| **Server** | `embeddingProvider: 'server'` | Uses server-configured API key; no user key needed |
| **OpenAI** | `embeddingProvider: 'openai'` | User provides their own OpenAI API key |
| **Custom** | `embeddingProvider: 'custom'` | User provides any OpenAI-compatible API URL + key |
| **Ollama** | *(superseded — see `plan_ai_model_registry.md`)* | Local embedding/LLM model via Ollama, via that plan's `ai_providers` registry rather than an `embeddingProvider` value |

---

## Phase Summary

| Phase | Description | Status | Dependencies |
|---|---|---|---|
| 1 | AI Configuration & Embeddings | ✅ Implemented | — |
| 2 | Context Window & Agent Engine | ✅ Implemented | Phase 1 |
| 3 | Event Cue Evaluation via LLM | ✅ Implemented | Phase 2, `lcyt-cues` |
| 4 | Video/Image Inference | ➡️ Superseded by `plan_ai_roles_framework.md` (Tracker/Describer) | Phase 2 |
| 5 | AI DSK Template Generation | ✅ Implemented | Phase 2, `lcyt-dsk` |
| 6 | AI-Assisted Rundown Creation | ✅ Implemented (migrated to `POST /roles/planner/assist`) | Phase 2, Planner |
| 7 | Multi-Modal Scene Understanding | 📋 Planned | Phase 4, `lcyt-music` |
| 8 | Local Model Support (Ollama) | ➡️ Superseded by `plan_ai_model_registry.md` | Phase 1 |

---

## Environment Variables

| Variable | Purpose | Default |
|---|---|---|
| `EMBEDDING_API_URL` | Base URL for embedding API | `https://api.openai.com` |
| `EMBEDDING_API_KEY` | API key for the embedding provider | none |
| `EMBEDDING_MODEL` | Model name | `text-embedding-3-small` |

---

## Test Coverage

- 16+ AgentEngine tests (context window, AI config, cosine similarity, event cue evaluation)
- Agent DB helper tests (event insert/retrieve, migrations)
- AI config DB tests
- Phase 5 & 6 fallback tests: `generateTemplate`, `editTemplate`, `suggestStyles` (no AI config/`provider: none`); `generateRundown`/`editRundown` (null/no-apiKey `apiSettings`, since Planner now resolves settings itself — see `routes/planner.js`)
- `_callChatCompletion` opts forwarding test (temperature + maxTokens)
- Phase 4's superseding implementation (Tracker/Describer) and Phase 6's route migration have their own test suites under `packages/plugins/lcyt-agent/test/` — see that package's `CLAUDE.md` for the full current list.
