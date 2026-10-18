/**
 * Unit tests for BridgeManager.
 *
 * Tests: authenticate, connect/disconnect SSE lifecycle, sendCommand
 * (legacy tcp_send shape and typed command shape), command timeout,
 * receiveStatus (success, error, heartbeat, unknown requestId).
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initDb } from 'lcyt-backend/db';
import { randomUUID } from 'node:crypto';
import { createBridgeSecurityRule } from '../src/db.js';
import { BridgeManager } from '../src/bridge-manager.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const openDbs = [];
async function makeDb() {
  const db = await initDb(':memory:');
  openDbs.push(db);
  return db;
}

after(async () => { for (const d of openDbs) await d.close(); });

/** Wait until the manager has written a command event to the SSE stream (the security check is async). */
async function waitForCommand(res) {
  for (let i = 0; i < 400; i++) {
    const d = extractCommandData(res.chunks);
    if (d) return d;
    await new Promise((r) => setTimeout(r, 5));
  }
  return null;
}

async function insertInstance(db, overrides = {}) {
  const id = overrides.id ?? randomUUID();
  const token = overrides.token ?? randomUUID();
  const name = overrides.name ?? 'Test Bridge';
  await db.prepare(
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
  it('returns null for empty token', async () => {
    const db = await makeDb();
    const mgr = new BridgeManager(db);
    assert.equal(await mgr.authenticate(''), null);
  });

  it('returns null for null/undefined token', async () => {
    const db = await makeDb();
    const mgr = new BridgeManager(db);
    assert.equal(await mgr.authenticate(null), null);
    assert.equal(await mgr.authenticate(undefined), null);
  });

  it('returns null for unknown token', async () => {
    const db = await makeDb();
    const mgr = new BridgeManager(db);
    assert.equal(await mgr.authenticate('no-such-token'), null);
  });

  it('returns instance row for valid token', async () => {
    const db = await makeDb();
    const { token, id } = await insertInstance(db);
    const mgr = new BridgeManager(db);
    const row = await mgr.authenticate(token);
    assert.ok(row);
    assert.equal(row.id, id);
    assert.equal(row.token, token);
  });
});

// ---------------------------------------------------------------------------
// connect / disconnect / isConnected
// ---------------------------------------------------------------------------

