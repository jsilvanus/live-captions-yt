import { num } from './helpers.js';

// ─── Icons (user-uploaded PNG/SVG for viewer branding) ────────────────────────

function toRow(row) {
  return row ? { ...row, size_bytes: num(row.size_bytes) } : row;
}

/**
 * Register a new icon in the database.
 * @param {import('./connection.js').Db} db
 * @param {{ apiKey: string, filename: string, diskFilename: string, mimeType: string, sizeBytes: number }} data
 * @returns {Promise<number>} row id
 */
export async function registerIcon(db, { apiKey, filename, diskFilename, mimeType, sizeBytes }) {
  const row = await db.icons.create({
    data: {
      api_key: apiKey,
      filename,
      disk_filename: diskFilename,
      mime_type: mimeType ?? 'image/png',
      size_bytes: Math.round(Number(sizeBytes ?? 0)) || 0,
    },
  });
  return row.id;
}

/**
 * List all icons for an API key, newest first.
 * @param {import('./connection.js').Db} db
 * @param {string} apiKey
 * @returns {Promise<Array>}
 */
export async function listIcons(db, apiKey) {
  const rows = await db.icons.findMany({
    where: { api_key: apiKey },
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
  });
  return rows.map(toRow);
}

/**
 * Get a single icon row by id (no API key scoping — for public serving).
 * @param {import('./connection.js').Db} db
 * @param {number} id
 * @returns {Promise<object|null>}
 */
export async function getIcon(db, id) {
  const n = Number(id);
  if (!Number.isInteger(n)) return null;
  return toRow(await db.icons.findUnique({ where: { id: n } })) ?? null;
}

/**
 * Delete an icon row by id, scoped to an API key.
 * @param {import('./connection.js').Db} db
 * @param {number} id
 * @param {string} apiKey
 * @returns {Promise<boolean>} true if a row was deleted
 */
export async function deleteIcon(db, id, apiKey) {
  const n = Number(id);
  if (!Number.isInteger(n)) return false;
  const r = await db.icons.deleteMany({ where: { id: n, api_key: apiKey } });
  return r.count > 0;
}

/**
 * Delete all icon rows for an API key (for GDPR erasure).
 * @param {import('./connection.js').Db} db
 * @param {string} apiKey
 * @returns {Promise<void>}
 */
export async function deleteAllIcons(db, apiKey) {
  await db.icons.deleteMany({ where: { api_key: apiKey } });
}
