// ─── Viewport helpers ─────────────────────────────────────────────────────────

/**
 * List all user-defined viewports for an API key.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @returns {Array}
 */
export function listViewports(db, apiKey) {
  return db.prepare(
    'SELECT * FROM dsk_viewports WHERE api_key = ? ORDER BY created_at ASC'
  ).all(apiKey);
}

/**
 * Get a single viewport by name for an API key.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @param {string} name
 * @returns {object|null}
 */
export function getViewport(db, apiKey, name) {
  return db.prepare(
    'SELECT * FROM dsk_viewports WHERE api_key = ? AND name = ?'
  ).get(apiKey, name) ?? null;
}

/**
 * Create or update a viewport. Name is immutable once set (use delete + create to rename).
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @param {{ name: string, label?: string, viewportType?: string, width?: number, height?: number }} data
 * @returns {object} the upserted row
 */
export function upsertViewport(db, apiKey, { name, label, viewportType, width, height }) {
  db.prepare(`
    INSERT INTO dsk_viewports (api_key, name, label, viewport_type, width, height, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT (api_key, name) DO UPDATE SET
      label         = excluded.label,
      viewport_type = excluded.viewport_type,
      width         = excluded.width,
      height        = excluded.height,
      updated_at    = excluded.updated_at
  `).run(
    apiKey,
    name,
    label ?? null,
    viewportType ?? 'landscape',
    width ?? 1920,
    height ?? 1080,
  );
  return getViewport(db, apiKey, name);
}

/**
 * Delete a viewport by name.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @param {string} name
 * @returns {boolean} true if a row was deleted
 */
export function deleteViewport(db, apiKey, name) {
  const result = db.prepare(
    'DELETE FROM dsk_viewports WHERE api_key = ? AND name = ?'
  ).run(apiKey, name);
  return result.changes > 0;
}
