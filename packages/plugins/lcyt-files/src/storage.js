/**
 * Storage adapter factory.
 *
 * Four storage modes:
 *
 *   1. local (default) — writes to FILES_DIR on the local filesystem.
 *      Selected when FILE_STORAGE env var is absent or set to "local".
 *
 *   2. Build-time S3 — operator-configured S3 via env vars.
 *      Selected when FILE_STORAGE=s3.
 *
 *   3. User-defined S3 — per-API-key S3 credentials stored in the DB.
 *      Requires the "files-custom-bucket" project feature.
 *      Configured via GET/PUT/DELETE /file/storage-config.
 *
 *   4. User-defined WebDAV — per-API-key WebDAV server stored in the DB.
 *      Requires the "files-webdav" project feature.
 *      Configured via GET/PUT/DELETE /file/storage-config with storage_type=webdav.
 *
 * The global adapter (mode 1 or 2) is created once at startup.  Per-key
 * adapters (modes 3/4) are created lazily and cached until invalidated.
 */

import { resolve } from 'node:path';

/**
 * Create and return a storage adapter based on environment configuration.
 * This creates the global (operator-configured) adapter — mode 1 or 2.
 *
 * @returns {Promise<import('./adapters/types.js').StorageAdapter>}
 */
export async function createStorageAdapter() {
  const mode = process.env.FILE_STORAGE || 'local';

  if (mode === 's3') {
    const bucket = process.env.S3_BUCKET;
    if (!bucket) throw new Error('S3_BUCKET must be set when FILE_STORAGE=s3');

    const region   = process.env.S3_REGION    || 'auto';
    const endpoint = process.env.S3_ENDPOINT  || undefined;
    const prefix   = process.env.S3_PREFIX    || 'captions';
    const credentials = process.env.S3_ACCESS_KEY_ID ? {
      accessKeyId:     process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
    } : undefined;

    const { createS3Adapter } = await import('./adapters/s3.js');
    return createS3Adapter({ bucket, prefix, region, endpoint, credentials });
  }

  // Default: local filesystem
  const baseDir = resolve(process.env.FILES_DIR || '/data/files');
  const { createLocalAdapter } = await import('./adapters/local.js');
  return createLocalAdapter(baseDir);
}

/**
 * Create a per-key storage resolver (modes 3 and 4 support).
 *
 * The returned `resolveStorage(apiKey)` function checks the DB for a
 * user-defined config and, if found, returns a per-key adapter (S3 or WebDAV).
 * If no per-key config exists, it falls back to the global adapter.
 *
 * Per-key adapters are created lazily and cached in memory.
 * Call `invalidateCache(apiKey)` after the user updates or removes their
 * config so the next call picks up the new settings.
 *
 * Access control (feature flag checks) is enforced in the route handler
 * before writing to key_storage_config, not here.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {import('./adapters/types.js').StorageAdapter} fallback  Global adapter (mode 1 or 2)
 * @returns {{ resolveStorage: (apiKey: string) => Promise<import('./adapters/types.js').StorageAdapter>, invalidateCache: (apiKey: string) => void }}
 */
export function createStorageResolver(db, fallback) {
  // Per-key adapter cache: apiKey -> StorageAdapter
  // Bounded LRU cache to avoid unbounded memory growth in multi-tenant setups.
  const MAX_CACHE = parseInt(process.env.FILES_CACHE_LIMIT || '500', 10);
  const cache = new Map();

  // Helper to move a key to the most-recently-used position
  function touchCacheKey(key) {
    const v = cache.get(key);
    if (v === undefined) return;
    cache.delete(key);
    cache.set(key, v);
  }


  const cache = new Map();

  async function resolveStorage(apiKey) {
    if (cache.has(apiKey)) return cache.get(apiKey);

    const { getKeyStorageConfig } = await import('./db.js');
    const config = getKeyStorageConfig(db, apiKey);
    if (!config) return fallback;

    let adapter;

    if (config.storage_type === 'webdav') {
      const { createWebDavAdapter } = await import('./adapters/webdav.js');
      adapter = await createWebDavAdapter({
        url:      config.endpoint,
        prefix:   config.prefix   || 'captions',
        username: config.access_key_id     || undefined,
        password: config.secret_access_key || undefined,
      });
    } else {
      // Default: s3
      const { createS3Adapter } = await import('./adapters/s3.js');
      adapter = await createS3Adapter({
        bucket:      config.bucket,
        region:      config.region || 'auto',
        endpoint:    config.endpoint || undefined,
        prefix:      config.prefix  || 'captions',
        credentials: config.access_key_id ? {
          accessKeyId:     config.access_key_id,
          secretAccessKey: config.secret_access_key || '',
        } : undefined,
      });
    }

    cache.set(apiKey, adapter);
    // Evict least-recently-used when cache grows beyond limit
    if (cache.size > MAX_CACHE) {
      const firstKey = cache.keys().next().value;
      if (firstKey) cache.delete(firstKey);
    }
    return adapter;
  }

  function invalidateCache(apiKey) {
    cache.delete(apiKey);
  }

  return { resolveStorage, invalidateCache };
}
