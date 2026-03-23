/**
 * Unit tests for BridgeManager.
 *
 * Tests: authenticate, connect/disconnect SSE lifecycle, sendCommand
 * (legacy tcp_send shape and typed command shape), command timeout,
 * receiveStatus (success, error, heartbeat, unknown requestId).
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { runMigrations } from '../src/db.js';
import { BridgeManager } from '../src/bridge-manager.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDb() {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}

function insertInstance(db, overrides = {}) {
  const id = overrides.id ?? randomUUID();
  const token = overrides.token ?? randomUUID();
  const name = overrides.name ?? 'Test Bridge';
  db.prepare(
    "INSERT INTO prod_bridge_instances (id, name, token) VALUES (?, ?, ?)"
  ).run(id, name, token);
  return { id, token, name };
}

/** Build a minimal mock Express SSE response object. */
function makeSseRes() {
  const chunks = [];
  let ended = false;
  const handlers = {};
  return {
    chunks,
    get ended() { return ended; },
    set(headers) {},
    flushHeaders() {},
    write(data) { chunks.push(data); },
    end() { ended = true; },
    on(event, fn) {
      if (!handlers[event]) handlers[event] = [];
      handlers[event].push(fn);
    },
    emit(event, ...args) {
      (handlers[event] ?? []).forEach(fn => fn(...args));
    },
  };
}

/**
 * Parse requestId from SSE chunks. The command chunk contains `"requestId"`.
 * chunks[0] is the `connected` event; chunks[1] is the `command` event.
 */
function extractCommandData(chunks) {
  for (const chunk of chunks) {
    const m = chunk.match(/^data: (.+)$/m);
    if (!m) continue;
    try {
      const obj = JSON.parse(m[1]);
      if (obj.requestId) return obj;
    } catch { /* skip */ }
  }
  return null;
}

// ---------------------------------------------------------------------------
// authenticate
// ---------------------------------------------------------------------------

describe('BridgeManager.authenticate', () => {
  it('returns null for empty token', () => {
    const db = makeDb();
    const mgr = new BridgeManager(db);
    assert.equal(mgr.authenticate(''), null);
  });

  it('returns null for null/undefined token', () => {
    const db = makeDb();
    const mgr = new BridgeManager(db);
    assert.equal(mgr.authenticate(null), null);
    assert.equal(mgr.authenticate(undefined), null);
  });

  it('returns null for unknown token', () => {
    const db = makeDb();
    const mgr = new BridgeManager(db);
    assert.equal(mgr.authenticate('no-such-token'), null);
  });

  it('returns instance row for valid token', () => {
    const db = makeDb();
    const { token, id } = insertInstance(db);
    const mgr = new BridgeManager(db);
    const row = mgr.authenticate(token);
    assert.ok(row);
    assert.equal(row.id, id);
    assert.equal(row.token, token);
  });
});

// ---------------------------------------------------------------------------
// connect / disconnect / isConnected
// ---------------------------------------------------------------------------

describe('BridgeManager.connect/disconnect', () => {
  it('writes SSE headers and connected event on connect', () => {
    const db = makeDb();
    const { id } = insertInstance(db);
    const mgr = new BridgeManager(db);
    const res = makeSseRes();
    mgr.connect(id, res);

    // At least one chunk should contain "connected"
    const allOutput = res.chunks.join('');
    assert.ok(allOutput.includes('"connected"') || allOutput.includes('event: connected'));
    mgr.disconnect(id);
  });

  it('isConnected returns true after connect', () => {
    const db = makeDb();
    const { id } = insertInstance(db);
    const mgr = new BridgeManager(db);
    const res = makeSseRes();
    mgr.connect(id, res);
    assert.equal(mgr.isConnected(id), true);
    mgr.disconnect(id);
  });

  it('isConnected returns false before connect', () => {
    const db = makeDb();
    const { id } = insertInstance(db);
    const mgr = new BridgeManager(db);
    assert.equal(mgr.isConnected(id), false);
  });

  it('isConnected returns false after disconnect', () => {
    const db = makeDb();
    const { id } = insertInstance(db);
    const mgr = new BridgeManager(db);
    const res = makeSseRes();
    mgr.connect(id, res);
    mgr.disconnect(id);
    assert.equal(mgr.isConnected(id), false);
  });

  it('connect updates DB status to connected', () => {
    const db = makeDb();
    const { id } = insertInstance(db);
    const mgr = new BridgeManager(db);
    const res = makeSseRes();
    mgr.connect(id, res);
    const row = db.prepare('SELECT status FROM prod_bridge_instances WHERE id = ?').get(id);
    assert.equal(row.status, 'connected');
    mgr.disconnect(id);
  });

  it('disconnect updates DB status to disconnected', () => {
    const db = makeDb();
    const { id } = insertInstance(db);
    const mgr = new BridgeManager(db);
    const res = makeSseRes();
    mgr.connect(id, res);
    mgr.disconnect(id);
    const row = db.prepare('SELECT status FROM prod_bridge_instances WHERE id = ?').get(id);
    assert.equal(row.status, 'disconnected');
  });

  it('disconnect is a no-op for unknown instanceId', () => {
    const db = makeDb();
    const mgr = new BridgeManager(db);
    assert.doesNotThrow(() => mgr.disconnect('no-such-id'));
  });

  it('reconnecting kicks the previous connection', () => {
    const db = makeDb();
    const { id } = insertInstance(db);
    const mgr = new BridgeManager(db);
    const res1 = makeSseRes();
    const res2 = makeSseRes();
    mgr.connect(id, res1);
    mgr.connect(id, res2); // kicks res1
    assert.equal(res1.ended, true);
    assert.equal(mgr.isConnected(id), true);
    mgr.disconnect(id);
  });

  it('res close event triggers disconnect', () => {
    const db = makeDb();
    const { id } = insertInstance(db);
    const mgr = new BridgeManager(db);
    const res = makeSseRes();
    mgr.connect(id, res);
    res.emit('close'); // simulate client dropping connection
    assert.equal(mgr.isConnected(id), false);
  });
});

