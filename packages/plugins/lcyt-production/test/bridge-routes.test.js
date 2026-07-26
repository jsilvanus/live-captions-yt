/**
 * Route-level tests for routes/bridge.js's opts.auth wiring (the
 * previously-unauthenticated bridge instance/command routes, closed
 * alongside the new security-rules feature) and the new security-rules
 * CRUD + bridge-agent-facing for-agent endpoint.
 *
 * Covers:
 *   - opts.auth gates instance CRUD, command dispatch, .env download, and
 *     the security-rules CRUD, but not /commands, /status, or
 *     .../security-rules/for-agent (bridge-token-authed, a different actor).
 *   - security-rules CRUD: create/list/delete, validation errors (bad
 *     ruleKind/ruleType, invalid regex, invalid host pattern), 404s.
 *   - for-agent resolves rules by bridge token, not the :id path param.
 */

import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import express from 'express';

import { runMigrations } from '../src/db.js';
import { createBridgeRouter } from '../src/routes/bridge.js';
import { BridgeManager } from '../src/bridge-manager.js';

let server, baseUrl, db, bridgeManager;

function insertInstance(overrides = {}) {
  const id = overrides.id ?? randomUUID();
  const token = overrides.token ?? randomUUID();
  db.prepare('INSERT INTO prod_bridge_instances (id, name, token) VALUES (?, ?, ?)')
    .run(id, overrides.name ?? 'Bridge 1', token);
  return { id, token };
}

// Stand-in for scopedAuth('production') — see mixers-routes.test.js.
function fakeAuth(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) return res.status(401).json({ error: 'missing api key' });
  req.session = { apiKey };
  next();
}

function startApp(opts = {}) {
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
  bridgeManager = new BridgeManager(db);
});

after(() => db.close());

afterEach(() => {
  if (server) { server.close(); server = null; }
  bridgeManager = new BridgeManager(db);
});

// ---------------------------------------------------------------------------
// opts.auth wiring
// ---------------------------------------------------------------------------

describe('bridge router — auth wiring', () => {
  it('no opts.auth: instance routes stay fully open (historical behavior)', async () => {
    await startApp();
    const res = await fetch(`${baseUrl}/production/bridge/instances`);
    assert.equal(res.status, 200);
  });

  it('opts.auth configured: GET /instances requires it', async () => {
    await startApp({ auth: fakeAuth });
    const unauth = await fetch(`${baseUrl}/production/bridge/instances`);
    assert.equal(unauth.status, 401);
    const authed = await fetch(`${baseUrl}/production/bridge/instances`, { headers: { 'x-api-key': 'proj-a' } });
    assert.equal(authed.status, 200);
  });

  it('POST /instances/:id/command maps a security-policy block to 403, not 502', async () => {
    const { id } = insertInstance();
    bridgeManager.isConnected = () => true;
    bridgeManager.sendCommand = async () => { throw new Error('Blocked by bridge security policy: Blocked by deny rule (10.0.0.1)'); };
    await startApp();

    const res = await fetch(`${baseUrl}/production/bridge/instances/${id}/command`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'tcp_send', host: '10.0.0.1', port: 9000, payload: 'x' }),
    });
    assert.equal(res.status, 403);
  });

  it('opts.auth configured: POST /instances/:id/command requires it', async () => {
    const { id } = insertInstance();
    await startApp({ auth: fakeAuth });
    const res = await fetch(`${baseUrl}/production/bridge/instances/${id}/command`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'tcp_send' }),
    });
    assert.equal(res.status, 401);
  });

  it('opts.auth configured: GET /instances/:id/env requires it', async () => {
    const { id } = insertInstance();
    await startApp({ auth: fakeAuth });
    const res = await fetch(`${baseUrl}/production/bridge/instances/${id}/env`);
    assert.equal(res.status, 401);
  });

  it('opts.auth configured: security-rules CRUD requires it', async () => {
    const { id } = insertInstance();
    await startApp({ auth: fakeAuth });
    const res = await fetch(`${baseUrl}/production/bridge/instances/${id}/security-rules`);
    assert.equal(res.status, 401);
  });

  it('opts.auth configured: GET /commands still reaches bridge-token auth (not blocked by opts.auth)', async () => {
    await startApp({ auth: fakeAuth });
    // No opts.auth credentials supplied at all — if the carve-out were
    // missing this would 401 from opts.auth before ever reaching
    // bridgeManager.authenticate(); it should instead 401 with the bridge
    // token's own error message.
    const res = await fetch(`${baseUrl}/production/bridge/commands?token=bogus`);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error, 'Invalid bridge token');
  });

  it('opts.auth configured: POST /status still reaches bridge-token auth', async () => {
    await startApp({ auth: fakeAuth });
    const res = await fetch(`${baseUrl}/production/bridge/status`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
    });
    assert.equal(res.status, 401);
  });

  it('opts.auth configured: GET /security-rules/for-agent still reaches bridge-token auth', async () => {
    await startApp({ auth: fakeAuth });
    const res = await fetch(`${baseUrl}/production/bridge/security-rules/for-agent`);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error, 'Invalid bridge token');
  });
});

// ---------------------------------------------------------------------------
// security-rules CRUD
// ---------------------------------------------------------------------------

