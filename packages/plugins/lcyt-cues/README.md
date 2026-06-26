# lcyt-cues — Cue Engine Plugin

Cue engine for detecting spoken phrases, sounds, and AI-analyzed events to auto-advance rundown files. Supports inline cue metacodes in caption files with multiple matching strategies.

**Version:** 0.1.0  
**License:** MIT

## Overview

lcyt-cues provides:
- **Phrase matching** — Substring and fuzzy (Jaro-Winkler) matching
- **Regex matching** — Full regex pattern support
- **Semantic matching** — Embedding-based similarity (requires AI plugin)
- **Event-based matching** — LLM analysis of caption context
- **Sound cues** — Music start/stop, silence detection
- **Silence timer** — Minimum duration before triggering
- **Per-rule cooldown** — Prevent duplicate triggers

## Installation

```bash
npm install lcyt-cues
```

## Quick Start

In `lcyt-backend`:

```javascript
import { initCueEngine, createCueProcessor, createCueRouter } from 'lcyt-cues';

const { engine } = await initCueEngine(db);

// Inject cue processor into captions route
const cueProcessor = createCueProcessor({ store, db, engine });

// Mount cue routes
app.use('/cues', createCueRouter(db, auth, engine));
```

## API Routes

```
GET    /cues/rules
       List all cue rules for API key (with search/pagination)
       Query: ?phrase=..., ?type=..., ?page=1, ?limit=20
       Response: { rules: [...], total, page, limit }

POST   /cues/rules
       Create new cue rule
       Body: { phrase, type, cooldown, metadata }
       Response: 201 { id, created_at }

PUT    /cues/rules/:id
       Update cue rule
       Body: { phrase, type, cooldown, ... }
       Response: 200

DELETE /cues/rules/:id
       Delete cue rule
       Response: 204

GET    /cues/events
       List recent cue events (triggered rules)
       Query: ?limit=50, ?since=timestamp
       Response: { events: [...] }
```

## Cue Metacode Syntax

### Frontend inline markers (in caption text)

Frontend captions can embed cue metacodes to manually trigger events:

```
<!-- cue:intro -->                  Match next occurrence of "intro"
<!-- cue*:verse -->                 Skip forward past other cues to "verse"
<!-- cue**:chorus -->               Any match (backwards compatible)
<!-- cue~:sirng -->                 Fuzzy match (typo-tolerant)
<!-- cue[semantic]:theme -->        Semantic similarity (backend only)
<!-- cue[events]:speaker changed --> AI event evaluation (backend only)
```

### Cue rule types (backend)

Defined via `POST /cues/rules`:

| Type | Matching | Example | Use case |
|------|----------|---------|----------|
| `phrase` | Substring search | `"welcome"` | Simple text match |
| `regex` | Full regex pattern | `/^intro.*/i` | Complex patterns |
| `fuzzy` | Jaro-Winkler distance | `"sientist"` → `"scientist"` | Typo tolerance |
| `semantic` | Embedding similarity | Similar meaning | Context-aware matching |
| `event_cue` | LLM evaluation | Complex descriptions | Advanced logic |
| `music_start` | Sound detection | Music begins | Audio classification |
| `music_stop` | Sound detection | Music ends | Audio classification |
| `silence` | Silence detection | >2s silence | Duration-based |

## Configuration

### Database Schema

```sql
-- Cue rules (per API key)
CREATE TABLE cue_rules (
  id TEXT PRIMARY KEY,
  api_key TEXT NOT NULL,
  phrase TEXT,
  type TEXT,                       -- 'phrase', 'regex', 'fuzzy', 'semantic', 'event_cue', etc.
  cooldown_ms INTEGER DEFAULT 0,   -- Min ms between consecutive triggers
  metadata TEXT,                   -- JSON (custom data, DSK actions, etc.)
  created_at DATETIME,
  FOREIGN KEY (api_key) REFERENCES api_keys(api_key)
);

-- Cue events (audit trail)
CREATE TABLE cue_events (
  id TEXT PRIMARY KEY,
  api_key TEXT NOT NULL,
  rule_id TEXT,
  type TEXT,
  caption TEXT,
  timestamp DATETIME,
  FOREIGN KEY (api_key) REFERENCES api_keys(api_key),
  FOREIGN KEY (rule_id) REFERENCES cue_rules(id)
);
```

### Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `CUE_COOLDOWN_MS` | 0 | Default cooldown between cue triggers |
| `SILENCE_MIN_DURATION_MS` | 2000 | Min silence before triggering silence cue |

## Integration with Other Plugins

**AI Agent** (`lcyt-agent`):
- Uses `computeEmbeddings()` for semantic matching
- Uses `evaluateEventCue()` for LLM-based cues
- Queries per-key AI configuration

**Sound Detection** (`lcyt-music`):
- Subscribes to `sound_label` SSE events
- Triggers `music_start`, `music_stop` cues
- Tracks silence duration

## Core Classes

### CueEngine

```javascript
const { engine } = await initCueEngine(db);

// Evaluate all rules for a caption (per API key)
const results = await engine.evaluateCaption(apiKey, captionText, { 
  sequence, timestamp 
});
// Returns: [{ ruleId, matched: true, cooldownRemaining }]

// Update AI dependencies
engine.setEmbeddingFn((text) => computeEmbeddings(text));
engine.setAiConfigFn((apiKey) => agent.getAiConfig(apiKey));
engine.setAgentEvaluateFn((apiKey, desc, opts) => agent.evaluateEventCue(...));
```

### SoundCueListener

Auto-detects sound events and triggers cues:

```javascript
const listener = createSoundCueListener({ store, engine });
// Listens to sound_label SSE events from lcyt-music plugin
// Automatically triggers music_start, music_stop, silence cues
```

## Testing

```bash
npm test -w packages/plugins/lcyt-cues
```

Tests cover:
- Phrase/regex/fuzzy matching
- Cooldown enforcement
- Semantic matching (with mock embeddings)
- Event cue evaluation (with mock LLM)
- Sound cue detection
- Silence timer logic

## Metacode Processing

The `createCueProcessor` intercepts captions before delivery:

```javascript
const processor = createCueProcessor({ store, db, engine });
const { cleanText, events } = await processor.processCaption(session, text, sequence);
// Extracts all <!-- cue:... --> codes
// Evaluates all applicable rules
// Emits SSE 'cue_fired' events
// Returns text with cue metacodes removed
```

## SSE Events

On `GET /events`, cue firing emits:

```json
{
  "type": "cue_fired",
  "data": {
    "ruleId": "rule-123",
    "phrase": "welcome",
    "type": "phrase",
    "caption": "welcome to the show",
    "timestamp": "2026-06-26T12:00:00.000"
  }
}
```

## See Also

- [AI Agent documentation](../lcyt-agent/README.md)
- [Music detection documentation](../lcyt-music/README.md)
- [LCYT backend documentation](../../lcyt-backend/README.md)
- [Plan: Cue Engine](../../docs/plans/plan_cues.md)
