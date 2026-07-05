/**
 * API Connectors & Variables plugin — DB migrations and CRUD helpers.
 *
 * Tables (see docs/plans/plan_api_connectors_variables.md §3):
 *   api_connectors          — outbound HTTP connector definitions (base URL, auth, headers)
 *   api_requests            — nested named requests per connector (method/path/query/body)
 *   api_response_mappings   — JSONPath-to-variable mappings per request
 *   variables               — project-scoped {{name}} values, manual or connector-sourced
 *
 * @param {import('better-sqlite3').Database} db
 */
export function runMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS api_connectors (
      id           TEXT    PRIMARY KEY,
      api_key      TEXT    NOT NULL,
      name         TEXT    NOT NULL,
      slug         TEXT    NOT NULL,
      base_url     TEXT    NOT NULL,
      auth_type    TEXT    NOT NULL DEFAULT 'none',
      auth_config  TEXT    NOT NULL DEFAULT '{}',
      headers      TEXT    NOT NULL DEFAULT '[]',
      created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE (api_key, slug)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_api_connectors_key ON api_connectors(api_key)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS api_requests (
      id                   TEXT    PRIMARY KEY,
      connector_id         TEXT    NOT NULL REFERENCES api_connectors(id) ON DELETE CASCADE,
      name                 TEXT    NOT NULL,
      slug                 TEXT    NOT NULL,
      method               TEXT    NOT NULL,
      path                 TEXT    NOT NULL,
      query_params         TEXT    NOT NULL DEFAULT '[]',
      body_type            TEXT    NOT NULL DEFAULT 'raw',
      body_content         TEXT,
      response_type        TEXT    NOT NULL DEFAULT 'auto',
      prefetch_interval_ms INTEGER NOT NULL DEFAULT 3000,
      timeout_ms           INTEGER NOT NULL DEFAULT 200,
      created_at           TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at           TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE (connector_id, slug)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_api_requests_connector ON api_requests(connector_id)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS api_response_mappings (
      id             TEXT    PRIMARY KEY,
      request_id     TEXT    NOT NULL REFERENCES api_requests(id) ON DELETE CASCADE,
      json_path      TEXT    NOT NULL DEFAULT '$',
      variable_name  TEXT    NOT NULL,
      skip_if_null   INTEGER NOT NULL DEFAULT 1,
      sort_order     INTEGER NOT NULL DEFAULT 0
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_api_response_mappings_request ON api_response_mappings(request_id)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS variables (
      api_key           TEXT    NOT NULL,
      name              TEXT    NOT NULL,
      current_value     TEXT,
      default_value     TEXT,
      source            TEXT    NOT NULL DEFAULT 'manual',
      source_request_id TEXT REFERENCES api_requests(id) ON DELETE SET NULL,
      resolved_at       TEXT,
      updated_at        TEXT    NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (api_key, name)
    )
  `);
}

// ---------------------------------------------------------------------------
// Connector CRUD
// ---------------------------------------------------------------------------

export function listConnectors(db, apiKey) {
  return db.prepare('SELECT * FROM api_connectors WHERE api_key = ? ORDER BY created_at').all(apiKey);
}

export function getConnectorBySlug(db, apiKey, slug) {
  return db.prepare('SELECT * FROM api_connectors WHERE api_key = ? AND slug = ?').get(apiKey, slug);
}

export function getConnectorById(db, id) {
  return db.prepare('SELECT * FROM api_connectors WHERE id = ?').get(id);
}

export function createConnector(db, apiKey, { id, name, slug, baseUrl, authType, authConfig, headers }) {
  db.prepare(`
    INSERT INTO api_connectors (id, api_key, name, slug, base_url, auth_type, auth_config, headers)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, apiKey, name, slug, baseUrl, authType || 'none', JSON.stringify(authConfig || {}), JSON.stringify(headers || []));
  return getConnectorById(db, id);
}

export function updateConnector(db, id, fields) {
  const existing = getConnectorById(db, id);
  if (!existing) return null;
  const next = {
    name: fields.name !== undefined ? fields.name : existing.name,
    slug: fields.slug !== undefined ? fields.slug : existing.slug,
    base_url: fields.baseUrl !== undefined ? fields.baseUrl : existing.base_url,
    auth_type: fields.authType !== undefined ? fields.authType : existing.auth_type,
    auth_config: fields.authConfig !== undefined ? JSON.stringify(fields.authConfig) : existing.auth_config,
    headers: fields.headers !== undefined ? JSON.stringify(fields.headers) : existing.headers,
  };
  db.prepare(`
    UPDATE api_connectors
    SET name = ?, slug = ?, base_url = ?, auth_type = ?, auth_config = ?, headers = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(next.name, next.slug, next.base_url, next.auth_type, next.auth_config, next.headers, id);
  return getConnectorById(db, id);
}

export function deleteConnector(db, id) {
  return db.prepare('DELETE FROM api_connectors WHERE id = ?').run(id).changes > 0;
}

/** Mask auth_config for client responses — never expose raw secrets. */
export function maskConnector(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    baseUrl: row.base_url,
    authType: row.auth_type,
    authConfigured: row.auth_type !== 'none' && row.auth_config !== '{}',
    headers: JSON.parse(row.headers || '[]'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Request CRUD
// ---------------------------------------------------------------------------

export function listRequests(db, connectorId) {
  return db.prepare('SELECT * FROM api_requests WHERE connector_id = ? ORDER BY created_at').all(connectorId);
}

export function getRequestBySlug(db, connectorId, slug) {
  return db.prepare('SELECT * FROM api_requests WHERE connector_id = ? AND slug = ?').get(connectorId, slug);
}

export function getRequestById(db, id) {
  return db.prepare('SELECT * FROM api_requests WHERE id = ?').get(id);
}

export function createRequest(db, connectorId, {
  id, name, slug, method, path, queryParams, bodyType, bodyContent,
  responseType, prefetchIntervalMs, timeoutMs,
}) {
  db.prepare(`
    INSERT INTO api_requests
      (id, connector_id, name, slug, method, path, query_params, body_type, body_content,
       response_type, prefetch_interval_ms, timeout_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, connectorId, name, slug, method, path,
    JSON.stringify(queryParams || []), bodyType || 'raw', bodyContent ?? null,
    responseType || 'auto',
    clampInterval(prefetchIntervalMs, 3000),
    clampTimeout(timeoutMs, 200),
  );
  return getRequestById(db, id);
}

export function updateRequest(db, id, fields) {
  const existing = getRequestById(db, id);
  if (!existing) return null;
  const next = {
    name: fields.name !== undefined ? fields.name : existing.name,
    slug: fields.slug !== undefined ? fields.slug : existing.slug,
    method: fields.method !== undefined ? fields.method : existing.method,
    path: fields.path !== undefined ? fields.path : existing.path,
    query_params: fields.queryParams !== undefined ? JSON.stringify(fields.queryParams) : existing.query_params,
    body_type: fields.bodyType !== undefined ? fields.bodyType : existing.body_type,
    body_content: fields.bodyContent !== undefined ? fields.bodyContent : existing.body_content,
    response_type: fields.responseType !== undefined ? fields.responseType : existing.response_type,
    prefetch_interval_ms: fields.prefetchIntervalMs !== undefined
      ? clampInterval(fields.prefetchIntervalMs, existing.prefetch_interval_ms)
      : existing.prefetch_interval_ms,
    timeout_ms: fields.timeoutMs !== undefined
      ? clampTimeout(fields.timeoutMs, existing.timeout_ms)
      : existing.timeout_ms,
  };
  db.prepare(`
    UPDATE api_requests
    SET name = ?, slug = ?, method = ?, path = ?, query_params = ?, body_type = ?, body_content = ?,
        response_type = ?, prefetch_interval_ms = ?, timeout_ms = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    next.name, next.slug, next.method, next.path, next.query_params, next.body_type, next.body_content,
    next.response_type, next.prefetch_interval_ms, next.timeout_ms, id,
  );
  return getRequestById(db, id);
}

export function deleteRequest(db, id) {
  return db.prepare('DELETE FROM api_requests WHERE id = ?').run(id).changes > 0;
}

function clampInterval(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.round(n);
}

function clampTimeout(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(250, Math.max(150, Math.round(n)));
}

// ---------------------------------------------------------------------------
// Response mapping CRUD
// ---------------------------------------------------------------------------

export function listMappings(db, requestId) {
  return db.prepare('SELECT * FROM api_response_mappings WHERE request_id = ? ORDER BY sort_order').all(requestId);
}

export function getMappingById(db, id) {
  return db.prepare('SELECT * FROM api_response_mappings WHERE id = ?').get(id);
}

export function createMapping(db, requestId, { id, jsonPath, variableName, skipIfNull, sortOrder }) {
  db.prepare(`
    INSERT INTO api_response_mappings (id, request_id, json_path, variable_name, skip_if_null, sort_order)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, requestId, jsonPath || '$', variableName, skipIfNull === false ? 0 : 1, sortOrder || 0);
  return getMappingById(db, id);
}

export function updateMapping(db, id, fields) {
  const existing = getMappingById(db, id);
  if (!existing) return null;
  const next = {
    json_path: fields.jsonPath !== undefined ? fields.jsonPath : existing.json_path,
    variable_name: fields.variableName !== undefined ? fields.variableName : existing.variable_name,
    skip_if_null: fields.skipIfNull !== undefined ? (fields.skipIfNull ? 1 : 0) : existing.skip_if_null,
    sort_order: fields.sortOrder !== undefined ? fields.sortOrder : existing.sort_order,
  };
  db.prepare(`
    UPDATE api_response_mappings
    SET json_path = ?, variable_name = ?, skip_if_null = ?, sort_order = ?
    WHERE id = ?
  `).run(next.json_path, next.variable_name, next.skip_if_null, next.sort_order, id);
  return getMappingById(db, id);
}

export function deleteMapping(db, id) {
  return db.prepare('DELETE FROM api_response_mappings WHERE id = ?').run(id).changes > 0;
}

// ---------------------------------------------------------------------------
// Variable CRUD
// ---------------------------------------------------------------------------

export function listVariables(db, apiKey) {
  return db.prepare('SELECT * FROM variables WHERE api_key = ? ORDER BY name').all(apiKey);
}

export function getVariable(db, apiKey, name) {
  return db.prepare('SELECT * FROM variables WHERE api_key = ? AND name = ?').get(apiKey, name);
}

export function upsertManualVariable(db, apiKey, name, { value, defaultValue }) {
  const existing = getVariable(db, apiKey, name);
  if (!existing) {
    db.prepare(`
      INSERT INTO variables (api_key, name, current_value, default_value, source, resolved_at, updated_at)
      VALUES (?, ?, ?, ?, 'manual', CASE WHEN ? IS NULL THEN NULL ELSE datetime('now') END, datetime('now'))
    `).run(apiKey, name, value ?? null, defaultValue ?? null, value ?? null);
    return getVariable(db, apiKey, name);
  }
  const nextValue = value !== undefined ? value : existing.current_value;
  const nextDefault = defaultValue !== undefined ? defaultValue : existing.default_value;
  db.prepare(`
    UPDATE variables
    SET current_value = ?, default_value = ?, source = 'manual',
        resolved_at = CASE WHEN ? THEN datetime('now') ELSE resolved_at END,
        updated_at = datetime('now')
    WHERE api_key = ? AND name = ?
  `).run(nextValue ?? null, nextDefault ?? null, value !== undefined ? 1 : 0, apiKey, name);
  return getVariable(db, apiKey, name);
}

/** Set a variable's resolved value from a connector call. */
export function setConnectorVariable(db, apiKey, name, value, sourceRequestId) {
  const existing = getVariable(db, apiKey, name);
  if (!existing) {
    db.prepare(`
      INSERT INTO variables (api_key, name, current_value, default_value, source, source_request_id, resolved_at, updated_at)
      VALUES (?, ?, ?, NULL, 'connector', ?, datetime('now'), datetime('now'))
    `).run(apiKey, name, value ?? null, sourceRequestId);
  } else {
    db.prepare(`
      UPDATE variables
      SET current_value = ?, source = 'connector', source_request_id = ?, resolved_at = datetime('now'), updated_at = datetime('now')
      WHERE api_key = ? AND name = ?
    `).run(value ?? null, sourceRequestId, apiKey, name);
  }
  return getVariable(db, apiKey, name);
}

export function deleteVariable(db, apiKey, name) {
  return db.prepare('DELETE FROM variables WHERE api_key = ? AND name = ?').run(apiKey, name).changes > 0;
}

/** Resolve a variable's effective value for {{ }} interpolation: current -> default -> ''. */
export function resolveVariableValue(row) {
  if (!row) return '';
  if (row.current_value !== null && row.current_value !== undefined) return row.current_value;
  if (row.default_value !== null && row.default_value !== undefined) return row.default_value;
  return '';
}