describe('BridgeManager.connect/disconnect', () => {
  it('writes SSE headers and connected event on connect', async () => {
    const db = await makeDb();
    const { id } = await insertInstance(db);
    const mgr = new BridgeManager(db);
    const res = makeSseRes();
    await mgr.connect(id, res);

    // At least one chunk should contain "connected"
    const allOutput = res.chunks.join('');
    assert.ok(allOutput.includes('"connected"') || allOutput.includes('event: connected'));
    await mgr.disconnect(id);
  });

  it('isConnected returns true after connect', async () => {
    const db = await makeDb();
    const { id } = await insertInstance(db);
    const mgr = new BridgeManager(db);
    const res = makeSseRes();
    await mgr.connect(id, res);
    assert.equal(mgr.isConnected(id), true);
    await mgr.disconnect(id);
  });

  it('isConnected returns false before connect', async () => {
    const db = await makeDb();
    const { id } = await insertInstance(db);
    const mgr = new BridgeManager(db);
    assert.equal(mgr.isConnected(id), false);
  });

  it('isConnected returns false after disconnect', async () => {
    const db = await makeDb();
    const { id } = await insertInstance(db);
    const mgr = new BridgeManager(db);
    const res = makeSseRes();
    await mgr.connect(id, res);
    await mgr.disconnect(id);
    assert.equal(mgr.isConnected(id), false);
  });

  it('connect updates DB status to connected', async () => {
    const db = await makeDb();
    const { id } = await insertInstance(db);
    const mgr = new BridgeManager(db);
    const res = makeSseRes();
    await mgr.connect(id, res);
    const row = await db.prepare('SELECT status FROM prod_bridge_instances WHERE id = ?').get(id);
    assert.equal(row.status, 'connected');
    await mgr.disconnect(id);
  });

  it('disconnect updates DB status to disconnected', async () => {
    const db = await makeDb();
    const { id } = await insertInstance(db);
    const mgr = new BridgeManager(db);
    const res = makeSseRes();
    await mgr.connect(id, res);
    await mgr.disconnect(id);
    const row = await db.prepare('SELECT status FROM prod_bridge_instances WHERE id = ?').get(id);
    assert.equal(row.status, 'disconnected');
  });

  it('disconnect is a no-op for unknown instanceId', async () => {
    const db = await makeDb();
    const mgr = new BridgeManager(db);
    await assert.doesNotReject(() => mgr.disconnect('no-such-id'));
  });

  it('reconnecting kicks the previous connection', async () => {
    const db = await makeDb();
    const { id } = await insertInstance(db);
    const mgr = new BridgeManager(db);
    const res1 = makeSseRes();
    const res2 = makeSseRes();
    await mgr.connect(id, res1);
    await mgr.connect(id, res2); // kicks res1
    assert.equal(res1.ended, true);
    assert.equal(mgr.isConnected(id), true);
    await mgr.disconnect(id);
  });

  it('res close event triggers disconnect', async () => {
    const db = await makeDb();
    const { id } = await insertInstance(db);
    const mgr = new BridgeManager(db);
    const res = makeSseRes();
    await mgr.connect(id, res);
    res.emit('close'); // simulate client dropping connection
    await new Promise((r) => setImmediate(r));
    assert.equal(mgr.isConnected(id), false);
  });
});

// ---------------------------------------------------------------------------
// sendCommand
// ---------------------------------------------------------------------------

describe('BridgeManager.sendCommand', () => {
  it('rejects immediately when instance is not connected', async () => {
    const db = await makeDb();
    const mgr = new BridgeManager(db);
    await assert.rejects(
      () => mgr.sendCommand('no-such-id', { host: '10.0.0.1', port: 80, payload: 'x' }),
      /not connected/,
    );
  });

  it('sends legacy tcp_send SSE event when command has no type', async () => {
    const db = await makeDb();
    const { id } = await insertInstance(db);
    const mgr = new BridgeManager(db);
    const res = makeSseRes();
    await mgr.connect(id, res);

    const commandPromise = mgr.sendCommand(id, { host: '10.0.0.1', port: 9000, payload: 'hello' });

    const cmdData = await waitForCommand(res);
    assert.ok(cmdData, 'command data found in SSE chunks');
    assert.equal(cmdData.type, 'tcp_send');
    assert.equal(cmdData.host, '10.0.0.1');
    assert.ok(cmdData.requestId);

    // Resolve so the promise doesn't hang
    await mgr.receiveStatus(id, { requestId: cmdData.requestId, ok: true });
    await commandPromise;
    await mgr.disconnect(id);
  });

  it('sends typed command SSE event when command.type is set', async () => {
    const db = await makeDb();
    const { id } = await insertInstance(db);
    const mgr = new BridgeManager(db);
    const res = makeSseRes();
    await mgr.connect(id, res);

    const commandPromise = mgr.sendCommand(id, {
      type: 'atem_switch',
      host: '192.168.1.100',
      meIndex: 0,
      inputNumber: 3,
    });

    const cmdData = await waitForCommand(res);
    assert.ok(cmdData, 'command data found in SSE chunks');
    assert.equal(cmdData.type, 'atem_switch');
    assert.equal(cmdData.host, '192.168.1.100');
    assert.equal(cmdData.meIndex, 0);
    assert.ok(cmdData.requestId);

    await mgr.receiveStatus(id, { requestId: cmdData.requestId, ok: true });
    await commandPromise;
    await mgr.disconnect(id);
  });
});

