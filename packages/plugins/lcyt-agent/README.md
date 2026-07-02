# lcyt-agent — AI Agent Plugin

Central AI service for LCYT. Owns AI configuration (per-key embedding/LLM provider settings), embedding computation, context window management, and LLM-based event cue evaluation. Other plugins delegate AI calls to the agent.

**Version:** 0.1.0  
**License:** (none right now)

## Overview

lcyt-agent provides:
- **Per-API-key AI configuration** — Select embedding model, LLM provider, credentials
- **Embedding computation** — OpenAI-compatible `/v1/embeddings` API client
- **Context window management** — Max 50 entries per API key; LLM context for decision-making
- **Event cue evaluation** — LLM-based analysis of caption events for advanced cue matching

## Installation

```bash
npm install lcyt-agent
```

## Quick Start

In `lcyt-backend`:

```javascript
import { initAgent, createAgentRouter, createAiRouter } from 'lcyt-agent';

const { agent } = await initAgent(db);

// Wire AI config to cue engine for semantic/event matching
cueEngine.setEmbeddingFn((text) => agent.computeEmbeddings(text));
cueEngine.setAiConfigFn((apiKey) => agent.getAiConfig(apiKey));
cueEngine.setAgentEvaluateFn((apiKey, desc, opts) => agent.evaluateEventCue(apiKey, desc, opts));

// Mount AI routes
app.use('/ai', createAiRouter(db, auth));
app.use('/agent', createAgentRouter(db, auth, agent));
```

## API Routes

```
GET  /ai/config
     Get per-API-key AI configuration
     Response: { provider, model, key, threshold }

PUT  /ai/config
     Update AI configuration (provider, model, credentials)
     Body: { provider, model, apiKey, threshold }
     Response: 200

GET  /ai/status
     Server-level AI capability info
     Response: { embeddingAvailable, models: [...] }

GET  /agent/status
     Agent engine capabilities and current state
     Response: { contextSize, maxEntries, supportedModels }

GET  /agent/context
     List context window entries for current API key
     Response: [{ id, type, content, timestamp }]

POST /agent/context
     Add entry to context window manually
     Body: { type, content }
     Response: { id, timestamp }

DELETE /agent/context
     Clear entire context window for API key
     Response: 200

GET  /agent/events
     Recent agent decision events (LLM calls, evaluations)
     Response: [{ timestamp, type, result }]
```

## Configuration

### Environment Variables

Per-server defaults (override per-API-key via `/ai/config`):

| Variable | Default | Purpose |
|----------|---------|---------|
| `EMBEDDING_API_URL` | `https://api.openai.com` | Embedding provider base URL |
| `EMBEDDING_API_KEY` | — | API key for embedding provider |
| `EMBEDDING_MODEL` | `text-embedding-3-small` | Model name |

### Per-API-Key Configuration

Users can configure via `PUT /ai/config`:

```json
{
  "provider": "openai",
  "model": "gpt-4-turbo",
  "apiKey": "sk-...",
  "threshold": 0.7
}
```

**Provider modes:**
- `none` — AI disabled
- `server` — Use server-level credentials
- `openai` — Use OpenAI API directly
- `custom` — Custom API-compatible endpoint

## Core Classes

### AgentEngine

```javascript
const { agent } = await initAgent(db);

// Embeddings
const vector = await agent.computeEmbeddings("hello world");

// Event cue evaluation (LLM)
const { decision, confidence } = await agent.evaluateEventCue(
  apiKey,
  "speaker changed", 
  { model: "gpt-4", temperature: 0.5 }
);

// Context management
agent.addContext(apiKey, { type: 'event', content: 'music started' });
const context = agent.getContext(apiKey);
agent.clearContext(apiKey);
```

### Embeddings

OpenAI-compatible `/v1/embeddings` API:

```javascript
import { computeEmbeddings, cosineSimilarity } from 'lcyt-agent';

const vector1 = await computeEmbeddings("music is playing");
const vector2 = await computeEmbeddings("song detected");
const similarity = cosineSimilarity(vector1, vector2);
```

## Database Schema

```sql
-- Per-API-key AI configuration
CREATE TABLE ai_config (
  api_key TEXT PRIMARY KEY,
  provider TEXT NOT NULL,           -- 'none', 'server', 'openai', 'custom'
  model TEXT,
  api_key_encrypted TEXT,           -- Encrypted credentials
  threshold REAL,
  created_at DATETIME,
  updated_at DATETIME
);

-- Context window entries
CREATE TABLE agent_context (
  id TEXT PRIMARY KEY,
  api_key TEXT NOT NULL,
  type TEXT,                        -- 'event', 'caption', 'custom'
  content TEXT,
  embedding BLOB,                   -- Optional: cached embedding vector
  created_at DATETIME,
  FOREIGN KEY (api_key) REFERENCES api_keys(api_key) ON DELETE CASCADE
);

-- Agent decision events (audit trail)
CREATE TABLE agent_events (
  id TEXT PRIMARY KEY,
  api_key TEXT NOT NULL,
  type TEXT,                        -- 'evaluation', 'embedding', 'error'
  input TEXT,
  result TEXT,
  confidence REAL,
  timestamp DATETIME,
  FOREIGN KEY (api_key) REFERENCES api_keys(api_key) ON DELETE CASCADE
);
```

## Integration with Other Plugins

**Cue Engine** (`lcyt-cues`):
- Uses `computeEmbeddings()` for semantic cue matching
- Uses `evaluateEventCue()` for LLM-based event cues
- Queries `getAiConfig()` to check per-key provider settings

**DSK Graphics** (`lcyt-dsk`):
- May use agent for context-aware overlay selection

## Testing

```bash
npm test -w packages/plugins/lcyt-agent
```

Tests cover:
- AI configuration CRUD
- Embedding computation (with mock API)
- Context window management
- Event evaluation (with mock LLM)
- Error handling

## Backward Compatibility

Re-exports are available from `lcyt-backend/src/ai/` for legacy imports:

```javascript
import { computeEmbeddings } from 'lcyt-backend/src/ai';
// Still works; imports from lcyt-agent internally
```

## See Also

- [Cue Engine documentation](../lcyt-cues/README.md)
- [LCYT backend documentation](../../lcyt-backend/README.md)
- [Plan: Agent & AI Integration](../../docs/plans/plan_agent.md)
- [API reference](../../docs/api/)
