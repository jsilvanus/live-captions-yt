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
import { fireRequest as varfetchFire, buildRequest } from 'varfetch';
import { checkUrlAllowed, loadNetworkPolicy, toNetworkOptions } from './network-guard.js';

const BINARY_TYPES = new Set(['image', 'binary']);

/** DB rows -> the camelCase connector/request shapes varfetch takes. */
function toConnector(row) {
  return {
    baseUrl: row.base_url,
    auth: { type: row.auth_type, ...JSON.parse(row.auth_config || '{}') },
    headers: JSON.parse(row.headers || '[]'),
  };
}

function toRequest(row, mappings) {
  return {
    method: row.method,
    path: row.path,
    query: JSON.parse(row.query_params || '[]'),
    bodyType: row.body_type === 'raw' ? 'none' : row.body_type,
    body: row.body_content,
    responseType: row.response_type,
    mappings: mappings.map((m) => ({ jsonPath: m.json_path, variable: m.variable_name, skipIfNull: !!m.skip_if_null })),
  };
}

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

  /** Store an image/binary response in files storage and point every mapped variable at it. */
  async function storeBinaryResponse(apiKey, request, mappings, buffer, contentType) {
    if (!filesControl) throw new Error('image/binary response mapping requires files storage, not configured');
    const storage = await filesControl.resolveStorage(apiKey);
    const objectKey = `connector-variables/${request.id}-${Date.now()}`;
    const { storedKey } = await storage.putObject(apiKey, objectKey, buffer, contentType || 'application/octet-stream');
    const ref = storage.publicUrl(apiKey, objectKey) || storedKey;
    return mappings.map((mapping) => setConnectorVariable(db, apiKey, mapping.variable_name, ref, request.id));
  }

  function writeValues(apiKey, request, values) {
    return Object.entries(values).map(([name, value]) => setConnectorVariable(db, apiKey, name, value, request.id));
  }

  /**
   * Fire a named request end-to-end: interpolate, call, map response, emit SSE.
   * @returns {Promise<{ ok: boolean, variables: Array<object>, error?: string }>}
   */
  async function fireRequest(apiKey, connectorSlug, requestSlug) {
    const connectorRow = getConnectorBySlug(db, apiKey, connectorSlug);
    if (!connectorRow) return { ok: false, variables: [], error: `Unknown connector: ${connectorSlug}` };
    const requestRow = getRequestBySlug(db, connectorRow.id, requestSlug);
    if (!requestRow) return { ok: false, variables: [], error: `Unknown request: ${connectorSlug}.${requestSlug}` };

    const snapshot = snapshotVariables(apiKey);
    const mappingRows = listMappings(db, requestRow.id);
    const connector = toConnector(connectorRow);
    const request = toRequest(requestRow, mappingRows);

    let built;
    try {
      built = buildRequest(connector, request, snapshot);
    } catch (err) {
      return { ok: false, variables: [], error: `Invalid request: ${err.message}` };
    }

    const orgId = getApiKeyOrgId(db, apiKey);
    // First hop is checked here so the error names the org/site rule layer;
    // varfetch re-checks it and every redirect hop with the merged lists.
    const guard = await checkUrlAllowed(db, built.url, orgId);
    if (!guard.allowed) {
      return { ok: false, variables: [], error: guard.reason };
    }

    try {
      const result = await varfetchFire({
        connector, request, variables: snapshot,
        network: toNetworkOptions(loadNetworkPolicy(db, orgId)),
      });
      let updated = [];
      if (result.ok && BINARY_TYPES.has(requestRow.response_type)) {
        if (mappingRows.length > 0) {
          updated = await storeBinaryResponse(apiKey, requestRow, mappingRows, result.body, result.contentType);
        }
      } else {
        updated = writeValues(apiKey, requestRow, result.values);
      }
      for (const row of updated) {
        bus.emitVariableUpdated(apiKey, serializeVariableRow(row));
      }
      return { ok: result.ok, variables: updated, error: result.ok ? undefined : result.error };
    } catch (err) {
      return { ok: false, variables: [], error: err.message };
    }
  }

  return { fireRequest, snapshotVariables };
}
