/**
 * lcyt-agent plugin entry point — AI Agent.
 *
 * The Agent plugin is the central AI service for LCYT. It owns:
 * - AI configuration (embedding provider, model, API keys per user)
 * - Embedding computation via OpenAI-compatible APIs
 * - Context window management (STT transcripts + explanation metacodes)
 * - Video/image inference (planned: vision-capable LLM)
 * - Event cues (planned: cue[events]:something happens)
 *
 * Other plugins (e.g. lcyt-cues CueEngine) delegate embedding calls
 * to the Agent rather than calling the embedding API directly.
 *
 * Usage in lcyt-backend/src/server.js:
 *
 *   import { initAgent, createAgentRouter, createAiRouter } from 'lcyt-agent';
 *
 *   const { agent } = await initAgent(db);
 *   app.use('/agent', createAgentRouter(db, auth, agent));
 *   app.use('/ai', createAiRouter(db, auth));
 *
 *   // Wire embedding fn into CueEngine:
 *   cueEngine.setEmbeddingFn((texts, opts) => agent.computeEmbeddings(texts));
 *   cueEngine.setAiConfigFn((apiKey) => agent.getAiConfig(apiKey));
 */

export { AgentEngine } from './agent-engine.js';
export { createAgentRouter } from './routes/agent.js';
export { createAiRouter } from './routes/ai.js';
export { runMigrations } from './db.js';

// Re-export AI config and embedding utilities so the backend can use them
export {
  runAiMigrations,
  getAiConfig,
  getAiConfigRaw,
  setAiConfig,
  VALID_PROVIDERS,
} from './ai-config.js';

export {
  computeEmbeddings,
  cosineSimilarity,
  isServerEmbeddingAvailable,
} from './embeddings.js';

/**
 * Run DB migrations and create the AgentEngine instance.
 * Call once at backend startup before mounting any routes.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} [opts]
 * @returns {Promise<{ agent: import('./agent-engine.js').AgentEngine }>}
 */
export async function initAgent(db, opts = {}) {
  const { runMigrations } = await import('./db.js');
  runMigrations(db);

  // AI config table migrations (embedding provider config per user)
  const { runAiMigrations } = await import('./ai-config.js');
  runAiMigrations(db);

  const { AgentEngine } = await import('./agent-engine.js');
  const agent = new AgentEngine(db, opts);

  return { agent };
}
