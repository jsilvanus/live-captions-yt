// ─── Image / graphics helpers ─────────────────────────────────────────────────

/**
 * Derive a safe per-key directory name component from an API key.
 * Strips characters not safe for file system paths and caps the length at 40.
 * Used as the subdirectory name under GRAPHICS_DIR (routes/images.js) and for
 * constructing image file paths in other modules (routes/captions.js).
 *
 * @param {string} apiKey
 * @returns {string}
 */
export function safeApiKey(apiKey) {
  return apiKey.replace(/[^a-zA-Z0-9-]/g, '_').slice(0, 40);
}

/**
 * Check whether graphics upload is enabled for an API key.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @returns {boolean}
 */
export function isGraphicsEnabled(db, apiKey) {
  const row = db.prepare('SELECT graphics_enabled FROM api_keys WHERE key = ?').get(apiKey);
  return row ? row.graphics_enabled === 1 : false;
}

/**
 * Register an uploaded image in caption_files.
 * @param {import('better-sqlite3').Database} db
 * @param {{ apiKey: string, filename: string, shorthand: string, mimeType: string, sizeBytes: number }} data
 * @returns {number} row id
 */
export function registerImage(db, { apiKey, filename, shorthand, mimeType, sizeBytes }) {
  const result = db.prepare(
    "INSERT INTO caption_files (api_key, filename, shorthand, mime_type, size_bytes, type, format) VALUES (?, ?, ?, ?, ?, 'image', 'image')"
  ).run(apiKey, filename, shorthand, mimeType, sizeBytes ?? 0);
  return result.lastInsertRowid;
}

/**
 * List all images for an API key.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @returns {Array}
 */
export function listImages(db, apiKey) {
  return db.prepare("SELECT * FROM caption_files WHERE api_key = ? AND type = 'image' ORDER BY created_at DESC").all(apiKey);
}

/**
 * Get a single image row by id (no api_key filter — for public DSK page serving).
 * @param {import('better-sqlite3').Database} db
 * @param {number} id
 * @returns {object|null}
 */
export function getImage(db, id) {
  return db.prepare("SELECT * FROM caption_files WHERE id = ? AND type = 'image'").get(id) ?? null;
}

/**
 * Get a single image row by id, scoped to an API key.
 * @param {import('better-sqlite3').Database} db
 * @param {number} id
 * @param {string} apiKey
 * @returns {object|null}
 */
export function getImageByKey(db, id, apiKey) {
  return db.prepare("SELECT * FROM caption_files WHERE id = ? AND api_key = ? AND type = 'image'").get(id, apiKey) ?? null;
}

/**
 * Get an image by shorthand name for a specific API key.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @param {string} shorthand
 * @returns {object|null}
 */
export function getImageByShorthand(db, apiKey, shorthand) {
  return db.prepare("SELECT * FROM caption_files WHERE api_key = ? AND shorthand = ? AND type = 'image'").get(apiKey, shorthand) ?? null;
}

/**
 * Check whether a shorthand name is already taken for an API key.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @param {string} shorthand
 * @returns {boolean}
 */
export function isShorthandTaken(db, apiKey, shorthand) {
  const row = db.prepare("SELECT id FROM caption_files WHERE api_key = ? AND shorthand = ? AND type = 'image'").get(apiKey, shorthand);
  return !!row;
}

/**
 * Delete an image row scoped to an API key.
 * @param {import('better-sqlite3').Database} db
 * @param {number} id
 * @param {string} apiKey
 * @returns {object|null} the deleted row (for disk cleanup), or null if not found
 */
export function deleteImage(db, id, apiKey) {
  const row = getImageByKey(db, id, apiKey);
  if (!row) return null;
  db.prepare('DELETE FROM caption_files WHERE id = ?').run(id);
  return row;
}

/**
 * Delete all image rows for an API key (for hard-delete cascade).
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @returns {Array} deleted rows (for disk cleanup)
 */
export function deleteAllImages(db, apiKey) {
  const rows = listImages(db, apiKey);
  db.prepare("DELETE FROM caption_files WHERE api_key = ? AND type = 'image'").run(apiKey);
  return rows;
}

/**
 * Get total image storage in bytes for an API key.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @returns {number}
 */
export function getTotalImageStorageBytes(db, apiKey) {
  const row = db.prepare("SELECT COALESCE(SUM(size_bytes),0) AS total FROM caption_files WHERE api_key = ? AND type = 'image'").get(apiKey);
  return row ? row.total : 0;
}
