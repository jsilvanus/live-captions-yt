/**
 * Per-key storage configuration — DB helpers.
 *
 * Manages the `key_storage_config` table which stores user-defined storage
 * credentials for per-key custom storage (S3-compatible or WebDAV).
 * The table comes from the backend's Prisma schema / PostgreSQL migrations.
 */

function nowStr() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Get per-key storage config, or null if not set.
 *
 * @param {object} db  Prisma client
 * @param {string} apiKey
 * @returns {Promise<{ api_key, storage_type, bucket, region, endpoint, prefix, access_key_id, secret_access_key, updated_at }|null>}
 */
export async function getKeyStorageConfig(db, apiKey) {
  return (await db.key_storage_config.findUnique({ where: { api_key: apiKey } })) ?? null;
}

/**
 * Upsert per-key storage config.
 *
 * @param {object} db  Prisma client
 * @param {string} apiKey
 * @param {{ storage_type?: string, bucket?: string, region?: string, endpoint?: string, prefix?: string, access_key_id?: string, secret_access_key?: string }} config
 * @returns {Promise<void>}
 */
export async function setKeyStorageConfig(db, apiKey, { storage_type, bucket, region, endpoint, prefix, access_key_id, secret_access_key }) {
  const values = {
    storage_type: storage_type || 's3',
    bucket: bucket || '',
    region: region || 'auto',
    endpoint: endpoint || null,
    prefix: prefix || 'captions',
    access_key_id: access_key_id || null,
    secret_access_key: secret_access_key || null,
    updated_at: nowStr(),
  };
  await db.key_storage_config.upsert({ where: { api_key: apiKey }, create: { api_key: apiKey, ...values }, update: values });
}

/**
 * Remove per-key storage config (reverts key to global default storage).
 *
 * @param {object} db  Prisma client
 * @param {string} apiKey
 * @returns {Promise<void>}
 */
export async function deleteKeyStorageConfig(db, apiKey) {
  await db.key_storage_config.deleteMany({ where: { api_key: apiKey } });
}
