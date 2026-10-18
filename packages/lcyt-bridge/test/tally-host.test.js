import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import dgram from 'node:dgram';
import { TallyHost } from '../src/tally-host.js';

const reading = (state, over = {}) => ({ v: 1, state, checkedAt: Date.now(), ttlMs: 15000, ...over });

function fakeOutputFactory() {
  const outputs = [];
  const create = (output) => {
    const o = { cfg: output, applied: [], closed: false,
      async apply(r, ctx) { o.applied.push({ state: r.state, rgb: ctx.lookFor(r.state).rgb, unknown: ctx.lookFor('UNKNOWN') }); },
      async close() { o.closed = true; } };
    outputs.push(o);
    return o;
  };
  return { outputs, create };
}

function fakeAtemPool() {
  const pool = new EventEmitter();
  pool.opened = [];
  pool.states = new Map();
  pool.connect = (host) => pool.opened.push(host);
  pool.state = (host) => pool.states.get(host) ?? null;
  return pool;
}

const lamp = { type: 'tally-ma', host: '192.168.1.50', port: 21324 };
const looks = { LIVE: { rgb: [255, 0, 0], blink: false }, UNKNOWN: { rgb: [255, 0, 0], blink: true } };

describe('TallyHost — light_set', () => {
  it('applies a reading with the looks the backend sent', async () => {
    const f = fakeOutputFactory();
    const host = new TallyHost({ check: () => null, createLampOutput: f.create });
    const r = await host.lightSet({ lightId: 'l1', kind: 'live-signal', output: lamp, reading: reading('LIVE'), looks });
    assert.deepEqual(r, { ok: true });
    assert.equal(f.outputs.length, 1);
    assert.deepEqual(f.outputs[0].applied[0].rgb, [255, 0, 0]);
    await host.lightSet({ lightId: 'l1', kind: 'live-signal', output: lamp, reading: reading('LIVE'), looks });
    assert.equal(f.outputs.length, 1, 'the output is reused for the same lamp');
    await host.destroy();
    assert.equal(f.outputs[0].closed, true);
  });

  it('falls back to the default look when the looks are malformed', async () => {
    const f = fakeOutputFactory();
    const host = new TallyHost({ check: () => null, createLampOutput: f.create });
    await host.lightSet({ lightId: 'l1', kind: 'live-signal', output: lamp, reading: reading('LIVE'), looks: { LIVE: { rgb: [999, 0] } } });
    assert.deepEqual(f.outputs[0].applied[0].rgb, [255, 0, 0]);
  });

  it('rejects bad input without touching a lamp', async () => {
    const f = fakeOutputFactory();
    const host = new TallyHost({ check: () => null, createLampOutput: f.create });
    assert.equal((await host.lightSet({ kind: 'live-signal', output: lamp, reading: reading('LIVE') })).ok, false);
    assert.equal((await host.lightSet({ lightId: 'l', kind: 'nope', output: lamp, reading: reading('LIVE') })).ok, false);
    assert.equal((await host.lightSet({ lightId: 'l', kind: 'live-signal', output: { type: 'console' }, reading: reading('LIVE') })).ok, false);
    const bad = await host.lightSet({ lightId: 'l', kind: 'live-signal', output: lamp, reading: reading('PGM') });
    assert.match(bad.error, /not valid/);
    assert.equal((await host.lightSet({ lightId: 'l', kind: 'live-signal', output: lamp, reading: reading('LIVE', { ttlMs: 5 }) })).ok, false);
    assert.equal(f.outputs.length, 0);
  });

  it('replaces the output when the lamp changes, and release darkens and forgets the light', async () => {
    const f = fakeOutputFactory();
    const host = new TallyHost({ check: () => null, createLampOutput: f.create });
    await host.lightSet({ lightId: 'l1', kind: 'live-signal', output: lamp, reading: reading('LIVE'), looks });
    await host.lightSet({ lightId: 'l1', kind: 'live-signal', output: { ...lamp, host: '192.168.1.51' }, reading: reading('LIVE'), looks });
    assert.equal(f.outputs.length, 2);
    assert.equal(f.outputs[0].closed, true);
    assert.deepEqual(f.outputs[0].applied.at(-1).rgb, [0, 0, 0]);
    await host.lightSet({ lightId: 'l1', kind: 'live-signal', output: { ...lamp, host: '192.168.1.51' }, release: true });
    assert.deepEqual(f.outputs[1].applied.at(-1), { state: 'OFF', rgb: [0, 0, 0], unknown: { rgb: [0, 0, 0], blink: false } });
    assert.equal(f.outputs[1].closed, true);
    assert.deepEqual(host.status().remote, []);
  });

  it('really sends a red colour packet to a UDP lamp', async () => {
    const sock = dgram.createSocket('udp4');
    const packets = [];
    sock.on('message', (m) => packets.push([...m]));
    await new Promise((r) => sock.bind(0, '127.0.0.1', r));
    const host = new TallyHost({ check: () => null });
    try {
      await host.lightSet({ lightId: 'l1', kind: 'live-signal', output: { type: 'tally-ma', host: '127.0.0.1', port: sock.address().port }, reading: reading('LIVE'), looks });
      const end = Date.now() + 2000;
      while (!packets.some((p) => p[0] === 2 && p[1] === 5 && p[2] === 255 && p[3] === 0) && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
      assert.ok(packets.some((p) => p[0] === 2 && p[1] === 5 && p[2] === 255 && p[3] === 0 && p[4] === 0));
    } finally { await host.destroy(); sock.close(); }
  });
});

describe('TallyHost — camera lights', () => {
  const camera = (over = {}) => ({
    id: 'c1', name: 'Cam 1', kind: 'camera', enabled: true, runner: 'bridge', bridgeInstanceId: 'b1',
    source: { type: 'atem', host: '192.168.1.60', input: 2, meIndex: 0 }, output: lamp, ...over,
  });
  const atemState = (program, preview) => ({ video: { mixEffects: [{ programInput: program, previewInput: preview }] } });
  const tick = () => new Promise((r) => setTimeout(r, 10));

  it('follows program and preview of the ATEM input', async () => {
    const f = fakeOutputFactory();
    const pool = fakeAtemPool();
    const host = new TallyHost({ atemPool: pool, check: () => null, createLampOutput: f.create });
    await host.syncCameraLights([camera()]);
    assert.deepEqual(pool.opened, ['192.168.1.60']);
    await tick();
    assert.equal(f.outputs[0].applied.at(-1).state, 'UNKNOWN');
    pool.emit('atem:state', '192.168.1.60', atemState(2, 1));
    await tick();
    assert.equal(f.outputs[0].applied.at(-1).state, 'PGM');
    pool.emit('atem:state', '192.168.1.60', atemState(1, 2));
    await tick();
    await tick();
    assert.equal(f.outputs[0].applied.at(-1).state, 'PRV');
    pool.emit('atem:disconnected', '192.168.1.60');
    await tick();
    assert.equal(f.outputs[0].applied.at(-1).state, 'UNKNOWN');
    await host.destroy();
  });

  it('removes a light that is no longer wanted and darkens its lamp', async () => {
    const f = fakeOutputFactory();
    const host = new TallyHost({ atemPool: fakeAtemPool(), check: () => null, createLampOutput: f.create });
    await host.syncCameraLights([camera()]);
    assert.deepEqual(host.status().camera, ['c1']);
    await host.syncCameraLights([]);
    assert.deepEqual(host.status().camera, []);
    assert.deepEqual(f.outputs[0].applied.at(-1).rgb, [0, 0, 0]);
    assert.equal(f.outputs[0].closed, true);
    await host.destroy();
  });

  it('restarts a light whose config changed, keeps one that did not', async () => {
    const f = fakeOutputFactory();
    const host = new TallyHost({ atemPool: fakeAtemPool(), check: () => null, createLampOutput: f.create });
    await host.syncCameraLights([camera()]);
    await host.syncCameraLights([camera()]);
    assert.equal(f.outputs.length, 1);
    await host.syncCameraLights([camera({ source: { type: 'atem', host: '192.168.1.60', input: 3, meIndex: 0 } })]);
    assert.equal(f.outputs.length, 2);
    await host.destroy();
  });

  it('refuses a light the security layers block, and reports it', async () => {
    const f = fakeOutputFactory();
    const errors = [];
    const host = new TallyHost({ atemPool: fakeAtemPool(), check: (type) => (type === 'light_set' ? 'Blocked by local security floor' : null), onError: (e) => errors.push(e.message), createLampOutput: f.create });
    await host.syncCameraLights([camera()]);
    assert.equal(f.outputs.length, 0);
    assert.match(errors[0], /Blocked by local security floor/);
    await host.destroy();
  });

  it('ignores live-signal, disabled and invalid entries', async () => {
    const f = fakeOutputFactory();
    const errors = [];
    const host = new TallyHost({ atemPool: fakeAtemPool(), check: () => null, onError: (e) => errors.push(e.message), createLampOutput: f.create });
    await host.syncCameraLights([
      camera({ id: 'a', enabled: false }),
      { id: 'b', name: 'Door', kind: 'live-signal', runner: 'bridge', bridgeInstanceId: 'b1', source: { type: 'youtube', mode: 'B', videoId: 'abcdefgh' }, output: lamp },
      { id: 'c', name: 'bad' },
    ]);
    assert.equal(f.outputs.length, 0);
    assert.equal(errors.length, 1);
    await host.destroy();
  });
});
