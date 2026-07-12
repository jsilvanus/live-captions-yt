/**
 * Resolution engine — fires a named connector request, interpolates {{ }} into
 * its path/query/headers/body, maps the response onto variables, and emits
 * variable_updated SSE events.
 *
 * See docs/plans/plan_api_connectors_variables.md §2, §3, §4, §6, §7.
 */
import {
  getConnectorBySlug, getRequestBySlug, listMappings,
  listVariables, setConnectorVariable, getApiKeyOrgId,
  materializeExpired, serializeVariableRow,
} from './db.js';
import { interpolate, interpolatePairs } from './interpolate.js';
import { evaluateJsonPath } from './json-path.js';
import { checkUrlAllowed } from './network-guard.js';

/**
 * @param {object} deps
 * @param {import('better-sqlite3').Database} deps.db
 * @param {import('./variables-bus.js').VariablesBus} deps.bus
 * @param {{ resolveStorage: (apiKey: string) => Promise<object> }} [deps.filesControl] — for image/binary responses
 */
export function createResolutionEngine({ db, bus, filesControl = null }) {
  /** Build a { name: value } snapshot of all variables currently known for a project. */
  function snapshotVariables(apiKey) {
    // Revert any due TTLs first so interpolation uses the reverted value. The
    // active scheduler is the primary emit path; this is the lazy fallback.
    materializeExpired(db, apiKey);
    const rows = listVariables(db, apiKey);
    const snapshot = {};
    for (const row of rows) {
      snapshot[row.name] = row.current_value !== null && row.current_value !== undefined
        ? row.current_value
        : (row.default_value ?? '');
    }
    return snapshot;
  }

  function buildAuthHeaders(connector) {
    const authConfig = JSON.parse(connector.auth_config || '{}');
    switch (connector.auth_type) {
      case 'bearer':
        return authConfig.token ? { Authorization: `Bearer ${authConfig.token}` } : {};
      case 'api_key':
        return authConfig.headerName ? { [authConfig.headerName]: authConfig.value ?? '' } : {};
      case 'basic': {
        if (!authConfig.username) return {};
        const raw = `${authConfig.username}:${authConfig.password ?? ''}`;
        return { Authorization: `Basic ${Buffer.from(raw).toString('base64')}` };
      }
      case 'custom':
        return authConfig.headers && typeof authConfig.headers === 'object' ? authConfig.headers : {};
      default:
        return {};
    }
  }

  function buildUrl(connector, request, snapshot) {
    const base = connector.base_url.replace(/\/+$/, '');
    const path = interpolate(request.path || '', snapshot);
    const url = new URL(base + (path.startsWith('/') ? path : `/${path}`));
    const queryParams = interpolatePairs(JSON.parse(request.query_params || '[]'), snapshot);
    for (const { key, value } of queryParams) {
      if (key) url.searchParams.append(key, value ?? '');
    }
    return url;
  }

  function buildBody(request, snapshot) {
    if (request.body_type === 'raw' || !request.body_content) return undefined;
    return interpolate(request.body_content, snapshot);
  }

  async function applyMappings(apiKey, request, response, contentType) {
    const mappings = listMappings(db, request.id);
    if (mappings.length === 0) return [];

    let parsedBody;
    const isJson = request.response_type === 'json'
      || (request.response_type === 'auto' && /json/i.test(contentType || ''));

    if (request.response_type === 'image' || request.response_type === 'binary') {
      if (!filesControl) throw new Error('image/binary response mapping requires files storage, not configured');
      const buffer = Buffer.from(await response.arrayBuffer());
      const storage = await filesControl.resolveStorage(apiKey);
      const objectKey = `connector-variables/${request.id}-${Date.now()}`;
      const { storedKey } = await storage.putObject(apiKey, objectKey, buffer, contentType || 'application/octet-stream');
      const ref = storage.publicUrl(apiKey, objectKey) || storedKey;
      const updated = [];
      for (const mapping of mappings) {
        const row = setConnectorVariable(db, apiKey, mapping.variable_name, ref, request.id);
        updated.push(row);
      }
      return updated;
    }

    if (isJson) {
      const text = await response.text();
      try {
        parsedBody = text ? JSON.parse(text) : null;
      } catch {
        parsedBody = null;
      }
    } else {
      parsedBody = await response.text();
    }

    const updated = [];
    for (const mapping of mappings) {
      const extracted = evaluateJsonPath(parsedBody, mapping.json_path);
      if (extracted === undefined || extracted === null) {
        if (mapping.skip_if_null) continue;
      }
      const value = typeof extracted === 'string' ? extracted
        : extracted === undefined || extracted === null ? null
        : JSON.stringify(extracted);
      const row = setConnectorVariable(db, apiKey, mapping.variable_name, value, request.id);
      updated.push(row);
    }
    return updated;
  }

  /**
   * Fire a named request end-to-end: interpolate, call, map response, emit SSE.
   * @returns {Promise<{ ok: boolean, variables: Array<object>, error?: string }>}
   */
  async function fireRequest(apiKey, connectorSlug, requestSlug) {
    const connector = getConnectorBySlug(db, apiKey, connectorSlug);
    if (!connector) return { ok: false, variables: [], error: `Unknown connector: ${connectorSlug}` };
    const request = getRequestBySlug(db, connector.id, requestSlug);
    if (!request) return { ok: false, variables: [], error: `Unknown request: ${connectorSlug}.${requestSlug}` };

    const snapshot = snapshotVariables(apiKey);
    const url = buildUrl(connector, request, snapshot);

    const orgId = getApiKeyOrgId(db, apiKey);
    const guard = await checkUrlAllowed(db, url, orgId);
    if (!guard.allowed) {
      return { ok: false, variables: [], error: guard.reason };
    }

    const headers = {
      ...Object.fromEntries(interpolatePairs(JSON.parse(connector.headers || '[]'), snapshot).map(({ key, value }) => [key, value])),
      ...buildAuthHeaders(connector),
    };
    const body = buildBody(request, snapshot);
    if (body !== undefined && request.body_type === 'json' && !headers['Content-Type'] && !headers['content-type']) {
      headers['Content-Type'] = 'application/json';
    }

    try {
      const response = await fetch(url, { method: request.method, headers, body });
      const contentType = response.headers.get('content-type');
      const updated = await applyMappings(apiKey, request, response, contentType);
      for (const row of updated) {
        bus.emitVariableUpdated(apiKey, serializeVariableRow(row));
      }
      return { ok: response.ok, variables: updated, error: response.ok ? undefined : `HTTP ${response.status}` };
    } catch (err) {
      return { ok: false, variables: [], error: err.message };
    }
  }

  return { fireRequest, snapshotVariables };
}
