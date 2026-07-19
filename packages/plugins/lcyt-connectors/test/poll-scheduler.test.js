import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';

let Database;
try {
  Database = (await import('better-sqlite3')).default;
} catch {
  console.log('# better-sqlite3 not available — skipping poll-scheduler tests');
  process.exit(0);
}

const { runMigrations, createConnector, createRequest, setConstantPoll, getRequestById } = await import('../src/db.js');
const { createPollScheduler } = await import('../src/poll-scheduler.js');

function createDb() {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}

function fakeEngine() {
  const calls = [];
  return {
    calls,
    fireRequest: async (apiKey, connectorSlug, requestSlug) => {
      calls.push([apiKey, connectorSlug, requestSlug]);
      return { ok: true, variables: [] };
    },
  };
}

const pending = [];
afterEach(() => {
  for (const stop of pending.splice(0)) stop();
});

describe('poll-scheduler — constant poll (session-long, pointer-independent)', () => {
  test('start() fires once immediately', async () => {
    const engine = fakeEngine();
    const scheduler = createPollScheduler({ db: createDb(), engine });
    scheduler.start('key1', 'weather', 'current', 5000);
    pending.push(() => scheduler.stopAll());
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(engine.calls, [['key1', 'weather', 'current']]);
  });

  test('isPolling() reflects start()/stop()', () => {
    const engine = fakeEngine();
    const scheduler = createPollScheduler({ db: createDb(), engine });
    assert.equal(scheduler.isPolling('key1', 'weather', 'current'), false);
    scheduler.start('key1', 'weather', 'current', 5000);
    pending.push(() => scheduler.stopAll());
    assert.equal(scheduler.isPolling('key1', 'weather', 'current'), true);
    scheduler.stop('key1', 'weather', 'current');
    assert.equal(scheduler.isPolling('key1', 'weather', 'current'), false);
  });

  test('start() is last-write-wins — no stacked intervals for the same request', () => {
    const engine = fakeEngine();
    const scheduler = createPollScheduler({ db: createDb(), engine });
    scheduler.start('key1', 'weather', 'current', 5000);
    scheduler.start('key1', 'weather', 'current', 5000);
    pending.push(() => scheduler.stopAll());
    // Two starts, one stop — isPolling still reflects exactly one active timer.
    scheduler.stop('key1', 'weather', 'current');
    assert.equal(scheduler.isPolling('key1', 'weather', 'current'), false);
  });

  test('stop() is a no-op for a request never started', () => {
    const scheduler = createPollScheduler({ db: createDb(), engine: fakeEngine() });
    assert.doesNotThrow(() => scheduler.stop('key1', 'weather', 'current'));
  });

  test('different requests poll independently', async () => {
    const engine = fakeEngine();
    const scheduler = createPollScheduler({ db: createDb(), engine });
    scheduler.start('key1', 'weather', 'current', 5000);
    scheduler.start('key1', 'weather', 'forecast', 5000);
    pending.push(() => scheduler.stopAll());
    await new Promise((r) => setImmediate(r));
    assert.equal(engine.calls.length, 2);
    assert.equal(scheduler.isPolling('key1', 'weather', 'current'), true);
    assert.equal(scheduler.isPolling('key1', 'weather', 'forecast'), true);
    scheduler.stop('key1', 'weather', 'current');
    assert.equal(scheduler.isPolling('key1', 'weather', 'current'), false);
    assert.equal(scheduler.isPolling('key1', 'weather', 'forecast'), true);
  });

  test('restore() starts every request persisted with constant_poll_enabled', async () => {
    const db = createDb();
    createConnector(db, 'key1', { id: 'c1', name: 'Weather', slug: 'weather', baseUrl: 'https://example.com' });
    const r1 = createRequest(db, 'c1', { id: 'r1', name: 'Current', slug: 'current', method: 'GET', path: '/current' });
    createRequest(db, 'c1', { id: 'r2', name: 'Forecast', slug: 'forecast', method: 'GET', path: '/forecast' });
    setConstantPoll(db, r1.id, true); // only r1 opts in

    const engine = fakeEngine();
    const scheduler = createPollScheduler({ db, engine });
    scheduler.restore();
    pending.push(() => scheduler.stopAll());
    await new Promise((r) => setImmediate(r));

    assert.equal(scheduler.isPolling('key1', 'weather', 'current'), true);
    assert.equal(scheduler.isPolling('key1', 'weather', 'forecast'), false);
    assert.deepEqual(engine.calls, [['key1', 'weather', 'current']]);
  });

  test('restore() tolerates a missing table (isolated test DB) rather than throwing', () => {
    const db = new Database(':memory:'); // no runMigrations() — no api_requests table
    const scheduler = createPollScheduler({ db, engine: fakeEngine() });
    assert.doesNotThrow(() => scheduler.restore());
  });

  test('setConstantPoll() persists the flag and is reflected by getRequestById', () => {
    const db = createDb();
    createConnector(db, 'key1', { id: 'c1', name: 'Weather', slug: 'weather', baseUrl: 'https://example.com' });
    const r1 = createRequest(db, 'c1', { id: 'r1', name: 'Current', slug: 'current', method: 'GET', path: '/current' });
    assert.equal(getRequestById(db, r1.id).constant_poll_enabled, 0);
    setConstantPoll(db, r1.id, true);
    assert.equal(getRequestById(db, r1.id).constant_poll_enabled, 1);
    setConstantPoll(db, r1.id, false);
    assert.equal(getRequestById(db, r1.id).constant_poll_enabled, 0);
  });
});
