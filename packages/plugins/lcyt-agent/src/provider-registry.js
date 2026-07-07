/**
 * AI Model Registry — providers, model catalogs, and grants (plan/ai_model_registry).
 *
 * Tables:
 *   ai_providers        — registry of model sources: cloud API, self-hosted Ollama,
 *                         in-process 'deer' runtimes. Site-scope (admin-curated)
 *                         or project-scope (owned by one api_key).
 *   ai_provider_models  — per-provider model catalog. Only ever populated for
 *                         'ollama' providers (discovered via /api/tags or added
 *                         manually); 'api' providers use free-text model names.
 *   ai_provider_grants  — default-deny visibility of site-scope providers to
 *                         projects (same posture as connector_network_rules).
 *
 * Reachability (direct vs. bridge-relayed) is derived from
 * `bridge_instance_id IS NOT NULL`, never stored separately.
 */

import { randomUUID } from 'node:crypto';

export const PROVIDER_KINDS = ['api', 'ollama', 'deer'];
export const PROVIDER_VENDORS = ['openai', 'google', 'anthropic', 'ollama', 'deer', 'custom'];
export const PROVIDER_SCOPES = ['site', 'project'];
export const MODEL_CAPABILITIES = ['embedding', 'vision', 'chat', 'translation'];

/**
 * Run DB migrations for the provider registry tables.
 * @param {import('better-sqlite3').Database} db
 */
export function runProviderRegistryMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_providers (
      id                   TEXT PRIMARY KEY,
      scope                TEXT NOT NULL,
      owner_api_key        TEXT,
      kind                 TEXT NOT NULL,
      vendor               TEXT NOT NULL DEFAULT 'custom',
      name                 TEXT NOT NULL,
      base_url             TEXT NOT NULL DEFAULT '',
      api_key_ref          TEXT NOT NULL DEFAULT '',
      bridge_instance_id   TEXT,
      enabled              INTEGER NOT NULL DEFAULT 1,
      last_discovery_at    TEXT,
      last_discovery_error TEXT,
      created_at           TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ai_providers_owner ON ai_providers(owner_api_key);

    CREATE TABLE IF NOT EXISTS ai_provider_models (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      provider_id     TEXT    NOT NULL REFERENCES ai_providers(id),
      model_name      TEXT    NOT NULL,
      capabilities    TEXT    NOT NULL DEFAULT '[]',
      source          TEXT    NOT NULL DEFAULT 'manual',
      enabled         INTEGER NOT NULL DEFAULT 1,
      parameter_size  TEXT,
      quantization    TEXT,
      discovered_at   TEXT,
      last_seen_at    TEXT,
      UNIQUE (provider_id, model_name)
    );
    CREATE INDEX IF NOT EXISTS idx_ai_provider_models_provider ON ai_provider_models(provider_id);

    CREATE TABLE IF NOT EXISTS ai_provider_grants (
      api_key      TEXT    NOT NULL,
      provider_id  TEXT    NOT NULL REFERENCES ai_providers(id),
      enabled      INTEGER NOT NULL DEFAULT 1,
      UNIQUE (api_key, provider_id)
    );
    CREATE INDEX IF NOT EXISTS idx_ai_provider_grants_key ON ai_provider_grants(api_key);
  `);
}

/**
 * Validate provider fields shared by create and update.
 * @returns {string|null} — error message, or null when valid
 */
export function validateProviderInput(input, { partial = false } = {}) {
  const has = (f) => input[f] !== undefined;
  if ((!partial || has('scope')) && !PROVIDER_SCOPES.includes(input.scope)) {
    return `scope must be one of: ${PROVIDER_SCOPES.join(', ')}`;
  }
  if ((!partial || has('kind')) && !PROVIDER_KINDS.includes(input.kind)) {
    return `kind must be one of: ${PROVIDER_KINDS.join(', ')}`;
  }
  if (has('vendor') && !PROVIDER_VENDORS.includes(input.vendor)) {
    return `vendor must be one of: ${PROVIDER_VENDORS.join(', ')}`;
  }
  if ((!partial || has('name')) && (typeof input.name !== 'string' || !input.name.trim())) {
    return 'name is required';
  }
  if (!partial && input.scope === 'project' && !input.ownerApiKey) {
    return 'ownerApiKey is required for project-scope providers';
  }
  const kind = input.kind;
  if (kind && kind !== 'deer' && !partial && (typeof input.baseUrl !== 'string' || !input.baseUrl.trim())) {
    return 'baseUrl is required for api/ollama providers';
  }
  return null;
}

/**
 * Create a provider. Caller is responsible for validation (validateProviderInput).
 * @param {import('better-sqlite3').Database} db
 * @param {object} input — { scope, ownerApiKey?, kind, vendor?, name, baseUrl?, apiKeyRef?, bridgeInstanceId?, enabled? }
 * @returns {object} — the created row, masked
 */
export function createProvider(db, input) {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO ai_providers (id, scope, owner_api_key, kind, vendor, name, base_url, api_key_ref, bridge_instance_id, enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.scope,
    input.scope === 'project' ? input.ownerApiKey : null,
    input.kind,
    input.vendor || 'custom',
    input.name.trim(),
    input.baseUrl?.trim() || '',
    input.apiKeyRef || '',
    input.bridgeInstanceId || null,
    input.enabled === false ? 0 : 1,
  );
  return maskProvider(getProvider(db, id));
}

/**
 * Get the raw provider row (includes api_key_ref — internal use only).
 * @param {import('better-sqlite3').Database} db
 * @param {string} id
 * @returns {object|null}
 */
export function getProvider(db, id) {
  return db.prepare('SELECT * FROM ai_providers WHERE id = ?').get(id) ?? null;
}

/**
 * Update a provider. Only provided fields change. Scope/owner never change.
 * @returns {object|null} — updated masked row, or null when not found
 */
export function updateProvider(db, id, input) {
  const existing = getProvider(db, id);
  if (!existing) return null;
  const sets = [];
  const vals = [];
  if (input.kind !== undefined) { sets.push('kind = ?'); vals.push(input.kind); }
  if (input.vendor !== undefined) { sets.push('vendor = ?'); vals.push(input.vendor); }
  if (input.name !== undefined) { sets.push('name = ?'); vals.push(String(input.name).trim()); }
  if (input.baseUrl !== undefined) { sets.push('base_url = ?'); vals.push(String(input.baseUrl).trim()); }
  if (input.apiKeyRef !== undefined) { sets.push('api_key_ref = ?'); vals.push(input.apiKeyRef); }
  if (input.bridgeInstanceId !== undefined) { sets.push('bridge_instance_id = ?'); vals.push(input.bridgeInstanceId || null); }
  if (input.enabled !== undefined) { sets.push('enabled = ?'); vals.push(input.enabled ? 1 : 0); }
  if (sets.length > 0) {
    vals.push(id);
    db.prepare(`UPDATE ai_providers SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  }
  return maskProvider(getProvider(db, id));
}

