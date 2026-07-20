---
id: plan/cues
title: "Cue Engine Enhanced Capabilities"
status: implemented
summary: "Cue engine with inline metacodes, auto-send, wildcards, next-cue-only modifiers, fuzzy/embedding matching, sound detection cues, semantic cues, and AI event cues — all in-scope work is implemented. Implemented work includes compact inline cue syntax, a multi-line indented composite-block authoring grammar, backend composite/context evaluation, inline cue snapshot sync (Phase 8.5), composite trees + reusable named conditions + tracker-state leaves end-to-end (Phase 9, backend and frontend), and a full Cue Rules editor UI including the ConditionTreeEditor and Named Conditions section (Phase 10). **Not done** (out of scope for this plan): multi-modal scene understanding / vision-backed event cues — Phase 6's unfinished vision-LLM checklist items, which `lcyt-agent`'s own plan (`plan_agent.md`, Phase 7) owns — and the fps30 tracker subsystem itself (whatever would emit `track_state`) — now drafted in `plan_video_perception.md` (2026-07-20), not yet built."
related: plan/agent, plan/ai_roles_framework, plan/video_perception
---

# Cue Engine Enhanced Capabilities

**Status:** Implemented (all in-scope cue-engine work — matching modes, composite/named conditions, the tracker-consumer side, and the Cue Rules editor UI — is shipped; the two items left below are out of scope for this plan, not future work within it)
**Scope:** `packages/plugins/lcyt-cues`, `packages/plugins/lcyt-agent`, `packages/lcyt-web/src/lib/metacode-runtime.js`, `packages/lcyt-web/src/lib/metacode-parser.js`, `packages/lcyt-web/src/components/InputBar.jsx`, `packages/lcyt-web/src/components/AiSettingsPage.jsx`
**Related plans:** [AI Agent Plan](plan_agent.md) (lcyt-agent owns AI config, embeddings, LLM calls, and future features including SVG graphics AI and rundown generation)

---

## Implemented work to date

