/**
 * Per-key storage configuration — DB helpers.
 *
 * Manages the `key_storage_config` table which stores user-defined storage
 * credentials for per-key custom storage (S3-compatible or WebDAV).
 *
 * The table is created by runFilesDbMigrations(), called from initFilesControl().
 */

/**
 * Run DB migrations for the lcyt-files plugin.
 * Safe to call on an existing database (additive only).
 *
 * @param {import('better-sqlite3').Database} db
 */
export function runFilesDbMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS key_storage_config (
      api_key           TEXT PRIMARY KEY NOT NULL,
      storage_type      TEXT NOT NULL DEFAULT 's3',
      bucket            TEXT NOT NULL DEFAULT '',
      region            TEXT NOT NULL DEFAULT 'auto',
      endpoint          TEXT,
      prefix            TEXT NOT NULL DEFAULT 'captions',
      access_key_id     TEXT,
      secret_access_key TEXT,
      updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  // Additive migration: add storage_type to existing tables that pre-date it
  try {
    db.exec(`ALTER TABLE key_storage_config ADD COLUMN storage_type TEXT NOT NULL DEFAULT 's3'`);
  } catch {
    // Column already exists — ignore
  }
}

/**
 * Get per-key storage config, or null if not set.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @returns {{ api_key, storage_type, bucket, region, endpoint, prefix, access_key_id, secret_access_key, updated_at }|null}
 */
export function getKeyStorageConfig(db, apiKey) {
  return db.prepare(
    'SELECT api_key, storage_type, bucket, region, endpoint, prefix, access_key_id, secret_access_key, updated_at FROM key_storage_config WHERE api_key = ?'
  ).get(apiKey) ?? null;
}

/**
 * Upsert per-key storage config.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @param {{ storage_type?: string, bucket?: string, region?: string, endpoint?: string, prefix?: string, access_key_id?: string, secret_access_key?: string }} config
 */
export function setKeyStorageConfig(db, apiKey, { storage_type, bucket, region, endpoint, prefix, access_key_id, secret_access_key }) {
  db.prepare(`
    INSERT INTO key_storage_config (api_key, storage_type, bucket, region, endpoint, prefix, access_key_id, secret_access_key, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT (api_key) DO UPDATE SET
      storage_type      = excluded.storage_type,
      bucket            = excluded.bucket,
      region            = excluded.region,
      endpoint          = excluded.endpoint,
      prefix            = excluded.prefix,
      access_key_id     = excluded.access_key_id,
      secret_access_key = excluded.secret_access_key,
      updated_at        = excluded.updated_at
  `).run(
    apiKey,
    storage_type || 's3',
    bucket || '',
    region || 'auto',
    endpoint || null,
    prefix || 'captions',
    access_key_id || null,
    secret_access_key || null,
  );
}

/**
 * Remove per-key storage config (reverts key to global default storage).
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 */
export function deleteKeyStorageConfig(db, apiKey) {
  db.prepare('DELETE FROM key_storage_config WHERE api_key = ?').run(apiKey);
}
