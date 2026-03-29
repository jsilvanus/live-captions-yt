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

## Phase 4 — Video/Image Inference (Planned)

### Motivation

A vision-capable LLM can describe what is happening on screen by analysing preview JPEGs or video frames. This enables automated scene descriptions and visual event detection.

### Preview image inference

The backend already provides `GET /preview/:key/incoming.jpg` (RTMP → JPEG thumbnails). The agent can periodically fetch and analyse these frames:

```
Preview JPEG → Vision LLM → Scene description → SSE event
```

### Video stream inference

For real-time analysis, the agent could process video segments directly:
- Use HLS segments from `GET /stream-hls/:key/*`
- Extract keyframes from fMP4 segments
- Send frames to vision LLM for analysis
- Emit `scene_description` SSE events

### Implementation plan

- [ ] `analyseImage()` — wire to OpenAI GPT-4o or compatible vision API
- [ ] Periodic preview frame analysis on configurable interval
- [ ] Scene description SSE event emission
- [ ] Video segment keyframe extraction
- [ ] Vision model configuration (model selection, provider)

---

## Phase 5 — AI SVG Graphics Creator (Planned)

### Motivation

The DSK graphics editor currently requires manual creation of SVG overlays and template layers. An AI-powered creator would allow operators to describe what they want and have the AI generate or edit SVG graphics.

### Capabilities

- **Create from prompt**: "Create a lower-third with the speaker's name and title" → generates SVG template layers
- **Edit by prompt**: "Make the background darker" or "Move the logo to the top-right" → modifies existing template JSON
- **Style suggestions**: Given a template, suggest colour schemes, font pairings, and layout improvements
- **Asset generation**: Generate simple SVG shapes, icons, and decorative elements on demand

### Integration points

- DSK template JSON shape (layers: text, rect, image)
- Template CRUD routes (`/dsk/:apikey/templates`)
- DSK editor page (`/graphics/editor`)

### Implementation plan

- [ ] `generateTemplate(prompt, opts)` method on AgentEngine
- [ ] `editTemplate(template, prompt, opts)` method on AgentEngine
- [ ] REST route: `POST /agent/generate-template` → returns template JSON
- [ ] REST route: `POST /agent/edit-template` → returns modified template JSON
- [ ] Frontend integration in DskEditorPage — "AI Assist" button/panel
- [ ] SVG layer generation via LLM structured output
- [ ] Style and colour suggestion endpoint

---

## Phase 6 — AI-Assisted Rundown Creation (Planned)

### Motivation

The planner page currently requires manual creation of rundown files with metacodes. An AI assistant could generate or modify rundowns from natural language instructions.

### Capabilities

- **Create rundown from prompt**: "Create a church service rundown with opening prayer, readings, sermon, and closing" → generates rundown file with sections, cues, and timers
- **Edit by prompt**: "Add a 5-second silence cue before the sermon" or "Insert a music cue after the offering" → modifies existing rundown
- **Smart metacode insertion**: AI understands the metacode syntax and inserts appropriate `<!-- section: -->`, `<!-- cue: -->`, `<!-- timer: -->`, `<!-- explanation: -->` markers
- **Template library**: Pre-built rundown templates for common event types

### Integration points

- Rundown file format (metacode-annotated text)
- Planner page (`/planner`)
- File store (`useFileStore` hook)

### Implementation plan

- [ ] `generateRundown(prompt, opts)` method on AgentEngine
- [ ] `editRundown(content, prompt, opts)` method on AgentEngine
- [ ] REST route: `POST /agent/generate-rundown` → returns rundown text
- [ ] REST route: `POST /agent/edit-rundown` → returns modified text
- [ ] Frontend integration in PlannerPage — "AI Assist" input
- [ ] Metacode-aware prompt engineering (teach LLM the syntax)
- [ ] Template library with common event structures

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

## Phase 8 — Local Model Support (Planned)

### Motivation

Some deployments may not want to use cloud APIs for privacy or cost reasons. Local models via Ollama or similar runtimes provide an alternative.

### Implementation plan

- [ ] Ollama embedding endpoint integration
- [ ] Local LLM chat completion via Ollama
- [ ] Auto-detection of running Ollama instance
- [ ] Model download and management UI
- [ ] Performance optimisation for local inference

---

## Model Configuration Modes

| Mode | Config field | How it works |
|---|---|---|
| **None** | `embeddingProvider: 'none'` | AI features disabled (default) |
| **Server** | `embeddingProvider: 'server'` | Uses server-configured API key; no user key needed |
| **OpenAI** | `embeddingProvider: 'openai'` | User provides their own OpenAI API key |
| **Custom** | `embeddingProvider: 'custom'` | User provides any OpenAI-compatible API URL + key |
| **Ollama** | *(Phase 8)* | Local embedding/LLM model via Ollama |

---

## Phase Summary

| Phase | Description | Status | Dependencies |
|---|---|---|---|
| 1 | AI Configuration & Embeddings | ✅ Implemented | — |
| 2 | Context Window & Agent Engine | ✅ Implemented | Phase 1 |
| 3 | Event Cue Evaluation via LLM | ✅ Implemented | Phase 2, `lcyt-cues` |
| 4 | Video/Image Inference | 📋 Planned | Phase 2 |
| 5 | AI SVG Graphics Creator | 📋 Planned | Phase 2, `lcyt-dsk` |
| 6 | AI-Assisted Rundown Creation | 📋 Planned | Phase 2, Planner |
| 7 | Multi-Modal Scene Understanding | 📋 Planned | Phase 4, `lcyt-music` |
| 8 | Local Model Support (Ollama) | 📋 Planned | Phase 1 |

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
