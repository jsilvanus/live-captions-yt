/**
 * Route-level tests for routes/encoders.js's opts.auth wiring — this router
 * previously had no auth hook in its signature at all (closed alongside the
 * bridge security-layer work, see routes/bridge.js's equivalent tests).
 */

import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
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

function startApp(opts = {}) {
  const app = express();
  app.use(express.json());
  app.use('/production/encoders', createEncodersRouter(db, null, opts));
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