/**
 * Delete a provider and its catalog/grant rows.
 * @returns {boolean}
 */
export function deleteProvider(db, id) {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM ai_provider_models WHERE provider_id = ?').run(id);
    db.prepare('DELETE FROM ai_provider_grants WHERE provider_id = ?').run(id);
    return db.prepare('DELETE FROM ai_providers WHERE id = ?').run(id).changes > 0;
  });
  return tx();
}

/**
 * Mask a provider row for client responses: strips api_key_ref, exposes
 * credentialConfigured (same convention as ai-config.js / connectors).
 * @param {object|null} row
 * @returns {object|null}
 */
export function maskProvider(row) {
  if (!row) return null;
  return {
    id: row.id,
    scope: row.scope,
    ownerApiKey: row.owner_api_key,
    kind: row.kind,
    vendor: row.vendor,
    name: row.name,
    baseUrl: row.base_url,
    credentialConfigured: !!row.api_key_ref,
    bridgeInstanceId: row.bridge_instance_id,
    // Derived, never stored: a provider with a bridge instance is only
    // reachable through that bridge's SSE command channel.
    reachability: row.bridge_instance_id ? 'bridge' : 'direct',
    enabled: row.enabled === 1,
    lastDiscoveryAt: row.last_discovery_at,
    lastDiscoveryError: row.last_discovery_error,
    createdAt: row.created_at,
  };
}

/**
 * List all site-scope providers (admin view).
 */
export function listSiteProviders(db) {
  return db.prepare("SELECT * FROM ai_providers WHERE scope = 'site' ORDER BY created_at").all()
    .map(maskProvider);
}

