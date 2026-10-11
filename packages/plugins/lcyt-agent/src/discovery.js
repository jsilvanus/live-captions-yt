/**
 * Ollama model discovery (plan/ai_model_registry, "Discovery Mechanics").
 *
 * `GET {base_url}/api/tags` is the source of truth for what models an Ollama
 * endpoint has pulled. Discovery is Ollama-only by design: `api`-kind
 * providers never get a catalog (free-text model names — cloud vendors ship
 * new models too often for a curated list to stay honest), and `deer` is
 * deferred to Phase 4.
 *
 * Discovered rows are upserted, never sweep-deleted: a role config might
 * point at a model that's temporarily offline or being re-pulled. Rows absent
 * from the latest sweep just keep a stale last_seen_at for a human to clean
 * up via DELETE /ai/providers/:id/models/:modelId.
 */

import logger from 'lcyt/logger';

/** Model families with vision support, per common Ollama catalog names. */
const VISION_FAMILIES = ['llava', 'bakllava', 'llama3.2-vision', 'moondream', 'minicpm-v', 'llama4'];

/**
 * Best-effort capability inference from an Ollama /api/tags entry.
 * A heuristic, not a contract — always admin/user-editable afterward.
 * @param {{ name?: string, details?: { family?: string, families?: string[] } }} entry
 * @returns {string[]}
 */
export function inferCapabilities(entry) {
  const name = (entry.name || '').toLowerCase();
  const families = [
    entry.details?.family || '',
    ...(Array.isArray(entry.details?.families) ? entry.details.families : []),
  ].map((f) => String(f).toLowerCase());

  if (name.includes('embed') || families.some((f) => f.includes('embed'))) {
    return ['embedding'];
  }
  if (VISION_FAMILIES.some((v) => name.startsWith(v) || families.includes(v))) {
    return ['vision', 'chat'];
  }
  return ['chat'];
}

/**
 * Upsert discovered models into ai_provider_models. Present models get
 * last_seen_at bumped; new ones are inserted with source 'discovered'.
 * Absent rows are left untouched (upsert-not-delete).
 *
 * @param {import('lcyt-backend/db').Db} db
 * @param {string} providerId
 * @param {Array<object>} entries — Ollama /api/tags "models" array
 * @returns {Promise<number>} — how many entries were processed
 */
export async function upsertDiscoveredModels(db, providerId, entries) {
  const now = db.$util.sqlNow();
  await db.$transaction(async (tx) => {
    for (const entry of entries) {
      if (!entry?.name) continue;
      const parameter_size = entry.details?.parameter_size ?? null;
      const quantization = entry.details?.quantization_level ?? null;
      await tx.ai_provider_models.upsert({
        where: { provider_id_model_name: { provider_id: providerId, model_name: entry.name } },
        create: {
          provider_id: providerId,
          model_name: entry.name,
          capabilities: JSON.stringify(inferCapabilities(entry)),
          source: 'discovered',
          parameter_size,
          quantization,
          discovered_at: now,
          last_seen_at: now,
        },
        update: { last_seen_at: now, parameter_size, quantization },
      });
    }
  });
  return entries.filter((e) => e?.name).length;
}

/**
 * Fetch {base_url}/api/tags for a provider — directly, or through the
 * provider's bridge instance when bridge_instance_id is set.
 *
 * @param {object} provider — raw ai_providers row
 * @param {{ bridgeManager?: object }} deps
 * @returns {Promise<Array<object>>} — the "models" array
 */
async function fetchOllamaTags(provider, { bridgeManager } = {}) {
  const url = `${provider.base_url.replace(/\/$/, '')}/api/tags`;

  if (provider.bridge_instance_id) {
    if (!bridgeManager) {
      throw new Error('Bridge manager not available for bridge-relayed provider');
    }
    if (!bridgeManager.isConnected(provider.bridge_instance_id)) {
      // Fail immediately, not by timeout — surfaced distinctly in the UI as
      // "offline — bridge disconnected" (expected/transient) vs. a real
      // request failure (usually a config error).
      throw new Error('offline — bridge disconnected');
    }
    const headers = provider.api_key_ref ? { Authorization: `Bearer ${provider.api_key_ref}` } : {};
    const result = await bridgeManager.sendCommand(provider.bridge_instance_id, {
      type: 'http_request',
      method: 'GET',
      url,
      headers,
    });
    const body = typeof result.body === 'string' ? JSON.parse(result.body) : result.body;
    if (!body || !Array.isArray(body.models)) {
      throw new Error('Unexpected /api/tags response via bridge');
    }
    return body.models;
  }

  const headers = provider.api_key_ref ? { Authorization: `Bearer ${provider.api_key_ref}` } : {};
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`Ollama /api/tags returned ${res.status}`);
  }
  const body = await res.json();
  if (!Array.isArray(body?.models)) {
    throw new Error('Unexpected /api/tags response format');
  }
  return body.models;
}

/**
 * Run discovery for a provider. Only 'ollama' providers do real work —
 * 'api' and 'deer' short-circuit to a deliberate no-op (no catalog is ever
 * built for them; see plan/ai_model_registry "Discovery Mechanics").
 *
 * Updates ai_providers.last_discovery_at / last_discovery_error either way.
 *
 * @param {import('lcyt-backend/db').Db} db
 * @param {object} provider — raw ai_providers row
 * @param {{ bridgeManager?: object }} [deps]
 * @returns {Promise<{ ok: boolean, discovered: number, skipped?: true, error?: string }>}
 */
export async function discoverProvider(db, provider, deps = {}) {
  if (provider.kind !== 'ollama') {
    return { ok: true, discovered: 0, skipped: true };
  }

  try {
    const entries = await fetchOllamaTags(provider, deps);
    const discovered = await upsertDiscoveredModels(db, provider.id, entries);
    await db.ai_providers.updateMany({
      where: { id: provider.id },
      data: { last_discovery_at: db.$util.sqlNow(), last_discovery_error: null },
    });
    return { ok: true, discovered };
  } catch (err) {
    logger.warn(`[agent] discovery failed for provider ${provider.id}: ${err.message}`);
    await db.ai_providers.updateMany({
      where: { id: provider.id },
      data: { last_discovery_at: db.$util.sqlNow(), last_discovery_error: err.message },
    });
    return { ok: false, discovered: 0, error: err.message };
  }
}
