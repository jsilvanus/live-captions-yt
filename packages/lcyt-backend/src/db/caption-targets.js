/**
 * Caption target DB helpers — server-persisted replacement for lcyt-web's
 * localStorage-only targetConfig.js (plan/selfservice_config_backend §1).
 *
 * One row per configured caption delivery target: 'youtube' | 'generic' | 'viewer'.
 */

import { randomUUID } from 'node:crypto';

const VALID_TYPES = new Set(['youtube', 'generic', 'viewer']);

/**
 * @param {object} row
 * @returns {object}
 */
function formatRow(row) {
  return {
    id:        row.id,
    type:      row.type,
    enabled:   row.enabled === 1,
    sortOrder: row.sort_order,
    streamKey: row.stream_key ?? null,
    url:       row.url ?? null,
    headers:   row.headers ? JSON.parse(row.headers) : null,
    viewerKey: row.viewer_key ?? null,
    noBatch:   row.no_batch === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Get all caption targets for an API key, ordered by sort_order.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @returns {object[]}
 */
export function getCaptionTargets(db, apiKey) {
  return db.prepare('SELECT * FROM caption_targets WHERE api_key = ? ORDER BY sort_order, created_at')
    .all(apiKey)
    .map(formatRow);
}

/**
 * Get a single caption target by id, scoped to an API key.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @param {string} id
 * @returns {object|null}
 */
export function getCaptionTarget(db, apiKey, id) {
  const row = db.prepare('SELECT * FROM caption_targets WHERE api_key = ? AND id = ?').get(apiKey, id);
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
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @param {{ id?: string, type: string, enabled?: boolean, streamKey?: string, url?: string, headers?: object, viewerKey?: string, noBatch?: boolean }} fields
 * @returns {{ ok: true, target: object }|{ ok: false, error: string }}
 */
export function createCaptionTarget(db, apiKey, fields = {}) {
  const { id = randomUUID(), type, enabled = true, streamKey = null, url = null, headers = null, viewerKey = null, noBatch = false } = fields;

  const error = validateTypeFields(type, { streamKey, url, viewerKey });
  if (error) return { ok: false, error };

  const { maxOrder } = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS maxOrder FROM caption_targets WHERE api_key = ?').get(apiKey);

  db.prepare(`
    INSERT INTO caption_targets (id, api_key, type, enabled, sort_order, stream_key, url, headers, viewer_key, no_batch)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, apiKey, type, enabled ? 1 : 0, maxOrder + 1,
    type === 'youtube' ? streamKey.trim() : null,
    type === 'generic' ? url : null,
    type === 'generic' && headers && typeof headers === 'object' ? JSON.stringify(headers) : null,
    type === 'viewer' ? viewerKey : null,
    noBatch ? 1 : 0,
  );
  return { ok: true, target: getCaptionTarget(db, apiKey, id) };
}

/**
 * Update a caption target. Only provided fields are changed; `type` is immutable.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @param {string} id
 * @param {{ enabled?: boolean, streamKey?: string, url?: string, headers?: object, viewerKey?: string, noBatch?: boolean }} patch
 * @returns {{ ok: true, target: object }|{ ok: false, error: string, status?: number }}
 */
export function updateCaptionTarget(db, apiKey, id, patch = {}) {
  const existing = db.prepare('SELECT * FROM caption_targets WHERE api_key = ? AND id = ?').get(apiKey, id);
  if (!existing) return { ok: false, error: 'Target not found', status: 404 };

  const streamKey = patch.streamKey !== undefined ? patch.streamKey : existing.stream_key;
  const url       = patch.url       !== undefined ? patch.url       : existing.url;
  const viewerKey = patch.viewerKey !== undefined ? patch.viewerKey : existing.viewer_key;

  const error = validateTypeFields(existing.type, { streamKey, url, viewerKey });
  if (error) return { ok: false, error };

  const headers = patch.headers !== undefined
    ? (patch.headers && typeof patch.headers === 'object' ? JSON.stringify(patch.headers) : null)
    : existing.headers;

  db.prepare(`
    UPDATE caption_targets SET
      enabled    = ?,
      stream_key = ?,
      url        = ?,
      headers    = ?,
      viewer_key = ?,
      no_batch   = ?,
      updated_at = datetime('now')
    WHERE api_key = ? AND id = ?
  `).run(
    patch.enabled !== undefined ? (patch.enabled ? 1 : 0) : existing.enabled,
    existing.type === 'youtube' ? streamKey.trim() : null,
    existing.type === 'generic' ? url : null,
    existing.type === 'generic' ? headers : null,
    existing.type === 'viewer' ? viewerKey : null,
    patch.noBatch !== undefined ? (patch.noBatch ? 1 : 0) : existing.no_batch,
    apiKey, id,
  );
  return { ok: true, target: getCaptionTarget(db, apiKey, id) };
}

/**
 * Delete a caption target.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @param {string} id
 * @returns {boolean} true if a row was deleted
 */
export function deleteCaptionTarget(db, apiKey, id) {
  const result = db.prepare('DELETE FROM caption_targets WHERE api_key = ? AND id = ?').run(apiKey, id);
  return result.changes > 0;
}

/**
 * Persist a new sort order for all of an API key's caption targets in one call.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @param {string[]} order  target ids in the desired order
 * @returns {{ ok: true }|{ ok: false, error: string }}
 */
export function reorderCaptionTargets(db, apiKey, order) {
  if (!Array.isArray(order) || order.length === 0) {
    return { ok: false, error: 'order must be a non-empty array of target ids' };
  }
  const existing = new Set(getCaptionTargets(db, apiKey).map(t => t.id));
  for (const id of order) {
    if (!existing.has(id)) return { ok: false, error: `Unknown target id: ${id}` };
  }
  const stmt = db.prepare('UPDATE caption_targets SET sort_order = ?, updated_at = datetime(\'now\') WHERE api_key = ? AND id = ?');
  const tx = db.transaction(() => {
    order.forEach((id, index) => stmt.run(index, apiKey, id));
  });
  tx();
  return { ok: true };
}