/**
 * Providers visible to a project: its own project-scope rows plus any
 * site-scope rows granted to it (default-deny).
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 */
export function listVisibleProviders(db, apiKey) {
  return db.prepare(`
    SELECT p.* FROM ai_providers p
      WHERE p.scope = 'project' AND p.owner_api_key = ?
    UNION
    SELECT p.* FROM ai_providers p
      JOIN ai_provider_grants g ON g.provider_id = p.id
      WHERE p.scope = 'site' AND g.api_key = ? AND g.enabled = 1
    ORDER BY created_at
  `).all(apiKey, apiKey).map(maskProvider);
}

/**
 * Is this provider visible to this project (own project-scope, or granted site-scope)?
 * @returns {boolean}
 */
export function isProviderVisible(db, providerRow, apiKey) {
  if (!providerRow) return false;
  if (providerRow.scope === 'project') return providerRow.owner_api_key === apiKey;
  const grant = db.prepare(
    'SELECT enabled FROM ai_provider_grants WHERE provider_id = ? AND api_key = ?'
  ).get(providerRow.id, apiKey);
  return grant?.enabled === 1;
}

/**
 * Grant or revoke a project's visibility into a site-scope provider.
 */
export function setGrant(db, providerId, apiKey, enabled) {
  db.prepare(`
    INSERT INTO ai_provider_grants (api_key, provider_id, enabled) VALUES (?, ?, ?)
    ON CONFLICT (api_key, provider_id) DO UPDATE SET enabled = excluded.enabled
  `).run(apiKey, providerId, enabled ? 1 : 0);
}

/**
 * List grants for a provider (admin view: which projects can see it).
 */
export function listGrants(db, providerId) {
  return db.prepare(
    'SELECT api_key, enabled FROM ai_provider_grants WHERE provider_id = ? ORDER BY api_key'
  ).all(providerId).map((row) => ({ apiKey: row.api_key, enabled: row.enabled === 1 }));
}

// ---------------------------------------------------------------------------
// Model catalog — only ever populated for 'ollama' providers
// ---------------------------------------------------------------------------

function formatModel(row) {
  let capabilities = [];
  try { capabilities = JSON.parse(row.capabilities); } catch { /* keep [] */ }
  return {
    id: row.id,
    providerId: row.provider_id,
    modelName: row.model_name,
    capabilities,
    source: row.source,
    enabled: row.enabled === 1,
    parameterSize: row.parameter_size,
    quantization: row.quantization,
    discoveredAt: row.discovered_at,
    lastSeenAt: row.last_seen_at,
  };
}

export function listProviderModels(db, providerId) {
  return db.prepare(
    'SELECT * FROM ai_provider_models WHERE provider_id = ? ORDER BY model_name'
  ).all(providerId).map(formatModel);
}

/**
 * Manually add a model row (ollama providers only — pre-register a model
 * before it's pulled; api providers have no catalog by design).
 * @returns {object|null} — the created model, or null on duplicate
 */
export function addManualModel(db, providerId, { modelName, capabilities = [] }) {
  try {
    const info = db.prepare(`
      INSERT INTO ai_provider_models (provider_id, model_name, capabilities, source)
      VALUES (?, ?, ?, 'manual')
    `).run(providerId, modelName, JSON.stringify(capabilities));
    return formatModel(db.prepare('SELECT * FROM ai_provider_models WHERE id = ?').get(info.lastInsertRowid));
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) return null;
    throw err;
  }
}

/**
 * Edit a model's capabilities / enabled flag.
 * @returns {object|null}
 */
export function updateModel(db, providerId, modelId, { capabilities, enabled }) {
  const sets = [];
  const vals = [];
  if (capabilities !== undefined) { sets.push('capabilities = ?'); vals.push(JSON.stringify(capabilities)); }
  if (enabled !== undefined) { sets.push('enabled = ?'); vals.push(enabled ? 1 : 0); }
  if (sets.length === 0) {
    const row = db.prepare('SELECT * FROM ai_provider_models WHERE id = ? AND provider_id = ?').get(modelId, providerId);
    return row ? formatModel(row) : null;
  }
  vals.push(modelId, providerId);
  const info = db.prepare(
    `UPDATE ai_provider_models SET ${sets.join(', ')} WHERE id = ? AND provider_id = ?`
  ).run(...vals);
  if (info.changes === 0) return null;
  return formatModel(db.prepare('SELECT * FROM ai_provider_models WHERE id = ?').get(modelId));
}

export function deleteModel(db, providerId, modelId) {
  return db.prepare(
    'DELETE FROM ai_provider_models WHERE id = ? AND provider_id = ?'
  ).run(modelId, providerId).changes > 0;
}
