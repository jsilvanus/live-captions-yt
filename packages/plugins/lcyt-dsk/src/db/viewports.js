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
 * @param {{ name: string, label?: string, viewportType?: string, width?: number, height?: number, textLayersJson?: string, displaySettingsJson?: string }} data
 * @returns {object} the upserted row
 */
export function upsertViewport(db, apiKey, { name, label, viewportType, width, height, textLayersJson, displaySettingsJson }) {
  db.prepare(`
    INSERT INTO dsk_viewports (api_key, name, label, viewport_type, width, height, text_layers_json, display_settings_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT (api_key, name) DO UPDATE SET
      label                 = excluded.label,
      viewport_type         = excluded.viewport_type,
      width                 = excluded.width,
      height                = excluded.height,
      text_layers_json      = excluded.text_layers_json,
      display_settings_json = excluded.display_settings_json,
      updated_at            = excluded.updated_at
  `).run(
    apiKey,
    name,
    label ?? null,
    viewportType ?? 'landscape',
    width ?? 1920,
    height ?? 1080,
    textLayersJson ?? null,
    displaySettingsJson ?? null,
  );
  return getViewport(db, apiKey, name);
}

/**
 * Enforce the single-composite-stream invariant (plan_dsk_viewport_settings
 * Phase 4): at most one viewport per api_key may have
 * `displaySettings.stream.mode === 'composite'`. Demotes every OTHER composite
 * viewport to `'standalone'` (keeping it enabled — only the composite bit is
 * exclusive). No-op unless `keepName`'s own stream is composite.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @param {string} keepName  the viewport allowed to stay composite
 * @returns {string[]} names of viewports that were demoted
 */
export function demoteOtherCompositeViewports(db, apiKey, keepName) {
  const rows = db.prepare(
    'SELECT name, display_settings_json FROM dsk_viewports WHERE api_key = ? AND name != ?'
  ).all(apiKey, keepName);

  const demoted = [];
  const tx = db.transaction(() => {
    for (const r of rows) {
      let settings;
      try { settings = JSON.parse(r.display_settings_json || 'null'); } catch { continue; }
      if (settings?.stream?.mode !== 'composite') continue;
      settings.stream.mode = 'standalone';
      db.prepare('UPDATE dsk_viewports SET display_settings_json = ?, updated_at = datetime(\'now\') WHERE api_key = ? AND name = ?')
        .run(JSON.stringify(settings), apiKey, r.name);
      demoted.push(r.name);
    }
  });
  tx();
  return demoted;
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
