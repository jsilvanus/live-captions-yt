/**
 * Route-level tests for routes/bridge.js's opts.auth wiring and the
 * Setup/Production tier gate (plan_project_roles.md, decided 2026-07-26).
 * First route-level test file for this router — previously instance CRUD and
 * command dispatch received no auth at all beyond the bridge agent's own
 * per-instance token on /commands and /status (see route-access.js / api.js's
 * doc comments), which must stay reachable with no human credential.
 */

import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import express from 'express';

import { runMigrations } from '../src/db.js';
import { createBridgeRouter } from '../src/routes/bridge.js';

let server, baseUrl, db;

function insertBridgeInstance(overrides = {}) {
  const id = overrides.id ?? randomUUID();
  db.prepare(`INSERT INTO prod_bridge_instances (id, name, token) VALUES (?, ?, ?)`)
    .run(id, overrides.name ?? 'Bridge 1', overrides.token ?? randomUUID());
  return id;
}

// Stand-in for scopedAuth('production') — see cameras-routes.test.js.
function fakeAuth(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) return res.status(401).json({ error: 'missing api key' });
  req.session = { apiKey };
  req.user = { userId: 1 };
  next();
}

const permissiveDeps = { checkProjectRole: () => true };

function makeBridgeManagerStub({ connected = true } = {}) {
  return {
    isConnected: () => connected,
    sendCommand: async () => ({ ok: true, result: 'done' }),
    authenticate: (token) => (token === 'agent-secret' ? { id: 'bridge-1' } : null),
    connect: () => {},
    receiveStatus: () => {},
    disconnect: () => {},
  };
}

function startApp(bridgeManager, opts = {}) {
  const app = express();
  app.use(express.json());
  app.use('/production/bridge', createBridgeRouter(db, bridgeManager, '', opts));
  return new Promise((resolve) => {
    server = createServer(app);
    server.listen(0, () => { baseUrl = `http://localhost:${server.address().port}`; resolve(); });
  });
}

before(() => {
  db = new Database(':memory:');
  runMigrations(db);
});

after(() => db.close());

afterEach(() => {
  if (server) { server.close(); server = null; }
});

describe('bridge router — auth wiring (previously unauthenticated)', () => {
  it('no opts.auth: instance routes stay fully open (historical behavior)', async () => {
    await startApp(makeBridgeManagerStub());
    const res = await fetch(`${baseUrl}/production/bridge/instances`);
    assert.equal(res.status, 200);
  });

  it('opts.auth configured: GET /instances requires it', async () => {
    await startApp(makeBridgeManagerStub(), { auth: fakeAuth });
    const unauth = await fetch(`${baseUrl}/production/bridge/instances`);
    assert.equal(unauth.status, 401);
    const authed = await fetch(`${baseUrl}/production/bridge/instances`, { headers: { 'x-api-key': 'proj-a' } });
    assert.equal(authed.status, 200);
  });

  it('opts.auth configured: the bridge agent channel (/commands, /status) stays unauthenticated by human auth — only its own token', async () => {
    await startApp(makeBridgeManagerStub(), { auth: fakeAuth });
    // No x-api-key at all — a real bridge agent binary sends its own bridge
    // token instead, never a human session/user JWT.
    const status = await fetch(`${baseUrl}/production/bridge/status`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'agent-secret' }),
    });
    assert.notEqual(status.status, 401);
  });
});

describe('bridge Setup/Production tier gate', () => {
  it('POST /instances (create) 403s when no deps.checkProjectRole is injected at all (fail closed)', async () => {
    await startApp(makeBridgeManagerStub(), { auth: fakeAuth }); // no deps
    const res = await fetch(`${baseUrl}/production/bridge/instances`, {
      method: 'POST', headers: { 'x-api-key': 'proj-a', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Bridge' }),
    });
    assert.equal(res.status, 403);
  });

  it('POST /instances 403s when checkProjectRole rejects, requesting the setup tier', async () => {
    const seen = [];
    await startApp(makeBridgeManagerStub(), { auth: fakeAuth, deps: { checkProjectRole: (tier) => { seen.push(tier); return false; } } });
    const res = await fetch(`${baseUrl}/production/bridge/instances`, {
      method: 'POST', headers: { 'x-api-key': 'proj-a', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Bridge' }),
    });
    assert.equal(res.status, 403);
    assert.deepEqual(seen, ['setup']);
  });

  it('POST /instances succeeds when checkProjectRole allows it', async () => {
    await startApp(makeBridgeManagerStub(), { auth: fakeAuth, deps: permissiveDeps });
    const res = await fetch(`${baseUrl}/production/bridge/instances`, {
      method: 'POST', headers: { 'x-api-key': 'proj-a', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Bridge' }),
    });
    assert.equal(res.status, 201);
  });

  it('DELETE /instances/:id 403s when checkProjectRole rejects the setup tier', async () => {
    const id = insertBridgeInstance();
    await startApp(makeBridgeManagerStub(), { auth: fakeAuth, deps: { checkProjectRole: () => false } });
    const res = await fetch(`${baseUrl}/production/bridge/instances/${id}`, { method: 'DELETE', headers: { 'x-api-key': 'proj-a' } });
    assert.equal(res.status, 403);
  });

  it('POST /instances/:id/command 403s when checkProjectRole rejects, requesting the production tier', async () => {
    const id = insertBridgeInstance();
    const seen = [];
    await startApp(makeBridgeManagerStub(), { auth: fakeAuth, deps: { checkProjectRole: (tier) => { seen.push(tier); return false; } } });
    const res = await fetch(`${baseUrl}/production/bridge/instances/${id}/command`, {
      method: 'POST', headers: { 'x-api-key': 'proj-a', 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'tcp_send', host: 'h', port: 1, payload: 'x' }),
    });
    assert.equal(res.status, 403);
    assert.deepEqual(seen, ['production']);
  });

  it('POST /instances/:id/command succeeds when checkProjectRole allows the production tier', async () => {
    const id = insertBridgeInstance();
    await startApp(makeBridgeManagerStub(), { auth: fakeAuth, deps: permissiveDeps });
    const res = await fetch(`${baseUrl}/production/bridge/instances/${id}/command`, {
      method: 'POST', headers: { 'x-api-key': 'proj-a', 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'tcp_send', host: 'h', port: 1, payload: 'x' }),
    });
    assert.equal(res.status, 200);
  });

  it('GET /instances stays open regardless of the gate (read is never blocked)', async () => {
    await startApp(makeBridgeManagerStub(), { auth: fakeAuth, deps: { checkProjectRole: () => false } });
    const res = await fetch(`${baseUrl}/production/bridge/instances`, { headers: { 'x-api-key': 'proj-a' } });
    assert.equal(res.status, 200);
  });

  it('a request with no opts.auth configured at all stays fail-open (historical behavior)', async () => {
    await startApp(makeBridgeManagerStub(), { deps: { checkProjectRole: () => false } }); // no auth opt
    const res = await fetch(`${baseUrl}/production/bridge/instances`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Bridge' }),
    });
    assert.equal(res.status, 201);
  });
});
