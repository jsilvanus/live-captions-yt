import { sqlNow, num } from './helpers.js';

// ─── Caption files (backend file saving) ─────────────────────────────────────

function toRow(row) {
  return row ? { ...row, size_bytes: num(row.size_bytes) } : row;
}

/**
 * Check whether backend file saving is enabled for an API key.
 * @param {import('./connection.js').Db} db
 * @param {string} apiKey
 * @returns {Promise<boolean>}
 */
export async function isBackendFileEnabled(db, apiKey) {
  const row = await db.api_keys.findUnique({ where: { key: apiKey }, select: { backend_file_enabled: true } });
  return row ? row.backend_file_enabled === 1 : false;
}

/**
 * Register a new caption file in the database.
 * @param {import('./connection.js').Db} db
 * @param {{ apiKey, sessionId, filename, lang, format, type }} data
 * @returns {Promise<number>} row id
 */
export async function registerCaptionFile(db, { apiKey, sessionId, filename, lang, format, type }) {
  const row = await db.caption_files.create({
    data: {
      api_key: apiKey,
      session_id: sessionId ?? null,
      filename,
      lang: lang ?? null,
      format: format ?? 'youtube',
      type: type ?? 'captions',
    },
  });
  return row.id;
}

/**
 * Update the size and updated_at of a caption file entry.
 * @param {import('./connection.js').Db} db
 * @param {number} id
 * @param {number} sizeBytes
 * @returns {Promise<void>}
 */
export async function updateCaptionFileSize(db, id, sizeBytes) {
  await db.caption_files.updateMany({
    where: { id: Number(id) },
    data: { size_bytes: Math.round(Number(sizeBytes) || 0), updated_at: sqlNow() },
  });
}

/**
 * Overwrite filename/lang/format/type of a caption file (PUT /file/:id) and bump updated_at.
 * @param {import('./connection.js').Db} db
 * @param {number} id
 * @param {string} apiKey
 * @param {{ filename, lang, format, type }} fields
 * @returns {Promise<void>}
 */
export async function updateCaptionFileMeta(db, id, apiKey, { filename, lang, format, type }) {
  await db.caption_files.updateMany({
    where: { id: Number(id), api_key: apiKey },
    data: { filename, lang: lang ?? null, format, type, updated_at: sqlNow() },
  });
}

/**
 * List all caption files for an API key.
 * @param {import('./connection.js').Db} db
 * @param {string} apiKey
 * @returns {Promise<Array>}
 */
export async function listCaptionFiles(db, apiKey) {
  const rows = await db.caption_files.findMany({
    where: { api_key: apiKey },
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
  });
  return rows.map(toRow);
}

/**
 * Get a single caption file row by id, optionally scoped to an API key.
 * @param {import('./connection.js').Db} db
 * @param {number} id
 * @param {string} [apiKey]
 * @returns {Promise<object|null>}
 */
export async function getCaptionFile(db, id, apiKey) {
  const n = Number(id);
  if (!Number.isInteger(n)) return null;
  const where = apiKey ? { id: n, api_key: apiKey } : { id: n };
  return toRow(await db.caption_files.findFirst({ where })) ?? null;
}

/**
 * Delete a caption file row by id, scoped to an API key (for security).
 * @param {import('./connection.js').Db} db
 * @param {number} id
 * @param {string} apiKey
 * @returns {Promise<boolean>} true if a row was deleted
 */
export async function deleteCaptionFile(db, id, apiKey) {
  const n = Number(id);
  if (!Number.isInteger(n)) return false;
  const r = await db.caption_files.deleteMany({ where: { id: n, api_key: apiKey } });
  return r.count > 0;
}

/**
 * Delete all caption file rows for an API key (for GDPR erasure).
 * @param {import('./connection.js').Db} db
 * @param {string} apiKey
 * @returns {Promise<void>}
 */
export async function deleteAllCaptionFiles(db, apiKey) {
  await db.caption_files.deleteMany({ where: { api_key: apiKey } });
}
