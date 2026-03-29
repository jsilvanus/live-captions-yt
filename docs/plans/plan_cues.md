---
id: plan/cues
title: "Cue Engine Enhanced Capabilities"
status: in-progress
summary: "Cue engine with inline metacodes, auto-send, wildcards, next-cue-only modifiers, fuzzy/embedding matching, sound detection cues, semantic cues, AI event cues, and AI agent for video inference. Phases 1-7 implemented; Phase 8 planned."
related: plan/agent
---

# Cue Engine Enhanced Capabilities

**Status:** In progress
**Scope:** `packages/plugins/lcyt-cues`, `packages/plugins/lcyt-agent`, `packages/lcyt-web/src/lib/metacode-runtime.js`, `packages/lcyt-web/src/lib/metacode-parser.js`, `packages/lcyt-web/src/components/InputBar.jsx`, `packages/lcyt-web/src/components/AiSettingsPage.jsx`
**Related plans:** [AI Agent Plan](plan_agent.md) (lcyt-agent owns AI config, embeddings, LLM calls, and future features including SVG graphics AI and rundown generation)

---

## Current Status (Phase 1 — Implemented)

### Backend plugin: `packages/plugins/lcyt-cues/`

- **CueEngine** (`cue-engine.js`) — evaluates rules per caption, per API key. Supports `phrase` (substring), `regex`, and `section` match types. Per-rule cooldown enforcement. Caches rules with manual invalidation on CRUD.
- **Cue processor** (`cue-processor.js`) — strips `<!-- cue:label -->` metacodes from caption text, fires cue events, evaluates CueEngine automatic rules. Emits `cue_fired` SSE events.
- **CRUD routes** (`routes/cues.js`) — `GET/POST/PUT/DELETE /cues/rules`, `GET /cues/events`. Regex pattern validation on create/update.
- **DB** (`db.js`) — `cue_rules` and `cue_events` tables with indexes on `api_key`.

### Frontend cue matching

- **Parser** (`metacode-parser.js`) — `<!-- cue:phrase -->` extracted inline, stored in `lineCodes.cue`. All metacodes are inline markers.
- **Runtime** (`metacode-runtime.js`) — `buildCueMap()` builds phrase → line index map. `checkCueMatch()` tests caption text against cue phrases with glob-style wildcard support (`*` matches any characters).
- **InputBar** (`InputBar.jsx`) — After sending a caption, checks if text matches any cue phrase. On match: jumps pointer to cue line and auto-sends its content. Also listens for backend `cue_fired` SSE events (STT). Dedup guard prevents double-firing.
- **useSession** — `cue_fired` in `PLUGIN_SSE_EVENTS`.

### Current matching capabilities

| Feature | Status | Notes |
|---|---|---|
| Exact substring match | ✅ | Case-insensitive, `cue:Amen` matches text containing "amen" |
| Glob wildcard `*` | ✅ | `cue:Let us *` matches "Let us pray", "Let us go" |
| Auto-send on match | ✅ | Pointer jumps to cue line, content is auto-sent |
| Backend SSE events | ✅ | `cue_fired` events from CueEngine reach frontend |
| Regex rules (API) | ✅ | Via CRUD `/cues/rules` (backend-only, not inline metacode) |

### Current limitations

1. **Any cue can fire** — all cues in the file are eligible regardless of pointer position. In practice, a cue at line 5 can fire even if the pointer is at line 50.
2. **No directionality** — no forward-only or backward-capable modifiers.
3. **Exact text only** — no fuzzy/approximate matching for spoken language variations.
4. **No music-state awareness** — cues cannot trigger based on music detection states.

---

## Phase 2 — Next-Cue-Only Firing with Modifiers (Implemented)

### Motivation

In a live rundown, cues should fire in order. If the pointer is at "O Lord hear us" (line 5), and the next two cues are `we beseech` (line 6) and `send us your mercy` (line 7), only the next cue (`we beseech`) should be eligible to fire. This prevents out-of-order jumps when the speaker says something that matches a later cue.

### Cue modifier syntax

Three modes, indicated by optional asterisks in the metacode key:

