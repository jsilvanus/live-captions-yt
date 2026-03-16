/**
 * DSK plugin DB migrations.
 *
 * Called by initDskControl() before any routes are mounted.
 * All migrations are additive (safe to run on existing databases).
 *
 * Tables managed here:
 *   dsk_templates         — JSON templates for the Playwright renderer
 *   caption_files.shorthand, caption_files.mime_type  — image metadata columns
 *
 * Note: graphics_enabled on api_keys is intentionally left in lcyt-backend's
 * db/index.js because the key admin routes (routes/keys.js) reference it.
 *
 * @param {import('better-sqlite3').Database} db
 */
export function runMigrations(db) {
  // dsk_templates: JSON templates for the Playwright-based renderer
  db.exec(`
    CREATE TABLE IF NOT EXISTS dsk_templates (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      api_key       TEXT    NOT NULL,
      name          TEXT    NOT NULL,
      template_json TEXT    NOT NULL,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE (api_key, name)
    )
  `);

  // dsk_viewports: named display targets (landscape, vertical-left, viewer, etc.)
  db.exec(`
    CREATE TABLE IF NOT EXISTS dsk_viewports (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      api_key        TEXT    NOT NULL,
      name           TEXT    NOT NULL,
      label          TEXT,
      viewport_type  TEXT    NOT NULL DEFAULT 'landscape',
      width          INTEGER NOT NULL DEFAULT 1920,
      height         INTEGER NOT NULL DEFAULT 1080,
      created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at     TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE (api_key, name)
    )
  `);

  // Additive columns on caption_files for image metadata (DSK images are stored there)
  const filesCols = new Set(
    db.prepare('PRAGMA table_info(caption_files)').all().map(c => c.name)
  );
  if (!filesCols.has('shorthand'))     db.exec('ALTER TABLE caption_files ADD COLUMN shorthand TEXT');
  if (!filesCols.has('mime_type'))     db.exec('ALTER TABLE caption_files ADD COLUMN mime_type TEXT');
  // settings_json: per-viewport visibility, position, animation overrides for each image
  if (!filesCols.has('settings_json')) db.exec('ALTER TABLE caption_files ADD COLUMN settings_json TEXT');

  // Additive column on dsk_viewports for text layers (bound to caption codes)
  const vpCols = new Set(
    db.prepare('PRAGMA table_info(dsk_viewports)').all().map(c => c.name)
  );
  if (!vpCols.has('text_layers_json')) db.exec('ALTER TABLE dsk_viewports ADD COLUMN text_layers_json TEXT');
}
