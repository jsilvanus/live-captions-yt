import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import express from 'express';
import { initDb } from 'lcyt-backend/db';
import { createTallyManager, createTallyRouter, createTallyBridgeRouter, resolveRunner } from '../src/api.js';

process.env.LCYT_DB_SQL_COMPAT ??= '1';

let db;
before(async () => { db = await initDb(':memory:'); });
after(async () => { await db.close(); });

const fakeAuth = (req, _res, next) => { req.session = { apiKey: req.headers['x-test-api-key'] }; next(); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await wait(20); }
  throw new Error('condition not met in time');
}

/** A fake YouTube Data API: the video is live. */
function liveFetch(state = { live: true }) {
  const fetch = async (url) => {
    fetch.calls.push(String(url));
    const details = state.live ? { actualStartTime: new Date(Date.now() - 5000).toISOString() } : { actualEndTime: new Date().toISOString(), actualStartTime: new Date(Date.now() - 50000).toISOString() };
    return { ok: true, status: 200, json: async () => ({ items: [{ liveStreamingDetails: details }] }) };
  };
  fetch.calls = [];
  return fetch;
}

function udpLamp() {
  const sock = dgram.createSocket('udp4');
  const packets = [];
  sock.on('message', (m) => packets.push([...m]));
  return new Promise((resolve) => sock.bind(0, '127.0.0.1', () => resolve({
    port: sock.address().port, packets, close: () => new Promise((r) => sock.close(r)),
  })));
}

describe('resolveRunner', () => {
  const cfg = (over) => ({ output: { type: 'tally-ma', host: '10.0.0.5' }, runner: 'auto', ...over });
  it('runs the lamp on the server only in local mode', () => {
    assert.equal(resolveRunner(cfg(), { localMode: true }).runner, 'backend');
    assert.equal(resolveRunner(cfg({ runner: 'backend' }), { localMode: false }).runner, 'none');
    assert.equal(resolveRunner(cfg(), { localMode: false }).runner, 'none');
    assert.equal(resolveRunner(cfg({ bridgeInstanceId: 'b1' }), { localMode: false }).runner, 'bridge');
    assert.equal(resolveRunner(cfg({ runner: 'bridge' }), { localMode: true }).runner, 'none');
  });
  it('a camera light with a named bridge runs on that bridge, even in local mode', () => {
    assert.equal(resolveRunner(cfg({ kind: 'camera', bridgeInstanceId: 'b1' }), { localMode: true }).runner, 'bridge');
    assert.equal(resolveRunner(cfg({ kind: 'live-signal', bridgeInstanceId: 'b1' }), { localMode: true }).runner, 'backend');
  });
  it('status-only outputs run anywhere', () => {
    assert.equal(resolveRunner(cfg({ output: { type: 'console' } }), { localMode: false }).runner, 'backend');
  });
});