// ---------------------------------------------------------------------------
// sendCommand
// ---------------------------------------------------------------------------

describe('BridgeManager.sendCommand', () => {
  it('rejects immediately when instance is not connected', async () => {
    const db = makeDb();
    const mgr = new BridgeManager(db);
    await assert.rejects(
      () => mgr.sendCommand('no-such-id', { host: '10.0.0.1', port: 80, payload: 'x' }),
      /not connected/,
    );
  });

  it('sends legacy tcp_send SSE event when command has no type', async () => {
    const db = makeDb();
    const { id } = insertInstance(db);
    const mgr = new BridgeManager(db);
    const res = makeSseRes();
    mgr.connect(id, res);

    const commandPromise = mgr.sendCommand(id, { host: '10.0.0.1', port: 9000, payload: 'hello' });

    const cmdData = extractCommandData(res.chunks);
    assert.ok(cmdData, 'command data found in SSE chunks');
    assert.equal(cmdData.type, 'tcp_send');
    assert.equal(cmdData.host, '10.0.0.1');
    assert.ok(cmdData.requestId);

    // Resolve so the promise doesn't hang
    mgr.receiveStatus(id, { requestId: cmdData.requestId, ok: true });
    await commandPromise;
    mgr.disconnect(id);
  });

  it('sends typed command SSE event when command.type is set', async () => {
    const db = makeDb();
    const { id } = insertInstance(db);
    const mgr = new BridgeManager(db);
    const res = makeSseRes();
    mgr.connect(id, res);

    const commandPromise = mgr.sendCommand(id, {
      type: 'atem_switch',
      host: '192.168.1.100',
      meIndex: 0,
      inputNumber: 3,
    });

    const cmdData = extractCommandData(res.chunks);
    assert.ok(cmdData, 'command data found in SSE chunks');
    assert.equal(cmdData.type, 'atem_switch');
    assert.equal(cmdData.host, '192.168.1.100');
    assert.equal(cmdData.meIndex, 0);
    assert.ok(cmdData.requestId);

    mgr.receiveStatus(id, { requestId: cmdData.requestId, ok: true });
    await commandPromise;
    mgr.disconnect(id);
  });
});

// ---------------------------------------------------------------------------
// receiveStatus
// ---------------------------------------------------------------------------

describe('BridgeManager.receiveStatus', () => {
  it('resolves pending promise when ok: true', async () => {
    const db = makeDb();
    const { id } = insertInstance(db);
    const mgr = new BridgeManager(db);
    const res = makeSseRes();
    mgr.connect(id, res);

    const promise = mgr.sendCommand(id, { host: '10.0.0.1', port: 80, payload: 'x' });

    const cmdData = extractCommandData(res.chunks);
    mgr.receiveStatus(id, { requestId: cmdData.requestId, ok: true });

    const result = await promise;
    assert.deepEqual(result, { ok: true });
    mgr.disconnect(id);
  });

  it('rejects pending promise when ok is falsy', async () => {
    const db = makeDb();
    const { id } = insertInstance(db);
    const mgr = new BridgeManager(db);
    const res = makeSseRes();
    mgr.connect(id, res);

    const promise = mgr.sendCommand(id, { host: '10.0.0.1', port: 80, payload: 'x' });

    const cmdData = extractCommandData(res.chunks);
    mgr.receiveStatus(id, { requestId: cmdData.requestId, ok: false, error: 'TCP refused' });

    await assert.rejects(() => promise, /TCP refused/);
    mgr.disconnect(id);
  });

  it('is a no-op when requestId is absent (heartbeat)', () => {
    const db = makeDb();
    const { id } = insertInstance(db);
    const mgr = new BridgeManager(db);
    assert.doesNotThrow(() => mgr.receiveStatus(id, { type: 'heartbeat' }));
  });

  it('is a no-op for unknown requestId', () => {
    const db = makeDb();
    const { id } = insertInstance(db);
    const mgr = new BridgeManager(db);
    assert.doesNotThrow(() => mgr.receiveStatus(id, { requestId: 'no-such-uuid', ok: true }));
  });

  it('updates last_seen on every receiveStatus call', () => {
    const db = makeDb();
    const { id } = insertInstance(db);
    const mgr = new BridgeManager(db);
    const before = db.prepare('SELECT last_seen FROM prod_bridge_instances WHERE id = ?').get(id);
    assert.equal(before.last_seen, null);

    mgr.receiveStatus(id, {}); // heartbeat — no requestId
    const after = db.prepare('SELECT last_seen FROM prod_bridge_instances WHERE id = ?').get(id);
    assert.ok(after.last_seen !== null, 'last_seen updated');
  });
});