| Syntax | Mode | Behavior |
|---|---|---|
| `<!-- cue:phrase -->` | **next** (default) | Only fires if this is the next cue after the current pointer |
| `<!-- cue*:phrase -->` | **skip** | Can skip forward past other cues to reach this one |
| `<!-- cue**:phrase -->` | **any** | Can fire from any position, including backwards |

### Examples

```
Welcome everyone                              ← pointer is here
<!-- cue:we beseech -->We beseech thee        ← next cue (fires normally)
<!-- cue:send us your mercy -->Have mercy      ← would NOT fire (not the next cue)
<!-- cue*:amen -->Let us close                 ← WOULD fire (skip mode — can skip past others)
<!-- cue**:hallelujah -->Praise God            ← WOULD fire from anywhere (any mode)
```

After `we beseech` fires and the pointer advances past it, `send us your mercy` becomes the next cue and is now eligible.

### Wildcard phrases still work

The `*` in the phrase value (for glob matching) is separate from the `*` modifier in the metacode key:

```
<!-- cue*:Let us * -->   ← skip mode + glob wildcard in phrase
<!-- cue:*amen* -->      ← next mode + glob wildcard in phrase
```

### Implementation

1. **Parser** — `CUE_META_RE` updated to capture optional `*`/`**` after `cue` keyword. Stores `lineCodes.cue` (phrase) and `lineCodes.cueMode` (`'next'`, `'skip'`, or `'any'`).
2. **Runtime `buildCueMap()`** — stores `{ index, mode }` per phrase instead of just index.
3. **Runtime `checkCueMatch()`** — new `pointer` parameter. Filters cues based on mode:
   - `next`: only matches if the cue index is the smallest cue index > pointer
   - `skip`: matches any cue index > pointer
   - `any`: matches regardless of pointer position
4. **InputBar** — passes `file.pointer` to `checkCueMatch()`.

### Data structures

```js
// buildCueMap returns:
Map<phrase, { index: number, mode: 'next' | 'skip' | 'any' }>

// checkCueMatch signature:
checkCueMatch(cueMap, text, pointer) → { phrase, index } | null
```

---

## Phase 3 — Fuzzy / Embedding-Based Matching (Implemented)

### Motivation

Live speech (especially via STT) introduces variations: "we beseech thee" vs "we beseech you", "amen" vs "ah men", "hallelujah" vs "alleluia". Exact substring matching misses these. Fuzzy matching catches near-misses.

### Implementation

Three tiers of fuzzy matching have been implemented:

#### Tier 1: Jaro-Winkler (Built-in, No Dependencies)

Word-level Jaro-Winkler string similarity is available on both frontend and backend with zero external dependencies. This catches spelling variations and STT artifacts.

**Frontend** (`metacode-runtime.js`):
- `jaroWinkler(s1, s2)` — character-level Jaro-Winkler similarity (0-1)
- `fuzzyWordMatch(pattern, text)` — slides a window of pattern words over text words, returns best average Jaro-Winkler score
- `checkCueMatch()` — uses `fuzzyWordMatch` when a cue has `fuzzy: true` flag

**Backend** (`cue-engine.js`):
- Same `jaroWinkler()` and `fuzzyWordMatch()` functions
- `match_type: 'fuzzy'` rule type in CueEngine with configurable `fuzzy_threshold`
- Rules created via CRUD API `POST /cues/rules`

#### Tier 2: Embedding-Based Semantic Matching (API-Backed)

Embedding similarity via OpenAI-compatible APIs. Computes text embeddings and uses cosine similarity to match semantically related phrases.

**Backend** (`packages/lcyt-backend/src/ai/`):
- `computeEmbeddings(texts, opts)` — calls OpenAI-compatible `/v1/embeddings` endpoint
- `cosineSimilarity(a, b)` — cosine similarity between embedding vectors
- CueEngine wired with `setEmbeddingFn()` and `setAiConfigFn()` for per-key embedding config

**Configuration** (`/ai/config` routes):
- `GET /ai/config` — get per-key AI configuration
- `PUT /ai/config` — update embedding provider, model, API key, threshold
- `GET /ai/status` — server capability info (is server embedding available?)

#### Tier 3: Server-Level Embedding (Admin-Configured)

Server administrators can configure a default embedding API via environment variables. Users can then select "Server-provided" as their embedding provider.

