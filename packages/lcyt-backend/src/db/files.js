// ─── Caption files (backend file saving) ─────────────────────────────────────

/**
 * Check whether backend file saving is enabled for an API key.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @returns {boolean}
 */
export function isBackendFileEnabled(db, apiKey) {
  const row = db.prepare('SELECT backend_file_enabled FROM api_keys WHERE key = ?').get(apiKey);
  return row ? row.backend_file_enabled === 1 : false;
}

/**
 * Register a new caption file in the database.
 * @param {import('better-sqlite3').Database} db
 * @param {{ apiKey, sessionId, filename, lang, format, type }} data
 * @returns {number} row id
 */
export function registerCaptionFile(db, { apiKey, sessionId, filename, lang, format, type }) {
  const result = db.prepare(
    'INSERT INTO caption_files (api_key, session_id, filename, lang, format, type) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(apiKey, sessionId ?? null, filename, lang ?? null, format ?? 'youtube', type ?? 'captions');
  return result.lastInsertRowid;
}

/**
 * Update the size and updated_at of a caption file entry.
 * @param {import('better-sqlite3').Database} db
 * @param {number} id
 * @param {number} sizeBytes
 */
export function updateCaptionFileSize(db, id, sizeBytes) {
  db.prepare("UPDATE caption_files SET size_bytes = ?, updated_at = datetime('now') WHERE id = ?").run(sizeBytes, id);
}

/**
 * List all caption files for an API key.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @returns {Array}
 */
export function listCaptionFiles(db, apiKey) {
  return db.prepare('SELECT * FROM caption_files WHERE api_key = ? ORDER BY created_at DESC').all(apiKey);
}

/**
 * Get a single caption file row by id, optionally scoped to an API key.
 * @param {import('better-sqlite3').Database} db
 * @param {number} id
 * @param {string} [apiKey]
 * @returns {object|null}
 */
export function getCaptionFile(db, id, apiKey) {
  if (apiKey) {
    return db.prepare('SELECT * FROM caption_files WHERE id = ? AND api_key = ?').get(id, apiKey) ?? null;
  }
  return db.prepare('SELECT * FROM caption_files WHERE id = ?').get(id) ?? null;
}

/**
 * Delete a caption file row by id, scoped to an API key (for security).
 * @param {import('better-sqlite3').Database} db
 * @param {number} id
 * @param {string} apiKey
 * @returns {boolean} true if a row was deleted
 */
export function deleteCaptionFile(db, id, apiKey) {
  const result = db.prepare('DELETE FROM caption_files WHERE id = ? AND api_key = ?').run(id, apiKey);
  return result.changes > 0;
}

/**
 * Delete all caption file rows for an API key (for GDPR erasure).
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 */
export function deleteAllCaptionFiles(db, apiKey) {
  db.prepare('DELETE FROM caption_files WHERE api_key = ?').run(apiKey);
}
