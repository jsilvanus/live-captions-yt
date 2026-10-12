/**
 * API Connectors & Variables plugin — CRUD helpers on the Prisma client from lcyt-backend's initDb().
 *
 * Tables (created by the backend schema; see docs/plans/plan_api_connectors_variables.md §3):
 *   api_connectors          — outbound HTTP connector definitions (base URL, auth, headers)
 *   api_requests            — nested named requests per connector (method/path/query/body)
 *   api_response_mappings   — JSONPath-to-variable mappings per request
 *   variables               — project-scoped {{name}} values, manual or connector-sourced
 *   connector_network_rules — SSRF guard allow/deny rules (global and per org)
 *
 * Every function is async.
 */

/** No-op kept for old callers: the tables come from the backend schema. */
export async function runMigrations() {}

// ---------------------------------------------------------------------------
// Connector CRUD
// ---------------------------------------------------------------------------

const now = (db) => db.$util.sqlNow();
// The old better-sqlite3 helpers returned undefined for a missing row; keep that.
const orUndef = (row) => row ?? undefined;

export async function listConnectors(db, apiKey) {
  return db.api_connectors.findMany({ where: { api_key: apiKey }, orderBy: { created_at: 'asc' } });
}

export async function getConnectorBySlug(db, apiKey, slug) {
  return orUndef(await db.api_connectors.findUnique({ where: { api_key_slug: { api_key: apiKey, slug } } }));
}

export async function getConnectorById(db, id) {
  return orUndef(await db.api_connectors.findUnique({ where: { id } }));
}

export async function createConnector(db, apiKey, { id, name, slug, baseUrl, authType, authConfig, headers }) {
  await db.api_connectors.create({
    data: {
      id, api_key: apiKey, name, slug, base_url: baseUrl,
      auth_type: authType || 'none',
      auth_config: JSON.stringify(authConfig || {}),
      headers: JSON.stringify(headers || []),
    },
  });
  return getConnectorById(db, id);
}

export async function updateConnector(db, id, fields) {
  const existing = await getConnectorById(db, id);
  if (!existing) return null;
  const next = {
    name: fields.name !== undefined ? fields.name : existing.name,
    slug: fields.slug !== undefined ? fields.slug : existing.slug,
    base_url: fields.baseUrl !== undefined ? fields.baseUrl : existing.base_url,
    auth_type: fields.authType !== undefined ? fields.authType : existing.auth_type,
    auth_config: fields.authConfig !== undefined ? JSON.stringify(fields.authConfig) : existing.auth_config,
    headers: fields.headers !== undefined ? JSON.stringify(fields.headers) : existing.headers,
  };
  await db.api_connectors.updateMany({ where: { id }, data: { ...next, updated_at: now(db) } });
  return getConnectorById(db, id);
}