// ---------------------------------------------------------------------------
// sendCommand — security enforcement (bridge-security.js)
// ---------------------------------------------------------------------------

describe('BridgeManager.sendCommand — security enforcement', () => {
  it('rejects a tcp_send blocked by a deny IP rule without writing to the SSE stream', async () => {
    const db = await makeDb();
    const { id } = await insertInstance(db);
    await createBridgeSecurityRule(db, { id: randomUUID(), bridgeInstanceId: id, ruleKind: 'ip', ruleType: 'deny', pattern: '10.0.0.1' });
    const mgr = new BridgeManager(db);
    const res = makeSseRes();
    await mgr.connect(id, res);

    await assert.rejects(
      () => mgr.sendCommand(id, { type: 'tcp_send', host: '10.0.0.1', port: 9000, payload: 'hello' }),
      /Blocked by bridge security policy/,
    );
    assert.equal(extractCommandData(res.chunks), null, 'no command event was ever written to the SSE stream');
    await mgr.disconnect(id);
  });

  it('rejects a tcp_send blocked by a deny command rule', async () => {
    const db = await makeDb();
    const { id } = await insertInstance(db);
    await createBridgeSecurityRule(db, { id: randomUUID(), bridgeInstanceId: id, ruleKind: 'command', ruleType: 'deny', pattern: '^FACTORY-RESET$' });
    const mgr = new BridgeManager(db);
    const res = makeSseRes();
    await mgr.connect(id, res);

    await assert.rejects(
      () => mgr.sendCommand(id, { type: 'tcp_send', host: '10.0.0.1', port: 9000, payload: 'FACTORY-RESET' }),
      /Blocked by bridge security policy/,
    );
    assert.equal(extractCommandData(res.chunks), null);
    await mgr.disconnect(id);
  });

  it('allows a tcp_send that matches neither an IP nor a command deny rule', async () => {
    const db = await makeDb();
    const { id } = await insertInstance(db);
    await createBridgeSecurityRule(db, { id: randomUUID(), bridgeInstanceId: id, ruleKind: 'ip', ruleType: 'deny', pattern: '10.0.0.99' });
    await createBridgeSecurityRule(db, { id: randomUUID(), bridgeInstanceId: id, ruleKind: 'command', ruleType: 'deny', pattern: '^FACTORY-RESET$' });
    const mgr = new BridgeManager(db);
    const res = makeSseRes();
    await mgr.connect(id, res);

    const promise = mgr.sendCommand(id, { type: 'tcp_send', host: '10.0.0.1', port: 9000, payload: 'PRESET-1' });
    const cmdData = await waitForCommand(res);
    assert.ok(cmdData, 'command was written to the SSE stream');
    await mgr.receiveStatus(id, { requestId: cmdData.requestId, ok: true });
    await promise;
    await mgr.disconnect(id);
  });

  it('an allow-list with no match blocks even a command with no deny rule', async () => {
    const db = await makeDb();
    const { id } = await insertInstance(db);
    await createBridgeSecurityRule(db, { id: randomUUID(), bridgeInstanceId: id, ruleKind: 'command', ruleType: 'allow', pattern: '^PRESET-[0-9]+$' });
    const mgr = new BridgeManager(db);
    const res = makeSseRes();
    await mgr.connect(id, res);

    await assert.rejects(
      () => mgr.sendCommand(id, { type: 'tcp_send', host: '10.0.0.1', port: 9000, payload: 'POWER OFF' }),
      /Blocked by bridge security policy/,
    );
    await mgr.disconnect(id);
  });

  it('checks the lamp of a light_set command against the IP rules', async () => {
    const db = await makeDb();
    const { id } = await insertInstance(db);
    await createBridgeSecurityRule(db, { id: randomUUID(), bridgeInstanceId: id, ruleKind: 'ip', ruleType: 'deny', pattern: '192.168.1.50' });
    const mgr = new BridgeManager(db);
    const res = makeSseRes();
    await mgr.connect(id, res);

    const reading = { v: 1, state: 'LIVE', checkedAt: Date.now(), ttlMs: 15000 };
    await assert.rejects(
      () => mgr.sendCommand(id, { type: 'light_set', lightId: 'l1', kind: 'live-signal', output: { type: 'tally-ma', host: '192.168.1.50' }, reading }),
      /Blocked by bridge security policy/,
    );
    await assert.rejects(
      () => mgr.sendCommand(id, { type: 'light_set', lightId: 'l1', kind: 'live-signal', output: { type: 'webhook', url: 'http://192.168.1.50:8080/x' }, reading }),
      /Blocked by bridge security policy/,
    );
    assert.equal(extractCommandData(res.chunks), null);
    await mgr.disconnect(id);
  });

  it('rejects an atem_switch blocked by a deny IP rule', async () => {
    const db = await makeDb();
    const { id } = await insertInstance(db);
    await createBridgeSecurityRule(db, { id: randomUUID(), bridgeInstanceId: id, ruleKind: 'ip', ruleType: 'deny', pattern: '192.168.1.100' });
    const mgr = new BridgeManager(db);
    const res = makeSseRes();
    await mgr.connect(id, res);

    await assert.rejects(
      () => mgr.sendCommand(id, { type: 'atem_switch', host: '192.168.1.100', meIndex: 0, inputNumber: 3 }),
      /Blocked by bridge security policy/,
    );
    assert.equal(extractCommandData(res.chunks), null);
    await mgr.disconnect(id);
  });

  // Regression coverage for the atem_switch port-threading fix: previously
  // getSwitchCommand() never included a `port` field, so _resolveIpTargets()
  // always resolved `port: null` for atem_switch and a ":port"-qualified rule
  // could never match one (a host-only rule still worked — that was the
  // pre-existing workaround). Both directions are covered: the port-qualified
  // rule now blocks a matching command, and does NOT block a command whose
  // (now real) port doesn't match the rule.
  it('rejects an atem_switch blocked by a port-qualified deny IP rule', async () => {
    const db = await makeDb();
    const { id } = await insertInstance(db);
    await createBridgeSecurityRule(db, { id: randomUUID(), bridgeInstanceId: id, ruleKind: 'ip', ruleType: 'deny', pattern: '192.168.1.100:9910' });
    const mgr = new BridgeManager(db);
    const res = makeSseRes();
    await mgr.connect(id, res);

    // port: 9910 mirrors what atem.js's getSwitchCommand() now sends by
    // default (atem-connection's own DEFAULT_PORT) when connectionConfig
    // doesn't set one.
    await assert.rejects(
      () => mgr.sendCommand(id, { type: 'atem_switch', host: '192.168.1.100', port: 9910, meIndex: 0, inputNumber: 3 }),
      /Blocked by bridge security policy/,
    );
    assert.equal(extractCommandData(res.chunks), null);
    await mgr.disconnect(id);
  });

  it('allows an atem_switch whose port does not match a port-qualified deny IP rule', async () => {
    const db = await makeDb();
    const { id } = await insertInstance(db);
    await createBridgeSecurityRule(db, { id: randomUUID(), bridgeInstanceId: id, ruleKind: 'ip', ruleType: 'deny', pattern: '192.168.1.100:9910' });
    const mgr = new BridgeManager(db);
    const res = makeSseRes();
    await mgr.connect(id, res);

    const promise = mgr.sendCommand(id, { type: 'atem_switch', host: '192.168.1.100', port: 19910, meIndex: 0, inputNumber: 3 });
    const cmdData = await waitForCommand(res);
    assert.ok(cmdData, 'command was written to the SSE stream — the deny rule is scoped to a different port');
    await mgr.receiveStatus(id, { requestId: cmdData.requestId, ok: true });
    await promise;
    await mgr.disconnect(id);
  });

  it('rejects a model_call whose sourceUrl host is blocked by a deny IP rule, even when endpoint is allowed', async () => {
    const db = await makeDb();
    const { id } = await insertInstance(db);
    await createBridgeSecurityRule(db, { id: randomUUID(), bridgeInstanceId: id, ruleKind: 'ip', ruleType: 'deny', pattern: '169.254.169.254' });
    const mgr = new BridgeManager(db);
    const res = makeSseRes();
    await mgr.connect(id, res);

    await assert.rejects(
      () => mgr.sendCommand(id, {
        type: 'model_call',
        endpoint: 'http://ollama:11434/api/generate',
        sourceUrl: 'http://169.254.169.254/latest/meta-data/',
      }),
      /Blocked by bridge security policy/,
    );
    assert.equal(extractCommandData(res.chunks), null, 'blocked before ever reaching the bridge, despite endpoint being allowed');
    await mgr.disconnect(id);
  });

  it('allows a model_call when both endpoint and sourceUrl pass the IP check', async () => {
    const db = await makeDb();
    const { id } = await insertInstance(db);
    await createBridgeSecurityRule(db, { id: randomUUID(), bridgeInstanceId: id, ruleKind: 'ip', ruleType: 'deny', pattern: '169.254.169.254' });
    const mgr = new BridgeManager(db);
    const res = makeSseRes();
    await mgr.connect(id, res);

    const promise = mgr.sendCommand(id, {
      type: 'model_call',
      endpoint: 'http://ollama:11434/api/generate',
      sourceUrl: 'http://backend.test/preview/key1/incoming.jpg',
    });
    const cmdData = await waitForCommand(res);
    assert.ok(cmdData, 'command reached the bridge');
    await mgr.receiveStatus(id, { requestId: cmdData.requestId, ok: true });
    await promise;
    await mgr.disconnect(id);
  });

  it('rejects an http_request whose URL host is blocked by a deny IP rule', async () => {
    const db = await makeDb();
    const { id } = await insertInstance(db);
    await createBridgeSecurityRule(db, { id: randomUUID(), bridgeInstanceId: id, ruleKind: 'ip', ruleType: 'deny', pattern: '192.168.1.50:80' });
    const mgr = new BridgeManager(db);
    const res = makeSseRes();
    await mgr.connect(id, res);

    await assert.rejects(
      () => mgr.sendCommand(id, { type: 'http_request', method: 'GET', url: 'http://192.168.1.50/Monarch/sdk/status' }),
      /Blocked by bridge security policy/,
    );
    assert.equal(extractCommandData(res.chunks), null);
    await mgr.disconnect(id);
  });
});

