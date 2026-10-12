/**
 * server_settings DB helpers (plan_env_to_ui_settings.md).
 *
 * Thin per the repo's DB-module convention — no precedence/coercion logic
 * here, that's SettingsService's job (src/settings/service.js). This module
 * only knows how to read/write raw JSON-encoded rows.
 */
import { sqlNow } from './helpers.js';

const SETTING_FIELDS = { key: true, value: true, updated_at: true, updated_by: true };

/**
 * @param {import('./connection.js').Db} db
 * @param {string} key
 * @returns {Promise<{ key: string, value: string, updated_at: string, updated_by: string|null }|undefined>}
 */
export async function getServerSettingRow(db, key) {
  return (await db.server_settings.findUnique({ where: { key }, select: SETTING_FIELDS })) ?? undefined;
}

/**
 * @param {import('./connection.js').Db} db
 * @returns {Promise<Array<{ key: string, value: string, updated_at: string, updated_by: string|null }>>}
 */
export async function getAllServerSettingRows(db) {
  return db.server_settings.findMany({ select: SETTING_FIELDS });
}

/**
 * Upsert a raw (already JSON-encoded) setting value.
 * @param {import('./connection.js').Db} db
 * @param {string} key
 * @param {string} jsonValue
 * @param {string|null} [updatedBy]
 */
export async function setServerSettingRow(db, key, jsonValue, updatedBy = null) {
  const updated_at = sqlNow();
  const updated_by = updatedBy ?? null;
  await db.server_settings.upsert({
    where: { key },
    create: { key, value: jsonValue, updated_at, updated_by },
    update: { value: jsonValue, updated_at, updated_by },
  });
}

/**
 * @param {import('./connection.js').Db} db
 * @param {string} key
 */
export async function deleteServerSettingRow(db, key) {
  await db.server_settings.deleteMany({ where: { key } });
}