- Compact inline cue syntax and modifier support (`cue:`, `cue*:`, `cue**:`, plus fuzzy/semantic/context-style forms).
- The multi-line indented composite-block grammar (`<!-- cue:\n or:\n exact: ... \n -->`) and `cue-def:name:` block form — an alternative authoring syntax to the compact `|`-pipe form, same tree shape — implemented 2026-07-18.
- Backend evaluation for composite/context cues, including named condition definitions and backend-side evaluation paths.
- Inline cue snapshot sync from parsed rundown files into the backend (`POST /cues/inline`) so backend-evaluated cues participate in the live runtime path — Phase 8.5, implemented (found already shipped, previously mis-tracked as planned — see Phase 8.5 note below).
- Composite condition trees (`and`/`or`/`not`), reusable named conditions (`cue_named_conditions` table + `/cues/defs` CRUD with write-time cycle rejection), and tracker-state (`track:`) leaves, backend and frontend — Phase 9, implemented 2026-07-18 (Lane D backend, continuing PR #282; frontend the same day).
- Frontend `buildCueMap()`/`checkCueMatch()` correctly skip composite cues (they fire via backend SSE only), matching the existing `semantic`/`events` skip.
- Parser/runtime/regression coverage for the compact syntax, the block grammar, and backend cue-evaluation paths.
- A complete Cue Rules editor UI (`/cues`, `CuesPage.jsx`/`CuesManager`) covering every synchronous/composable rule type (`phrase`/`regex`/`section`/`fuzzy`/`track`/`composite`) plus a Named Conditions section, both using the shared `ConditionTreeEditor` component — Phase 10, implemented 2026-07-18.

## Remaining roadmap

**Not done (out of scope for this plan):**

- Multi-modal scene understanding and vision-backed event cues — this is Phase 6's unfinished checklist (preview JPEG fetching, vision LLM integration, scene description SSE emission, video keyframe extraction). `lcyt-agent` owns this as its own Phase 7 ("Multi-Modal Scene Understanding," `plan_agent.md`, still `Planned` there) — per this doc's "Related plans" note, `lcyt-agent` owns AI config/embeddings/LLM calls and future AI features, not `plan_cues.md`.
- The fps30 tracker subsystem itself (whatever emits `track_state` events) — out of scope for `lcyt-cues`, which only implements the cue-engine-facing consumer side (`track:` leaves, `match_type: 'track'` rules, `createTrackerCueListener()`). Nothing in this repo produces `track_state` yet, but `plan_video_perception.md` (draft, 2026-07-20) is now the specced producer. That plan deliberately keeps this project-level `track_state` contract unchanged (`{ apiKey, ts, labels: [{ label, confidence }] }`, no camera dimension, matching `CueEngine._trackerState`'s existing `Map<apiKey, state>` shape exactly) — multi-camera detail (`cameraId`, `visible`, bbox) is a separate `camera.track_state` event for its own World State service, not pushed through this flat contract.
- A lint/warning pass for indirect `not:`+async cycles through a `ref` chain (the `ConditionTreeEditor` only warns on a `not` group's direct child) — a UI nicety gap, not a correctness one.

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

### Remaining gaps

1. **Multi-modal scene understanding** — vision + audio + transcript fusion remains the next major milestone.
2. **Vision-backed event cues** — preview-frame / video inference is still planned rather than shipped.
3. **Agent-side image analysis** — the preview-image inference hook remains future work.

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

*(Scope note: the AI-config/embedding/routing plumbing below is implemented; the remaining vision-LLM checklist items are the same out-of-scope, `lcyt-agent`-owned work called out in "Remaining roadmap" above — tracked as `plan_agent.md`'s own Phase 7, not left open within this plan.)*

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

## Phase 8 — Compact Inline Cue Syntax, Inline Sync, and Composite/Context Evaluation (Implemented)

### Motivation

Inline cues should be expressible in a compact single-line form and evaluated by the backend when the cue contains composite logic or semantic/event semantics.

### Implemented capabilities

- [x] Compact stanza syntax using escaped newlines or pipe separators:
  - `<!-- stanza: line one\nline two -->`
  - `<!-- stanza: line one|line two -->`
- [x] Compact cue-expression syntax with `|`, `|+`, `|-`, grouping parentheses, named refs, event shorthands, and shorthand match types:
  - `exact:term`, `~term`, `~~term`, `fuzzy:term`, `semantic:term`
  - `@named`, `complex:named`, `#event`
  - `context:section=~prayer`
- [x] Backend composite evaluation for `and` / `or` / `not` trees and named cue definitions in `packages/plugins/lcyt-cues/src/cue-engine.js`.
- [x] Inline cue snapshot sync from parsed rundown files to the backend, so composite/context/fuzzy cue trees participate in the runtime path.
- [x] Planner/parser/runtime regression coverage for the compact syntax plus backend cue-engine tests.

---

## Phase 8 — Multi-Modal Scene Understanding (Planned, out of scope for this plan)

*(Numbering note: this section was mislabeled "Phase 9" — the Phase Summary table below has always numbered this Phase 8, immediately after Phase 7's AI event cues and before Phase 8.5. Corrected here; no content change.)*

Superseded in ownership by `plan_agent.md`'s own Phase 7 of the same name — see the "Remaining roadmap" section above and this doc's "Related plans" note. Kept here for historical motivation/design context only; this plan does not need to implement it.

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

## Phase 8.5 — Close the Inline ↔ Backend Cue Sync Gap (Prerequisite, Implemented)

### Status (2026-07-18)

Already shipped — confirmed by direct code inspection while scoping Lane D's remaining Phase 9 work. `POST /cues/inline` (`packages/plugins/lcyt-cues/src/routes/cues.js`), `CueEngine.setInlineSnapshot()`/`evaluateInlineCues()` (`cue-engine.js`), the `source: 'inline'` `cue_fired` SSE value, and the frontend caller (`packages/lcyt-web/src/components/InputBar.jsx`, `POST ${backendUrl}/cues/inline` on file load) all exist with test coverage (`test/routes.test.js`'s `/cues/inline` suite, `test/cue-engine.test.js`'s inline semantic/composite tests). This section had drifted out of date relative to the code — the "Problem"/"Design" text below is kept as the accurate design rationale, but the checklist has been corrected to reflect what's actually landed.

### Problem

Phases 5 and 7 document `cue[semantic]:` and `cue[events]:` as "Implemented," and the matching primitives genuinely are — `CueEngine` can evaluate `semantic` and `event_cue` match-type rules, and the frontend parser/runtime correctly recognize the inline metacodes and skip them client-side "because they fire via backend SSE." **But nothing ever puts those inline phrases into the backend's `cue_rules` table.** The only way a `semantic`/`event_cue` rule reaches `CueEngine._loadRules()` today is by calling `POST /cues/rules` directly (CRUD, independent of any rundown file). An author who writes `<!-- cue[semantic]:end of prayer -->` in a file gets a silently inert cue — the frontend skips it (correctly, per its own doc comment) and the backend never hears about it, because it was never registered as a rule. There is no reproduction needed; this is visible directly from the code: `metacode-runtime.js`'s `checkCueMatch()` unconditionally `continue`s past `entry.semantic`/`entry.events`, and grepping the whole frontend and `lcyt-cues` for any call that POSTs inline cue data to `/cues/rules` (or an equivalent) returns nothing.

This must be fixed before Phase 9, because composite cues make the problem worse: a composite condition tree with a `semantic` or `event` leaf is exactly as inert as a bare `cue[semantic]:` today unless this sync path exists, and named condition references (`@name`) need *some* backend-resolvable registry to live in regardless.

### Design

Inline cues are per-file, change on every edit, and are cheap to resend — they don't need the durability of `cue_rules` (which model persistent, CRUD-managed, file-independent rules). Treat them as **session-scoped, ephemeral registrations** rather than DB rows:

- New endpoint `POST /cues/inline` (session-authenticated): body `{ cues: [{ line, phrase, mode, matchType, tree? }, ...] }`. Called once when a file finishes loading/parsing on the frontend, and again whenever the active file changes or its cue metacodes are edited.
- `CueEngine` gets an in-memory `Map<apiKey, InlineCueSet>` (mirrors `_ruleCache` but keyed by session, not persisted). `_loadRules(apiKey)` is extended to merge persistent DB rules with the current inline set for that API key.
- Inline entries are wholly replaced (not merged) on each `POST /cues/inline` — the frontend always sends the full current set for the active file, so stale line-cues from a previous file/edit can't linger.
- Only `semantic`, `event`, and (Phase 9) `composite` inline cues need to make this round trip — plain `exact`/`fuzzy`/`section` inline cues keep working exactly as today (frontend-only, zero backend involvement, zero latency). This keeps the common case cheap and only pays the sync cost for the AI-backed cases that already require a network round trip anyway.
- `cue_fired` SSE events for inline-sourced rules carry `source: 'inline'` (new value alongside today's `explicit`/`auto`/`sound`/`event_cue`) so the frontend can distinguish them from CRUD-authored automatic rules if needed.

### Implementation

- [x] `CueEngine`: inline cue registration (`setInlineSnapshot()`) and a dedicated evaluation path (`evaluateInlineCues()`) — implemented as a separate ephemeral snapshot rather than merged into `_loadRules()`'s DB-rule cache, which is an equivalent design (inline entries never need regex precompilation or cooldown-cache sharing with DB rules) and is what the shipped code does
- [x] `lcyt-cues` routes: `POST /cues/inline`
- [x] Frontend: call `POST /cues/inline` on file load (`InputBar.jsx`)
- [x] `cue_fired` SSE `source: 'inline'`
- [x] Tests: engine inline-evaluation behavior, replace-not-append semantics (`setInlineSnapshot` always replaces), route auth/validation

---

## Phase 9 — Composite & Named Conditions (Implemented, backend + frontend)

### Status (2026-07-18)

Backend implemented in this pass (Lane D, continuing PR #282, `packages/plugins/lcyt-cues` only — no frontend changes). All of the below is landed and tested:

- `cue_named_conditions` table (`db.js`) + full CRUD (`listNamedConditions`/`getNamedCondition`/`getNamedConditionByName`/`insertNamedCondition`/`updateNamedCondition`/`deleteNamedCondition`) and `cue_rules.condition_tree` column.
- `GET/POST/PUT/DELETE /cues/defs` (`routes/cues.js`) — tree validation (known leaf types, `not:` exactly one child) and write-time cycle rejection (`detectCycle()`) for both self-reference and multi-hop reference cycles.
- `POST/PUT /cues/rules` accept `match_type: 'composite'` (with `condition_tree`, pattern optional) and `match_type: 'track'` (pattern required, cooldown defaults to 1000ms unless set explicitly — same default applied when a composite rule's tree contains a `track:` leaf).
- `CueEngine.evaluateComposite(apiKey, node, ctx, localDefs, visited)` — async recursive tree evaluator. Leaf types: `phrase`/`exact`, `regex`, `fuzzy`, `section`, `context`, `track` (sync, reads cached tracker state), `semantic`, `event`/`event_cue` (async, embedding/LLM calls). Groups (`and`/`or`/`not`) short-circuit and evaluate cheap sync leaves before async ones within a group regardless of source order (`_orderByCost()`/`_nodeIsAsync()`). `ref` leaves resolve against a caller-supplied `localDefs` map first, then the DB-backed named-condition cache (`_loadNamedConditions()`, invalidated via the existing `invalidate(apiKey)`), with a `visited`-set cycle guard so a bad definition degrades to a no-match instead of an infinite loop. Returns `{ matched, leaf }` so callers can report which leaf actually fired (for `cue_fired` debugging payloads) — this replaced the old inline-only, sync, `defs`-only `_evaluateCompositeCondition()`/`_evaluateLeafCondition()` pair, which `evaluateInlineCues()`'s `composite` case now calls through the new async path instead.
- `CueEngine.evaluateCompositeRules(apiKey, text, codes, onFired)` — new async evaluation path for DB-backed `match_type: 'composite'` rules (inline composite cues were already covered by `evaluateInlineCues()`; DB-backed ones had no evaluation path at all before this). Wired into `cue-processor.js` alongside `evaluate()`/`evaluateInlineCues()`/`evaluateEventCues()`.
- `CueEngine._trackerState` cache + `evaluateTrackerEvent(apiKey, state, onFired)` (mirrors `_silenceState`/`evaluateSoundEvent()`, but is a plain cached-state check with no timer logic) for standalone `match_type: 'track'` rules, and `createTrackerCueListener()` (`cue-processor.js`, mirrors `createSoundCueListener()`) wired to a `track_state` session-emitter event, exported from `api.js`. **Nothing in this repo emits `track_state` yet** — the fps30 tracker subsystem itself is out of scope here (see plan text below); the listener is inert until such a producer exists, same relationship `createSoundCueListener()` has always had with `lcyt-music`.
- `_emitCueResults()`/`_emitCueFired()` (`cue-processor.js`) source labeling fixed: DB-backed composite matches now report `source: 'composite'` (previously would have fallen through to the generic `event_cue` label; inline composite matches still correctly report `source: 'inline'`), and the sound-cue emitter's hardcoded `'sound'` source is now a parameter so the same helper serves the new tracker listener with `source: 'track'`.
- Tests: `test/cue-engine.test.js` (composite tree evaluation, DB-backed named-condition ref resolution, self-reference and cheap-leaf-first-ordering regression tests, `evaluateCompositeRules` + cooldown), `test/tracker-cues.test.js` (new — mirrors `sound-cues.test.js` for `match_type: 'track'`), `test/routes.test.js` (`/cues/rules` composite/track validation, `/cues/defs` CRUD + duplicate-name + cycle rejection).

### Status (2026-07-18, frontend follow-up)

The frontend half landed the same day, continuing directly on the backend pass above:

- **`ConditionTreeEditor`** (`packages/lcyt-web/src/components/ConditionTreeEditor.jsx`, new) — recursive editor for the leaf/group/ref tree shape: add-leaf buttons (Exact/Fuzzy/Semantic/Section/Track/Event/Ref), collapsible `and`/`or`/`not` group containers (op switchable via a select; switching to `not` truncates existing children to at most one and disables further additions, matching "not: takes exactly one child"), a `ref` leaf rendered as a `<select>` populated from the caller-supplied named-conditions list (never free text, so an author can't typo a name that silently never resolves), and an inline warning when `not` wraps a semantic/event/ref leaf (per this section's "Caution" note below). Also exports `summarizeConditionTree()` — the compact one-line rendering (`Amen OR ~~end of the prayer OR @other-condition`) used by both list views.
- **`CuesManager` rules editor** — `match_type: 'composite'` and `match_type: 'track'` are now in `EDITABLE_MATCH_TYPES` (`packages/lcyt-web/src/components/CuesPage.jsx`) alongside phrase/regex/section/fuzzy; picking `composite` swaps the pattern input for a `ConditionTreeEditor`; picking `track` relabels the pattern input to "Tracked label" and auto-bumps the cooldown field to 1000ms if it's still at the untouched 0 default (a UI nicety — the backend's own `defaultCooldownFor()` applies independently regardless of what the form sends). The remaining non-editable types (`semantic`, `event_cue`, `music_start`, `music_stop`, `silence`) still list/toggle/delete with the locked-form notice, unchanged.
- **Named Conditions section** — a second CRUD list/editor in the same `CuesManager` (both the standalone `/cues` page and the Planner's embedded Cues tab), wired to `GET/POST/PUT/DELETE /cues/defs`. Name is locked after creation (matches the backend's uniqueness contract). Inline-sourced rows (`source: 'inline'`) show the persistent notice + **Detach** button specified in Phase 10's "Inline/UI ownership caveat" below (`PUT /cues/defs/:id` with `{ source: 'api' }`).
- **Parser** (`packages/lcyt-web/src/lib/metacode-parser.js`) — the multi-line "Composite block grammar" (below) is now real: `CUE_BLOCK_OPEN_RE`/`CUE_DEF_BLOCK_OPEN_RE` detect a bare `<!-- cue(*{0,2}):` or `<!-- cue-def:name:` open line (nothing after the final colon) and collect an indented body until a closing `-->`, parsed by `parseIndentedConditionBlock()`/`parseBlockLeafLine()` into the same tree shape `parseCueExpression()` already produced from the compact `|`-syntax. A composite `cue:` block's `-->` may carry trailing caption text on the same physical line (`-->We beseech thee, O Lord`), which continues through the normal per-line pipeline unchanged; a `cue-def:` block's `-->` must be bare (a definition isn't attached to any caption line, same as the existing single-line form). The single-line `<!-- cue-def:name: value -->` form (pre-existing, previously untested and JSON-only) now also falls back to `parseCueExpression()` when `value` isn't raw JSON, so the compact pipe syntax works as a one-line condition definition too. Two small pre-existing gaps fixed along the way: `parseCueLeaf()` (the compact-syntax leaf parser) had no `track`/`regex` keyword cases and silently dropped them to a plain phrase match; and `~~:value`/`~:value` (colon immediately after the tildes, the block grammar's own leaf spelling) left a stray leading `:` in the pattern since the old tilde-stripping only trimmed whitespace, not a following colon.
- **Runtime** (`packages/lcyt-web/src/lib/metacode-runtime.js`) — `buildCueMap()` now marks `composite: !!lc.cueTree` per entry; `checkCueMatch()` skips `entry.composite` the same way it already skipped `entry.semantic`/`entry.events`. Previously a composite cue's raw compact-expression text (or, block-grammar entries specifically, a synthesized phrase joining the body lines) was silently substring-matched as if it were a literal phrase — inert in practice (such text essentially never appears verbatim in spoken captions) but incorrect, and exactly the gap the Phase 9 checklist flagged.
- Tests: `test/components/ConditionTreeEditor.test.jsx` (16), `test/fileUtils.test.js` additions (multi-line `cue:`/`cue-def:` blocks, track/regex compact-syntax keywords — 14 new cases), `test/metacode-runtime.test.js` additions (composite skip — 4 new cases, plus 2 existing `buildCueMap()` assertions updated for the new `composite` field), `test/components/CuesPage.test.jsx` additions (composite rule list/create, track cooldown bump, Named Conditions list/create/delete/409/Detach/locked-name/ref-dropdown — 11 new cases).

**Not built:** a visual warning/lint pass across *all* named conditions for indirect `not`+async cycles (the editor only warns on a `not` group's *direct* child, not through a `ref` that itself resolves to an async leaf); this is a UI nicety gap, not a correctness one — the backend still evaluates correctly either way, and the plan's own caution note only asks for the direct-child case. Multi-modal scene understanding (a different Phase 9, above) remains untouched.

### Motivation

Some cue points genuinely need more than one detection strategy to be reliable in a live setting. A single point in a rundown might need to fire on **any** of: the exact word being said, a semantically related phrase being said instead (STT paraphrase, different wording of the same idea), or simply already being in the right section of the service. Prompted by: *"Exact: Amen OR Semantic: end of prayer OR Inside: section: prayer."* Today each of these is its own independent match type — there is no way to say "fire on whichever of these happens first," and no way to reuse a condition once written across multiple cue points (e.g. "we are ending a prayer" is a useful condition in a lot of places in a service rundown, not just one).

### Depends on

[[Phase 8.5]] — composite conditions with semantic/event leaves are inert without the inline↔backend sync path.

### Leaf condition markers

Terseness is reserved for the cheap, synchronous, local match types; the match types that cost an API call get an explicit word, both as a readability aid and as a small deliberate speed bump before an author reaches for something with per-call latency and (for `openai`/`custom` providers) real cost:

| Marker | Leaf type | Cost | Notes |
|---|---|---|---|
| `word` (bare, no prefix) | `exact` | free, sync | same substring/glob semantics as today's plain `cue:` |
| `~word` | `fuzzy` | free, sync | same Jaro-Winkler as today's `cue~:` — **unchanged**, no collision |
| `~~word` | `semantic` | embedding API call, async | doubling the tilde mirrors the existing `*`/`**` doubling for cue modes — "more fuzzy" |
| `section:name` | `section` | free, sync | same as today's CRUD `section` match type |
| `track:label` | `track` | free, sync (reads cached state) | **new** — see "Tracker-state leaves" below |
| `event:description` | `event_cue` | LLM API call, async, costliest | same as today's `cue[events]:` semantics |
| `@name` | named reference | inherits cost of whatever it resolves to | see below |

`cue[semantic]:` and `cue[events]:` (single-condition, non-composite) continue to work unchanged as documented in Phases 5 and 7 — `~~` and `event:` are additive alternate spellings usable inside composite trees, not a breaking rename. (Whether to eventually deprecate the bracket forms in favor of `~~`/`event:` for consistency is a follow-up decision, not part of this phase.)

### Tracker-state leaves (`track:label`)

A video tracker is planned as a separate subsystem: a fast local loop (fps30-class, not per-frame LLM inference) that tracks specific things in frame and reports state. Whatever produces that state, from the cue engine's point of view it needs to look exactly like the existing sound-detection integration (Phase 4): a **cheap, synchronous check against the most recently reported state**, not a per-evaluation API call.

**Note on the two "Tracker" things in this repo:** `docs/plans/plan_ai_roles_framework.md` already specs an `ai_roles` catalog role named "Tracker" — but that one is explicitly a `continuous_vision` **polling** loop against preview JPEGs (default interval 5s, chosen for thumbnail freshness/cost, not real-time tracking), emitting `tracker_update { objects: [{ id, label, confidence, bbox }] }`. An fps30 fast-loop tracker is a different design point — 5s-interval vision-LLM calls and 30fps local tracking are not the same subsystem serving two speeds, they're two different techniques (one calls out to a multimodal model per sample, the other almost certainly doesn't, or it would be cost-prohibitive at 30fps). This plan does **not** assume the fps30 tracker is a faster configuration of the `plan_ai_roles_framework.md` Tracker role — that's an open question for wherever the fps30 tracker itself gets speced, not something to resolve here. What this plan commits to is only the **cue-engine-facing contract**, which is deliberately agnostic to that question:

- Whatever the tracker subsystem is, it emits state updates on a session emitter — reuse the existing `sound_label` event shape/pattern rather than inventing a new transport: e.g. `{ type: 'track_state', data: { labels: [{ label, confidence, region? }], ts } }`.
- `CueEngine` caches the latest tracker state per `apiKey` (a `_trackerState` map, structurally identical to today's `_silenceState` map), updated by a new `createTrackerCueListener({ store, engine })` that mirrors `createSoundCueListener()` exactly (same `_attachSoundListener`-style wiring, listening for `track_state` instead of `sound_label`).
- The `track:label` leaf (both as a standalone cue and inside a composite tree) checks the cached state synchronously: does the current tracked-labels set contain `label` above its confidence threshold? No event loop re-entrancy, no timer — a plain map read, same cost class as `section:`.
- A standalone (non-composite) `match_type: 'track'` CRUD rule type is added alongside `music_start`/`music_stop`/`silence` for symmetry, evaluated via a new `CueEngine.evaluateTrackerEvent(apiKey, state, onFired)`, called from the listener on every `track_state` event — mirroring `evaluateSoundEvent()`. At fps30 this fires far more often than caption arrival does, so **per-rule `cooldown_ms` is load-bearing here, not optional** — a `track:` rule with `cooldown_ms: 0` would otherwise refire on every single frame the label remains present. Recommend defaulting `cooldown_ms` to a non-zero value (e.g. 1000ms) specifically for `track` and `composite`-with-`track`-leaf rules, unlike other match types which default to 0.
- Composite trees with a `track:` leaf are evaluated the same way `or`/`and`/`section:` leaves are today (per caption arrival, reading cached tracker state) — a `track:` leaf does not itself cause the tree to be re-evaluated at fps30; it just means "check the *last known* tracker state" at whatever cadence the tree is already being evaluated (caption arrival). A composite tree that should re-evaluate live as tracker state changes, independent of caption arrival, is a different feature (continuous re-evaluation trigger) and is out of scope for this phase — flagging as a follow-up if the motivating use case turns out to need "fire the instant tracking state changes," not "check tracking state next time something else happens."

### Composite block grammar

A composite cue opens the same way single cues do (`cue:`, `cue*:`, `cue**:` — position-mode modifiers are orthogonal to condition logic and still apply to the whole block), but instead of a single-line phrase, the value is a multi-line indented condition tree, parsed the same way the existing `<!-- stanza ... -->` construct collects lines until a bare `-->`:

```
<!-- cue:
or:
  exact: Amen
  ~~: end of the prayer
  section: prayer
-->We beseech thee, O Lord
```

Group nodes are `and:` / `or:` / `not:` (an `or:` at the top level implicitly, if the block's first line is a leaf rather than a group — for the common two-or-three-condition OR case, allowing a flat list without requiring `or:` boilerplate):

```
<!-- cue:
  exact: Amen
  ~~: end of the prayer
-->
```

parses identically to an explicit top-level `or:` with those two children. Nesting is via 2-space indentation:

```
<!-- cue:
or:
  exact: Amen
  and:
    section: prayer
    ~~: leader concludes
-->
```

`not:` takes exactly one child and negates it. **Caution:** `not:` wrapping an async leaf (`~~`/`event:`) is allowed but discouraged — "this event has NOT happened" is true almost all the time for an LLM-evaluated description, so it will tend to fire on the very next caption after the block becomes eligible rather than at a meaningful moment. The cue-rule editor UI (future) should warn on `not:` + async leaf; this plan doesn't block that combination outright since there may be legitimate uses (e.g. gating on "the operator has NOT yet given the closing signal").

### Named condition reuse (`@name`)

A condition can be defined once and referenced from any composite tree (or standalone) by name, so "the leader is wrapping up the prayer" doesn't need to be re-typed at every point in a rundown where it matters.

**Inline definition** (a declaration, not attached to any caption line — same non-attached pattern as `<!-- section: ... -->` setting ambient state):

```
<!-- cue-def:prayer-ending:
or:
  exact: amen
  ~~: end of the prayer
-->
```

**CRUD definition** — `POST /cues/defs` with `{ name, tree }` (see routes below), for conditions authored outside any specific file.

**Reference** — `@prayer-ending` as a leaf anywhere a leaf is valid, including inside another named condition's tree (resolved recursively, with cycle detection — a definition that (directly or transitively) references itself is rejected at write time with a 400, not caught at evaluation time).

Named conditions are per-API-key (scoped like `cue_rules`), not per-file — a name defined via `cue-def:` in one rundown file is available from composite cues in any other file under the same project, since resolution happens backend-side against the API key's definition set. Inline `cue-def:` blocks upsert into the same store CRUD-authored definitions use (this is the "share one engine" answer from user clarification: one condition-tree evaluator, two authoring surfaces).

### DB schema

```sql
-- New table: reusable named conditions
CREATE TABLE cue_named_conditions (
  id             TEXT PRIMARY KEY,
  api_key        TEXT NOT NULL,
  name           TEXT NOT NULL,          -- unique per api_key
  condition_tree TEXT NOT NULL,          -- JSON
  source         TEXT NOT NULL DEFAULT 'api',  -- 'api' | 'inline'
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX cue_named_conditions_key_name ON cue_named_conditions(api_key, name);

-- cue_rules: additive column for the new match type
ALTER TABLE cue_rules ADD COLUMN condition_tree TEXT;  -- JSON, used when match_type = 'composite'
```

`condition_tree` JSON shape (leaf/group union):

```json
{ "op": "or", "children": [
  { "type": "exact", "pattern": "Amen" },
  { "type": "semantic", "pattern": "end of the prayer" },
  { "type": "track", "pattern": "presenter-standing" },
  { "type": "ref", "name": "prayer-ending" }
]}
```

### CueEngine changes

- `evaluateComposite(apiKey, tree, text, codes)` — async recursive evaluator. Group nodes (`and`/`or`/`not`) short-circuit: `or` returns on first true child, `and` returns on first false child, evaluating **cheap sync leaves before async leaves** within the same group regardless of source order, so a composite `or` of `exact` + `semantic` never pays for an embedding call when the exact match already hit. `not` evaluates its single child and inverts.
- `track` leaves read `CueEngine`'s cached tracker state (see "Tracker-state leaves" above) — synchronous, no different in cost from `section`.
- `ref` leaves resolve against `cue_named_conditions` (cached per-`apiKey`, invalidated the same way `_ruleCache`/`_embeddingCache` are today), recursing into `evaluateComposite` with cycle guard (track visited names in the current resolution chain; a repeat is a no-match + warning log, not a throw, so one bad definition doesn't take down evaluation of everything else).
- Cooldown remains per top-level rule (not per-leaf) — a composite rule fires at most once per `cooldown_ms` regardless of which leaf tripped it.
- `match_type: 'composite'` rules are evaluated via this new path; existing `evaluate()` (sync phrase/regex/section/fuzzy) and `evaluateEventCues()` are unchanged for non-composite rules — composite is additive, not a replacement.

### Frontend

- Parser: composite block collection (stanza-like multi-line read) producing a `tree` object in `lineCodes[i].cueTree` instead of a flat `cue` phrase string, plus `cue-def:` block collection producing a separate `cueDefs` map in the parse result (name → tree), independent of `lines`/`lineCodes` since defs aren't attached to a caption line.
- `buildCueMap()`: composite entries get `{ index, mode, composite: true, tree }`; `checkCueMatch()` unconditionally skips `composite: true` entries, same reasoning as today's `semantic`/`events` skip — **all composite cues fire via backend SSE only in v1**, even ones whose leaves happen to be all-sync (e.g. `exact` OR `section`). Evaluating pure-sync composite trees client-side for zero-latency response is a plausible follow-up optimization but adds a second tree-evaluator implementation (frontend + backend) for a case that already works correctly, just with SSE round-trip latency instead of instant local match — not worth the duplication for v1.
- On file load (and on relevant edits), the frontend sends the file's composite cues and any `cue-def:` blocks via the Phase 8.5 sync path (`POST /cues/inline` carries `tree`-bearing entries; a parallel small call or an extended payload upserts `cueDefs` into `cue_named_conditions` with `source: 'inline'`).

### CRUD routes (`packages/plugins/lcyt-cues/src/routes/`)

- `GET/POST/PUT/DELETE /cues/defs` — named condition CRUD, mirroring the existing `/cues/rules` shape. Create/update validates the tree (known leaf types, `not:` has exactly one child, `ref:` targets exist or at least don't immediately self-cycle) and rejects on cycle detection.
- `/cues/rules` gains `match_type: 'composite'` as a valid type, with `condition_tree` in the request body validated the same way.

### Examples

The motivating case, as a composite cue:

```
<!-- cue:
or:
  exact: Amen
  ~~: end of the prayer
  section: prayer
-->We beseech thee, O Lord
```

Reusing a named condition across a rundown:

```
<!-- cue-def:prayer-ending:
or:
  exact: amen
  ~~: end of the prayer
-->

...later in the same or another file...

<!-- cue:@prayer-ending -->Let us stand
<!-- cue*:@prayer-ending -->Closing hymn
```

### Implementation checklist

- [x] Parser: recognize multi-line composite `cue:`/`cue-def:name:` blocks (`CUE_BLOCK_OPEN_RE`/`CUE_DEF_BLOCK_OPEN_RE` + `parseIndentedConditionBlock()`/`parseBlockLeafLine()` in `metacode-parser.js`), producing `lineCodes[i].cueTree` / a `cueDefs` map entry — same tree shape the compact `|`-syntax already produced
- [x] `db.js`: `cue_named_conditions` table, `cue_rules.condition_tree` column
- [x] Named-condition CRUD routes (`/cues/defs`)
- [x] `/cues/rules` accepts `match_type: 'composite'` + `condition_tree`
- [x] `CueEngine.evaluateComposite()` — async tree evaluator, cheap-leaf-first ordering, cycle-guarded `ref` resolution
- [x] `CueEngine`/`db.js`: named-condition cache + invalidation
- [x] `CueEngine._trackerState` cache + `evaluateTrackerEvent()` (mirrors `_silenceState`/`evaluateSoundEvent()`), `track` leaf support in `evaluateComposite()`
- [x] `createTrackerCueListener()` (mirrors `createSoundCueListener()`) — wired to a `track_state` session-emitter event; nothing in this repo emits that event yet, so the listener is exported and ready but inert until a tracker producer exists (out of scope here, see plan text above)
- [x] `match_type: 'track'` added to the standalone CRUD rule validation list (alongside `music_start`/`music_stop`/`silence`), with a non-zero default `cooldown_ms`
- [x] Frontend `buildCueMap()`/`checkCueMatch()`: skip composite entries (backend-SSE-only) — `buildCueMap()` now marks `composite: !!lc.cueTree`, `checkCueMatch()` skips it, same as the existing `semantic`/`events` skip
- [x] Phase 8.5 sync path extended to carry composite trees + `cue-def:` blocks — `POST /cues/inline`'s payload shape (`cues[].tree`/`cues[].cueDef`, top-level `cueDefs`) already supported this pre-Phase-9 (see `normalizeInlineCue()` in `routes/cues.js`); this pass is what makes composite trees sent through it actually evaluate against a real async tree evaluator with DB-backed named-condition support, instead of the old sync-only, inline-`cueDefs`-only evaluator — and, as of the frontend follow-up, the parser now actually produces `lc.cueTree`/`file.cueDefs` from real rundown files (multi-line blocks or the compact `|`-syntax) for `buildInlineCuePayload()` to sync
- [x] `cue_fired` SSE payload: composite rule matches identify which leaf(es) matched (for the rundown log / debugging) — `evaluateComposite()` returns `{ matched, leaf }`; both `evaluateInlineCues()` and `evaluateCompositeRules()` turn a matched `leaf` into a `composite:<type>:<pattern>` matched-string
- [x] Tests: tree evaluator (and/or/not, cheap-leaf-first ordering, cycle detection), routes (`/cues/defs` validation + cycle rejection, `/cues/rules` composite/track validation), tracker listener/cache (mirroring existing sound-cue tests); parser (`fileUtils.test.js` — multi-line block grammar, track/regex compact-syntax keywords), runtime (`metacode-runtime.test.js` — composite skip)

---

## Phase 10 — Assets Card: Cue Rules Editor (Implemented, including composite trees + Named Conditions)

### Status (2026-07-18)

Implemented for today's four simple, synchronous rule types — `phrase`, `regex`, `section`, `fuzzy` — per the roadmap's explicit scoping decision ("ship the editor first, scoped to today's simpler rule types — don't wait on Phase 9", `docs/plans/ROADMAP.md` Lane C). `CuesPage.jsx` (`/cues`) is a straight CRUD editor over the existing `GET/POST/PUT/DELETE /cues/rules` API — no backend changes were needed or made. **Not built:** the composite-tree `ConditionTreeEditor`, the Named Conditions section, and the `ref`-leaf dropdown — all three depend on Phase 9's `/cues/defs` API and `condition_tree` column, neither of which exist yet. Rules whose `match_type` is outside the editable four (`semantic`, `event_cue`, `music_start`, `music_stop`, `silence`, and any future `composite` rows) still list, toggle, and delete correctly from `/cues`; their match type and pattern are locked in the edit form with an explanatory notice instead of a broken/misleading form. The rest of this section is kept as-written (it's still the target design for the deferred pieces) with inline notes marking what shipped vs. what's still Phase-9-gated.

**Follow-up, same day:** the editor's actual/state-holding logic was extracted out of `CuesPage.jsx` into `CuesManager({ embedded })`, mirroring `LanguagesManager`/`LanguagesPage.jsx`'s existing split — `CuesPage` is now a two-line wrapper (`useProjectRequired()` + `<CuesManager />`). This unlocked a second consumer: `embedded` mode (no page title/description/back-link, just the "+ Add" affordance + list + dialogs) is used by `packages/lcyt-web/src/components/planner/PlannerAssistPanel.jsx`, the Planner's right-column "📋 Cues" tab (alongside an "⚡ Actions" tab for `plan_named_actions.md`'s `NamedActionsManager`, rebuilt the same way), sitting above the AI assistant chat (`AgentChatPanel`, now rendered with `showHeader={false}` since the panel wrapper supplies the column chrome). This replaces a non-functional tab stub that had been sitting in `PlannerPage.jsx`'s narrow/mobile "Cues & AI" swipeable page (inert buttons + "Cues and Actions panels coming soon" placeholder text) and gives the desktop 3-column layout the same tabs for the first time — desktop previously rendered `AgentChatPanel` as the entire right column with no Cues/Actions access at all. The standalone `/cues` page is unchanged and still the deep-link target from the Assets "Global cues" card.

**Second follow-up, same day (Phase 9 frontend landed):** everything deferred below — the `ConditionTreeEditor` component, the Named Conditions section, the `ref`-leaf dropdown, and the inline-sourced "Detach" flow — is now implemented, once Phase 9's backend API (`/cues/defs`, `condition_tree`) shipped. `match_type: 'composite'` and `match_type: 'track'` moved from "locked, non-editable" into the same editable form as phrase/regex/section/fuzzy. See Phase 9's "Status (2026-07-18, frontend follow-up)" note above for the component/file-level detail — this section's text below is largely superseded by that note; kept for the historical "Where it lives"/"Motivation" framing, with the two now-resolved sub-sections ("The `/cues` page itself", "Inline/UI ownership caveat") left as-written except for their checklists.

### Motivation

There is currently **no frontend UI at all** for cue rules — `packages/plugins/lcyt-cues/src/routes/cues.js` has had a full `/cues/rules` CRUD API since Phase 1, but nothing in `lcyt-web` calls it. The only way to create a persistent cue rule today is a raw HTTP request. This was tolerable while rules were simple (phrase/regex/section/fuzzy), but Phase 9's composite trees and reusable named conditions are materially harder to author by hand as raw JSON — a named condition library that can't be browsed or edited defeats its own DRY purpose. This phase adds the missing editor, surfaced from the existing Assets library page rather than as a new sidebar section.

### Where it lives

`AssetsPage` (`packages/lcyt-web/src/components/AssetsPage.jsx`) already had a real, non-placeholder "Global cues" card (`plan_assets_page.md`'s `key: 'cues'` row — a `visibleCards` entry, not a bare `TILES` array as originally sketched here) fetching `GET /cues/rules` for its count and rows. The only change needed there was pointing its `headerAction.href` and each `SetupItemRow`'s `href` at `/cues` instead of `/planner` — no new tile, no new `load()` fetch, since the count fetch already existed. (The `TILES` pseudocode below is the original sketch, kept for the Phase 9 named-conditions-count extension it still describes; it doesn't match the shape `AssetsPage.jsx` actually uses today.)

```js
const TILES = [
  { id: 'captions',      icon: '💬', title: 'Captions',     href: '/captions',    tracked: false },
  { id: 'rundowns',      icon: '📋', title: 'Rundowns',      href: '/planner',     tracked: false },
  { id: 'graphics',      icon: '🖼️', title: 'Graphics',      href: '/graphics/editor', tracked: true, key: 'graphics' },
  { id: 'translations',  icon: '🌐', title: 'Translations',  href: '/translations',tracked: false },
  { id: 'broadcasts',    icon: '📡', title: 'Broadcasts',    href: '/broadcast',   tracked: true, key: 'broadcasts' },
  { id: 'thumbnails',    icon: '🖼️', title: 'Thumbnails',    href: '/broadcast',   tracked: false },
  { id: 'cues',          icon: '🎯', title: 'Cue Rules',     href: '/cues',        tracked: true, key: 'cues' },  // new
];
```

Once Phase 9's `/cues/defs` ships, its count should merge into the existing cues card description (e.g. `"12 rules · 4 named conditions"`) rather than becoming a second card — named conditions are a detail of the cue system, not a separate asset category a user thinks about independently.

### The `/cues` page itself

`CuesPage` (`packages/lcyt-web/src/components/CuesPage.jsx`), added to the routing table in `main.jsx` alongside the other sidebar-adjacent-but-not-in-the-Claude-Design-mockup pages (same treatment as `/planner`, `/translations` — reachable via its Assets card and direct URL, not a top-level sidebar item; see `HIDDEN.md`'s existing convention). One section shipped, one deferred:

1. **Rules** (✅ implemented) — CRUD list/editor over `cue_rules` (`GET/POST/PUT/DELETE /cues/rules`, unchanged endpoints), following the `LanguagesManager`/`Dialog`/`SetupItemRow` pattern used elsewhere in `lcyt-web`. Form fields per `match_type`: `phrase`/`regex`/`section`/`fuzzy`/`track` get a match-type select plus pattern input (`fuzzy` additionally shows the threshold slider, same range-input convention as `AiSettingsPage`'s fuzzy threshold; `track` relabels the pattern field to "Tracked label" and suggests a 1000ms cooldown). `composite` swaps the pattern input for the `ConditionTreeEditor` recursive tree builder — add-leaf buttons per leaf type (`exact`/`fuzzy`/`semantic`/`section`/`track`/`event`/`ref`), group nodes (`and`/`or`/`not`) as collapsible containers, `ref` leaf as a named-conditions dropdown (✅ implemented, `packages/lcyt-web/src/components/ConditionTreeEditor.jsx`). The remaining non-editable types (`semantic`, `event_cue`, `music_start`, `music_stop`, `silence`) still list/toggle/delete with the locked-form notice — these are single-condition-only concepts already covered by their own inline metacode syntax, or sound-cue types configured by audio events rather than hand-authored.
2. **Named Conditions** (✅ implemented) — CRUD list/editor over `cue_named_conditions` (`GET/POST/PUT/DELETE /cues/defs`), the same `ConditionTreeEditor` component the composite rule editor uses (a named condition's `condition_tree` and a composite rule's `condition_tree` are the identical shape). Each row shows a compact one-line rendering of its tree via `summarizeConditionTree()` (e.g. `Amen OR ~~end of the prayer OR @other-condition`) plus a `source` badge (`inline` vs `api`).

### Inline/UI ownership caveat (Implemented)

Phase 9 lets a `cue-def:` block in a rundown file upsert into the same `cue_named_conditions` table this UI edits (`source: 'inline'`). Editing an inline-sourced definition through `/cues` is allowed, but the edit is **not durable** against that source file: the next time the file loads (or its `cue-def:` block changes) the inline sync overwrites the row again, silently discarding the UI edit. The editor surfaces this rather than letting it be a surprise — an inline-sourced row's edit form shows a persistent notice ("Defined by a rundown file's `cue-def:` block — edits here will be overwritten next time that file syncs") with a **Detach** button that calls `PUT /cues/defs/:id` with `{ source: 'api' }` (keeping the current tree, severing the link so the file's `cue-def:` block no longer overwrites it).

### Implementation checklist

- [x] `AssetsPage.jsx`: point the existing `cues` card's `headerAction`/row `href` at `/cues` (no new tile or fetch needed — the card and its `GET /cues/rules` count fetch already existed, see "Where it lives" above)
- [x] `CuesPage.jsx` (new) + route registration in `main.jsx`
- [x] `ConditionTreeEditor` component (shared by composite-rule and named-condition editing)
- [x] Rules list/editor wired to existing `/cues/rules` CRUD; `composite` and `track` editable alongside `phrase`/`regex`/`section`/`fuzzy`; remaining non-editable types list/toggle/delete but lock their edit form
- [x] Named Conditions list/editor wired to `/cues/defs` CRUD
- [x] `ref` leaf renders as a validated dropdown, not free text
- [x] Inline-sourced row: persistent notice + "Detach" action
- [x] Tests: `CuesPage`/`CuesManager` component tests (Vitest — `test/components/CuesPage.test.jsx`: list/empty states, create, invalid-regex rejection, edit, delete, toggle, locked non-editable type, composite rule create/list, track cooldown suggestion, Named Conditions list/create/delete/409/Detach/locked-name/ref-dropdown); `ConditionTreeEditor` component tests (`test/components/ConditionTreeEditor.test.jsx` — add/remove leaves and groups, NOT truncation + disabled-add, NOT+async warning, ref dropdown, `summarizeConditionTree()`); `AssetsPage`'s existing test coverage already exercises the cues card's data loading, no separate tile-count test needed since no new tile was added

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
| 8.5 | Close inline↔backend cue sync gap (semantic/event inline cues) | ✅ Implemented | Phase 5, Phase 7 |
| 9 | Composite & named conditions (`and`/`or`/`not` trees, `@name` reuse, `track:` leaves) | ✅ Implemented 2026-07-18 (backend + frontend) | Phase 8.5 |
| 10 | Assets card: Cue Rules editor UI (`/cues` page, `ConditionTreeEditor`, Named Conditions) | ✅ Implemented 2026-07-18 | Phase 9 |

> **See also:** [AI Agent Plan](plan_agent.md) for additional agent phases including SVG graphics AI (Phase 5) and AI-assisted rundown creation (Phase 6).