export async function deleteConnector(db, id) {
  return (await db.api_connectors.deleteMany({ where: { id } })).count > 0;
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

export async function listRequests(db, connectorId) {
  return db.api_requests.findMany({ where: { connector_id: connectorId }, orderBy: { created_at: 'asc' } });
}

export async function getRequestBySlug(db, connectorId, slug) {
  return orUndef(await db.api_requests.findUnique({ where: { connector_id_slug: { connector_id: connectorId, slug } } }));
}

export async function getRequestById(db, id) {
  return orUndef(await db.api_requests.findUnique({ where: { id } }));
}

export async function createRequest(db, connectorId, {
  id, name, slug, method, path, queryParams, bodyType, bodyContent,
  responseType, prefetchIntervalMs, timeoutMs,
}) {
  await db.api_requests.create({
    data: {
      id, connector_id: connectorId, name, slug, method, path,
      query_params: JSON.stringify(queryParams || []),
      body_type: bodyType || 'raw',
      body_content: bodyContent ?? null,
      response_type: responseType || 'auto',
      prefetch_interval_ms: clampInterval(prefetchIntervalMs, 3000),
      timeout_ms: clampTimeout(timeoutMs, 200),
    },
  });
  return getRequestById(db, id);
}

export async function updateRequest(db, id, fields) {
  const existing = await getRequestById(db, id);
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
  await db.api_requests.updateMany({ where: { id }, data: { ...next, updated_at: now(db) } });
  return getRequestById(db, id);
}

export async function deleteRequest(db, id) {
  return (await db.api_requests.deleteMany({ where: { id } })).count > 0;
}

/** Toggle a request's constant-poll flag (see PollScheduler). Returns the updated row. */
export async function setConstantPoll(db, id, enabled) {
  await db.api_requests.updateMany({
    where: { id },
    data: { constant_poll_enabled: enabled ? 1 : 0, updated_at: now(db) },
  });
  return getRequestById(db, id);
}

/**
 * Every request currently opted into constant polling, across all projects —
 * joined with its owning connector so PollScheduler.restore() has the
 * (apiKey, connectorSlug, requestSlug) triple fireRequest() needs.
 */
export async function listConstantPollRequests(db) {
  const rows = await db.api_requests.findMany({
    where: { constant_poll_enabled: 1 },
    include: { api_connectors: { select: { api_key: true, slug: true } } },
  });
  return rows.map((r) => ({
    request_id: r.id,
    request_slug: r.slug,
    interval_ms: r.prefetch_interval_ms,
    api_key: r.api_connectors.api_key,
    connector_slug: r.api_connectors.slug,
  }));
}

/**
 * Resolve one request's current constant-poll target by its stable id —
 * PollScheduler calls this fresh on every fire (see poll-scheduler.js) so a
 * connector/request slug rename takes effect on the next tick automatically,
 * with no explicit re-keying needed anywhere. Returns undefined if the
 * request (or its connector) no longer exists — the scheduler treats that
 * as "stop polling, nothing left to fire".
 */
export async function getConstantPollTarget(db, requestId) {
  const r = await db.api_requests.findUnique({
    where: { id: requestId },
    include: { api_connectors: { select: { api_key: true, slug: true } } },
  });
  if (!r) return undefined;
  return {
    request_id: r.id,
    request_slug: r.slug,
    interval_ms: r.prefetch_interval_ms,
    constant_poll_enabled: r.constant_poll_enabled,
    api_key: r.api_connectors.api_key,
    connector_slug: r.api_connectors.slug,
  };
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

export async function listMappings(db, requestId) {
  return db.api_response_mappings.findMany({ where: { request_id: requestId }, orderBy: { sort_order: 'asc' } });
}

export async function getMappingById(db, id) {
  return orUndef(await db.api_response_mappings.findUnique({ where: { id } }));
}

export async function createMapping(db, requestId, { id, jsonPath, variableName, skipIfNull, sortOrder }) {
  await db.api_response_mappings.create({
    data: {
      id, request_id: requestId, json_path: jsonPath || '$', variable_name: variableName,
      skip_if_null: skipIfNull === false ? 0 : 1, sort_order: sortOrder || 0,
    },
  });
  return getMappingById(db, id);
}

export async function updateMapping(db, id, fields) {
  const existing = await getMappingById(db, id);
  if (!existing) return null;
  const next = {
    json_path: fields.jsonPath !== undefined ? fields.jsonPath : existing.json_path,
    variable_name: fields.variableName !== undefined ? fields.variableName : existing.variable_name,
    skip_if_null: fields.skipIfNull !== undefined ? (fields.skipIfNull ? 1 : 0) : existing.skip_if_null,
    sort_order: fields.sortOrder !== undefined ? fields.sortOrder : existing.sort_order,
  };
  await db.api_response_mappings.updateMany({ where: { id }, data: next });
  return getMappingById(db, id);
}

export async function deleteMapping(db, id) {
  return (await db.api_response_mappings.deleteMany({ where: { id } })).count > 0;
}

// ---------------------------------------------------------------------------
// Variable CRUD
// ---------------------------------------------------------------------------

export async function listVariables(db, apiKey) {
  const rows = await db.variables.findMany({ where: { api_key: apiKey } });
  // Plain code-unit order like SQLite's BINARY collation, so PostgreSQL's locale collation cannot reorder names.
  return rows.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

export async function getVariable(db, apiKey, name) {
  return orUndef(await db.variables.findUnique({ where: { api_key_name: { api_key: apiKey, name } } }));
}

/**
 * Compute the five TTL columns for a write. `ttl` is null (clear any pending
 * expiry — last-write-wins) or { ms, captions, revertMode, revertValue }.
 * `prevValue` is the variable's value *before* this write, captured for the
 * 'previous' revert mode.
 */
function computeTtlColumns(ttl, prevValue) {
  if (!ttl || (ttl.ms == null && ttl.captions == null)) {
    return { expires_at: null, expires_at_seq: null, revert_mode: null, revert_value: null, prev_value: null };
  }
  return {
    expires_at: ttl.ms != null ? new Date(Date.now() + ttl.ms).toISOString() : null,
    expires_at_seq: ttl.captions != null ? ttl.captions : null,
    revert_mode: ttl.revertMode || 'baseline',
    revert_value: ttl.revertMode === 'literal' ? (ttl.revertValue ?? '') : null,
    prev_value: ttl.revertMode === 'previous' ? (prevValue ?? null) : null,
  };
}

export async function upsertManualVariable(db, apiKey, name, { value, defaultValue, ttl = null, source = 'manual' } = {}) {
  const existing = await getVariable(db, apiKey, name);
  const nextValue = value !== undefined ? value : (existing ? existing.current_value : null);
  const nextDefault = defaultValue !== undefined ? defaultValue : (existing ? existing.default_value : null);
  const resolvedBumped = value !== undefined;
  const t = computeTtlColumns(ttl, existing ? existing.current_value : null);
  const src = source === 'file' ? 'file' : 'manual';
  const ts = now(db);

  if (!existing) {
    await db.variables.create({
      data: {
        api_key: apiKey, name,
        current_value: nextValue ?? null, default_value: nextDefault ?? null, source: src,
        resolved_at: resolvedBumped ? ts : null, updated_at: ts,
        ...t,
      },
    });
    return getVariable(db, apiKey, name);
  }
  await db.variables.updateMany({
    where: { api_key: apiKey, name },
    data: {
      current_value: nextValue ?? null, default_value: nextDefault ?? null, source: src,
      ...(resolvedBumped ? { resolved_at: ts } : {}),
      updated_at: ts,
      ...t,
    },
  });
  return getVariable(db, apiKey, name);
}

/**
 * Apply a pending TTL revert unconditionally: recompute current_value from the
 * stored revert_mode and clear all TTL columns. Used by the scheduler at expiry
 * and by materializeExpired() lazily on read. Returns the updated row (or null).
 */
export async function applyRevert(db, apiKey, name) {
  const row = await getVariable(db, apiKey, name);
  if (!row || !row.revert_mode) return null;
  let reverted;
  if (row.revert_mode === 'literal') reverted = row.revert_value ?? '';
  else if (row.revert_mode === 'previous') reverted = row.prev_value ?? null;
  else reverted = null; // baseline → clear, resolves to default_value → ''
  const ts = now(db);
  await db.variables.updateMany({
    where: { api_key: apiKey, name },
    data: {
      current_value: reverted ?? null,
      ...(reverted == null ? {} : { resolved_at: ts }),
      updated_at: ts,
      expires_at: null, expires_at_seq: null, revert_mode: null, revert_value: null, prev_value: null,
    },
  });
  return getVariable(db, apiKey, name);
}

/**
 * Lazily revert every variable whose time-based TTL is due at `now` (epoch ms).
 * Belt-and-braces for a missed/never-scheduled timer (e.g. server restart before
 * scheduler.restore()). Returns the list of reverted rows so the caller can emit.
 */
export async function materializeExpired(db, apiKey, nowMs = Date.now()) {
  const rows = await db.variables.findMany({ where: { api_key: apiKey, expires_at: { not: null } } });
  const due = rows.filter((r) => {
    const t = Date.parse(r.expires_at);
    return Number.isFinite(t) && t <= nowMs;
  });
  const reverted = [];
  for (const { name } of due) {
    const row = await applyRevert(db, apiKey, name);
    if (row) reverted.push(row);
  }
  return reverted;
}

/** Serialize a variable row for JSON/SSE — shared by routes, scheduler, engine. */
export function serializeVariableRow(row) {
  return {
    name: row.name,
    value: resolveVariableValue(row),
    source: row.source,
    defaultValue: row.default_value,
    resolvedAt: row.resolved_at,
    expiresAt: row.expires_at ?? null,
    revertMode: row.revert_mode ?? null,
  };
}

/** Set a variable's resolved value from a connector call. */
export async function setConnectorVariable(db, apiKey, name, value, sourceRequestId) {
  const existing = await getVariable(db, apiKey, name);
  const ts = now(db);
  if (!existing) {
    await db.variables.create({
      data: {
        api_key: apiKey, name, current_value: value ?? null, default_value: null, source: 'connector',
        source_request_id: sourceRequestId, resolved_at: ts, updated_at: ts,
      },
    });
  } else {
    await db.variables.updateMany({
      where: { api_key: apiKey, name },
      data: { current_value: value ?? null, source: 'connector', source_request_id: sourceRequestId, resolved_at: ts, updated_at: ts },
    });
  }
  return getVariable(db, apiKey, name);
}

export async function deleteVariable(db, apiKey, name) {
  return (await db.variables.deleteMany({ where: { api_key: apiKey, name } })).count > 0;
}

/** Resolve a variable's effective value for {{ }} interpolation: current -> default -> ''. */
export function resolveVariableValue(row) {
  if (!row) return '';
  if (row.current_value !== null && row.current_value !== undefined) return row.current_value;
  if (row.default_value !== null && row.default_value !== undefined) return row.default_value;
  return '';
}

// ---------------------------------------------------------------------------
// Outbound network policy (SSRF guard rules) — see network-guard.js
// ---------------------------------------------------------------------------

export async function listNetworkRules(db, { scope, orgId } = {}) {
  let where = {};
  if (scope === 'global') where = { scope: 'global' };
  else if (scope === 'org') where = { scope: 'org', org_id: orgId };
  return db.connector_network_rules.findMany({ where, orderBy: { created_at: 'asc' } });
}

export async function getNetworkRule(db, id) {
  return orUndef(await db.connector_network_rules.findUnique({ where: { id } }));
}

export async function createNetworkRule(db, { id, scope, orgId = null, ruleType, pattern, description = null, createdBy = null }) {
  await db.connector_network_rules.create({
    data: { id, scope, org_id: orgId, rule_type: ruleType, pattern, description, created_by: createdBy },
  });
  return getNetworkRule(db, id);
}

export async function deleteNetworkRule(db, id) {
  return (await db.connector_network_rules.deleteMany({ where: { id } })).count > 0;
}

/** api_keys.org_id lookup — api_keys is a core lcyt-backend table, not owned by this plugin. */
export async function getApiKeyOrgId(db, apiKey) {
  try {
    const row = await db.api_keys.findUnique({ where: { key: apiKey }, select: { org_id: true } });
    return row?.org_id ?? null;
  } catch {
    // Fall back to "no org" rather than failing the whole request — network
    // rules just won't have an org-scoped tier to check in that case.
    return null;
  }
}

/**
 * A user's role in an organization: 'owner' (organizations.owner_user_id),
 * their org_members.role, or null if they're not a member at all.
 * organizations/org_members are core lcyt-backend tables, not owned by this plugin.
 */
export async function getOrgRole(db, userId, orgId) {
  const org = await db.organizations.findUnique({ where: { id: orgId }, select: { owner_user_id: true } });
  if (!org) return null;
  if (org.owner_user_id === userId) return 'owner';
  const member = await db.org_members.findFirst({ where: { org_id: orgId, user_id: userId }, select: { role: true } });
  return member?.role ?? null;
}
