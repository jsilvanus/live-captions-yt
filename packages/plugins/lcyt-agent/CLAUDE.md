# `packages/plugins/lcyt-agent` — AI Agent Plugin (v0.1.0)

Central AI service for LCYT. Owns AI configuration (per-user embedding/LLM provider settings), embedding computation, context window management, and LLM-based event cue evaluation. Other plugins delegate AI calls to the agent. Imported by `lcyt-backend` as `lcyt-agent`.

**Main entry:** `src/api.js`
**Usage in lcyt-backend:**
```js
import { initAgent, createAgentRouter, createAiRouter, computeEmbeddings } from 'lcyt-agent';

const { agent } = await initAgent(db);
cueEngine.setEmbeddingFn(computeEmbeddings);
cueEngine.setAiConfigFn((apiKey) => agent.getAiConfig(apiKey));
cueEngine.setAgentEvaluateFn((apiKey, desc, opts) => agent.evaluateEventCue(apiKey, desc, opts));
app.use('/ai', createAiRouter(db, auth));
app.use('/agent', createAgentRouter(db, auth, agent));
```

**Source files (`src/`):**
- `api.js` — `initAgent(db)` + `createAgentRouter()` + `createAiRouter()`. Re-exports AI config and embedding utilities.
- `agent-engine.js` — `AgentEngine`: context window management (per-API-key, max 50 entries), `evaluateEventCue()` via LLM chat completions, `analyseImage()` stub for future vision inference.
- `ai-config.js` — Per-API-key AI model settings DB helpers (`ai_config` table). Provider modes: `none`, `server`, `openai`, `custom`.
- `embeddings.js` — OpenAI-compatible `/v1/embeddings` API client. `computeEmbeddings()`, `cosineSimilarity()`, `isServerEmbeddingAvailable()`.
- `db.js` — `agent_events` and `agent_context` table migrations.
- `routes/ai.js` — `GET/PUT /ai/config`, `GET /ai/status`.
- `routes/agent.js` — `GET /agent/status`, `GET/POST/DELETE /agent/context`, `GET /agent/events`.

**Backward compatibility:** `packages/lcyt-backend/src/ai/index.js` re-exports from `lcyt-agent`.

**Tests:** `packages/plugins/lcyt-agent/test/*.test.js` — uses `node:test`.

---

`computeEmbeddings()` and `evaluateEventCue()` here are the delegation targets for `packages/plugins/lcyt-cues`'s `semantic` and `event_cue` match types — see its `CLAUDE.md`.
