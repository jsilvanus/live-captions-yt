import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { initDb } from 'lcyt-backend/db';


const { createConnector, createRequest, updateRequest, setConstantPoll, getRequestById } = await import('../src/db.js');
const { createPollScheduler } = await import('../src/poll-scheduler.js');

const opened = [];

async function createDb() {
  const db = await initDb(':memory:');
  opened.push(db);
  return db;
}

/** A real connector + request row, opted into constant poll (so fireAndLog actually resolves and fires). */
async function makeRequest(db, { apiKey = 'key1', connectorId = 'c1', connectorSlug = 'weather', requestId = 'r1', requestSlug = 'current' } = {}) {
  if (!(await db.api_connectors.findUnique({ where: { id: connectorId } }))) {
    await createConnector(db, apiKey, { id: connectorId, name: 'Weather', slug: connectorSlug, baseUrl: 'https://example.com' });
  }
  const row = await createRequest(db, connectorId, { id: requestId, name: 'Current', slug: requestSlug, method: 'GET', path: '/current' });
  return await setConstantPoll(db, requestId, true);
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
afterEach(async () => { for (const d of opened.splice(0)) await d.close(); });

describe('poll-scheduler — constant poll (session-long, pointer-independent)', () => {
  test('start() fires once immediately, resolving the current slugs from the DB by request id', async () => {
    const db = await createDb();
    await makeRequest(db);
    const engine = fakeEngine();
    const scheduler = createPollScheduler({ db, engine });
    await scheduler.start('r1', 5000);
    pending.push(() => scheduler.stopAll());
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(engine.calls, [['key1', 'weather', 'current']]);
  });

  test('isPolling() reflects start()/stop()', async () => {
    const db = await createDb();
    await makeRequest(db);
    const scheduler = createPollScheduler({ db, engine: fakeEngine() });
    assert.equal(scheduler.isPolling('r1'), false);
    await scheduler.start('r1', 5000);
    pending.push(() => scheduler.stopAll());
    assert.equal(scheduler.isPolling('r1'), true);
    scheduler.stop('r1');
    assert.equal(scheduler.isPolling('r1'), false);
  });

  test('start() is last-write-wins — no stacked intervals for the same request', async () => {
    const db = await createDb();
    await makeRequest(db);
    const scheduler = createPollScheduler({ db, engine: fakeEngine() });
    await scheduler.start('r1', 5000);
    await scheduler.start('r1', 5000);
    pending.push(() => scheduler.stopAll());
    scheduler.stop('r1');
    assert.equal(scheduler.isPolling('r1'), false);
  });

  test('stop() is a no-op for a request never started', async () => {
    const scheduler = createPollScheduler({ db: await createDb(), engine: fakeEngine() });
    assert.doesNotThrow(() => scheduler.stop('nonexistent'));
  });

  test('a slug rename takes effect on the next fire with no re-keying — start()/stop() only ever need the request id', async () => {
    const db = await createDb();
    await makeRequest(db);
    const engine = fakeEngine();
    const scheduler = createPollScheduler({ db, engine });
    await scheduler.start('r1', 5000);
    pending.push(() => scheduler.stopAll());
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(engine.calls, [['key1', 'weather', 'current']]);

    // Rename the request's slug directly in the DB (simulating the PUT route) —
    // no pollScheduler.stop()/start() call needed for the rename itself.
    await updateRequest(db, 'r1', { slug: 'current-renamed' });
    engine.calls.length = 0;
    scheduler.stop('r1'); // stop the old interval, start a fresh one to force an immediate fire for the test
    await scheduler.start('r1', 5000);
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(engine.calls, [['key1', 'weather', 'current-renamed']]);
  });

  test('start() self-heals immediately if the request id does not exist in the DB', async () => {
    const db = await createDb();
    const scheduler = createPollScheduler({ db, engine: fakeEngine() });
    await scheduler.start('nonexistent-id', 5000);
    pending.push(() => scheduler.stopAll());
    // The immediate fire finds no target and stops itself right away —
    // no dangling interval left polling a request that doesn't exist.
    assert.equal(scheduler.isPolling('nonexistent-id'), false);
  });

  test('start() self-heals immediately if constant_poll_enabled is false (out-of-band disable)', async () => {
    const db = await createDb();
    await makeRequest(db);
    await setConstantPoll(db, 'r1', false); // flag flipped off without going through pollScheduler.stop()
    const scheduler = createPollScheduler({ db, engine: fakeEngine() });
    await scheduler.start('r1', 5000);
    pending.push(() => scheduler.stopAll());
    assert.equal(scheduler.isPolling('r1'), false);
  });

  test('fireAndLog self-heals when the request is deleted without an explicit stop()', async () => {
    const db = await createDb();
    await makeRequest(db);
    const engine = fakeEngine();
    const scheduler = createPollScheduler({ db, engine });
    await scheduler.start('r1', 5000);
    pending.push(() => scheduler.stopAll());
    assert.equal(scheduler.isPolling('r1'), true);

    await db.api_requests.deleteMany({ where: { id: 'r1' } });
    // Simulate the next tick directly (without waiting out the real interval).
    scheduler.stop('r1');
    await scheduler.start('r1', 5000);
    assert.equal(scheduler.isPolling('r1'), false);
  });

  test('different requests poll independently', async () => {
    const db = await createDb();
    await makeRequest(db, { requestId: 'r1', requestSlug: 'current' });
    await makeRequest(db, { requestId: 'r2', requestSlug: 'forecast' });
    const engine = fakeEngine();
    const scheduler = createPollScheduler({ db, engine });
    await scheduler.start('r1', 5000);
    await scheduler.start('r2', 5000);
    pending.push(() => scheduler.stopAll());
    await new Promise((r) => setImmediate(r));
    assert.equal(engine.calls.length, 2);
    assert.equal(scheduler.isPolling('r1'), true);
    assert.equal(scheduler.isPolling('r2'), true);
    scheduler.stop('r1');
    assert.equal(scheduler.isPolling('r1'), false);
    assert.equal(scheduler.isPolling('r2'), true);
  });

  test('restore() starts every request persisted with constant_poll_enabled', async () => {
    const db = await createDb();
    await createConnector(db, 'key1', { id: 'c1', name: 'Weather', slug: 'weather', baseUrl: 'https://example.com' });
    const r1 = await createRequest(db, 'c1', { id: 'r1', name: 'Current', slug: 'current', method: 'GET', path: '/current' });
    await createRequest(db, 'c1', { id: 'r2', name: 'Forecast', slug: 'forecast', method: 'GET', path: '/forecast' });
    await setConstantPoll(db, r1.id, true); // only r1 opts in

    const engine = fakeEngine();
    const scheduler = createPollScheduler({ db, engine });
    await scheduler.restore();
    pending.push(() => scheduler.stopAll());
    await new Promise((r) => setImmediate(r));

    assert.equal(scheduler.isPolling('r1'), true);
    assert.equal(scheduler.isPolling('r2'), false);
    assert.deepEqual(engine.calls, [['key1', 'weather', 'current']]);
  });

  test('restore() tolerates a failing lookup rather than throwing', async () => {
    const db = { api_requests: { findMany: async () => { throw new Error('no such table'); } } };
    const scheduler = createPollScheduler({ db, engine: fakeEngine() });
    await assert.doesNotReject(() => scheduler.restore());
  });

  test('setConstantPoll() persists the flag and is reflected by getRequestById', async () => {
    const db = await createDb();
    await createConnector(db, 'key1', { id: 'c1', name: 'Weather', slug: 'weather', baseUrl: 'https://example.com' });
    const r1 = await createRequest(db, 'c1', { id: 'r1', name: 'Current', slug: 'current', method: 'GET', path: '/current' });
    assert.equal((await getRequestById(db, r1.id)).constant_poll_enabled, 0);
    await setConstantPoll(db, r1.id, true);
    assert.equal((await getRequestById(db, r1.id)).constant_poll_enabled, 1);
    await setConstantPoll(db, r1.id, false);
    assert.equal((await getRequestById(db, r1.id)).constant_poll_enabled, 0);
  });
});