describe('lcyt-tally — routes and backend runner', () => {
  let server, baseUrl, manager, lamp, fetch;
  const live = { live: true };

  before(async () => {
    await db.tally_lights.deleteMany({});
    lamp = await udpLamp();
    fetch = liveFetch(live);
    manager = createTallyManager({ db, localMode: true, youtubeApiKey: 'KEY', fetch });
    await manager.start();
    const app = express();
    app.use(express.json());
    app.use('/tally', createTallyRouter(db, fakeAuth, { manager }));
    await new Promise((resolve) => { server = app.listen(0, resolve); });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    manager.stop();
    await new Promise((r) => server.close(r));
    await lamp.close();
  });

  async function call(method, path, body, key = 'proj1') {
    const res = await globalThis.fetch(`${baseUrl}${path}`, {
      method, headers: { 'Content-Type': 'application/json', 'x-test-api-key': key }, body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  }

  const light = (over = {}) => ({
    name: 'Door', kind: 'live-signal',
    source: { type: 'youtube', mode: 'B', videoId: 'abcdefgh' },
    output: { type: 'tally-ma', host: '127.0.0.1', port: lamp.port },
    ...over,
  });

  it('rejects an invalid light', async () => {
    const r = await call('POST', '/tally/lights', { name: 'x', kind: 'nope' });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /kind/);
  });

  let id;
  it('creates a light, polls YouTube and turns the lamp red', async () => {
    const r = await call('POST', '/tally/lights', light());
    assert.equal(r.status, 201);
    id = r.body.id;
    assert.equal(r.body.runner, 'auto');
    await until(() => lamp.packets.some((p) => p[0] === 2 && p[1] === 5 && p[2] === 255 && p[3] === 0 && p[4] === 0));
    const s = await until(async () => { const x = await call('GET', '/tally/status'); return x.body.lights[0]?.state === 'LIVE' ? x.body.lights[0] : null; });
    assert.equal(s.runner, 'backend');
    assert.equal(s.error, null);
    assert.ok(fetch.calls[0].includes('key=KEY'));
  });

  it('lists the light with its status, scoped to the project', async () => {
    const mine = await call('GET', '/tally/lights');
    assert.equal(mine.body.lights.length, 1);
    assert.equal(mine.body.lights[0].status.state, 'LIVE');
    const other = await call('GET', '/tally/lights', null, 'proj2');
    assert.deepEqual(other.body.lights, []);
    assert.equal((await call('PUT', `/tally/lights/${id}`, light(), 'proj2')).status, 404);
  });

  it('refuses two lights on the same lamp, but not once the first is disabled', async () => {
    const dup = await call('POST', '/tally/lights', light({ name: 'Second' }));
    assert.equal(dup.status, 409);
    const off = await call('PUT', `/tally/lights/${id}`, light({ enabled: false }));
    assert.equal(off.status, 200);
    assert.equal(off.body.status.note, 'Disabled');
    const ok = await call('POST', '/tally/lights', light({ name: 'Second' }));
    assert.equal(ok.status, 201);
    await call('DELETE', `/tally/lights/${ok.body.id}`);
    await call('PUT', `/tally/lights/${id}`, light());
  });

  it('test sends a state to the lamp, and validates it', async () => {
    const before = lamp.packets.length;
    const bad = await call('POST', `/tally/lights/${id}/test`, { state: 'PGM' });
    assert.equal(bad.status, 400);
    const r = await call('POST', `/tally/lights/${id}/test`, { state: 'DEGRADED' });
    assert.equal(r.status, 200);
    await until(() => lamp.packets.slice(before).some((p) => p[2] === 255 && p[3] === 160 && p[4] === 0));
  });

  it('reports a YouTube failure in the status', async () => {
    const failing = async () => ({ ok: false, status: 500, json: async () => ({}) });
    const m2 = createTallyManager({ db, localMode: true, youtubeApiKey: 'KEY', fetch: failing });
    await m2.start();
    const s = await until(() => m2.status('proj1')[0]?.error ? m2.status('proj1')[0] : null);
    assert.match(s.error, /500/);
    m2.stop();
  });

  it('deletes a light and stops it', async () => {
    assert.equal((await call('DELETE', `/tally/lights/${id}`)).status, 200);
    assert.equal((await call('DELETE', `/tally/lights/${id}`)).status, 404);
    assert.equal(manager.status('proj1').length, 0);
  });
});

describe('lcyt-tally — outside local mode', () => {
  it('does not drive a lamp from the server, and tells why', async () => {
    await db.tally_lights.deleteMany({});
    const manager = createTallyManager({ db, localMode: false, fetch: liveFetch() });
    const app = express();
    app.use(express.json());
    app.use('/tally', createTallyRouter(db, fakeAuth, { manager }));
    const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
    try {
      const res = await globalThis.fetch(`http://127.0.0.1:${server.address().port}/tally/lights`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-test-api-key': 'p' },
        body: JSON.stringify({ name: 'Door', kind: 'live-signal', runner: 'backend', source: { type: 'youtube', mode: 'B', videoId: 'abcdefgh' }, output: { type: 'tally-ma', host: '10.0.0.9' } }),
      });
      const body = await res.json();
      assert.equal(res.status, 201);
      assert.equal(body.status.runner, 'none');
      assert.match(body.status.note, /local install mode/);
    } finally { manager.stop(); await new Promise((r) => server.close(r)); }
  });

  it('sends readings to the bridge as light_set with every look', async () => {
    await db.tally_lights.deleteMany({});
    const sent = [];
    const bridgeManager = { sendCommand: async (instanceId, cmd) => { sent.push({ instanceId, cmd }); return { ok: true }; } };
    const manager = createTallyManager({ db, localMode: false, fetch: liveFetch(), bridgeManager, youtubeApiKey: 'K' });
    const app = express();
    app.use(express.json());
    app.use('/tally', createTallyRouter(db, fakeAuth, { manager, bridgeBelongsToProject: async (k, b) => b === 'b1' }));
    const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
    const url = `http://127.0.0.1:${server.address().port}/tally/lights`;
    const post = (body) => globalThis.fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-test-api-key': 'p' }, body: JSON.stringify(body) });
    const base = { name: 'Door', kind: 'live-signal', source: { type: 'youtube', mode: 'B', videoId: 'abcdefgh' }, output: { type: 'tally-ma', host: '192.168.1.50' } };
    try {
      assert.equal((await post({ ...base, runner: 'bridge', bridgeInstanceId: 'other' })).status, 400);
      assert.equal((await post({ ...base, runner: 'bridge', bridgeInstanceId: 'b1' })).status, 201);
      await until(() => sent.length > 0);
      const { instanceId, cmd } = sent[0];
      assert.equal(instanceId, 'b1');
      assert.equal(cmd.type, 'light_set');
      assert.equal(cmd.reading.state, 'LIVE');
      assert.deepEqual(cmd.output, { type: 'tally-ma', host: '192.168.1.50', port: 21324 });
      assert.deepEqual(Object.keys(cmd.looks).sort(), ['DEGRADED', 'LIVE', 'OFF', 'STARTING', 'UNKNOWN']);
    } finally { manager.stop(); await new Promise((r) => server.close(r)); }
  });
});

