/**
 * Route-level tests for vision roles (POST /roles/:roleCode/start|stop,
 * GET /roles/:roleCode/status), restricted to tracker/describer.
 */

import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

let Database, express, jwt;
try {
  Database = (await import('better-sqlite3')).default;
  express = (await import('express')).default;
  jwt = (await import('jsonwebtoken')).default;
} catch {
  console.log('# deps not available — skipping vision-roles route tests');
  process.exit(0);
}

import { runAiRolesMigrations, setRoleConfig } from '../src/ai-roles.js';
import { runProviderRegistryMigrations, createProvider } from '../src/provider-registry.js';
import { createVisionRolesRouter } from '../src/routes/vision-roles.js';
import { VisionRoleManager } from '../src/vision-role-manager.js';
import { RolesBus } from '../src/roles-bus.js';

const JWT_SECRET = 'test-vision-roles-secret';
const realFetch = global.fetch;

let server, baseUrl, db, token, providerId, manager;

function sessionAuth(req, res, next) {
  const header = req.headers.authorization || '';
  try {
    req.session = jwt.verify(header.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

before(() => {
  db = new Database(':memory:');
  runAiRolesMigrations(db);
  runProviderRegistryMigrations(db);
  providerId = createProvider(db, {
    scope: 'site', kind: 'api', vendor: 'openai', name: 'Test provider', baseUrl: 'https://api.test', apiKeyRef: 'sk-test',
  }).id;
  token = jwt.sign({ sessionId: 's1', apiKey: 'key1' }, JWT_SECRET, { expiresIn: '1h' });
});

after(() => db.close());
afterEach(() => {
  global.fetch = realFetch;
  if (manager) { manager.stop('key1', 'tracker'); manager.stop('key1', 'describer'); manager = null; }
  if (server) { server.close(); server = null; }
});

function startApp(bridgeManager = null) {
  manager = new VisionRoleManager(new RolesBus());
  const app = express();
  app.use(express.json());
  app.use('/roles', createVisionRolesRouter(db, sessionAuth, manager, bridgeManager));
  return new Promise((resolve) => {
    server = createServer(app);
    server.listen(0, () => { baseUrl = `http://localhost:${server.address().port}`; resolve(); });
  });
}

function bearer(tok = token) { return { Authorization: `Bearer ${tok}` }; }
// global.fetch is shared with the test's own calls to the local test server —
// only intercept requests to the preview endpoint, pass everything else through.
function mockPreview() {
  global.fetch = async (url, init) => {
    if (typeof url === 'string' && url.includes('/preview/')) {
      return { ok: true, status: 200, arrayBuffer: async () => Buffer.from('x') };
    }
    return realFetch(url, init);
  };
}

describe('POST /roles/:roleCode/start', () => {
  it('404s for a non-vision role', async () => {
    await startApp();
    const res = await fetch(`${baseUrl}/roles/planner/start`, { method: 'POST', headers: bearer() });
    assert.equal(res.status, 404);
  });

  it('requires auth', async () => {
    await startApp();
    const res = await fetch(`${baseUrl}/roles/tracker/start`, { method: 'POST' });
    assert.equal(res.status, 401);
  });

  it('503s when the role is not enabled', async () => {
    await startApp();
    const res = await fetch(`${baseUrl}/roles/tracker/start`, { method: 'POST', headers: bearer() });
    assert.equal(res.status, 503);
  });

  it('503s for a bridge-relayed provider when no bridge manager is injected', async () => {
    const bridgeProviderId = createProvider(db, {
      scope: 'site', kind: 'ollama', vendor: 'ollama', name: 'Bridge Ollama', baseUrl: 'http://ollama:11434', bridgeInstanceId: 'bridge-1',
    }).id;
    setRoleConfig(db, 'key1', 'describer', { enabled: true, providerId: bridgeProviderId, modelName: 'llava' });
    await startApp();
    const res = await fetch(`${baseUrl}/roles/describer/start`, { method: 'POST', headers: bearer() });
    assert.equal(res.status, 503);
  });

  it('starts the loop for a bridge-relayed provider when the router receives a bridge manager', async () => {
    const bridgeManager = {
      sendCommand: async () => ({ ok: true, status: 200, body: { choices: [{ message: { content: 'ok' } }] } }),
    };
    const bridgeProviderId = createProvider(db, {
      scope: 'site', kind: 'ollama', vendor: 'ollama', name: 'Bridge Ollama', baseUrl: 'http://ollama:11434', bridgeInstanceId: 'bridge-2',
    }).id;
    setRoleConfig(db, 'key1', 'tracker', { enabled: true, providerId: bridgeProviderId, modelName: 'llava' });
    mockPreview();
    await startApp(bridgeManager);
    const res = await fetch(`${baseUrl}/roles/tracker/start`, { method: 'POST', headers: bearer() });
    assert.equal(res.status, 200);
  });

  it('starts the loop when enabled with a direct provider', async () => {
    setRoleConfig(db, 'key1', 'tracker', { enabled: true, providerId, modelName: 'gpt-4o-mini' });
    mockPreview();
    await startApp();
    const res = await fetch(`${baseUrl}/roles/tracker/start`, { method: 'POST', headers: bearer() });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    const status = await (await fetch(`${baseUrl}/roles/tracker/status`, { headers: bearer() })).json();
    assert.equal(status.running, true);
  });
});

describe('POST /roles/:roleCode/stop', () => {
  it('reports wasRunning:false when nothing was running', async () => {
    await startApp();
    const res = await fetch(`${baseUrl}/roles/tracker/stop`, { method: 'POST', headers: bearer() });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.wasRunning, false);
  });

  it('stops a running loop', async () => {
    setRoleConfig(db, 'key1', 'tracker', { enabled: true, providerId, modelName: 'gpt-4o-mini' });
    mockPreview();
    await startApp();
    await fetch(`${baseUrl}/roles/tracker/start`, { method: 'POST', headers: bearer() });
    const res = await fetch(`${baseUrl}/roles/tracker/stop`, { method: 'POST', headers: bearer() });
    const body = await res.json();
    assert.equal(body.wasRunning, true);
    const status = await (await fetch(`${baseUrl}/roles/tracker/status`, { headers: bearer() })).json();
    assert.equal(status.running, false);
  });
});

describe('GET /roles/:roleCode/status', () => {
  it('404s for a non-vision role and requires auth', async () => {
    await startApp();
    const res1 = await fetch(`${baseUrl}/roles/planner/status`, { headers: bearer() });
    assert.equal(res1.status, 404);
    const res2 = await fetch(`${baseUrl}/roles/tracker/status`);
    assert.equal(res2.status, 401);
  });
});
