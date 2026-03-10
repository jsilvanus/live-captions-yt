// ─── Icons (user-uploaded PNG/SVG for viewer branding) ────────────────────────

/**
 * Register a new icon in the database.
 * @param {import('better-sqlite3').Database} db
 * @param {{ apiKey: string, filename: string, diskFilename: string, mimeType: string, sizeBytes: number }} data
 * @returns {number} row id
 */
export function registerIcon(db, { apiKey, filename, diskFilename, mimeType, sizeBytes }) {
  const result = db.prepare(
    'INSERT INTO icons (api_key, filename, disk_filename, mime_type, size_bytes) VALUES (?, ?, ?, ?, ?)'
  ).run(apiKey, filename, diskFilename, mimeType ?? 'image/png', sizeBytes ?? 0);
  return result.lastInsertRowid;
}

/**
 * List all icons for an API key, newest first.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @returns {Array}
 */
export function listIcons(db, apiKey) {
  return db.prepare('SELECT * FROM icons WHERE api_key = ? ORDER BY created_at DESC').all(apiKey);
}

/**
 * Get a single icon row by id (no API key scoping — for public serving).
 * @param {import('better-sqlite3').Database} db
 * @param {number} id
 * @returns {object|null}
 */
export function getIcon(db, id) {
  return db.prepare('SELECT * FROM icons WHERE id = ?').get(id) ?? null;
}

/**
 * Delete an icon row by id, scoped to an API key.
 * @param {import('better-sqlite3').Database} db
 * @param {number} id
 * @param {string} apiKey
 * @returns {boolean} true if a row was deleted
 */
export function deleteIcon(db, id, apiKey) {
  const result = db.prepare('DELETE FROM icons WHERE id = ? AND api_key = ?').run(id, apiKey);
  return result.changes > 0;
}

/**
 * Delete all icon rows for an API key (for GDPR erasure).
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 */
export function deleteAllIcons(db, apiKey) {
  db.prepare('DELETE FROM icons WHERE api_key = ?').run(apiKey);
}
