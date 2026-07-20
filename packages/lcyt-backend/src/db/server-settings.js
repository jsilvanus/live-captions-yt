/**
 * server_settings DB helpers (plan_env_to_ui_settings.md).
 *
 * Thin per the repo's DB-module convention — no precedence/coercion logic
 * here, that's SettingsService's job (src/settings/service.js). This module
 * only knows how to read/write raw JSON-encoded rows.
 */

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} key
 * @returns {{ key: string, value: string, updated_at: string, updated_by: string|null }|undefined}
 */
export function getServerSettingRow(db, key) {
  return db.prepare(
    'SELECT key, value, updated_at, updated_by FROM server_settings WHERE key = ?'
  ).get(key);
}

/**
 * @param {import('better-sqlite3').Database} db
 * @returns {Array<{ key: string, value: string, updated_at: string, updated_by: string|null }>}
 */
export function getAllServerSettingRows(db) {
  return db.prepare(
    'SELECT key, value, updated_at, updated_by FROM server_settings'
  ).all();
}

/**
 * Upsert a raw (already JSON-encoded) setting value.
 * @param {import('better-sqlite3').Database} db
 * @param {string} key
 * @param {string} jsonValue
 * @param {string|null} [updatedBy]
 */
export function setServerSettingRow(db, key, jsonValue, updatedBy = null) {
  db.prepare(`
    INSERT INTO server_settings (key, value, updated_at, updated_by)
    VALUES (?, ?, datetime('now'), ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = datetime('now'),
      updated_by = excluded.updated_by
  `).run(key, jsonValue, updatedBy ?? null);
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} key
 */
export function deleteServerSettingRow(db, key) {
  db.prepare('DELETE FROM server_settings WHERE key = ?').run(key);
}
