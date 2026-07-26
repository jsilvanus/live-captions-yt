/**
 * Route-level tests for routes/encoders.js's opts.auth wiring and the
 * Setup/Production tier gate (plan_project_roles.md, decided 2026-07-26).
 * First route-level test file for this router — previously it received no
 * auth at all (see route-access.js / api.js's doc comments).
 */

import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import express from 'express';

import { runMigrations } from '../src/db.js';
import { createEncodersRouter } from '../src/routes/encoders.js';

let server, baseUrl, db;

function insertEncoder(overrides = {}) {
  const id = overrides.id ?? randomUUID();
  db.prepare(`
    INSERT INTO prod_encoders (id, name, type, connection_config, connection_source, bridge_instance_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    id,
    overrides.name ?? 'Encoder 1',
    overrides.type ?? 'monarch_hd',
    JSON.stringify(overrides.connection_config ?? { host: '10.0.0.9' }),
    overrides.connection_source ?? 'backend',
    overrides.bridge_instance_id ?? null,
  );
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

function startApp(bridgeManager = null, opts = {}) {
  const app = express();
  app.use(express.json());
  app.use('/production/encoders', createEncodersRouter(db, bridgeManager, opts));
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

describe('encoders router — auth wiring (previously unauthenticated)', () => {
  it('no opts.auth: routes stay fully open (historical behavior)', async () => {
    const id = insertEncoder();
    await startApp();
    const res = await fetch(`${baseUrl}/production/encoders/${id}`);
    assert.equal(res.status, 200);
  });

  it('opts.auth configured: GET requires it', async () => {
    const id = insertEncoder();
    await startApp(null, { auth: fakeAuth });
    const unauth = await fetch(`${baseUrl}/production/encoders/${id}`);
    assert.equal(unauth.status, 401);
    const authed = await fetch(`${baseUrl}/production/encoders/${id}`, { headers: { 'x-api-key': 'proj-a' } });
    assert.equal(authed.status, 200);
  });
});

describe('encoders Setup/Production tier gate', () => {
  it('POST / (create) 403s when no deps.checkProjectRole is injected at all (fail closed)', async () => {
    await startApp(null, { auth: fakeAuth }); // no deps
    const res = await fetch(`${baseUrl}/production/encoders`, {
      method: 'POST', headers: { 'x-api-key': 'proj-a', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Encoder', type: 'monarch_hd' }),
    });
    assert.equal(res.status, 403);
  });

  it('POST / (create) 403s when checkProjectRole rejects, requesting the setup tier', async () => {
    const seen = [];
    await startApp(null, { auth: fakeAuth, deps: { checkProjectRole: (tier) => { seen.push(tier); return false; } } });
    const res = await fetch(`${baseUrl}/production/encoders`, {
      method: 'POST', headers: { 'x-api-key': 'proj-a', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Encoder', type: 'monarch_hd' }),
    });
    assert.equal(res.status, 403);
    assert.deepEqual(seen, ['setup']);
  });

  it('POST / (create) succeeds when checkProjectRole allows it', async () => {
    await startApp(null, { auth: fakeAuth, deps: permissiveDeps });
    const res = await fetch(`${baseUrl}/production/encoders`, {
      method: 'POST', headers: { 'x-api-key': 'proj-a', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Encoder', type: 'monarch_hd' }),
    });
    assert.equal(res.status, 201);
  });

  it('PUT /:id 403s when checkProjectRole rejects the setup tier', async () => {
    const id = insertEncoder();
    await startApp(null, { auth: fakeAuth, deps: { checkProjectRole: () => false } });
    const res = await fetch(`${baseUrl}/production/encoders/${id}`, {
      method: 'PUT', headers: { 'x-api-key': 'proj-a', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Renamed' }),
    });
    assert.equal(res.status, 403);
  });

  it('DELETE /:id 403s when checkProjectRole rejects the setup tier', async () => {
    const id = insertEncoder();
    await startApp(null, { auth: fakeAuth, deps: { checkProjectRole: () => false } });
    const res = await fetch(`${baseUrl}/production/encoders/${id}`, { method: 'DELETE', headers: { 'x-api-key': 'proj-a' } });
    assert.equal(res.status, 403);
  });

  it('POST /:id/start|stop|test 403 when checkProjectRole rejects, requesting the production tier', async () => {
    const id = insertEncoder();
    const seen = [];
    await startApp(null, { auth: fakeAuth, deps: { checkProjectRole: (tier) => { seen.push(tier); return false; } } });
    for (const verb of ['start', 'stop', 'test']) {
      const res = await fetch(`${baseUrl}/production/encoders/${id}/${verb}`, {
        method: 'POST', headers: { 'x-api-key': 'proj-a' },
      });
      assert.equal(res.status, 403, `POST /:id/${verb} should 403`);
    }
    assert.deepEqual(seen, ['production', 'production', 'production']);
  });

  it('GET / stays open regardless of the gate (read is never blocked)', async () => {
    await startApp(null, { auth: fakeAuth, deps: { checkProjectRole: () => false } });
    const res = await fetch(`${baseUrl}/production/encoders`, { headers: { 'x-api-key': 'proj-a' } });
    assert.equal(res.status, 200);
  });

  it('a request with no opts.auth configured at all stays fail-open (historical behavior)', async () => {
    await startApp(null, { deps: { checkProjectRole: () => false } }); // no auth opt
    const res = await fetch(`${baseUrl}/production/encoders`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Encoder', type: 'monarch_hd' }),
    });
    assert.equal(res.status, 201);
  });
});
