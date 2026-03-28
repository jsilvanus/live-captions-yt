/**
 * lcyt-agent plugin entry point — AI Agent.
 *
 * The Agent plugin provides AI-powered features:
 * - Video/image inference (describe what is happening on screen)
 * - Context-aware event cues (cue[events]:something happens)
 * - Scene description via LLM with STT + preview frame analysis
 * - `<!-- explanation:... -->` context enrichment for AI understanding
 *
 * Future capabilities:
 * - Continuous video stream analysis
 * - Multi-modal understanding (audio + video + text)
 * - Automated scene transition detection
 * - Content moderation and safety checks
 *
 * Usage in lcyt-backend/src/server.js:
 *
 *   import { initAgent, createAgentRouter } from 'lcyt-agent';
 *
 *   const { agent } = await initAgent(db);
 *   app.use('/agent', createAgentRouter(db, auth, agent));
 */

export { AgentEngine } from './agent-engine.js';
export { createAgentRouter } from './routes/agent.js';
export { runMigrations } from './db.js';

/**
 * Run DB migrations and create the AgentEngine instance.
 * Call once at backend startup before mounting any routes.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} [opts]
 * @param {object} [opts.aiConfig] — AI configuration module reference
 * @returns {Promise<{ agent: import('./agent-engine.js').AgentEngine }>}
 */
export async function initAgent(db, opts = {}) {
  const { runMigrations } = await import('./db.js');
  runMigrations(db);

  const { AgentEngine } = await import('./agent-engine.js');
  const agent = new AgentEngine(db, opts);

  return { agent };
}
