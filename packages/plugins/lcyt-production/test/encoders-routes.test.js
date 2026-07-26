/**
 * Route-level tests for routes/encoders.js's opts.auth wiring — this router
 * previously had no auth hook in its signature at all (closed alongside the
 * bridge security-layer work, see routes/bridge.js's equivalent tests).
 */

import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import Database from 'better-sqlite3';
import express from 'express';

import { runMigrations } from '../src/db.js';
import { createEncodersRouter } from '../src/routes/encoders.js';

let server, baseUrl, db;

// Stand-in for scopedAuth('production') — see mixers-routes.test.js.
function fakeAuth(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) return res.status(401).json({ error: 'missing api key' });
  req.session = { apiKey };
  next();
}

function startApp(opts = {}, bridgeManager = null) {
  const app = express();
  app.use(express.json());
  app.use('/production/encoders', createEncodersRouter(db, bridgeManager, opts));
  return new Promise((resolve) => {
    server = createServer(app);
    server.listen(0, () => { baseUrl = `http://localhost:${server.address().port}`; resolve(); });
  });
}

function insertBridgeInstance(id = 'bridge-1') {
  db.prepare('INSERT OR IGNORE INTO prod_bridge_instances (id, name, token) VALUES (?, ?, ?)')
    .run(id, 'Bridge 1', `tok-${id}`);
  return id;
}

function insertEncoder(overrides = {}) {
  const id = overrides.id ?? randomUUID();
  db.prepare(`
    INSERT INTO prod_encoders (id, name, type, connection_config, connection_source, bridge_instance_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    id,
    overrides.name ?? 'Enc 1',
    overrides.type ?? 'monarch_hd',
    JSON.stringify(overrides.connectionConfig ?? { host: '10.0.0.9' }),
    overrides.connectionSource ?? 'bridge',
    overrides.bridgeInstanceId ?? null,
  );
  return id;
}

before(() => {
  db = new Database(':memory:');
  runMigrations(db);
});

after(() => db.close());

afterEach(() => {
  if (server) { server.close(); server = null; }
});

describe('encoders router — auth wiring', () => {
  it('no opts.auth: routes stay fully open (historical behavior)', async () => {
    await startApp();
    const res = await fetch(`${baseUrl}/production/encoders`);
    assert.equal(res.status, 200);
  });

  it('opts.auth configured: GET / requires it', async () => {
    await startApp({ auth: fakeAuth });
    const unauth = await fetch(`${baseUrl}/production/encoders`);
    assert.equal(unauth.status, 401);
    const authed = await fetch(`${baseUrl}/production/encoders`, { headers: { 'x-api-key': 'proj-a' } });
    assert.equal(authed.status, 200);
  });

  it('opts.auth configured: POST / requires it', async () => {
    await startApp({ auth: fakeAuth });
    const res = await fetch(`${baseUrl}/production/encoders`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Enc 1', type: 'monarch_hd' }),
    });
    assert.equal(res.status, 401);
  });
});

describe('encoders router — bridge-relayed start/stop status mapping', () => {
  it('maps a security-policy block to 403, not the generic 502', async () => {
    const bridgeManager = {
      isConnected: () => true,
      sendCommand: async () => { throw new Error('Blocked by bridge security policy: Blocked by deny rule (10.0.0.9:80)'); },
    };
    insertBridgeInstance('bridge-1');
    const id = insertEncoder({ bridgeInstanceId: 'bridge-1' });
    await startApp({}, bridgeManager);

    const res = await fetch(`${baseUrl}/production/encoders/${id}/start`, { method: 'POST' });
    assert.equal(res.status, 403);
  });

  it('a real connection failure still maps to 502', async () => {
    const bridgeManager = {
      isConnected: () => true,
      sendCommand: async () => { throw new Error('ECONNREFUSED'); },
    };
    insertBridgeInstance('bridge-1');
    const id = insertEncoder({ bridgeInstanceId: 'bridge-1' });
    await startApp({}, bridgeManager);

    const res = await fetch(`${baseUrl}/production/encoders/${id}/start`, { method: 'POST' });
    assert.equal(res.status, 502);
  });
});
