/**
 * AI / Embedding configuration — DB migrations and helpers.
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
 * @param {import('better-sqlite3').Database} db
 */
export function runAiMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_config (
      api_key             TEXT PRIMARY KEY,
      embedding_provider  TEXT NOT NULL DEFAULT 'none',
      embedding_model     TEXT NOT NULL DEFAULT '',
      embedding_api_key   TEXT NOT NULL DEFAULT '',
      embedding_api_url   TEXT NOT NULL DEFAULT '',
      fuzzy_threshold     REAL NOT NULL DEFAULT 0.75,
      updated_at          INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    )
  `);
}

/**
 * Valid embedding providers.
 * 'none'   — disabled
 * 'server' — use server-configured embedding API
 * 'openai' — user provides their own OpenAI API key
 * 'custom' — user provides custom embedding API endpoint + key
 */
export const VALID_PROVIDERS = ['none', 'server', 'openai', 'custom'];

/**
 * Get AI config for an API key, or null if not configured.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @returns {object|null}
 */
export function getAiConfig(db, apiKey) {
  const row = db.prepare('SELECT * FROM ai_config WHERE api_key = ?').get(apiKey);
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
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @returns {object|null}
 */
export function getAiConfigRaw(db, apiKey) {
  const row = db.prepare('SELECT * FROM ai_config WHERE api_key = ?').get(apiKey);
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
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @param {object} opts
 */
export function setAiConfig(db, apiKey, opts) {
  const existing = db.prepare('SELECT api_key FROM ai_config WHERE api_key = ?').get(apiKey);
  if (!existing) {
    db.prepare(`
      INSERT INTO ai_config (api_key, embedding_provider, embedding_model, embedding_api_key, embedding_api_url, fuzzy_threshold)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      apiKey,
      opts.embeddingProvider || 'none',
      opts.embeddingModel || '',
      opts.embeddingApiKey || '',
      opts.embeddingApiUrl || '',
      opts.fuzzyThreshold ?? 0.75,
    );
  } else {
    const sets = [];
    const vals = [];
    if (opts.embeddingProvider !== undefined) { sets.push('embedding_provider = ?'); vals.push(opts.embeddingProvider); }
    if (opts.embeddingModel !== undefined) { sets.push('embedding_model = ?'); vals.push(opts.embeddingModel); }
    if (opts.embeddingApiKey !== undefined) { sets.push('embedding_api_key = ?'); vals.push(opts.embeddingApiKey); }
    if (opts.embeddingApiUrl !== undefined) { sets.push('embedding_api_url = ?'); vals.push(opts.embeddingApiUrl); }
    if (opts.fuzzyThreshold !== undefined) { sets.push('fuzzy_threshold = ?'); vals.push(opts.fuzzyThreshold); }
    if (sets.length === 0) return;
    sets.push('updated_at = strftime(\'%s\',\'now\')');
    vals.push(apiKey);
    db.prepare(`UPDATE ai_config SET ${sets.join(', ')} WHERE api_key = ?`).run(...vals);
  }
}
