/**
 * Caption target DB helpers — server-persisted replacement for lcyt-web's
 * localStorage-only targetConfig.js (plan/selfservice_config_backend §1).
 *
 * One row per configured caption delivery target: 'youtube' | 'generic' | 'viewer'.
 */

import { randomUUID } from 'node:crypto';
import { sqlNow } from './helpers.js';

const VALID_TYPES = new Set(['youtube', 'generic', 'viewer']);

/**
 * Normalise an incoming icon id to a positive integer or null.
 * Accepts numbers or numeric strings; anything else (or <= 0) becomes null.
 * @param {*} v
 * @returns {number|null}
 */
function normalizeIconId(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * @param {object} row
 * @returns {object}
 */
function formatRow(row) {
  return {
    id:          row.id,
    type:        row.type,
    enabled:     row.enabled === 1,
    sortOrder:   row.sort_order,
    streamKey:   row.stream_key ?? null,
    url:         row.url ?? null,
    headers:     row.headers ? JSON.parse(row.headers) : null,
    viewerKey:   row.viewer_key ?? null,
    iconId:      row.icon_id ?? null,
    iconEnabled: row.icon_enabled === 1,
    noBatch:     row.no_batch === 1,
    createdAt:   row.created_at,
    updatedAt:   row.updated_at,
  };
}

/**
 * Get all caption targets for an API key, ordered by sort_order.
 * @param {import('./connection.js').Db} db
 * @param {string} apiKey
 * @returns {Promise<object[]>}
 */
export async function getCaptionTargets(db, apiKey) {
  const rows = await db.caption_targets.findMany({
    where: { api_key: apiKey },
    orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
  });
  return rows.map(formatRow);
}

/**
 * Get a single caption target by id, scoped to an API key.
 * @param {import('./connection.js').Db} db
 * @param {string} apiKey
 * @param {string} id
 * @returns {Promise<object|null>}
 */
export async function getCaptionTarget(db, apiKey, id) {
  const row = await db.caption_targets.findFirst({ where: { api_key: apiKey, id } });
  return row ? formatRow(row) : null;
}

/**
 * Validate a target's type-specific fields.
 * @returns {string|null} error message, or null if valid
 */
function validateTypeFields(type, { streamKey, url, viewerKey }) {
  if (!VALID_TYPES.has(type)) {
    return `Invalid target type: ${type}`;
  }
  if (type === 'youtube' && (!streamKey || typeof streamKey !== 'string')) {
    return 'YouTube target requires a streamKey field';
  }
  if (type === 'generic') {
    if (!url || typeof url !== 'string') return 'Generic target requires a url field';
    try {
      const u = new URL(url);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') {
        return `Generic target URL must use http or https: ${url}`;
      }
    } catch {
      return `Invalid generic target URL: ${url}`;
    }
  }
  if (type === 'viewer') {
    if (!viewerKey || typeof viewerKey !== 'string' || !/^[a-zA-Z0-9_-]{3,}$/.test(viewerKey)) {
      return `Invalid viewerKey "${viewerKey}": must be at least 3 characters (letters, digits, hyphens, underscores)`;
    }
  }
  return null;
}

/**
 * Create a caption target for an API key.
 * @param {import('./connection.js').Db} db
 * @param {string} apiKey
 * @param {{ id?: string, type: string, enabled?: boolean, streamKey?: string, url?: string, headers?: object, viewerKey?: string, iconId?: number|null, iconEnabled?: boolean, noBatch?: boolean }} fields
 * @returns {Promise<{ ok: true, target: object }|{ ok: false, error: string }>}
 */
export async function createCaptionTarget(db, apiKey, fields = {}) {
  const { id = randomUUID(), type, enabled = true, streamKey = null, url = null, headers = null, viewerKey = null, iconId = null, iconEnabled = false, noBatch = false } = fields;

  const error = validateTypeFields(type, { streamKey, url, viewerKey });
  if (error) return { ok: false, error };

  const agg = await db.caption_targets.aggregate({ where: { api_key: apiKey }, _max: { sort_order: true } });
  const maxOrder = agg._max.sort_order ?? -1;

  await db.caption_targets.create({
    data: {
      id,
      api_key: apiKey,
      type,
      enabled: enabled ? 1 : 0,
      sort_order: maxOrder + 1,
      stream_key: type === 'youtube' ? streamKey.trim() : null,
      url: type === 'generic' ? url : null,
      headers: type === 'generic' && headers && typeof headers === 'object' ? JSON.stringify(headers) : null,
      viewer_key: type === 'viewer' ? viewerKey : null,
      icon_id: type === 'viewer' ? normalizeIconId(iconId) : null,
      icon_enabled: type === 'viewer' && iconEnabled ? 1 : 0,
      no_batch: noBatch ? 1 : 0,
    },
  });
  return { ok: true, target: await getCaptionTarget(db, apiKey, id) };
}

