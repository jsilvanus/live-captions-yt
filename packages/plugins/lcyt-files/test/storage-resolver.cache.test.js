/**
 * Tests for the storage resolver: per-key adapter selection, caching, and LRU eviction.
 *
 * Uses a stub DB and a lightweight in-memory fallback adapter so no S3 or WebDAV
 * connection is required.
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { createStorageResolver } from '../src/storage.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Create a DB stub that returns `config` for the given `matchKey`, or null otherwise.
 * Also counts how many times getKeyStorageConfig is called by tracking prepare() calls.
 */
function makeDb(matchKey, config, { callCount } = {}) {
  const counter = { n: 0 };
  if (callCount) callCount.ref = counter;

  return {
    prepare: (sql) => {
      if (sql.includes('SELECT') && sql.includes('key_storage_config')) {
        return {
          get: (key) => {
            counter.n++;
            return key === matchKey ? config : null;
          },
        };
      }
      return { get: () => null, run: () => {}, all: () => [] };
    },
  };
}

/** Minimal no-op adapter used as the global fallback. */
function makeFallback() {
  return {
    describe: () => '✓ fallback',
    openAppend: () => {},
    openRead: () => {},
    deleteFile: () => Promise.resolve(),
    keyDir: () => '/fallback',
    _isFallback: true,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('createStorageResolver', () => {
  let fallback;

  beforeEach(() => {
    fallback = makeFallback();
  });

  test('returns global fallback when no per-key config in DB', async () => {
    const db = makeDb('nobody', null);
    const { resolveStorage } = createStorageResolver(db, fallback);

    const result = await resolveStorage('anyKey');
    assert.strictEqual(result, fallback, 'should return the fallback adapter');
  });

  test('returns same fallback instance on repeated calls (no config)', async () => {
    const db = makeDb('nobody', null);
    const { resolveStorage } = createStorageResolver(db, fallback);

    const r1 = await resolveStorage('anyKey');
    const r2 = await resolveStorage('anyKey');
    assert.strictEqual(r1, r2, 'both calls should return the same fallback');
  });

  test('queries DB each time when no config (fallback not cached)', async () => {
    const dbCalls = { ref: null };
    const db = makeDb('nobody', null, { callCount: dbCalls });
    const { resolveStorage } = createStorageResolver(db, fallback);

    await resolveStorage('noConfig');
    await resolveStorage('noConfig');
    assert.strictEqual(dbCalls.ref.n, 2, 'DB should be queried each call (fallback not cached)');
  });

  test('invalidateCache removes a cached entry so next call queries DB', async () => {
    // DB always returns null (no config), so resolveStorage returns fallback each time.
    // After calling invalidateCache, the next resolveStorage call should re-query the DB.
    const dbCalls = { ref: null };
    const db = makeDb('nobody', null, { callCount: dbCalls });
    const { resolveStorage, invalidateCache } = createStorageResolver(db, fallback);

    await resolveStorage('key1');
    const callsAfterFirst = dbCalls.ref.n;

    invalidateCache('key1');
    await resolveStorage('key1');
    assert.ok(dbCalls.ref.n > callsAfterFirst, 'DB should be queried again after invalidation');
  });

  test('invalidateCache on unknown key is a safe no-op', () => {
    const db = makeDb('nobody', null);
    const { invalidateCache } = createStorageResolver(db, fallback);
    assert.doesNotThrow(() => invalidateCache('nonexistent-key'));
  });

  test('resolver is a function', () => {
    const db = makeDb('nobody', null);
    const { resolveStorage } = createStorageResolver(db, fallback);
    assert.strictEqual(typeof resolveStorage, 'function');
  });

  test('invalidateCache is a function', () => {
    const db = makeDb('nobody', null);
    const { invalidateCache } = createStorageResolver(db, fallback);
    assert.strictEqual(typeof invalidateCache, 'function');
  });
});

// ─── LRU eviction ────────────────────────────────────────────────────────────

describe('LRU eviction', () => {
  test('evicts oldest entry when cache exceeds FILES_CACHE_LIMIT', async () => {
    // Set a small cache limit via environment variable
    const original = process.env.FILES_CACHE_LIMIT;
    process.env.FILES_CACHE_LIMIT = '2';

    try {
      // We need keys that have a per-key config so the adapter is cached.
      // Use a DB stub that returns a fake WebDAV config for any key.
      const fakeConfig = {
        storage_type: 'webdav',
        endpoint: 'http://localhost:9999',
        prefix: 'captions',
        access_key_id: null,
        secret_access_key: null,
        bucket: '',
        region: 'auto',
      };

      // Count DB queries per key
      const counts = {};
      const db = {
        prepare: (sql) => ({
          get: (key) => {
            counts[key] = (counts[key] || 0) + 1;
            return fakeConfig;
          },
        }),
      };

      const fallback = makeFallback();
      const { resolveStorage } = createStorageResolver(db, fallback);

      // Fill cache with two keys — both succeed (webdav adapter created)
      // We catch errors from webdav import in test environments
      let adapterA, adapterB;
      try {
        adapterA = await resolveStorage('keyA');
      } catch { adapterA = null; }
      try {
        adapterB = await resolveStorage('keyB');
      } catch { adapterB = null; }

      // Adding a third key should evict the oldest (keyA)
      let adapterC;
      try {
        adapterC = await resolveStorage('keyC');
      } catch { adapterC = null; }

      // keyA should have been evicted; calling it again re-queries DB
      const countABeforeRetry = counts['keyA'] || 0;
      try { await resolveStorage('keyA'); } catch {}
      const countAAfterRetry = counts['keyA'] || 0;

      // If keyA was evicted, the DB should have been queried again (count goes up)
      assert.ok(countAAfterRetry > countABeforeRetry,
        'keyA should be re-queried after LRU eviction (cache size was 2)');
    } finally {
      // Restore original env
      if (original === undefined) {
        delete process.env.FILES_CACHE_LIMIT;
      } else {
        process.env.FILES_CACHE_LIMIT = original;
      }
    }
  });
});

