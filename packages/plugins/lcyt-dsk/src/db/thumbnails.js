/**
 * DB helpers for DSK thumbnails.
 *
 * Table: dsk_thumbnails
 *   id            INTEGER PK
 *   api_key       TEXT NOT NULL
 *   template_id   INTEGER NULL
 *   name          TEXT NOT NULL
 *   storage_path  TEXT NOT NULL
 *   width         INTEGER NOT NULL
 *   height        INTEGER NOT NULL
 *   size_bytes    INTEGER NOT NULL DEFAULT 0
 *   created_at    TEXT NOT NULL DEFAULT (datetime('now'))
 *   updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
 */

/**
 * Create a thumbnail row.
 * @param {import('better-sqlite3').Database} db
 * @param {{ apiKey: string, templateId?: number|null, name: string, storagePath: string, width: number, height: number, sizeBytes?: number }} opts
 * @returns {number}
 */
export function createThumbnail(db, { apiKey, templateId = null, name, storagePath, width, height, sizeBytes = 0 }) {
  const { lastInsertRowid } = db.prepare(
    `INSERT INTO dsk_thumbnails (api_key, template_id, name, storage_path, width, height, size_bytes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
  ).run(apiKey, templateId ?? null, name, storagePath, width, height, sizeBytes);
  return Number(lastInsertRowid);
}

/**
 * List thumbnails for an API key.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @returns {Array<object>}
 */
export function listThumbnails(db, apiKey) {
  return db.prepare(
    'SELECT id, template_id, name, storage_path, width, height, size_bytes, created_at, updated_at FROM dsk_thumbnails WHERE api_key = ? ORDER BY created_at DESC'
  ).all(apiKey);
}

/**
 * Get a thumbnail row for an API key.
 * @param {import('better-sqlite3').Database} db
 * @param {number} id
 * @param {string} apiKey
 * @returns {object|null}
 */
export function getThumbnail(db, id, apiKey) {
  return db.prepare(
    'SELECT id, template_id, name, storage_path, width, height, size_bytes, created_at, updated_at FROM dsk_thumbnails WHERE id = ? AND api_key = ?'
  ).get(id, apiKey) ?? null;
}

/**
 * Update a thumbnail row.
 * @param {import('better-sqlite3').Database} db
 * @param {number} id
 * @param {string} apiKey
 * @param {{ name?: string, templateId?: number|null, width?: number, height?: number, sizeBytes?: number, storagePath?: string }} patch
 * @returns {boolean}
 */
export function updateThumbnail(db, id, apiKey, patch = {}) {
  const fields = [];
  const values = [];
  if (patch.name != null) { fields.push('name = ?'); values.push(patch.name); }
  if (patch.templateId != null) { fields.push('template_id = ?'); values.push(patch.templateId ?? null); }
  if (patch.width != null) { fields.push('width = ?'); values.push(patch.width); }
  if (patch.height != null) { fields.push('height = ?'); values.push(patch.height); }
  if (patch.sizeBytes != null) { fields.push('size_bytes = ?'); values.push(patch.sizeBytes); }
  if (patch.storagePath != null) { fields.push('storage_path = ?'); values.push(patch.storagePath); }
  if (fields.length === 0) return false;
  fields.push('updated_at = datetime(\'now\')');
  values.push(id, apiKey);
  const { changes } = db.prepare(`UPDATE dsk_thumbnails SET ${fields.join(', ')} WHERE id = ? AND api_key = ?`).run(...values);
  return changes > 0;
}

/**
 * Delete a thumbnail row.
 * @param {import('better-sqlite3').Database} db
 * @param {number} id
 * @param {string} apiKey
 * @returns {boolean}
 */
export function deleteThumbnail(db, id, apiKey) {
  const { changes } = db.prepare('DELETE FROM dsk_thumbnails WHERE id = ? AND api_key = ?').run(id, apiKey);
  return changes > 0;
}