describe('lcyt-tally — bridge lights and hand-over', () => {
  async function setup() {
    await db.tally_lights.deleteMany({});
    const sent = [];
    const notified = [];
    const bridgeManager = {
      sendCommand: async (instanceId, cmd) => { sent.push({ instanceId, cmd }); return { ok: true }; },
      broadcastTallyUpdated: (id) => notified.push(id),
      authenticate: async (token) => (token === 'good' ? { id: 'b1' } : null),
    };
    const manager = createTallyManager({ db, localMode: false, fetch: liveFetch(), bridgeManager, youtubeApiKey: 'K' });
    const app = express();
    app.use(express.json());
    app.use('/tally', createTallyBridgeRouter(db, { bridgeManager, localMode: false }));
    app.use('/tally', createTallyRouter(db, fakeAuth, { manager }));
    const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
    const base = `http://127.0.0.1:${server.address().port}/tally`;
    const call = async (method, path, body) => {
      const res = await globalThis.fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'x-test-api-key': 'p' }, body: body ? JSON.stringify(body) : undefined });
      return { status: res.status, body: await res.json() };
    };
    return { sent, notified, manager, call, base, close: async () => { manager.stop(); await new Promise((r) => server.close(r)); } };
  }
  const camera = { name: 'Cam 1', kind: 'camera', runner: 'bridge', bridgeInstanceId: 'b1', source: { type: 'atem', host: '192.168.1.60', input: 2 }, output: { type: 'tally-ma', host: '192.168.1.51' } };
  const signal = { name: 'Door', kind: 'live-signal', runner: 'bridge', bridgeInstanceId: 'b1', source: { type: 'youtube', mode: 'B', videoId: 'abcdefgh' }, output: { type: 'tally-ma', host: '192.168.1.50' } };

  it('lists a bridge its camera lights by token, and nothing else', async () => {
    const t = await setup();
    try {
      const cam = await t.call('POST', '/lights', camera);
      assert.equal(cam.body.status.note, 'Runs on the bridge');
      await t.call('POST', '/lights', signal);
      assert.ok(t.notified.includes('b1'), 'the bridge is told to look again');
      const res = await globalThis.fetch(`${t.base}/bridge/lights?token=good`);
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.deepEqual(body.lights.map((l) => l.name), ['Cam 1']);
      assert.equal(body.lights[0].source.input, 2);
      assert.equal((await globalThis.fetch(`${t.base}/bridge/lights?token=bad`)).status, 401);
      assert.equal((await globalThis.fetch(`${t.base}/bridge/lights`)).status, 401);
    } finally { await t.close(); }
  });

  it('releases the lamp of a deleted or disabled live-signal light, but not when only the name changes', async () => {
    const t = await setup();
    try {
      const made = await t.call('POST', '/lights', signal);
      const id = made.body.id;
      await until(() => t.sent.some((s) => !s.cmd.release));
      t.sent.length = 0;
      await t.call('PUT', `/lights/${id}`, { ...signal, name: 'Door renamed' });
      assert.equal(t.sent.some((s) => s.cmd.release), false);
      await t.call('PUT', `/lights/${id}`, { ...signal, enabled: false });
      const rel = t.sent.find((s) => s.cmd.release);
      assert.equal(rel.instanceId, 'b1');
      assert.equal(rel.cmd.lightId, id);
      assert.deepEqual(rel.cmd.output, { type: 'tally-ma', host: '192.168.1.50', port: 21324 });
      await t.call('PUT', `/lights/${id}`, signal);
      t.sent.length = 0;
      await t.call('DELETE', `/lights/${id}`);
      assert.equal(t.sent.filter((s) => s.cmd.release).length, 1);
    } finally { await t.close(); }
  });
});