// ---------------------------------------------------------------------------
// receiveStatus
// ---------------------------------------------------------------------------

describe('BridgeManager.receiveStatus', () => {
  it('resolves pending promise when ok: true', async () => {
    const db = await makeDb();
    const { id } = await insertInstance(db);
    const mgr = new BridgeManager(db);
    const res = makeSseRes();
    await mgr.connect(id, res);

    const promise = mgr.sendCommand(id, { host: '10.0.0.1', port: 80, payload: 'x' });

    const cmdData = await waitForCommand(res);
    await mgr.receiveStatus(id, { requestId: cmdData.requestId, ok: true });

    const result = await promise;
    assert.deepEqual(result, { ok: true });
    await mgr.disconnect(id);
  });

  it('rejects pending promise when ok is falsy', async () => {
    const db = await makeDb();
    const { id } = await insertInstance(db);
    const mgr = new BridgeManager(db);
    const res = makeSseRes();
    await mgr.connect(id, res);

    const promise = mgr.sendCommand(id, { host: '10.0.0.1', port: 80, payload: 'x' });

    const cmdData = await waitForCommand(res);
    const settled = assert.rejects(() => promise, /TCP refused/);
    await mgr.receiveStatus(id, { requestId: cmdData.requestId, ok: false, error: 'TCP refused' });

    await settled;
    await mgr.disconnect(id);
  });

  it('is a no-op when requestId is absent (heartbeat)', async () => {
    const db = await makeDb();
    const { id } = await insertInstance(db);
    const mgr = new BridgeManager(db);
    await assert.doesNotReject(() => mgr.receiveStatus(id, { type: 'heartbeat' }));
  });

  it('is a no-op for unknown requestId', async () => {
    const db = await makeDb();
    const { id } = await insertInstance(db);
    const mgr = new BridgeManager(db);
    await assert.doesNotReject(() => mgr.receiveStatus(id, { requestId: 'no-such-uuid', ok: true }));
  });

  it('updates last_seen on every receiveStatus call', async () => {
    const db = await makeDb();
    const { id } = await insertInstance(db);
    const mgr = new BridgeManager(db);
    const before = await db.prepare('SELECT last_seen FROM prod_bridge_instances WHERE id = ?').get(id);
    assert.equal(before.last_seen, null);

    await mgr.receiveStatus(id, {}); // heartbeat — no requestId
    const after = await db.prepare('SELECT last_seen FROM prod_bridge_instances WHERE id = ?').get(id);
    assert.ok(after.last_seen !== null, 'last_seen updated');
  });
});

