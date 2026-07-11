// ─── Image / graphics helpers ─────────────────────────────────────────────────

import { createHash } from 'node:crypto';

/**
 * Derive a safe, collision-free per-key directory name component from an API key.
 *
 * Single source of truth for the graphics pipeline's per-project directory
 * segment: it is used as the subdirectory name under GRAPHICS_DIR by the write
 * (routes/images.js), serve, and delete paths — including the delete-on-key
 * path in lcyt-backend's keys.js, which imports this via `lcyt-dsk`. Every site
 * that touches a project's graphics directory must agree on it, so it lives here.
 *
 * The raw key is sanitized to `[a-zA-Z0-9-]` and capped at 40 chars, which is
 * lossy — two distinct keys can sanitize to the same string (by differing only
 * in stripped characters, or beyond the length cap) and would then share a
 * directory. To keep the mapping 1:1 a short hash of the full raw key is
 * appended whenever sanitization altered it. Any already-safe key ≤40 chars —
 * including every default `randomUUID()` key — is returned unchanged, matching
 * the historical output so existing on-disk paths are untouched.
 *
 * @param {string} apiKey
 * @returns {string}
 */
export function safeApiKey(apiKey) {
  const raw = String(apiKey ?? '');
  const safe = raw.replace(/[^a-zA-Z0-9-]/g, '_').slice(0, 40);
  if (safe === raw) return safe;
  const suffix = createHash('sha256').update(raw).digest('hex').slice(0, 8);
  return `${safe}-${suffix}`;
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
 * Update the settings_json column for an image scoped to an API key.
 * @param {import('better-sqlite3').Database} db
 * @param {number} id
 * @param {string} apiKey
 * @param {object} settingsJson  parsed JS object — will be JSON-stringified
 * @returns {boolean} true if a row was updated
 */
export function updateImageSettings(db, id, apiKey, settingsJson) {
  const result = db.prepare(
    "UPDATE caption_files SET settings_json = ? WHERE id = ? AND api_key = ? AND type = 'image'"
  ).run(JSON.stringify(settingsJson), id, apiKey);
  return result.changes > 0;
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
