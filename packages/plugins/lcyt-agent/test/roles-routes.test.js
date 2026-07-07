/**
 * Route-level tests for the AI Roles Framework catalog + config routes.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

let Database, express, jwt;
try {
  Database = (await import('better-sqlite3')).default;
  express = (await import('express')).default;
  jwt = (await import('jsonwebtoken')).default;
} catch {
  console.log('# deps not available — skipping roles route tests');
  process.exit(0);
}

import { runAiRolesMigrations, setRoleConfig } from '../src/ai-roles.js';
import { createRolesRouter } from '../src/routes/roles.js';

const JWT_SECRET = 'test-roles-secret';

let server, baseUrl, db, tokenA, tokenB;

function sessionAuth(req, res, next) {
  const header = req.headers.authorization || '';
  try {
    req.session = jwt.verify(header.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

before(() => new Promise((resolve) => {
  db = new Database(':memory:');
  runAiRolesMigrations(db);

  const app = express();
  app.use(express.json());
  app.use('/roles', createRolesRouter(db, sessionAuth));

  tokenA = jwt.sign({ sessionId: 'sA', apiKey: 'keyA' }, JWT_SECRET, { expiresIn: '1h' });
  tokenB = jwt.sign({ sessionId: 'sB', apiKey: 'keyB' }, JWT_SECRET, { expiresIn: '1h' });

  server = createServer(app);
  server.listen(0, () => {
    baseUrl = `http://localhost:${server.address().port}`;
    resolve();
  });
}));

after(() => new Promise((resolve) => {
  db.close();
  server.close(resolve);
}));

function req(path, { method = 'GET', token, body } = {}) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe('GET /roles/catalog', () => {
  it('is public (no auth required) and lists all seven roles', async () => {
    const res = await req('/roles/catalog');
    assert.equal(res.status, 200);
    const { roles } = await res.json();
    assert.equal(roles.length, 7);
  });
});

describe('GET /roles/:roleCode/config', () => {
  it('requires auth', async () => {
    assert.equal((await req('/roles/planner/config')).status, 401);
  });

  it('404s for an unknown role code', async () => {
    assert.equal((await req('/roles/not-a-role/config', { token: tokenA })).status, 404);
  });

  it('returns the default config when unconfigured', async () => {
    const res = await req('/roles/planner/config', { token: tokenA });
    assert.equal(res.status, 200);
    const { config } = await res.json();
    assert.equal(config.roleCode, 'planner');
    assert.equal(config.enabled, false);
  });
});

describe('PUT /roles/:roleCode/config', () => {
  it('updates the session project\'s config for a role', async () => {
    const res = await req('/roles/dsk_designer/config', {
      method: 'PUT', token: tokenA,
      body: { enabled: true, providerId: 'prov-1', modelName: 'gpt-4o-mini', harnessConfig: { mode: 'confirm' } },
    });
    assert.equal(res.status, 200);
    const { config } = await res.json();
    assert.equal(config.enabled, true);
    assert.equal(config.providerId, 'prov-1');
    assert.deepEqual(config.harnessConfig, { mode: 'confirm' });
  });

  it('rejects a non-object harnessConfig', async () => {
    const res = await req('/roles/dsk_designer/config', {
      method: 'PUT', token: tokenA, body: { harnessConfig: 'not-an-object' },
    });
    assert.equal(res.status, 400);
  });

  it('rejects an array harnessConfig', async () => {
    const res = await req('/roles/dsk_designer/config', {
      method: 'PUT', token: tokenA, body: { harnessConfig: [] },
    });
    assert.equal(res.status, 400);
  });

  it('404s for an unknown role code', async () => {
    const res = await req('/roles/not-a-role/config', { method: 'PUT', token: tokenA, body: { enabled: true } });
    assert.equal(res.status, 404);
  });

  it('is isolated per project — keyB never sees keyA\'s config', async () => {
    setRoleConfig(db, 'keyA', 'setup_assistant', { enabled: true, providerId: 'prov-x' });
    const res = await req('/roles/setup_assistant/config', { token: tokenB });
    const { config } = await res.json();
    assert.equal(config.enabled, false);
    assert.equal(config.providerId, null);
  });
});