// ---------------------------------------------------------------------------
// sendCommand timeout override + result payload passthrough (plan/ai_model_registry)
// ---------------------------------------------------------------------------

describe('BridgeManager.sendCommand timeouts and payload passthrough', () => {
  it('honours a per-call timeoutMs override', async () => {
    const db = await makeDb();
    const { id } = await insertInstance(db);
    const mgr = new BridgeManager(db);
    const res = makeSseRes();
    await mgr.connect(id, res);

    const start = Date.now();
    const promise = mgr.sendCommand(id, { type: 'http_request', method: 'GET', url: 'http://x' }, { timeoutMs: 50 });
    await assert.rejects(() => promise, /timed out/);
    assert.ok(Date.now() - start < 5_000, 'timed out via the 50ms override, not the 10s default');
    await mgr.disconnect(id);
  });

  it('passes response payload fields (status, body) through to the resolver', async () => {
    const db = await makeDb();
    const { id } = await insertInstance(db);
    const mgr = new BridgeManager(db);
    const res = makeSseRes();
    await mgr.connect(id, res);

    const promise = mgr.sendCommand(id, { type: 'http_request', method: 'GET', url: 'http://x' });
    const cmdData = await waitForCommand(res);
    await mgr.receiveStatus(id, { requestId: cmdData.requestId, ok: true, status: 200, body: { models: [] } });

    const result = await promise;
    assert.equal(result.ok, true);
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { models: [] });
    assert.equal(result.requestId, undefined, 'requestId is not leaked into the result');
    await mgr.disconnect(id);
  });

  it('sends model_call commands as-is with a requestId', async () => {
    const db = await makeDb();
    const { id } = await insertInstance(db);
    const mgr = new BridgeManager(db);
    const res = makeSseRes();
    await mgr.connect(id, res);

    mgr.sendCommand(id, {
      type: 'model_call', endpoint: 'http://ollama:11434/api/generate',
      model: 'llava', prompt: 'Describe', outputMode: 'text',
      sourceUrl: 'https://backend/preview/k/incoming.jpg',
    }).catch(() => { /* resolved below — ignore */ });

    const cmdData = await waitForCommand(res);
    assert.equal(cmdData.type, 'model_call');
    assert.equal(cmdData.endpoint, 'http://ollama:11434/api/generate');
    assert.equal(cmdData.model, 'llava');
    assert.ok(cmdData.requestId);

    // Resolve so the 120s model_call timer doesn't keep the process alive
    await mgr.receiveStatus(id, { requestId: cmdData.requestId, ok: true, status: 200, body: {} });
    await mgr.disconnect(id);
  });
});
