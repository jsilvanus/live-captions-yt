/**
 * AI module — re-exports from lcyt-agent plugin.
 *
 * The AI configuration, embedding computation, and routes are now owned
 * by the lcyt-agent plugin (packages/plugins/lcyt-agent). This file
 * provides backward-compatible re-exports for any code that still imports
 * from this path.
 *
 * New code should import directly from 'lcyt-agent'.
 */

export {
  runAiMigrations,
  getAiConfig,
  getAiConfigRaw,
  setAiConfig,
  VALID_PROVIDERS,
  computeEmbeddings,
  cosineSimilarity,
  isServerEmbeddingAvailable,
  createAiRouter,
} from 'lcyt-agent';

/**
 * Run DB migrations for AI config tables.
 * @param {import('better-sqlite3').Database} db
 * @deprecated Use initAgent() from lcyt-agent instead.
 */
export async function initAi(db) {
  const { runAiMigrations } = await import('lcyt-agent');
  runAiMigrations(db);
}