**Environment variables:**
| Variable | Purpose | Default |
|---|---|---|
| `EMBEDDING_API_URL` | Base URL for embedding API | `https://api.openai.com` |
| `EMBEDDING_API_KEY` | API key for the embedding provider | none |
| `EMBEDDING_MODEL` | Model name | `text-embedding-3-small` |

### Metacode syntax: `cue~:` (Fuzzy Cue)

The tilde modifier `~` enables fuzzy matching for inline cue metacodes:

```
<!-- cue~:we beseech thee -->Lord, hear us    ← fuzzy match: catches "we beseech you", "we bseech thee"
<!-- cue*~:amen -->Let us close               ← skip mode + fuzzy
<!-- cue**~:hallelujah -->Praise God          ← any mode + fuzzy
```

### Model configuration modes

| Mode | Config field | How it works |
|---|---|---|
| **None** | `embeddingProvider: 'none'` | AI features disabled (default) |
| **Server** | `embeddingProvider: 'server'` | Uses server-level env var API key; no user key needed |
| **OpenAI** | `embeddingProvider: 'openai'` | User provides their own OpenAI API key |
| **Custom** | `embeddingProvider: 'custom'` | User provides any OpenAI-compatible API URL + key |
| **Ollama** | *(future)* | Local embedding model via Ollama — planned |

### AI Settings page

`/ai` sidebar route — configuration UI for embedding provider selection, API key entry, model selection, and fuzzy threshold slider. Shows server status indicator and Ollama future feature placeholder.

### DB additions

- `ai_config` table — per-API-key embedding config (`embedding_provider`, `embedding_model`, `embedding_api_key`, `embedding_api_url`, `fuzzy_threshold`)
- `cue_rules.fuzzy_threshold` column — per-rule threshold for fuzzy match type

### Tests

- **Backend**: 8 embedding utility tests (cosine similarity, server availability), 4 fuzzy match type tests in CueEngine, 7 jaroWinkler backend tests, 7 fuzzyWordMatch backend tests, 8 AI config DB tests
- **Frontend**: 4 jaroWinkler tests, 5 fuzzyWordMatch tests, 4 checkCueMatch fuzzy tests, 5 parser fuzzy cue tests

---

## Phase 4 — Sound Detection Cue Triggers (Implemented)

### Motivation

Cues should fire based on audio analysis states from `lcyt-music`. Use cases:
- When music starts → show lyrics overlay / switch to lyrics file
- When music stops → switch back to speech rundown
- When silence persists for a minimum time → advance to next section

### Cue rule match types for sound

| Match type | Pattern | Fires when |
|---|---|---|
| `music_start` | — | Sound label transitions from non-music to `music` |
| `music_stop` | — | Sound label transitions from `music` to `speech`/`silence` |
| `silence` | `5` (seconds) | Silence persists for at least the specified duration |

### Silence cue behavior

When a silence cue rule is configured with a minimum time (e.g. 5 seconds):
1. When `silence` label is detected, a timer starts
2. If silence persists for the configured duration, the cue fires
3. If the silence is broken (label changes to `speech` or `music`), the timer is cancelled
4. This prevents false positives from brief pauses

### Integration with `lcyt-music`

`createSoundCueListener()` subscribes to `sound_label` events on each session emitter and evaluates music/silence cue rules:

```js
import { createSoundCueListener } from 'lcyt-cues';
createSoundCueListener({ store, engine: cueEngine });
```

### Implementation

- [x] Add `music_start`, `music_stop`, `silence` match types to CueEngine
- [x] `evaluateSoundEvent()` method with silence timer logic
- [x] `createSoundCueListener()` wires session emitters to the engine
- [x] `clearSilenceTimers()` for graceful shutdown cleanup
- [x] Tests for sound detection cue rules

---

## Phase 5 — Semantic Embedding Cues (Implemented)

### Motivation

Some cue phrases require semantic understanding beyond string similarity. Embedding-based matching uses vector similarity to catch paraphrases and related concepts.

### Metacode syntax: `cue[semantic]:`

```
<!-- cue[semantic]:prayer for healing -->Response text
<!-- cue*[semantic]:closing remarks -->Goodbye
<!-- cue**[semantic]:invitation -->Come forward
```

### Implementation

