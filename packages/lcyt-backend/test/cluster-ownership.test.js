import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { initDb } from '../src/db.js';
import { createLeases } from '../src/cluster/leases.js';
import { createOwnership, clusterToken, verifyClusterToken } from '../src/cluster/ownership.js';
import { createClusterInternalRouter } from '../src/routes/cluster-internal.js';

const silent = { info() {}, warn() {} };
const SECRET = 'test-secret';

async function until(fn, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return false;
}

describe('cluster token', () => {
  it('verifies only the HMAC of the shared secret', () => {
    const token = clusterToken(SECRET);
    assert.equal(verifyClusterToken(SECRET, token), true);
    assert.equal(verifyClusterToken('other', token), false);
    assert.equal(verifyClusterToken(SECRET, ''), false);
    assert.equal(verifyClusterToken(SECRET, undefined), false);
    assert.equal(verifyClusterToken(SECRET, token.slice(0, -1)), false);
  });
});

describe('process ownership', () => {
  let db;
  let clock;
  const registry = (peers) => ({ peers: () => peers, list: async () => peers });
  const peers = [
    { id: 'A', url: 'http://a.internal:3000' },
    { id: 'B', url: 'http://b.internal:3000' },
  ];
  const node = (id, extra = {}) => {
    const leases = createLeases(db, { instanceId: id, enforce: true, now: () => clock });
    return createOwnership({ leases, registry: registry(peers), instanceId: id, secret: SECRET, log: silent, cacheMs: 0, ...extra });
  };

  before(async () => { db = await initDb(':memory:'); });
  after(async () => { await db.close(); });

  it('claim: the first instance wins, the second learns the owner and its URL', async () => {
    clock = 1_000_000;
    const a = node('A');
    const b = node('B');
    assert.deepEqual(await a.claim('relay', 'k1', { stillNeeded: () => true }), { ok: true });
    const lost = await b.claim('relay', 'k1', { stillNeeded: () => true });
    assert.equal(lost.ok, false);
    assert.deepEqual(lost.owner, { id: 'A', url: 'http://a.internal:3000', self: false });
    assert.equal((await a.ownerOf('relay', 'k1')).self, true);
    assert.equal((await b.ownerOf('relay', 'k1')).id, 'A');
    assert.equal(await b.ownerOf('relay', 'nobody'), null);
    await a.stop();
    assert.equal(await b.ownerOf('relay', 'k1'), null, 'stop() gave the lease back');
  });

  it('kinds and keys are separate leases', async () => {
    clock = 2_000_000;
    const a = node('A');
    const b = node('B');
    await a.claim('relay', 'k2');
    assert.equal((await b.claim('crop', 'k2')).ok, true);
    assert.equal((await b.claim('relay', 'other')).ok, true);
    await a.stop();
    await b.stop();
  });

  it('renewal keeps the lease while the process runs and gives it back when it is gone', async () => {
    clock = 3_000_000;
    let running = true;
    const a = node('A', { renewMs: 15 });
    const b = node('B');
    await a.claim('relay', 'k3', { stillNeeded: () => running });
    assert.deepEqual(a.held(), ['proc:relay:k3']);
    running = false; // the ffmpeg process exited
    assert.equal(await until(() => a.held().length === 0), true, 'timer released it');
    assert.equal((await b.claim('relay', 'k3')).ok, true, 'another instance can start it now');
    await b.stop();
  });

  it('takeover: a lease nobody renews expires after the TTL', async () => {
    clock = 4_000_000;
    const a = node('A', { ttlMs: 45_000, renewMs: 3_600_000 });
    const b = node('B');
    await a.claim('relay', 'k4');
    clock += 44_000;
    assert.equal((await b.claim('relay', 'k4')).ok, false, 'still held');
    clock += 2_000; // instance A died: no renewal
    assert.equal((await b.claim('relay', 'k4')).ok, true, 'B takes over');
    await a.stop();
    await b.stop();
  });

  describe('forward over HTTP', () => {
    let server;
    let url;
    const calls = [];

    before(async () => {
      const wrapper = {
        async __invokeLocal(method, args) {
          calls.push([method, args]);
          if (method === 'boom') throw new Error('it broke');
          if (method === 'nope') throw Object.assign(new Error('not allowed'), { code: 'METHOD_NOT_ALLOWED' });
          if (method === 'moved') throw Object.assign(new Error('gone'), { code: 'NOT_OWNER' });
          if (method === 'nothing') return undefined;
          return { echoed: args };
        },
      };
      const app = express();
      app.use('/internal/cluster', createClusterInternalRouter({ secret: SECRET, owned: { relay: wrapper }, log: silent }));
      await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
      url = `http://127.0.0.1:${server.address().port}`;
    });
    after(() => new Promise((r) => server.close(r)));

    const owner = () => ({ id: 'A', url, self: false });

    it('delivers the call with the shared-secret token and returns the result', async () => {
      const b = node('B');
      const result = await b.forward(owner(), 'relay', 'stop', ['k1', { a: 1 }]);
      assert.deepEqual(result, { echoed: ['k1', { a: 1 }] });
      assert.deepEqual(calls.at(-1), ['stop', ['k1', { a: 1 }]]);
    });

    it('an undefined result comes back as null', async () => {
      assert.equal(await node('B').forward(owner(), 'relay', 'nothing', ['k']), null);
    });

    it('errors on the owner reach the caller with their code', async () => {
      const b = node('B');
      await assert.rejects(b.forward(owner(), 'relay', 'boom', ['k']), (e) => e.message === 'it broke' && e.remote === true);
      await assert.rejects(b.forward(owner(), 'relay', 'nope', ['k']), (e) => e.code === 'METHOD_NOT_ALLOWED');
      await assert.rejects(b.forward(owner(), 'relay', 'moved', ['k']), (e) => e.code === 'NOT_OWNER');
    });

    it('rejects a wrong token, an unknown kind and a malformed body', async () => {
      const post = (headers, body) => fetch(`${url}/internal/cluster/call`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
      assert.equal((await post({}, { kind: 'relay', method: 'stop', args: ['k'] })).status, 401);
      assert.equal((await post({ authorization: 'Bearer nope' }, { kind: 'relay', method: 'stop', args: ['k'] })).status, 401);
      const good = { authorization: `Bearer ${clusterToken(SECRET)}` };
      assert.equal((await post(good, { kind: 'nothing', method: 'stop', args: [] })).status, 400);
      assert.equal((await post(good, { kind: 'constructor', method: 'stop', args: [] })).status, 400);
      assert.equal((await post(good, { kind: 'relay', method: 'stop', args: 'k' })).status, 400);
    });

    it('an owner without a URL or one that is down gives a clear error', async () => {
      const b = node('B', { timeoutMs: 500 });
      await assert.rejects(b.forward({ id: 'A', url: null, self: false }, 'relay', 'stop', ['k']), (e) => e.code === 'CLUSTER_NO_URL');
      await assert.rejects(b.forward({ id: 'A', url: 'http://127.0.0.1:1', self: false }, 'relay', 'stop', ['k']), (e) => e.code === 'CLUSTER_UNREACHABLE');
    });
  });
});
