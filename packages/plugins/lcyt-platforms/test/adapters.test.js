import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const { assertAdapterShape, expiryFromNow, REQUIRED_ADAPTER_METHODS } = await import('../src/adapters/base.js');
const { getAdapter, isSupportedPlatform, SUPPORTED_PLATFORMS } = await import('../src/adapters/index.js');
const { facebookAdapter } = await import('../src/adapters/facebook.js');

describe('assertAdapterShape', () => {
  const stub = () => {};
  const complete = Object.fromEntries(REQUIRED_ADAPTER_METHODS.map(m => [m, stub]));

  test('accepts a complete adapter', () => {
    assert.doesNotThrow(() => assertAdapterShape({ platform: 'x', scopes: [], ...complete }));
  });

  test('names every missing method', () => {
    const { transition, setThumbnail, ...partial } = complete;
    assert.throws(
      () => assertAdapterShape({ platform: 'x', scopes: [], ...partial }),
      /missing required method\(s\): transition, setThumbnail/,
    );
  });

  test('rejects a missing platform or scopes', () => {
    assert.throws(() => assertAdapterShape({ scopes: [], ...complete }), /platform/);
    assert.throws(() => assertAdapterShape({ platform: 'x', ...complete }), /scopes/);
    assert.throws(() => assertAdapterShape(null), TypeError);
  });
});

describe('expiryFromNow', () => {
  test('converts seconds-from-now into an ISO timestamp', () => {
    assert.equal(expiryFromNow(3600, Date.parse('2026-07-27T12:00:00Z')), '2026-07-27T13:00:00.000');
  });

  test('omits the trailing Z per this repo timestamp convention', () => {
    assert.ok(!expiryFromNow(60).endsWith('Z'));
  });

  test('treats a non-numeric expiry as immediate rather than NaN', () => {
    // A malformed token response must produce an already-expired credential
    // (forcing a refresh) rather than an unparseable date.
    assert.equal(expiryFromNow(undefined, Date.parse('2026-07-27T12:00:00Z')), '2026-07-27T12:00:00.000');
  });
});

describe('adapter registry', () => {
  test('registers youtube only', () => {
    assert.deepEqual(SUPPORTED_PLATFORMS, ['youtube']);
    assert.equal(getAdapter('youtube').platform, 'youtube');
    assert.equal(isSupportedPlatform('youtube'), true);
  });

  test('facebook is deliberately unregistered', () => {
    // Decision #3: the skeleton exists to prove the interface generalises, but
    // no route may reach it.
    assert.equal(getAdapter('facebook'), null);
    assert.equal(isSupportedPlatform('facebook'), false);
  });

  test('an unknown platform resolves to null rather than throwing', () => {
    assert.equal(getAdapter('twitch'), null);
    assert.equal(getAdapter(undefined), null);
  });
});

describe('facebook skeleton', () => {
  test('satisfies the adapter interface', () => {
    // The whole reason it exists: a second implementation proving base.js
    // generalises past YouTube.
    assert.doesNotThrow(() => assertAdapterShape(facebookAdapter, 'facebookAdapter'));
  });

  test('declares the permissions App Review would gate', () => {
    assert.ok(facebookAdapter.scopes.includes('read_insights'));
    assert.ok(facebookAdapter.scopes.includes('pages_manage_posts'));
  });

  test('every method throws NotImplementedError pointing at the plan', () => {
    for (const method of REQUIRED_ADAPTER_METHODS) {
      assert.throws(
        () => facebookAdapter[method](),
        (err) => err.name === 'NotImplementedError' && /Facebook Live \(deferred\)/.test(err.message),
        `${method} should throw NotImplementedError`,
      );
    }
  });
});
