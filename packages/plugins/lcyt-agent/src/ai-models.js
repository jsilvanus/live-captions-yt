import { createHash, randomBytes } from 'node:crypto';

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

export function runMcpTokenMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_mcp_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      api_key TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      token_hash TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_by_user_id INTEGER,
      created_by_name TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT,
      revoked_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_agent_mcp_tokens_api_key
      ON agent_mcp_tokens(api_key);
  `);
}

export function createMcpToken(db, apiKey, opts = {}) {
  const label = (opts.label || '').trim();
  if (!label) throw new Error('label is required');
  const token = `lcytmcp_${randomBytes(32).toString('hex')}`;
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const active = opts.active === undefined ? 1 : (opts.active ? 1 : 0);
  const createdByName = (opts.createdByName || '').trim() || (opts.createdByEmail || '').trim() || 'Unknown';
  const createdByUserId = opts.createdByUserId ?? null;

  const info = db.prepare(`
    INSERT INTO agent_mcp_tokens (api_key, label, token_hash, active, created_by_user_id, created_by_name)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(apiKey, label, tokenHash, active, createdByUserId, createdByName);

  return {
    id: info.lastInsertRowid,
    token,
    label,
    active: active === 1,
    createdByName,
    createdAt: new Date().toISOString(),
  };
}

export function listMcpTokens(db, apiKey) {
  const rows = db.prepare(`
    SELECT id, label, active, created_by_name, created_at, last_used_at, revoked_at
    FROM agent_mcp_tokens
    WHERE api_key = ? AND revoked_at IS NULL
    ORDER BY id ASC
  `).all(apiKey);

  return rows.map(row => ({
    id: row.id,
    label: row.label,
    active: row.active === 1,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  }));
}

export function updateMcpToken(db, apiKey, id, opts = {}) {
  const existing = db.prepare('SELECT id FROM agent_mcp_tokens WHERE api_key = ? AND id = ? AND revoked_at IS NULL').get(apiKey, id);
  if (!existing) return null;

  const parts = [];
  const values = [];
  if (opts.label !== undefined) { parts.push('label = ?'); values.push((opts.label || '').trim()); }
  if (opts.active !== undefined) { parts.push('active = ?'); values.push(opts.active ? 1 : 0); }
  if (opts.createdByName !== undefined) { parts.push('created_by_name = ?'); values.push((opts.createdByName || '').trim()); }

  if (parts.length === 0) return listMcpTokens(db, apiKey).find(item => item.id === id) || null;

  values.push(id);
  values.unshift(apiKey);
  db.prepare(`UPDATE agent_mcp_tokens SET ${parts.join(', ')} WHERE api_key = ? AND id = ?`).run(...values);
  return listMcpTokens(db, apiKey).find(item => item.id === id) || null;
}

export function revokeMcpToken(db, apiKey, id) {
  const existing = db.prepare('SELECT id FROM agent_mcp_tokens WHERE api_key = ? AND id = ? AND revoked_at IS NULL').get(apiKey, id);
  if (!existing) return false;
  db.prepare("UPDATE agent_mcp_tokens SET revoked_at = datetime('now'), active = 0 WHERE api_key = ? AND id = ?").run(apiKey, id);
  return true;
}