- [x] Parser supports `cue[semantic]:` with mode modifiers
- [x] Frontend `checkCueMatch()` skips semantic cues (they fire only via backend SSE)
- [x] `buildCueMap()` includes `semantic` flag
- [x] Backend CueEngine can evaluate semantic rules via embedding API

---

## Phase 6 — AI Agent: Video/Image Inference (`lcyt-agent` Plugin) (In Progress)

### Motivation

A vision-capable LLM can describe what is happening on screen by analysing preview JPEGs or video frames. This enables:
- Automated scene descriptions for accessibility
- Visual event detection (speaker stands up, slides change, etc.)
- Content-aware cue triggers based on what is seen, not just heard

### Plugin: `packages/plugins/lcyt-agent/`

The **AI Agent** is the central AI service for LCYT. It owns:
- **AI configuration** — embedding provider, model, API keys per user (`ai_config` DB table)
- **Embedding computation** — via OpenAI-compatible `/v1/embeddings` APIs
- **Context window management** — STT transcripts + `<!-- explanation:... -->` metacodes
- **Video/image inference** (planned) — vision-capable LLM analysis of preview frames

Other plugins (e.g. `lcyt-cues` CueEngine) delegate embedding calls to the Agent.

**Components:**
- `AgentEngine` — AI config access, embedding computation, context window, image analysis stubs, event evaluation stubs
- `ai-config.js` — per-API-key AI model settings DB helpers (migrated from `lcyt-backend/src/ai/config.js`)
- `embeddings.js` — OpenAI-compatible embedding API client (migrated from `lcyt-backend/src/ai/embeddings.js`)
- `routes/ai.js` — AI configuration routes (`GET/PUT /ai/config`, `GET /ai/status`)
- `routes/agent.js` — Agent routes (`/agent/status`, `/agent/context`, `/agent/events`)
- `db.js` — `agent_events` and `agent_context` table migrations

### Integration in `server.js`

```js
import { initAgent, createAgentRouter, createAiRouter } from 'lcyt-agent';

const { agent } = await initAgent(db);
// Wire embedding fn into CueEngine:
cueEngine.setEmbeddingFn(computeEmbeddings);
cueEngine.setAiConfigFn((apiKey) => agent.getAiConfig(apiKey));

app.use('/agent', createAgentRouter(db, auth, agent));
app.use('/ai', createAiRouter(db, auth));
```

### Backward compatibility

`packages/lcyt-backend/src/ai/index.js` re-exports from `lcyt-agent` so existing imports continue to work.

### Preview image inference

The backend already provides `GET /preview/:key/incoming.jpg` (RTMP → JPEG thumbnails).
The agent can periodically fetch and analyse these frames:

```
Preview JPEG → Vision LLM → Scene description → SSE event
```

### Video stream inference (future)

For real-time analysis, the agent could process video segments directly:
- Use HLS segments from `GET /stream-hls/:key/*`
- Extract keyframes from fMP4 segments
- Send frames to vision LLM for analysis
- Emit `scene_description` SSE events

### Context enrichment: `<!-- explanation:... -->`

The `explanation` metacode provides human-authored context to help the AI understand what is happening:

```
<!-- explanation: The pastor is beginning the offertory prayer -->
Let us bring our offerings to the Lord
```

The `explanation` text is stored as a persistent lineCodes entry and fed into the agent's context window alongside STT transcripts and visual analysis.

### Implementation plan

- [x] Plugin scaffolding (`lcyt-agent`)
- [x] `AgentEngine` with context window management
- [x] DB migrations and event storage
- [x] REST API routes (`/agent/status`, `/agent/context`, `/agent/events`)
- [x] AI config migrated from `lcyt-backend/src/ai/` into agent plugin
- [x] AgentEngine owns `getAiConfig()`, `computeEmbeddings()`, `cosineSimilarity()`
- [x] AI configuration routes (`/ai/config`, `/ai/status`) moved to agent plugin
- [x] Backward-compatible re-exports in `lcyt-backend/src/ai/index.js`
- [x] Agent wired into `server.js` with routes mounted
- [ ] Wire preview JPEG fetching on interval
- [ ] Vision LLM integration (OpenAI GPT-4o, Claude, etc.)
- [ ] Scene description SSE event emission
- [ ] Video segment keyframe extraction

