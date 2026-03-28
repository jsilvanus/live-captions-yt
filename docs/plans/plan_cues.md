---
id: plan/cues
title: "Cue Engine Enhanced Capabilities"
status: in-progress
summary: "Next-cue-only firing with skip/anywhere modifiers, fuzzy embedding-based matching, and music-state cue triggers. Phase 1 (basic cue engine) implemented; Phase 2 (next-only + modifiers) implemented; Phase 3 (fuzzy/embedding) implemented; Phase 4 (music cues) planned."
---

# Cue Engine Enhanced Capabilities

**Status:** In progress
**Scope:** `packages/plugins/lcyt-cues`, `packages/lcyt-backend/src/ai/`, `packages/lcyt-web/src/lib/metacode-runtime.js`, `packages/lcyt-web/src/lib/metacode-parser.js`, `packages/lcyt-web/src/components/InputBar.jsx`, `packages/lcyt-web/src/components/AiSettingsPage.jsx`

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

## Phase 4 — Music Detection Cue Triggers (Planned)

### Motivation

Cues should fire based on music detection states from `lcyt-music`. Use cases:
- When music starts → show lyrics overlay / switch to lyrics file
- When music stops → switch back to speech rundown
- When BPM changes significantly → adjust graphics tempo

### Cue rule match types for music

| Match type | Pattern | Fires when |
|---|---|---|
| `music_start` | — | Sound label transitions from non-music to `music` |
| `music_stop` | — | Sound label transitions from `music` to `speech`/`silence` |
| `bpm_range` | `120-140` | BPM falls within the specified range |
| `bpm_change` | `>20` | BPM changes by more than the threshold |

### Integration with `lcyt-music`

The music detection plugin (`lcyt-music`) already emits `sound_label` and `bpm_update` SSE events. The cue engine can subscribe to these:

```js
// In cue-processor or a new music-cue bridge:
session.emitter.on('event', (evt) => {
  if (evt.type === 'sound_label' && evt.data.label === 'music') {
    // Evaluate music_start rules
  }
  if (evt.type === 'bpm_update') {
    // Evaluate bpm_range and bpm_change rules
  }
});
```

### Metacode syntax

```
<!-- cue-music:start -->Switch to lyrics      ← fires when music starts
<!-- cue-music:stop -->Back to sermon          ← fires when music stops
<!-- cue-bpm:120-140 -->Upbeat section         ← fires when BPM is 120-140
```

### Implementation plan

- [ ] Add `music_start`, `music_stop`, `bpm_range`, `bpm_change` match types to CueEngine
- [ ] Subscribe CueEngine to `sound_label` and `bpm_update` session events
- [ ] Parser support for `<!-- cue-music:... -->` and `<!-- cue-bpm:... -->` metacodes
- [ ] Frontend handling of music-triggered cue events
- [ ] Tests for music state transitions triggering cues

---

## Phase Summary

| Phase | Description | Status | Dependencies |
|---|---|---|---|
| 1 | Basic cue engine: inline metacodes, auto-send, wildcards | ✅ Implemented | — |
| 2 | Next-cue-only firing with `*`/`**` modifiers | ✅ Implemented | Phase 1 |
| 3 | Fuzzy / embedding-based matching, AI config page | ✅ Implemented | Phase 2 |
| 4 | Music detection cue triggers | 📋 Planned | Phase 2, `lcyt-music` |
