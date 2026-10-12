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

/** No-op kept for old callers: the tables come from the backend schema. */
export async function runProviderRegistryMigrations() {}

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
 * @param {import('lcyt-backend/db').Db} db
 * @param {object} input — { scope, ownerApiKey?, kind, vendor?, name, baseUrl?, apiKeyRef?, bridgeInstanceId?, enabled? }
 * @returns {Promise<object>} — the created row, masked
 */
export async function createProvider(db, input) {
  const id = randomUUID();
  await db.ai_providers.create({
    data: {
      id,
      scope: input.scope,
      owner_api_key: input.scope === 'project' ? input.ownerApiKey : null,
      kind: input.kind,
      vendor: input.vendor || 'custom',
      name: input.name.trim(),
      base_url: input.baseUrl?.trim() || '',
      api_key_ref: input.apiKeyRef || '',
      bridge_instance_id: input.bridgeInstanceId || null,
      enabled: input.enabled === false ? 0 : 1,
    },
  });
  return maskProvider(await getProvider(db, id));
}

/**
 * Get the raw provider row (includes api_key_ref — internal use only).
 * @param {import('lcyt-backend/db').Db} db
 * @param {string} id
 * @returns {Promise<object|null>}
 */
export async function getProvider(db, id) {
  return (await db.ai_providers.findUnique({ where: { id } })) ?? null;
}

/**
 * Update a provider. Only provided fields change. Scope/owner never change.
 * @returns {Promise<object|null>} — updated masked row, or null when not found
 */
export async function updateProvider(db, id, input) {
  const existing = await getProvider(db, id);
  if (!existing) return null;
  const data = {};
  if (input.kind !== undefined) data.kind = input.kind;
  if (input.vendor !== undefined) data.vendor = input.vendor;
  if (input.name !== undefined) data.name = String(input.name).trim();
  if (input.baseUrl !== undefined) data.base_url = String(input.baseUrl).trim();
  if (input.apiKeyRef !== undefined) data.api_key_ref = input.apiKeyRef;
  if (input.bridgeInstanceId !== undefined) data.bridge_instance_id = input.bridgeInstanceId || null;
  if (input.enabled !== undefined) data.enabled = input.enabled ? 1 : 0;
  if (Object.keys(data).length > 0) await db.ai_providers.updateMany({ where: { id }, data });
  return maskProvider(await getProvider(db, id));
}

/**
 * Delete a provider and its catalog/grant rows.
 * @returns {Promise<boolean>}
 */
export async function deleteProvider(db, id) {
  return db.$transaction(async (tx) => {
    await tx.ai_provider_models.deleteMany({ where: { provider_id: id } });
    await tx.ai_provider_grants.deleteMany({ where: { provider_id: id } });
    return (await tx.ai_providers.deleteMany({ where: { id } })).count > 0;
  });
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
export async function listSiteProviders(db) {
  const rows = await db.ai_providers.findMany({ where: { scope: 'site' }, orderBy: { created_at: 'asc' } });
  return rows.map(maskProvider);
}

/**
 * Providers visible to a project: its own project-scope rows plus any
 * site-scope rows granted to it (default-deny).
 * @param {import('lcyt-backend/db').Db} db
 * @param {string} apiKey
 */
export async function listVisibleProviders(db, apiKey) {
  const rows = await db.ai_providers.findMany({
    where: {
      OR: [
        { scope: 'project', owner_api_key: apiKey },
        { scope: 'site', ai_provider_grants: { some: { api_key: apiKey, enabled: 1 } } },
      ],
    },
    orderBy: { created_at: 'asc' },
  });
  return rows.map(maskProvider);
}

/**
 * Is this provider visible to this project (own project-scope, or granted site-scope)?
 * @returns {Promise<boolean>}
 */
export async function isProviderVisible(db, providerRow, apiKey) {
  if (!providerRow) return false;
  if (providerRow.scope === 'project') return providerRow.owner_api_key === apiKey;
  const grant = await db.ai_provider_grants.findUnique({
    where: { api_key_provider_id: { api_key: apiKey, provider_id: providerRow.id } },
  });
  return grant?.enabled === 1;
}

/**
 * Grant or revoke a project's visibility into a site-scope provider.
 */
export async function setGrant(db, providerId, apiKey, enabled) {
  const value = enabled ? 1 : 0;
  await db.ai_provider_grants.upsert({
    where: { api_key_provider_id: { api_key: apiKey, provider_id: providerId } },
    create: { api_key: apiKey, provider_id: providerId, enabled: value },
    update: { enabled: value },
  });
}

/**
 * List grants for a provider (admin view: which projects can see it).
 */
export async function listGrants(db, providerId) {
  const rows = await db.ai_provider_grants.findMany({ where: { provider_id: providerId }, orderBy: { api_key: 'asc' } });
  return rows.map((row) => ({ apiKey: row.api_key, enabled: row.enabled === 1 }));
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

export async function listProviderModels(db, providerId) {
  const rows = await db.ai_provider_models.findMany({ where: { provider_id: providerId }, orderBy: { model_name: 'asc' } });
  return rows.map(formatModel);
}

/**
 * Manually add a model row (ollama providers only — pre-register a model
 * before it's pulled; api providers have no catalog by design).
 * @returns {Promise<object|null>} — the created model, or null on duplicate
 */
export async function addManualModel(db, providerId, { modelName, capabilities = [] }) {
  try {
    const row = await db.ai_provider_models.create({
      data: { provider_id: providerId, model_name: modelName, capabilities: JSON.stringify(capabilities), source: 'manual' },
    });
    return formatModel(row);
  } catch (err) {
    if (err?.code === 'P2002' || String(err.message).includes('UNIQUE')) return null;
    throw err;
  }
}

/**
 * Edit a model's capabilities / enabled flag.
 * @returns {Promise<object|null>}
 */
export async function updateModel(db, providerId, modelId, { capabilities, enabled }) {
  const data = {};
  if (capabilities !== undefined) data.capabilities = JSON.stringify(capabilities);
  if (enabled !== undefined) data.enabled = enabled ? 1 : 0;
  if (Object.keys(data).length === 0) {
    const row = await db.ai_provider_models.findFirst({ where: { id: modelId, provider_id: providerId } });
    return row ? formatModel(row) : null;
  }
  const info = await db.ai_provider_models.updateMany({ where: { id: modelId, provider_id: providerId }, data });
  if (info.count === 0) return null;
  return formatModel(await db.ai_provider_models.findUnique({ where: { id: modelId } }));
}

export async function deleteModel(db, providerId, modelId) {
  return (await db.ai_provider_models.deleteMany({ where: { id: modelId, provider_id: providerId } })).count > 0;
}
