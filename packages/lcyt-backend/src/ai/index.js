/**
 * AI module entry point — initialisation and route factory.
 *
 * Usage in server.js:
 *   import { initAi, createAiRouter } from './ai/index.js';
 *   await initAi(db);
 *   app.use('/ai', createAiRouter(db, auth));
 */

export { runAiMigrations, getAiConfig, getAiConfigRaw, setAiConfig, VALID_PROVIDERS } from './config.js';
export { computeEmbeddings, cosineSimilarity, isServerEmbeddingAvailable } from './embeddings.js';
export { createAiRouter } from './routes.js';

/**
 * Run DB migrations for AI config tables.
 * @param {import('better-sqlite3').Database} db
 */
export async function initAi(db) {
  const { runAiMigrations } = await import('./config.js');
  runAiMigrations(db);
}
