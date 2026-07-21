/**
 * Unit tests for src/lib/storageQuota.js — pure functions, no React/DOM.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getStorageEstimate, WARN_RATIO } from '../src/lib/storageQuota.js';

beforeEach(() => {
  delete globalThis.navigator;
});

describe('getStorageEstimate()', () => {
  it('reports unsupported when navigator.storage.estimate is missing', async () => {
    globalThis.navigator = {};
    const result = await getStorageEstimate();
    assert.deepEqual(result, { supported: false, usage: 0, quota: 0, ratio: null });
  });

  it('computes the usage ratio when supported', async () => {
    globalThis.navigator = { storage: { estimate: async () => ({ usage: 80, quota: 100 }) } };
    const result = await getStorageEstimate();
    assert.equal(result.supported, true);
    assert.equal(result.usage, 80);
    assert.equal(result.quota, 100);
    assert.equal(result.ratio, 0.8);
  });

  it('returns a null ratio when quota is reported as zero', async () => {
    globalThis.navigator = { storage: { estimate: async () => ({ usage: 0, quota: 0 }) } };
    const result = await getStorageEstimate();
    assert.equal(result.ratio, null);
  });

  it('falls back to unsupported when estimate() throws', async () => {
    globalThis.navigator = { storage: { estimate: async () => { throw new Error('denied'); } } };
    const result = await getStorageEstimate();
    assert.equal(result.supported, false);
  });
});

describe('WARN_RATIO', () => {
  it('is a sane threshold between 0 and 1', () => {
    assert.ok(WARN_RATIO > 0 && WARN_RATIO < 1);
  });
});
