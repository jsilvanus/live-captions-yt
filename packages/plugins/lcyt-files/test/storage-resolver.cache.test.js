/**
 * Tests for the storage resolver: per-key adapter selection, caching, and LRU eviction.
 *
 * Uses a stub DB and a lightweight in-memory fallback adapter so no S3 or WebDAV
 * connection is required.
 *
 * Per-key config stubs use `storage_type: 's3'` with fake credentials because
 * `createS3Adapter` constructs an S3Client but makes no network calls at
 * construction time — safe for unit tests without real AWS credentials.
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { createStorageResolver } from '../src/storage.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Fake S3 per-key config that `createStorageResolver` will accept and use to
 * build a real (but network-disconnected) S3 adapter.
 */
const FAKE_S3_CONFIG = {
  storage_type: 's3',
  bucket: 'test-bucket',
  region: 'us-east-1',
  prefix: 'captions',
  endpoint: null,
  access_key_id: 'FAKEKEY',
  secret_access_key: 'FAKESECRET',
};

/**
 * Create a DB stub whose getKeyStorageConfig query invokes `configFn(key)`.
 * Optionally tracks total call count via `callCount.ref`.
 */
function makeDb(configFn, { callCount } = {}) {
  const counter = { n: 0 };
  if (callCount) callCount.ref = counter;

  return {
    prepare: (sql) => {
      if (sql.includes('SELECT') && sql.includes('key_storage_config')) {
        return {
          get: (key) => {
            counter.n++;
            return configFn(key);
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
    const db = makeDb(() => null);
    const { resolveStorage } = createStorageResolver(db, fallback);

    const result = await resolveStorage('anyKey');
    assert.strictEqual(result, fallback, 'should return the fallback adapter');
  });

  test('returns same fallback instance on repeated calls (no config)', async () => {
    const db = makeDb(() => null);
    const { resolveStorage } = createStorageResolver(db, fallback);

    const r1 = await resolveStorage('anyKey');
    const r2 = await resolveStorage('anyKey');
    assert.strictEqual(r1, r2, 'both calls should return the same fallback');
  });

  test('queries DB each time when no config (fallback not cached)', async () => {
    const dbCalls = { ref: null };
    const db = makeDb(() => null, { callCount: dbCalls });
    const { resolveStorage } = createStorageResolver(db, fallback);

    await resolveStorage('noConfig');
    await resolveStorage('noConfig');
    assert.strictEqual(dbCalls.ref.n, 2, 'DB should be queried each call (fallback not cached)');
  });

  test('invalidateCache removes a cached entry so next call re-queries DB and falls back', async () => {
    let currentConfig = { ...FAKE_S3_CONFIG };
    const dbCalls = { ref: null };
    const db = makeDb(
      (key) => (key === 'key1' && currentConfig ? { ...currentConfig } : null),
      { callCount: dbCalls },
    );
    const { resolveStorage, invalidateCache } = createStorageResolver(db, fallback);

    // First call — creates and caches a per-key S3 adapter
    const cachedAdapter = await resolveStorage('key1');
    const callsAfterFirst = dbCalls.ref.n;
    assert.notStrictEqual(cachedAdapter, fallback, 'first call should create a per-key adapter, not return fallback');

    // Remove config from DB (simulates user deleting their storage config)
    currentConfig = null;

    // Without invalidation — should return the cached adapter, NOT re-query DB
    const stillCachedAdapter = await resolveStorage('key1');
    assert.strictEqual(stillCachedAdapter, cachedAdapter, 'without invalidation, cached adapter should be returned');
    assert.strictEqual(dbCalls.ref.n, callsAfterFirst, 'without invalidation, DB should not be re-queried');

    // After invalidation — should re-query DB and fall back to global adapter
    invalidateCache('key1');
    const fallbackAfterInvalidation = await resolveStorage('key1');
    assert.ok(dbCalls.ref.n > callsAfterFirst, 'DB should be queried again after invalidation');
    assert.strictEqual(fallbackAfterInvalidation, fallback, 'after invalidation with no DB config, should return global fallback');
  });

  test('invalidateCache on unknown key is a safe no-op', () => {
    const db = makeDb(() => null);
    const { invalidateCache } = createStorageResolver(db, fallback);
    assert.doesNotThrow(() => invalidateCache('nonexistent-key'));
  });

  test('resolver is a function', () => {
    const db = makeDb(() => null);
    const { resolveStorage } = createStorageResolver(db, fallback);
    assert.strictEqual(typeof resolveStorage, 'function');
  });

  test('invalidateCache is a function', () => {
    const db = makeDb(() => null);
    const { invalidateCache } = createStorageResolver(db, fallback);
    assert.strictEqual(typeof invalidateCache, 'function');
  });
});

// ─── LRU eviction ────────────────────────────────────────────────────────────

describe('LRU eviction', () => {
  test('evicts least-recently-used entry, not oldest-inserted', async () => {
    const original = process.env.FILES_CACHE_LIMIT;
    process.env.FILES_CACHE_LIMIT = '2';

    try {
      const dbCalls = {};
      const db = makeDb((key) => {
        dbCalls[key] = (dbCalls[key] || 0) + 1;
        return { ...FAKE_S3_CONFIG };
      });

      const fallback = makeFallback();
      const { resolveStorage } = createStorageResolver(db, fallback);

      // Add keyA (oldest) and keyB to fill the cache (size = 2)
      await resolveStorage('keyA');
      await resolveStorage('keyB');
      const callsAAfterInsert = dbCalls['keyA'];

      // Re-access keyA — this should move it to MRU position
      await resolveStorage('keyA');
      assert.strictEqual(dbCalls['keyA'], callsAAfterInsert, 'keyA should be served from cache, no DB re-query');

      // Add keyC — this should evict keyB (LRU), NOT keyA (recently accessed)
      await resolveStorage('keyC');

      // Verify keyA is still cached FIRST (before re-adding keyB, which would
      // fill the cache again and might evict keyA)
      const callsABeforeRetry = dbCalls['keyA'];
      await resolveStorage('keyA');
      assert.strictEqual(
        dbCalls['keyA'],
        callsABeforeRetry,
        'keyA should still be cached (it was the MRU when keyC was added)',
      );

      // Now verify keyB was evicted — re-adding it will query the DB
      const callsBBeforeRetry = dbCalls['keyB'];
      await resolveStorage('keyB');
      assert.ok(
        (dbCalls['keyB'] || 0) > callsBBeforeRetry,
        'keyB should have been evicted (LRU) and re-queried from DB',
      );
    } finally {
      if (original === undefined) {
        delete process.env.FILES_CACHE_LIMIT;
      } else {
        process.env.FILES_CACHE_LIMIT = original;
      }
    }
  });

  test('evicts oldest entry when no key has been re-accessed (FIFO fallback)', async () => {
    const original = process.env.FILES_CACHE_LIMIT;
    process.env.FILES_CACHE_LIMIT = '2';

    try {
      const dbCalls = {};
      const db = makeDb((key) => {
        dbCalls[key] = (dbCalls[key] || 0) + 1;
        return { ...FAKE_S3_CONFIG };
      });

      const fallback = makeFallback();
      const { resolveStorage } = createStorageResolver(db, fallback);

      // Add keyA and keyB (no re-access)
      await resolveStorage('keyA');
      await resolveStorage('keyB');

      // Adding keyC should evict keyA (oldest / LRU)
      await resolveStorage('keyC');

      const callsABeforeRetry = dbCalls['keyA'];
      await resolveStorage('keyA');
      assert.ok(
        (dbCalls['keyA'] || 0) > callsABeforeRetry,
        'keyA (oldest) should be evicted when no re-access happened',
      );
    } finally {
      if (original === undefined) {
        delete process.env.FILES_CACHE_LIMIT;
      } else {
        process.env.FILES_CACHE_LIMIT = original;
      }
    }
  });
});
