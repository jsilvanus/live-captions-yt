import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { initDb } from 'lcyt-backend/db';
import { createTallyManager, createLight, resolveRunner } from '../src/api.js';

process.env.LCYT_DB_SQL_COMPAT ??= '1';

let db;
before(async () => { db = await initDb(':memory:'); await db.tally_lights.deleteMany({}); });
after(async () => { await db.close(); });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await wait(20); }
  throw new Error('condition not met in time');
}
function udpLamp() {
  const sock = dgram.createSocket('udp4');
  const packets = [];
  sock.on('message', (m) => packets.push([...m]));
  return new Promise((resolve) => sock.bind(0, '127.0.0.1', () => resolve({
    port: sock.address().port, packets, close: () => new Promise((r) => sock.close(r)),
  })));
}
const mixerLight = (over = {}) => ({
  name: 'Cam 2', kind: 'camera', enabled: true, runner: 'auto',
  source: { type: 'lcyt', mixerId: 'mix1', input: 2 },
  output: { type: 'console' },
  ...over,
});

describe('camera tally from LCYT software mixer', () => {
  it('a mixer light runs on the backend even when a bridge is named; an ATEM light still goes to the bridge', () => {
    const out = { type: 'tally-ma', host: '10.0.0.5' };
    assert.equal(resolveRunner(mixerLight({ output: out, bridgeInstanceId: 'b1' }), { localMode: true }).runner, 'backend');
    assert.equal(resolveRunner(mixerLight({ output: out, bridgeInstanceId: 'b1' }), { localMode: false }).runner, 'bridge');
    assert.equal(resolveRunner(mixerLight({ output: out, source: { type: 'atem', input: 2 }, bridgeInstanceId: 'b1' }), { localMode: true }).runner, 'bridge');
  });

  it('follows the mixer program input on the lamp and in the status', async () => {
    const lamp = await udpLamp();
    let active = 2;
    const manager = createTallyManager({ db, localMode: true, getActiveSource: () => active });
    await createLight(db, 'proj1', 'l1', mixerLight({ output: { type: 'tally-ma', host: '127.0.0.1', port: lamp.port } }));
    await manager.start();
    const state = async () => manager.status('proj1')[0].state;
    try {
      await until(async () => (await state()) === 'PGM');
      await until(() => lamp.packets.some((p) => p[0] === 2 && p[1] === 5 && p[2] === 255 && p[3] === 0 && p[4] === 0));
      manager.onProgramChanged({ mixerId: 'mix1', inputNumber: 3 });
      await until(async () => (await state()) === 'OFF');
      manager.onProgramChanged({ mixerId: 'other', inputNumber: 2 });
      await wait(50);
      assert.equal(await state(), 'OFF', 'another mixer does not move this light');
      manager.onProgramChanged({ mixerId: 'mix1', inputNumber: 2 });
      await until(async () => (await state()) === 'PGM');
    } finally {
      manager.stop();
      await lamp.close();
    }
  });

  it('stays UNKNOWN until the mixer has a program input', async () => {
    await db.tally_lights.deleteMany({});
    const manager = createTallyManager({ db, localMode: true, getActiveSource: () => null });
    await createLight(db, 'proj1', 'l2', mixerLight());
    await manager.start();
    try {
      await wait(50);
      assert.equal(manager.status('proj1')[0].state, 'UNKNOWN');
      manager.onProgramChanged({ mixerId: 'mix1', inputNumber: 5 });
      await until(() => manager.status('proj1')[0].state === 'OFF');
    } finally { manager.stop(); }
  });

  it('on a hosted server a mixer light hands its readings to the bridge as light_set', async () => {
    await db.tally_lights.deleteMany({});
    const sent = [];
    const bridgeManager = { sendCommand: async (id, cmd) => { sent.push([id, cmd]); }, broadcastTallyUpdated() {} };
    const manager = createTallyManager({ db, localMode: false, bridgeManager, getActiveSource: () => 2 });
    await createLight(db, 'proj1', 'l3', mixerLight({ bridgeInstanceId: 'b1', output: { type: 'tally-ma', host: '10.0.0.9' } }));
    await manager.start();
    try {
      await until(() => sent.some(([, c]) => c.type === 'light_set' && c.kind === 'camera' && c.reading.state === 'PGM'));
      assert.equal(sent[0][0], 'b1');
    } finally { manager.stop(); }
  });
});
