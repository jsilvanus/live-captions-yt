/**
 * Per-key storage configuration — DB helpers.
 *
 * Manages the `key_storage_config` table which stores user-defined S3
 * credentials for the "user-defined S3" storage mode.
 *
 * The table is created by runFilesDbMigrations(), called from initFilesControl().
 */

/**
 * Run DB migrations for the lcyt-files plugin.
 * Safe to call on an existing database (CREATE TABLE IF NOT EXISTS).
 *
 * @param {import('better-sqlite3').Database} db
 */
export function runFilesDbMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS key_storage_config (
      api_key           TEXT PRIMARY KEY NOT NULL,
      bucket            TEXT NOT NULL,
      region            TEXT NOT NULL DEFAULT 'auto',
      endpoint          TEXT,
      prefix            TEXT NOT NULL DEFAULT 'captions',
      access_key_id     TEXT,
      secret_access_key TEXT,
      updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

/**
 * Get per-key S3 config, or null if not set.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @returns {{ api_key, bucket, region, endpoint, prefix, access_key_id, secret_access_key, updated_at }|null}
 */
export function getKeyStorageConfig(db, apiKey) {
  return db.prepare(
    'SELECT api_key, bucket, region, endpoint, prefix, access_key_id, secret_access_key, updated_at FROM key_storage_config WHERE api_key = ?'
  ).get(apiKey) ?? null;
}

/**
 * Upsert per-key S3 config.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @param {{ bucket: string, region?: string, endpoint?: string, prefix?: string, access_key_id?: string, secret_access_key?: string }} config
 */
export function setKeyStorageConfig(db, apiKey, { bucket, region, endpoint, prefix, access_key_id, secret_access_key }) {
  db.prepare(`
    INSERT INTO key_storage_config (api_key, bucket, region, endpoint, prefix, access_key_id, secret_access_key, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT (api_key) DO UPDATE SET
      bucket            = excluded.bucket,
      region            = excluded.region,
      endpoint          = excluded.endpoint,
      prefix            = excluded.prefix,
      access_key_id     = excluded.access_key_id,
      secret_access_key = excluded.secret_access_key,
      updated_at        = excluded.updated_at
  `).run(
    apiKey,
    bucket,
    region || 'auto',
    endpoint || null,
    prefix || 'captions',
    access_key_id || null,
    secret_access_key || null,
  );
}

/**
 * Remove per-key S3 config (reverts key to global default storage).
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 */
export function deleteKeyStorageConfig(db, apiKey) {
  db.prepare('DELETE FROM key_storage_config WHERE api_key = ?').run(apiKey);
}
