/**
 * Tests for commands.js (ProductionCommands) — the shared camera-preset /
 * mixer-switch path used by the HTTP routes, the AI tools and (later) the
 * action runner. See docs/plans/plan_backend_actions.md.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { EventBus } from 'lcyt/event-bus';

import { runMigrations } from '../src/db.js';
import { createProductionCommands, commandStatus, slugifyLabel } from '../src/commands.js';

let db, registry, bridge, bus, events, commands;

function insertBridgeInstance(id = 'bridge-1') {
  db.prepare('INSERT OR IGNORE INTO prod_bridge_instances (id, name, token) VALUES (?, ?, ?)').run(id, 'Bridge 1', `tok-${id}`);
  return id;
}

function insertCamera(o = {}) {
  const id = o.id ?? randomUUID();
  db.prepare(`
    INSERT INTO prod_cameras (id, name, control_type, control_config, bridge_instance_id, owner_api_key)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, o.name ?? 'Cam', o.control_type ?? 'amx', JSON.stringify(o.control_config ?? {}), o.bridge_instance_id ?? null, o.owner_api_key ?? null);
  return id;
}

function insertMixer(o = {}) {
  const id = o.id ?? randomUUID();
  db.prepare(`
    INSERT INTO prod_mixers (id, name, type, connection_config, bridge_instance_id, owner_api_key)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, o.name ?? 'Mixer', o.type ?? 'lcyt', JSON.stringify(o.connection_config ?? {}), o.bridge_instance_id ?? null, o.owner_api_key ?? null);
  return id;
}

beforeEach(() => {
  db = new Database(':memory:');
  runMigrations(db);
  const calls = [];
  registry = {
    calls,
    presetRecalled: [],
    programChanged: [],
    callPreset: async (id, presetId) => { calls.push(['callPreset', id, presetId]); },
    switchSource: async (id, input) => { calls.push(['switchSource', id, input]); },
    notifyCameraPresetRecalled(d) { this.presetRecalled.push(d); },
    notifyProgramChanged(d) { this.programChanged.push(d); },
  };
  bridge = {
    connected: true,
    sent: [],
    isConnected() { return this.connected; },
    async sendCommand(instanceId, command) { this.sent.push([instanceId, command]); },
  };
  bus = new EventBus();
  events = [];
  bus.tap((e) => events.push(e));
  commands = createProductionCommands({ db, registry, bridgeManager: bridge, eventBus: bus });
});

describe('callCameraPreset', () => {
  it('recalls a direct preset, notifies production-follow and publishes a result event', async () => {
    const id = insertCamera();
    const r = await commands.callCameraPreset('key1', id, 'home', { source: 'tool' });
    assert.deepEqual(r, { ok: true, cameraId: id, presetId: 'home', transport: 'direct' });
    assert.deepEqual(registry.calls, [['callPreset', id, 'home']]);
    assert.deepEqual(registry.presetRecalled, [{ apiKey: 'key1', cameraId: id, preset: 'home' }]);
    assert.equal(events.length, 1);
    assert.equal(events[0].topic, 'production.command_result');
    assert.equal(events[0].projectId, 'key1');
    assert.equal(events[0].data.kind, 'camera.preset');
    assert.equal(events[0].data.source, 'tool');
    assert.equal(events[0].data.ok, true);
    assert.equal(events[0].data.transport, 'direct');
  });

  it('routes through the bridge and notifies with the preset number', async () => {
    const bridgeId = insertBridgeInstance();
    const id = insertCamera({
      bridge_instance_id: bridgeId,
      control_config: { host: '10.0.0.5', port: 1319, presets: [{ id: 'p1', presetNumber: 7, command: 'PRESET7' }] },
    });
    const r = await commands.callCameraPreset('key1', id, 'p1');
    assert.equal(r.ok, true);
    assert.equal(r.transport, 'bridge');
    assert.deepEqual(bridge.sent, [[bridgeId, { host: '10.0.0.5', port: 1319, payload: 'PRESET7\r\n' }]]);
    assert.deepEqual(registry.calls, []);
    assert.equal(registry.presetRecalled[0].preset, 7);
  });

  it('falls back to the array index when the preset has no presetNumber', async () => {
    const bridgeId = insertBridgeInstance();
    const id = insertCamera({
      bridge_instance_id: bridgeId,
      control_config: { host: 'h', port: 1, presets: [{ id: 'a', command: 'A' }, { id: 'b', command: 'B' }] },
    });
    await commands.callCameraPreset('key1', id, 'b');
    assert.equal(registry.presetRecalled[0].preset, 1);
  });

  it('is unavailable (503) and does not notify when the bridge is offline', async () => {
    const bridgeId = insertBridgeInstance();
    const id = insertCamera({ bridge_instance_id: bridgeId, control_config: { presets: [{ id: 'p1', command: 'X' }] } });
    bridge.connected = false;
    const r = await commands.callCameraPreset('key1', id, 'p1');
    assert.deepEqual([r.ok, r.code, r.error], [false, 'unavailable', 'Bridge is not connected']);
    assert.equal(commandStatus(r), 503);
    assert.deepEqual(registry.presetRecalled, []);
    assert.equal(events[0].data.ok, false);
  });

  it('rejects an unknown preset on a bridged camera as bad_request', async () => {
    const bridgeId = insertBridgeInstance();
    const id = insertCamera({ bridge_instance_id: bridgeId, control_config: { presets: [] } });
    const r = await commands.callCameraPreset('key1', id, 'nope');
    assert.equal(r.code, 'bad_request');
    assert.equal(commandStatus(r), 400);
  });

  it('is not_found (404) for a missing camera and for another project\'s owned camera', async () => {
    const owned = insertCamera({ owner_api_key: 'other' });
    assert.equal((await commands.callCameraPreset('key1', 'missing', 'p')).code, 'not_found');
    const r = await commands.callCameraPreset('key1', owned, 'p');
    assert.equal(r.code, 'not_found');
    assert.equal(commandStatus(r), 404);
    assert.deepEqual(registry.calls, []);
  });

  it('allows the owner, unowned cameras, and an unauthenticated (null apiKey) caller', async () => {
    const owned = insertCamera({ owner_api_key: 'key1' });
    const unowned = insertCamera();
    assert.equal((await commands.callCameraPreset('key1', owned, 'p')).ok, true);
    assert.equal((await commands.callCameraPreset('key1', unowned, 'p')).ok, true);
    const other = insertCamera({ owner_api_key: 'someone-else' });
    assert.equal((await commands.callCameraPreset(null, other, 'p')).ok, true);
  });

  it('maps a registry error to bad_request and a timeout to unavailable', async () => {
    const id = insertCamera();
    registry.callPreset = async () => { throw new Error('boom'); };
    assert.equal((await commands.callCameraPreset('key1', id, 'p')).code, 'bad_request');
    registry.callPreset = async () => { throw new Error('request timed out'); };
    assert.equal((await commands.callCameraPreset('key1', id, 'p')).code, 'unavailable');
    assert.deepEqual(registry.presetRecalled, []);
  });

  it('publishes nothing without an apiKey or without a bus, and never throws on bus errors', async () => {
    const id = insertCamera();
    await commands.callCameraPreset(null, id, 'p');
    assert.equal(events.length, 0);
    const noBus = createProductionCommands({ db, registry, bridgeManager: bridge });
    assert.equal((await noBus.callCameraPreset('key1', id, 'p')).ok, true);
    const badBus = createProductionCommands({ db, registry, eventBus: { publish() { throw new Error('bus down'); } } });
    assert.equal((await badBus.callCameraPreset('key1', id, 'p')).ok, true);
  });
});

describe('switchMixer', () => {
  it('switches a direct mixer and notifies production-follow', async () => {
    const id = insertMixer();
    const r = await commands.switchMixer('key1', id, 3, { source: 'http' });
    assert.deepEqual(r, { ok: true, mixerId: id, activeSource: 3, transport: 'direct' });
    assert.deepEqual(registry.calls, [['switchSource', id, 3]]);
    assert.deepEqual(registry.programChanged, [{ apiKey: 'key1', mixerId: id, inputNumber: 3 }]);
    assert.equal(events[0].data.kind, 'mixer.switch');
    assert.equal(events[0].data.source, 'http');
  });

  it('relays a roland switch through the bridge without calling switchSource', async () => {
    const bridgeId = insertBridgeInstance();
    const id = insertMixer({ type: 'roland', bridge_instance_id: bridgeId, connection_config: { host: '10.0.0.9' } });
    const r = await commands.switchMixer('key1', id, 2);
    assert.equal(r.ok, true);
    assert.equal(r.transport, 'bridge');
    assert.equal(bridge.sent.length, 1);
    assert.equal(bridge.sent[0][0], bridgeId);
    assert.equal(bridge.sent[0][1].host, '10.0.0.9');
    assert.deepEqual(registry.calls, []);
    assert.equal(registry.programChanged.length, 1);
  });

  it('falls through to the registry for an lcyt mixer even when a bridge is assigned', async () => {
    const bridgeId = insertBridgeInstance();
    const id = insertMixer({ type: 'lcyt', bridge_instance_id: bridgeId });
    const r = await commands.switchMixer('key1', id, 1);
    assert.equal(r.transport, 'direct');
    assert.deepEqual(registry.calls, [['switchSource', id, 1]]);
    assert.deepEqual(bridge.sent, []);
  });

  it('is unavailable when the bridge is offline', async () => {
    const bridgeId = insertBridgeInstance();
    const id = insertMixer({ type: 'roland', bridge_instance_id: bridgeId, connection_config: { host: 'h' } });
    bridge.connected = false;
    const r = await commands.switchMixer('key1', id, 1);
    assert.equal(r.code, 'unavailable');
    assert.deepEqual(registry.programChanged, []);
  });

  it('validates the input number and enforces ownership', async () => {
    const id = insertMixer({ owner_api_key: 'other' });
    assert.equal((await commands.switchMixer('key1', id, -1)).code, 'bad_request');
    assert.equal((await commands.switchMixer('key1', id, 1.5)).code, 'bad_request');
    assert.equal((await commands.switchMixer('key1', id, 1)).code, 'not_found');
    assert.equal((await commands.switchMixer('key1', 'missing', 1)).code, 'not_found');
    assert.equal((await commands.switchMixer(null, id, 1)).ok, true);
  });

  it('does not notify when the switch fails', async () => {
    const id = insertMixer();
    registry.switchSource = async () => { throw new Error('mixer not connected'); };
    const r = await commands.switchMixer('key1', id, 1);
    assert.equal(r.code, 'unavailable');
    assert.deepEqual(registry.programChanged, []);
  });
});

describe('commandStatus', () => {
  it('maps codes to the HTTP statuses the routes used', () => {
    assert.equal(commandStatus({ code: 'not_found' }), 404);
    assert.equal(commandStatus({ code: 'bad_request' }), 400);
    assert.equal(commandStatus({ code: 'unavailable' }), 503);
    assert.equal(commandStatus({ code: 'forbidden' }), 403);
    assert.equal(commandStatus({}), 400);
  });
});

describe('action atoms (label addressing)', () => {
  const presets = [
    { id: 'p-wide', name: 'Wide shot', presetNumber: 1 },
    { id: 'p-alt', label: 'Altar', presetNumber: 2 },
  ];

  it('camera atom resolves a camera by label slug and a preset by name slug', async () => {
    const id = insertCamera({ control_config: { presets } });
    db.prepare('UPDATE prod_cameras SET label = ? WHERE id = ?').run('Pulpit', id);
    const r = await commands.runCameraAtom('key1', 'pulpit.wide-shot', { source: 'action' });
    assert.equal(r.ok, true);
    assert.deepEqual(registry.calls, [['callPreset', id, 'p-wide']]);
    assert.equal(events[0].data.source, 'action');
  });

  it('camera atom resolves by camera name when no label is set, preset by label or number or id', async () => {
    const id = insertCamera({ name: 'Back Camera', control_config: { presets } });
    assert.equal((await commands.runCameraAtom('key1', 'back-camera.altar')).ok, true);
    assert.equal((await commands.runCameraAtom('key1', 'back-camera.1')).ok, true);
    assert.equal((await commands.runCameraAtom('key1', `${id}.p-alt`)).ok, true);
    assert.deepEqual(registry.calls.map((c) => c[2]), ['p-alt', 'p-wide', 'p-alt']);
  });

  it('camera atom errors: unknown camera, unknown preset, malformed value, ambiguous label', async () => {
    insertCamera({ name: 'Cam A', control_config: { presets } });
    assert.equal((await commands.runCameraAtom('key1', 'nope.wide')).code, 'not_found');
    assert.equal((await commands.runCameraAtom('key1', 'cam-a.zzz')).code, 'not_found');
    assert.equal((await commands.runCameraAtom('key1', 'cam-a')).code, 'bad_request');
    insertCamera({ name: 'cam a', control_config: { presets } });
    const r = await commands.runCameraAtom('key1', 'cam-a.wide-shot');
    assert.equal(r.code, 'bad_request');
    assert.match(r.error, /ambiguous/);
    assert.deepEqual(registry.calls, []);
  });

  it('an exact id wins over a label match, and other projects\' cameras are invisible', async () => {
    const mine = insertCamera({ name: 'Cam', control_config: { presets }, owner_api_key: 'key1' });
    insertCamera({ name: 'Cam', control_config: { presets }, owner_api_key: 'other' });
    // only 'mine' is visible to key1, so the shared label is not ambiguous
    assert.equal((await commands.runCameraAtom('key1', 'cam.wide-shot')).ok, true);
    assert.equal(registry.calls[0][1], mine);
    const hidden = insertCamera({ name: 'Secret', control_config: { presets }, owner_api_key: 'other' });
    assert.equal((await commands.runCameraAtom('key1', 'secret.wide-shot')).code, 'not_found');
    assert.equal((await commands.runCameraAtom('key1', `${hidden}.p-wide`)).code, 'not_found');
  });

  it('mixer atom resolves by name slug and switches to the input number', async () => {
    const id = insertMixer({ name: 'Main Mixer' });
    const r = await commands.runMixerAtom('key1', 'main-mixer.3', { source: 'action' });
    assert.equal(r.ok, true);
    assert.deepEqual(registry.calls, [['switchSource', id, 3]]);
  });

  it('mixer atom accepts an input written by name (OBS scene name or input label)', async () => {
    const id = insertMixer({ name: 'Stream OBS', type: 'obs', connection_config: { inputs: [
      { number: 1, sceneName: 'Pulpit Wide' }, { number: 2, label: 'Choir' }, { number: 3, sceneName: 'Choir' },
    ] } });
    assert.equal((await commands.runMixerAtom('key1', 'stream-obs.pulpit-wide')).ok, true);
    assert.deepEqual(registry.calls, [['switchSource', id, 1]]);
    assert.equal((await commands.runMixerAtom('key1', 'stream-obs.choir')).code, 'bad_request'); // 2 and 3 share the name
    assert.equal((await commands.runMixerAtom('key1', 'stream-obs.altar')).code, 'not_found');
  });

  it('mixer atom errors: non-numeric input, unknown mixer, malformed value', async () => {
    insertMixer({ name: 'Main' });
    assert.equal((await commands.runMixerAtom('key1', 'main.two')).code, 'not_found');
    assert.equal((await commands.runMixerAtom('key1', 'main')).code, 'bad_request');
    assert.equal((await commands.runMixerAtom('key1', 'nope.1')).code, 'not_found');
    assert.deepEqual(registry.calls, []);
  });
});

describe('action atoms (id <-> label rewriting)', () => {
  const presets = [{ id: 'p-wide', label: 'Wide', presetNumber: 1 }, { id: 'p-alt', name: 'Altar', presetNumber: 2 }];

  it('stores ids for a camera atom and shows labels again, surviving a rename', () => {
    const id = insertCamera({ name: 'Cam A', control_config: { presets }, owner_api_key: 'key1' });
    db.prepare('UPDATE prod_cameras SET label = ? WHERE id = ?').run('Pulpit', id);
    const stored = commands.cameraAtomToIds('key1', 'pulpit.wide');
    assert.equal(stored, `${id}.p-wide`);
    db.prepare('UPDATE prod_cameras SET label = ? WHERE id = ?').run('Lectern', id);
    assert.equal(commands.cameraAtomToLabels('key1', stored), 'lectern.wide');
    assert.equal(commands.cameraAtomToIds('key1', 'lectern.2'), `${id}.p-alt`);
  });

  it('leaves unresolvable atoms alone and falls back to the id for an ambiguous label', () => {
    const a = insertCamera({ name: 'A', control_config: { presets }, owner_api_key: 'key1' });
    const b = insertCamera({ name: 'B', control_config: { presets }, owner_api_key: 'key1' });
    db.prepare('UPDATE prod_cameras SET label = ? WHERE id IN (?, ?)').run('Same', a, b);
    assert.equal(commands.cameraAtomToIds('key1', 'nope.wide'), null);
    assert.equal(commands.cameraAtomToIds('key1', 'same.wide'), null); // ambiguous
    assert.equal(commands.cameraAtomToLabels('key1', `${a}.p-wide`), `${a}.wide`);
  });

  it('rewrites only the mixer part of a mixer atom', () => {
    const id = insertMixer({ name: 'Main', owner_api_key: 'key1' });
    assert.equal(commands.mixerAtomToIds('key1', 'main.stream'), `${id}.stream`);
    assert.equal(commands.mixerAtomToLabels('key1', `${id}.2`), 'main.2');
    assert.equal(commands.mixerAtomToIds('key1', 'ghost.2'), null);
  });
});

describe('slugifyLabel', () => {
  it('lowercases and collapses non-alphanumerics', () => {
    assert.equal(slugifyLabel('  Pulpit — Wide!  '), 'pulpit-wide');
    assert.equal(slugifyLabel(null), '');
  });
});
