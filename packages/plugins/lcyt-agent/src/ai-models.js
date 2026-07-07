export function runAiModelMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_model_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      api_key TEXT NOT NULL,
      role_code TEXT NOT NULL DEFAULT 'assistant',
      provider TEXT NOT NULL DEFAULT 'api',
      model_name TEXT NOT NULL DEFAULT '',
      api_url TEXT NOT NULL DEFAULT '',
      api_key_ref TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_ai_model_configs_api_key
      ON ai_model_configs(api_key);
  `);
}

export function listAiModelConfigs(db, apiKey) {
  const rows = db.prepare(`
    SELECT id, role_code, provider, model_name, api_url, api_key_ref, enabled, created_at, updated_at
    FROM ai_model_configs
    WHERE api_key = ?
    ORDER BY id ASC
  `).all(apiKey);

  return rows.map(row => ({
    id: row.id,
    roleCode: row.role_code,
    provider: row.provider,
    modelName: row.model_name,
    apiUrl: row.api_url,
    apiKey: '',
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export function getAiModelConfig(db, apiKey, roleCode) {
  const row = db.prepare(`
    SELECT id, role_code, provider, model_name, api_url, api_key_ref, enabled, created_at, updated_at
    FROM ai_model_configs
    WHERE api_key = ? AND role_code = ?
    LIMIT 1
  `).get(apiKey, roleCode);

  if (!row) return null;
  return {
    id: row.id,
    roleCode: row.role_code,
    provider: row.provider,
    modelName: row.model_name,
    apiUrl: row.api_url,
    apiKey: '',
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function setAiModelConfig(db, apiKey, opts = {}) {
  const roleCode = opts.roleCode || 'assistant';
  const provider = opts.provider || 'api';
  const modelName = opts.modelName || '';
  const apiUrl = opts.apiUrl || '';
  const apiKeyRef = opts.apiKey || '';
  const enabled = opts.enabled === undefined ? 1 : (opts.enabled ? 1 : 0);

  const existing = db.prepare('SELECT id FROM ai_model_configs WHERE api_key = ? AND role_code = ?').get(apiKey, roleCode);
  if (existing) {
    db.prepare(`
      UPDATE ai_model_configs
      SET provider = ?, model_name = ?, api_url = ?, api_key_ref = ?, enabled = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(provider, modelName, apiUrl, apiKeyRef, enabled, existing.id);
    return getAiModelConfig(db, apiKey, roleCode);
  }

  const info = db.prepare(`
    INSERT INTO ai_model_configs (api_key, role_code, provider, model_name, api_url, api_key_ref, enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(apiKey, roleCode, provider, modelName, apiUrl, apiKeyRef, enabled);

  return getAiModelConfig(db, apiKey, roleCode);
}

export function deleteAiModelConfig(db, apiKey, id) {
  const existing = db.prepare('SELECT id FROM ai_model_configs WHERE api_key = ? AND id = ?').get(apiKey, id);
  if (!existing) return false;
  db.prepare('DELETE FROM ai_model_configs WHERE api_key = ? AND id = ?').run(apiKey, id);
  return true;
}