/**
 * Update a caption target. Only provided fields are changed; `type` is immutable.
 * @param {import('./connection.js').Db} db
 * @param {string} apiKey
 * @param {string} id
 * @param {{ enabled?: boolean, streamKey?: string, url?: string, headers?: object, viewerKey?: string, iconId?: number|null, iconEnabled?: boolean, noBatch?: boolean }} patch
 * @returns {Promise<{ ok: true, target: object }|{ ok: false, error: string, status?: number }>}
 */
export async function updateCaptionTarget(db, apiKey, id, patch = {}) {
  const existing = await db.caption_targets.findFirst({ where: { api_key: apiKey, id } });
  if (!existing) return { ok: false, error: 'Target not found', status: 404 };

  const streamKey = patch.streamKey !== undefined ? patch.streamKey : existing.stream_key;
  const url       = patch.url       !== undefined ? patch.url       : existing.url;
  const viewerKey = patch.viewerKey !== undefined ? patch.viewerKey : existing.viewer_key;

  const error = validateTypeFields(existing.type, { streamKey, url, viewerKey });
  if (error) return { ok: false, error };

  const headers = patch.headers !== undefined
    ? (patch.headers && typeof patch.headers === 'object' ? JSON.stringify(patch.headers) : null)
    : existing.headers;

  const iconId = patch.iconId !== undefined ? normalizeIconId(patch.iconId) : existing.icon_id;
  const iconEnabled = patch.iconEnabled !== undefined ? (patch.iconEnabled ? 1 : 0) : existing.icon_enabled;

  await db.caption_targets.updateMany({
    where: { api_key: apiKey, id },
    data: {
      enabled:      patch.enabled !== undefined ? (patch.enabled ? 1 : 0) : existing.enabled,
      stream_key:   existing.type === 'youtube' ? streamKey.trim() : null,
      url:          existing.type === 'generic' ? url : null,
      headers:      existing.type === 'generic' ? headers : null,
      viewer_key:   existing.type === 'viewer' ? viewerKey : null,
      icon_id:      existing.type === 'viewer' ? iconId : null,
      icon_enabled: existing.type === 'viewer' ? iconEnabled : 0,
      no_batch:     patch.noBatch !== undefined ? (patch.noBatch ? 1 : 0) : existing.no_batch,
      updated_at:   sqlNow(),
    },
  });
  return { ok: true, target: await getCaptionTarget(db, apiKey, id) };
}

/**
 * Delete a caption target.
 * @param {import('./connection.js').Db} db
 * @param {string} apiKey
 * @param {string} id
 * @returns {Promise<boolean>} true if a row was deleted
 */
export async function deleteCaptionTarget(db, apiKey, id) {
  const r = await db.caption_targets.deleteMany({ where: { api_key: apiKey, id } });
  return r.count > 0;
}

/**
 * Persist a new sort order for all of an API key's caption targets in one call.
 * @param {import('./connection.js').Db} db
 * @param {string} apiKey
 * @param {string[]} order  target ids in the desired order
 * @returns {Promise<{ ok: true }|{ ok: false, error: string }>}
 */
export async function reorderCaptionTargets(db, apiKey, order) {
  if (!Array.isArray(order) || order.length === 0) {
    return { ok: false, error: 'order must be a non-empty array of target ids' };
  }
  const existing = new Set((await getCaptionTargets(db, apiKey)).map(t => t.id));
  for (const id of order) {
    if (!existing.has(id)) return { ok: false, error: `Unknown target id: ${id}` };
  }
  const now = sqlNow();
  await db.$transaction(async (tx) => {
    for (let index = 0; index < order.length; index++) {
      await tx.caption_targets.updateMany({
        where: { api_key: apiKey, id: order[index] },
        data: { sort_order: index, updated_at: now },
      });
    }
  });
  return { ok: true };
}
