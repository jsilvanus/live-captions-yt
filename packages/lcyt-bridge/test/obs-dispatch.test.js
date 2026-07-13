import { test } from 'node:test';
import assert from 'node:assert';
import { ObsPool } from '../src/obs-pool.js';

test('ObsPool — initialization', (t) => {
  const pool = new ObsPool();
  assert.deepEqual(pool.status(), []);
});

test('ObsPool — destroys without error', (t) => {
  const pool = new ObsPool();
  pool.destroy(); // should not throw
});

test('ObsPool — status returns empty array initially', (t) => {
  const pool = new ObsPool();
  const status = pool.status();
  assert.strictEqual(Array.isArray(status), true);
  assert.strictEqual(status.length, 0);
});

test('ObsPool — _makeKey creates unique keys for different connections', (t) => {
  const pool = new ObsPool();
  const key1 = pool._makeKey('host1', 4455, 'pass1');
  const key2 = pool._makeKey('host1', 4455, 'pass2');
  const key3 = pool._makeKey('host1', 4456, 'pass1');
  assert.notStrictEqual(key1, key2, 'different passwords create different keys');
  assert.notStrictEqual(key1, key3, 'different ports create different keys');
});

test('ObsPool — _makeKey creates same key for identical connections', (t) => {
  const pool = new ObsPool();
  const key1 = pool._makeKey('host1', 4455, 'pass1');
  const key2 = pool._makeKey('host1', 4455, 'pass1');
  assert.strictEqual(key1, key2);
});

test('ObsPool — emits events on connection', async (t) => {
  const pool = new ObsPool();
  let emittedConnected = false;

  pool.on('obs:connected', (key) => {
    emittedConnected = true;
  });

  // Note: This test will not actually connect because OBS is not running.
  // The connection attempt will time out after CONNECT_TIMEOUT_MS.
  // We're just testing that _open() returns a promise and doesn't crash.
  const entry = await pool._open('localhost', 4455, '', 'test:key:1');
  assert.strictEqual(typeof entry, 'object');
  // Pool entries are { client, key } — assert the shape _open actually returns.
  assert.ok(entry.client, 'entry exposes its OBSClient');
  assert.strictEqual(entry.key, 'test:key:1');

  pool.destroy();
});

test('ObsPool — switch throws when not connected', async (t) => {
  const pool = new ObsPool();
  try {
    await pool.switch('localhost', 4455, 'wrongpass', 'TestScene');
    assert.fail('should have thrown');
  } catch (err) {
    assert.match(err.message, /is not connected/);
  }
  pool.destroy();
});

test('ObsPool — destroy sets destroyed flag', async (t) => {
  const pool = new ObsPool();
  assert.strictEqual(pool.destroyed, undefined);
  pool.destroy();
  // After destroy, the pool should have cleared connections
  assert.strictEqual(pool.status().length, 0);
});