---

## Phase 7 — AI Event Cues: `cue[events]:` (Implemented)

### Motivation

Instead of matching specific phrases, event cues describe what should happen:
- `<!-- cue[events]:the speaker invites the congregation to stand -->` → fires when the AI determines this event occurred
- `<!-- cue[events]:applause begins -->` → fires when audio + visual analysis indicates applause

### Metacode syntax

```
<!-- cue[events]:the speaker stands up -->Next section
<!-- cue*[events]:slides change to a new topic -->New topic
<!-- cue**[events]:congregation begins singing -->Switch to lyrics
```

### How it works

1. The agent continuously monitors:
   - STT transcripts (what is being said)
   - Preview frames (what is being shown — Phase 6+)
   - `<!-- explanation:... -->` context (what the operator told us)
   - Sound labels (music, speech, silence)
2. For each `cue[events]:description`, the agent asks the LLM:
   "Given the current context, has this event occurred: [description]?"
3. If the LLM responds affirmatively with sufficient confidence, the cue fires.

### Implementation

- [x] Parser support for `cue[events]:` metacode (alongside `cue[semantic]:`)
- [x] Frontend `checkCueMatch` skips event cues (they fire only via backend SSE)
- [x] `buildCueMap` includes `events` flag
- [x] CaptionView indicator for `cue[events]:` lines (🔔 icon)
- [x] `AgentEngine.evaluateEventCue()` LLM integration via chat completions API
- [x] `CueEngine.evaluateEventCues()` async method for `event_cue` match type rules
- [x] `CueProcessor` triggers async event cue evaluation on every caption
- [x] `cue_fired` SSE events with `source: 'event_cue'` reach the frontend
- [x] Confidence threshold configuration (default 0.7)
- [x] Server.js wiring: agent evaluate fn → CueEngine
- [x] Tests: parser (6 tests), runtime (4 tests), CueEngine (5 tests), AgentEngine (5 tests)

### Rate limiting and cost control

- Per-rule cooldown (`cooldown_ms`) prevents rapid repeated LLM calls
- Agent falls back gracefully when no AI config or empty context
- Low temperature (0.1) and max_tokens (200) limit API costs
- Only `event_cue` rules trigger LLM calls — other match types are unaffected

---

## Phase 8 — Multi-Modal Scene Understanding (Planned)

### Motivation

Combine all available signals for comprehensive scene understanding:
- Audio analysis (music, speech, silence, BPM)
- Video analysis (preview frames, keyframes)
- STT transcripts
- Operator context (`<!-- explanation:... -->`)

### Capabilities

- **Continuous narration**: the agent provides a running description of the scene
- **Intelligent section detection**: automatically detect section changes based on visual + audio cues
- **Content moderation**: flag inappropriate content in real-time
- **Automated graphics**: suggest DSK overlay changes based on content

### Implementation plan

- [ ] Multi-signal aggregation in AgentEngine
- [ ] Streaming LLM analysis with context window
- [ ] Scene transition detection algorithm
- [ ] Integration with DSK graphics system
- [ ] Content moderation pipeline

---

## Phase Summary

| Phase | Description | Status | Dependencies |
|---|---|---|---|
| 1 | Basic cue engine: inline metacodes, auto-send, wildcards | ✅ Implemented | — |
| 2 | Next-cue-only firing with `*`/`**` modifiers | ✅ Implemented | Phase 1 |
| 3 | Fuzzy / embedding-based matching, AI config page | ✅ Implemented | Phase 2 |
| 4 | Sound detection cue triggers (music/silence) | ✅ Implemented | Phase 2, `lcyt-music` |
| 5 | Semantic embedding cues (`cue[semantic]:`) | ✅ Implemented | Phase 3 |
| 6 | AI Agent: AI config + embeddings + video/image inference (`lcyt-agent`) | 🔧 In Progress | AI config |
| 7 | AI Event cues (`cue[events]:description`) | ✅ Implemented | Phase 6, `lcyt-agent` |
| 8 | Multi-modal scene understanding | 📋 Planned | Phase 6, Phase 7 |

> **See also:** [AI Agent Plan](plan_agent.md) for additional agent phases including SVG graphics AI (Phase 5) and AI-assisted rundown creation (Phase 6).