describe('bridge router — security-rules CRUD', () => {
  it('POST creates a rule, GET lists it', async () => {
    const { id } = insertInstance();
    await startApp();

    const create = await fetch(`${baseUrl}/production/bridge/instances/${id}/security-rules`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ruleKind: 'ip', ruleType: 'deny', pattern: '10.0.0.1', description: 'blocked device' }),
    });
    assert.equal(create.status, 201);
    const created = await create.json();
    assert.ok(created.rule.id);
    assert.equal(created.rule.ruleKind, 'ip');
    assert.equal(created.rule.pattern, '10.0.0.1');

    const list = await fetch(`${baseUrl}/production/bridge/instances/${id}/security-rules`);
    const body = await list.json();
    assert.equal(body.rules.length, 1);
    assert.equal(body.rules[0].id, created.rule.id);
  });

  it('GET ?kind= filters to one rule kind', async () => {
    const { id } = insertInstance();
    await startApp();
    await fetch(`${baseUrl}/production/bridge/instances/${id}/security-rules`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ruleKind: 'ip', ruleType: 'deny', pattern: '10.0.0.1' }),
    });
    await fetch(`${baseUrl}/production/bridge/instances/${id}/security-rules`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ruleKind: 'command', ruleType: 'deny', pattern: '^X$' }),
    });

    const res = await fetch(`${baseUrl}/production/bridge/instances/${id}/security-rules?kind=command`);
    const body = await res.json();
    assert.equal(body.rules.length, 1);
    assert.equal(body.rules[0].ruleKind, 'command');
  });

  it('POST rejects an invalid ruleKind', async () => {
    const { id } = insertInstance();
    await startApp();
    const res = await fetch(`${baseUrl}/production/bridge/instances/${id}/security-rules`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ruleKind: 'bogus', ruleType: 'deny', pattern: 'x' }),
    });
    assert.equal(res.status, 400);
  });

  it('POST rejects an invalid regex for a command rule', async () => {
    const { id } = insertInstance();
    await startApp();
    const res = await fetch(`${baseUrl}/production/bridge/instances/${id}/security-rules`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ruleKind: 'command', ruleType: 'deny', pattern: '(unclosed' }),
    });
    assert.equal(res.status, 400);
  });

  it('POST rejects an invalid host pattern for an ip rule', async () => {
    const { id } = insertInstance();
    await startApp();
    const res = await fetch(`${baseUrl}/production/bridge/instances/${id}/security-rules`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ruleKind: 'ip', ruleType: 'deny', pattern: '10.0.0.0/999' }),
    });
    assert.equal(res.status, 400);
  });

  it('POST/GET 404 for an unknown bridge instance', async () => {
    await startApp();
    const res = await fetch(`${baseUrl}/production/bridge/instances/no-such-id/security-rules`);
    assert.equal(res.status, 404);
  });

  it('DELETE removes a rule; a second DELETE 404s', async () => {
    const { id } = insertInstance();
    await startApp();
    const create = await fetch(`${baseUrl}/production/bridge/instances/${id}/security-rules`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ruleKind: 'ip', ruleType: 'deny', pattern: '10.0.0.1' }),
    });
    const { rule } = await create.json();

    const del = await fetch(`${baseUrl}/production/bridge/instances/${id}/security-rules/${rule.id}`, { method: 'DELETE' });
    assert.equal(del.status, 200);

    const list = await fetch(`${baseUrl}/production/bridge/instances/${id}/security-rules`);
    assert.equal((await list.json()).rules.length, 0);

    const redel = await fetch(`${baseUrl}/production/bridge/instances/${id}/security-rules/${rule.id}`, { method: 'DELETE' });
    assert.equal(redel.status, 404);
  });

  it('DELETE 404s when the rule belongs to a different bridge instance', async () => {
    const a = insertInstance();
    const b = insertInstance();
    await startApp();
    const create = await fetch(`${baseUrl}/production/bridge/instances/${a.id}/security-rules`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ruleKind: 'ip', ruleType: 'deny', pattern: '10.0.0.1' }),
    });
    const { rule } = await create.json();

    const res = await fetch(`${baseUrl}/production/bridge/instances/${b.id}/security-rules/${rule.id}`, { method: 'DELETE' });
    assert.equal(res.status, 404);
  });
});

// ---------------------------------------------------------------------------
// GET /security-rules/for-agent — bridge-token identity, no :id at all
// ---------------------------------------------------------------------------

describe('bridge router — security-rules for-agent', () => {
  it('401s with no/invalid token', async () => {
    await startApp();
    const res = await fetch(`${baseUrl}/production/bridge/security-rules/for-agent`);
    assert.equal(res.status, 401);
  });

  it('returns ip/command rules for the token-resolved instance only', async () => {
    const real = insertInstance();
    const other = insertInstance();
    await startApp();

    await fetch(`${baseUrl}/production/bridge/instances/${real.id}/security-rules`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ruleKind: 'ip', ruleType: 'deny', pattern: '10.0.0.1' }),
    });
    await fetch(`${baseUrl}/production/bridge/instances/${real.id}/security-rules`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ruleKind: 'command', ruleType: 'allow', pattern: '^PRESET-[0-9]+$' }),
    });
    // A rule on a different instance must never leak through.
    await fetch(`${baseUrl}/production/bridge/instances/${other.id}/security-rules`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ruleKind: 'ip', ruleType: 'deny', pattern: '10.0.0.99' }),
    });

    const res = await fetch(`${baseUrl}/production/bridge/security-rules/for-agent?token=${real.token}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ipRules.length, 1);
    assert.equal(body.ipRules[0].pattern, '10.0.0.1');
    assert.equal(body.commandRules.length, 1);
    assert.equal(body.commandRules[0].pattern, '^PRESET-[0-9]+$');
  });
});
