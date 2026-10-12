/**
 * AI / Embedding configuration helpers.
 *
 * Tables:
 *   ai_config — per-API-key AI model settings (embedding provider, API keys, thresholds)
 *
 * Three source modes for AI models:
 *   - 'server' — server admin provides API key via env vars, available to all users
 *   - 'openai' — user provides their own OpenAI API key
 *   - 'custom' — user provides custom embedding API endpoint + key
 *   - 'none'   — AI features disabled (default)
 *
 * All functions take the Prisma client from lcyt-backend's initDb() and are async.
 */

/**
 * No-op kept for old callers: the ai_config table comes from the backend schema
 * (prisma/sqlite/schema.sql, prisma/postgres/migrations).
 */
export async function runAiMigrations() {}

/**
 * Valid embedding providers.
 * 'none'   — disabled
 * 'server' — use server-configured embedding API
 * 'openai' — user provides their own OpenAI API key
 * 'custom' — user provides custom embedding API endpoint + key
 * 'deer'   — local embedding model served by @jsilvanus/embedeer (gRPC address in
 *            embedding_api_url, optional model name; no API key)
 */
export const VALID_PROVIDERS = ['none', 'server', 'openai', 'custom', 'deer'];

/**
 * Get AI config for an API key, or null if not configured.
 * @param {import('lcyt-backend/db').Db} db
 * @param {string} apiKey
 * @returns {Promise<object|null>}
 */
export async function getAiConfig(db, apiKey) {
  const row = await db.ai_config.findUnique({ where: { api_key: apiKey } });
  if (!row) return null;
  return {
    embeddingProvider: row.embedding_provider,
    embeddingModel: row.embedding_model,
    embeddingApiKey: row.embedding_api_key ? '***' : '',
    embeddingApiUrl: row.embedding_api_url,
    fuzzyThreshold: row.fuzzy_threshold,
  };
}

/**
 * Get the raw AI config (includes actual API key, for internal use only).
 *
 * ⚠ SECURITY: Returns the real API key — only use in trusted server-side code.
 * For client-facing responses, use getAiConfig() which masks the key.
 *
 * @param {import('lcyt-backend/db').Db} db
 * @param {string} apiKey
 * @returns {Promise<object|null>}
 */
export async function getAiConfigRaw(db, apiKey) {
  const row = await db.ai_config.findUnique({ where: { api_key: apiKey } });
  if (!row) return null;
  return {
    embeddingProvider: row.embedding_provider,
    embeddingModel: row.embedding_model,
    embeddingApiKey: row.embedding_api_key,
    embeddingApiUrl: row.embedding_api_url,
    fuzzyThreshold: row.fuzzy_threshold,
  };
}

/**
 * Upsert AI config for an API key.
 * @param {import('lcyt-backend/db').Db} db
 * @param {string} apiKey
 * @param {object} opts
 */
export async function setAiConfig(db, apiKey, opts) {
  const existing = await db.ai_config.findUnique({ where: { api_key: apiKey }, select: { api_key: true } });
  if (!existing) {
    await db.ai_config.create({
      data: {
        api_key: apiKey,
        embedding_provider: opts.embeddingProvider || 'none',
        embedding_model: opts.embeddingModel || '',
        embedding_api_key: opts.embeddingApiKey || '',
        embedding_api_url: opts.embeddingApiUrl || '',
        fuzzy_threshold: opts.fuzzyThreshold ?? 0.75,
        updated_at: Math.floor(Date.now() / 1000),
      },
    });
  } else {
    const data = {};
    if (opts.embeddingProvider !== undefined) data.embedding_provider = opts.embeddingProvider;
    if (opts.embeddingModel !== undefined) data.embedding_model = opts.embeddingModel;
    if (opts.embeddingApiKey !== undefined) data.embedding_api_key = opts.embeddingApiKey;
    if (opts.embeddingApiUrl !== undefined) data.embedding_api_url = opts.embeddingApiUrl;
    if (opts.fuzzyThreshold !== undefined) data.fuzzy_threshold = opts.fuzzyThreshold;
    if (Object.keys(data).length === 0) return;
    data.updated_at = Math.floor(Date.now() / 1000);
    await db.ai_config.updateMany({ where: { api_key: apiKey }, data });
  }
}
