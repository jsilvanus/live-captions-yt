/**
 * Unit tests for DeviceRegistry, getCameraAdapter, getMixerAdapter,
 * parseCamera, and parseMixer.
 *
 * DeviceRegistry tests use the built-in 'none' camera adapter (no TCP needed)
 * and a minimal mock adapter for mixers to avoid real network connections.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { runMigrations } from '../src/db.js';
import {
  getCameraAdapter,
  getMixerAdapter,
  parseCamera,
  parseMixer,
  DeviceRegistry,
} from '../src/registry.js';

// ---------------------------------------------------------------------------
// Setup helper
// ---------------------------------------------------------------------------

function makeDb() {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}

function insertCamera(db, overrides = {}) {
  const id = overrides.id ?? randomUUID();
  db.prepare(`
    INSERT INTO prod_cameras (id, name, mixer_input, control_type, control_config, sort_order)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    id,
    overrides.name ?? 'Cam 1',
    overrides.mixer_input ?? 1,
    overrides.control_type ?? 'none',
    JSON.stringify(overrides.control_config ?? {}),
    overrides.sort_order ?? 0,
  );
  return id;
}

function insertMixer(db, overrides = {}) {
  const id = overrides.id ?? randomUUID();
  db.prepare(`
    INSERT INTO prod_mixers (id, name, type, connection_config)
    VALUES (?, ?, ?, ?)
  `).run(
    id,
    overrides.name ?? 'Roland',
    overrides.type ?? 'roland',
    JSON.stringify(overrides.connection_config ?? {}),
  );
  return id;
}

// ---------------------------------------------------------------------------
// getCameraAdapter
// ---------------------------------------------------------------------------

describe('getCameraAdapter', () => {
  for (const type of ['amx', 'none', 'visca-ip', 'webcam', 'mobile']) {
    it(`returns adapter for controlType '${type}'`, () => {
      const adapter = getCameraAdapter({ controlType: type });
      assert.equal(typeof adapter.connect, 'function');
      assert.equal(typeof adapter.disconnect, 'function');
      assert.equal(typeof adapter.callPreset, 'function');
    });
  }

  it('throws for unknown controlType', () => {
    assert.throws(
      () => getCameraAdapter({ controlType: 'unknown-xyz' }),
      /unknown camera controlType/,
    );
  });
});

// ---------------------------------------------------------------------------
// getMixerAdapter
// ---------------------------------------------------------------------------

describe('getMixerAdapter', () => {
  for (const type of ['roland', 'amx', 'atem', 'obs', 'monarch_hdx', 'lcyt']) {
    it(`returns adapter for mixer type '${type}'`, () => {
      const adapter = getMixerAdapter({ type });
      assert.equal(typeof adapter.connect, 'function');
      assert.equal(typeof adapter.disconnect, 'function');
      assert.equal(typeof adapter.switchSource, 'function');
    });
  }

  it('throws for unknown mixer type', () => {
    assert.throws(
      () => getMixerAdapter({ type: 'unknown-xyz' }),
      /unknown mixer type/,
    );
  });
});

// ---------------------------------------------------------------------------
// parseCamera
// ---------------------------------------------------------------------------

describe('parseCamera', () => {
  it('maps snake_case columns and parses control_config JSON', () => {
    const row = {
      id: 'c1',
      name: 'Wide',
      mixer_input: 2,
      control_type: 'none',
      control_config: '{"host":"192.168.1.1"}',
      connection_source: 'backend',
      bridge_instance_id: null,
      sort_order: 1,
      camera_key: null,
      created_at: '2024-01-01T00:00:00',
    };
    const cam = parseCamera(row);
    assert.equal(cam.controlType, 'none');
    assert.deepEqual(cam.controlConfig, { host: '192.168.1.1' });
    assert.equal(cam.mixerInput, 2);
    assert.equal(cam.sortOrder, 1);
    assert.equal(cam.connectionSource, 'backend');
  });

  it('defaults connectionSource to backend when null', () => {
    const row = {
      id: 'c1', name: 'Cam', mixer_input: 1, control_type: 'none',
      control_config: '{}', connection_source: null,
      bridge_instance_id: null, sort_order: 0, camera_key: null, created_at: '',
    };
    const cam = parseCamera(row);
    assert.equal(cam.connectionSource, 'backend');
  });

  it('handles empty control_config gracefully', () => {
    const row = {
      id: 'c1', name: 'Cam', mixer_input: 1, control_type: 'none',
      control_config: '', connection_source: 'backend',
      bridge_instance_id: null, sort_order: 0, camera_key: null, created_at: '',
    };
    // control_config = '' → JSON.parse('{}') via || '{}'
    const cam = parseCamera(row);
    assert.deepEqual(cam.controlConfig, {});
  });
});

// ---------------------------------------------------------------------------
// parseMixer
// ---------------------------------------------------------------------------

describe('parseMixer', () => {
  it('maps snake_case columns and parses connection_config JSON', () => {
    const row = {
      id: 'm1',
      name: 'Roland',
      type: 'roland',
      connection_config: '{"host":"10.0.0.1","port":9000}',
      connection_source: 'backend',
      bridge_instance_id: null,
      output_key: null,
      created_at: '2024-01-01T00:00:00',
    };
    const mixer = parseMixer(row);
    assert.deepEqual(mixer.connectionConfig, { host: '10.0.0.1', port: 9000 });
    assert.equal(mixer.connectionSource, 'backend');
    assert.equal(mixer.outputKey, null);
  });

  it('defaults connectionSource to backend when null', () => {
    const row = {
      id: 'm1', name: 'Mixer', type: 'roland',
      connection_config: '{}', connection_source: null,
      bridge_instance_id: null, output_key: null, created_at: '',
    };
    const mixer = parseMixer(row);
    assert.equal(mixer.connectionSource, 'backend');
  });
});

// ---------------------------------------------------------------------------
// DeviceRegistry — lifecycle
// ---------------------------------------------------------------------------

describe('DeviceRegistry', () => {
  it('start() with no cameras or mixers completes without error', async () => {
    const db = makeDb();
    const registry = new DeviceRegistry(db);
    await assert.doesNotReject(() => registry.start());
    await registry.stop();
  });

  it('start() connects a none-type camera without throwing', async () => {
    const db = makeDb();
    const camId = insertCamera(db, { control_type: 'none' });
    const registry = new DeviceRegistry(db);
    await registry.start();
    // none-type adapter always succeeds; connection should be tracked
    // (we can indirectly verify by checking callPreset behavior below)
    await registry.stop();
  });

  it('callPreset throws for unknown cameraId', async () => {
    const db = makeDb();
    const registry = new DeviceRegistry(db);
    await registry.start();
    await assert.rejects(
      () => registry.callPreset('nonexistent-id', 'wide'),
      /Camera not found/,
    );
    await registry.stop();
  });

  it('callPreset throws when camera has no active connection (connect failed)', async () => {
    const db = makeDb();
    const camId = insertCamera(db, { control_type: 'none' });
    const registry = new DeviceRegistry(db);
    // Do NOT call start() — no connection in map
    await assert.rejects(
      () => registry.callPreset(camId, 'wide'),
      /No connection/,
    );
  });

  it('removeCamera disconnects and removes from connections map', async () => {
    const db = makeDb();
    const camId = insertCamera(db, { control_type: 'none' });
    const registry = new DeviceRegistry(db);
    await registry.start();
    await registry.removeCamera(camId);
    // After removal, callPreset should say no connection
    await assert.rejects(
      () => registry.callPreset(camId, 'wide'),
      /No connection/,
    );
  });

  it('removeCamera is a no-op for unknown cameraId', async () => {
    const db = makeDb();
    const registry = new DeviceRegistry(db);
    await assert.doesNotReject(() => registry.removeCamera('no-such-camera'));
  });

  it('switchSource throws for unknown mixerId', async () => {
    const db = makeDb();
    const registry = new DeviceRegistry(db);
    await registry.start();
    await assert.rejects(
      () => registry.switchSource('nonexistent-id', 1),
      /Mixer not found/,
    );
    await registry.stop();
  });

  it('isMixerConnected returns false for unknown mixerId', async () => {
    const db = makeDb();
    const registry = new DeviceRegistry(db);
    await registry.start();
    assert.equal(registry.isMixerConnected('no-such-id'), false);
    await registry.stop();
  });

  it('getActiveSource returns null for unconnected mixer', async () => {
    const db = makeDb();
    const registry = new DeviceRegistry(db);
    assert.equal(registry.getActiveSource('no-such-id'), null);
  });

  it('removeMixer is a no-op for unknown mixerId', async () => {
    const db = makeDb();
    const registry = new DeviceRegistry(db);
    await assert.doesNotReject(() => registry.removeMixer('no-such-mixer'));
  });

  it('stop() clears all connections without throwing', async () => {
    const db = makeDb();
    insertCamera(db, { control_type: 'none' });
    const registry = new DeviceRegistry(db);
    await registry.start();
    await assert.doesNotReject(() => registry.stop());
  });

  it('reloadCamera reconnects without throwing (none adapter)', async () => {
    const db = makeDb();
    const camId = insertCamera(db, { control_type: 'none' });
    const registry = new DeviceRegistry(db);
    await registry.start();
    await assert.doesNotReject(() => registry.reloadCamera(camId));
    await registry.stop();
  });
});
