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

describe('GET /roles/:roleCode/captures', () => {
  it('requires auth and 404s for a non-vision role', async () => {
    await startApp();
    const res1 = await fetch(`${baseUrl}/roles/tracker/captures`);
    assert.equal(res1.status, 401);
    const res2 = await fetch(`${baseUrl}/roles/planner/captures`, { headers: bearer() });
    assert.equal(res2.status, 404);
  });

  it('returns an empty list when nothing has been captured yet', async () => {
    await startApp();
    const res = await fetch(`${baseUrl}/roles/tracker/captures`, { headers: bearer() });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.captures, []);
  });

  it('lists captures (without frame bytes) recorded by the running poll loop', async () => {
    setRoleConfig(db, 'key1', 'tracker', { enabled: true, providerId, modelName: 'gpt-4o-mini' });
    global.fetch = async (url, init) => {
      if (typeof url === 'string' && url.includes('/preview/')) {
        return { ok: true, status: 200, arrayBuffer: async () => Buffer.from('x') };
      }
      if (typeof url === 'string' && url.includes('/roles/')) return realFetch(url, init);
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"objects":[]}' } }] }) };
    };
    await startApp();
    await fetch(`${baseUrl}/roles/tracker/start`, { method: 'POST', headers: bearer() });
    await new Promise((r) => setTimeout(r, 200));
    await fetch(`${baseUrl}/roles/tracker/stop`, { method: 'POST', headers: bearer() });

    const res = await fetch(`${baseUrl}/roles/tracker/captures`, { headers: bearer() });
    const body = await res.json();
    assert.ok(body.captures.length > 0);
    assert.ok(body.captures[0].id);
    assert.equal(body.captures[0].frame, undefined);
  });
});

describe('GET /roles/:roleCode/captures/:id/frame', () => {
  it('requires auth, 404s for a non-vision role, and 404s an unknown capture id', async () => {
    await startApp();
    const res1 = await fetch(`${baseUrl}/roles/tracker/captures/x/frame`);
    assert.equal(res1.status, 401);
    const res2 = await fetch(`${baseUrl}/roles/planner/captures/x/frame`, { headers: bearer() });
    assert.equal(res2.status, 404);
    const res3 = await fetch(`${baseUrl}/roles/tracker/captures/nonexistent/frame`, { headers: bearer() });
    assert.equal(res3.status, 404);
  });

  it('serves the raw captured JPEG bytes for a known capture', async () => {
    setRoleConfig(db, 'key1', 'tracker', { enabled: true, providerId, modelName: 'gpt-4o-mini' });
    global.fetch = async (url, init) => {
      if (typeof url === 'string' && url.includes('/preview/')) {
        return { ok: true, status: 200, arrayBuffer: async () => Buffer.from('jpeg-frame-bytes') };
      }
      if (typeof url === 'string' && url.includes('/roles/')) return realFetch(url, init);
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"objects":[]}' } }] }) };
    };
    await startApp();
    await fetch(`${baseUrl}/roles/tracker/start`, { method: 'POST', headers: bearer() });
    await new Promise((r) => setTimeout(r, 60));
    await fetch(`${baseUrl}/roles/tracker/stop`, { method: 'POST', headers: bearer() });

    const list = await (await fetch(`${baseUrl}/roles/tracker/captures`, { headers: bearer() })).json();
    const id = list.captures[0].id;
    const res = await fetch(`${baseUrl}/roles/tracker/captures/${id}/frame`, { headers: bearer() });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/jpeg');
    const buf = Buffer.from(await res.arrayBuffer());
    assert.equal(buf.toString(), 'jpeg-frame-bytes');
  });
});

describe('POST /roles/:roleCode/captures/:id/replay', () => {
  it('requires auth, 404s for a non-vision role', async () => {
    await startApp();
    const res1 = await fetch(`${baseUrl}/roles/tracker/captures/x/replay`, { method: 'POST' });
    assert.equal(res1.status, 401);
    const res2 = await fetch(`${baseUrl}/roles/planner/captures/x/replay`, { method: 'POST', headers: bearer() });
    assert.equal(res2.status, 404);
  });

  it('503s when the role is not enabled (same gate as /start)', async () => {
    // Use a distinct api_key with no role config at all — 'key1' has been
    // enabled for 'tracker' by earlier tests sharing this file's db.
    const otherToken = jwt.sign({ sessionId: 's2', apiKey: 'key-no-role-config' }, JWT_SECRET, { expiresIn: '1h' });
    await startApp();
    const res = await fetch(`${baseUrl}/roles/tracker/captures/x/replay`, {
      method: 'POST', headers: { Authorization: `Bearer ${otherToken}`, 'Content-Type': 'application/json' }, body: '{}',
    });
    assert.equal(res.status, 503);
  });

  it('replays a captured frame against an edited prompt and returns the original + replay diff', async () => {
    setRoleConfig(db, 'key1', 'tracker', { enabled: true, providerId, modelName: 'gpt-4o-mini' });
    global.fetch = async (url, init) => {
      if (typeof url === 'string' && url.includes('/preview/')) {
        return { ok: true, status: 200, arrayBuffer: async () => Buffer.from('x') };
      }
      if (typeof url === 'string' && url.includes('/roles/')) return realFetch(url, init);
      const body = JSON.parse(init.body);
      const promptText = body.messages[0].content.find((c) => c.type === 'text').text;
      const label = promptText.includes('OVERRIDE') ? 'dog' : 'person';
      return { ok: true, json: async () => ({ choices: [{ message: { content: `{"objects":[{"label":"${label}","confidence":0.9,"bbox":{"x":0,"y":0,"w":1,"h":1}}]}` } }] }) };
    };
    await startApp();
    await fetch(`${baseUrl}/roles/tracker/start`, { method: 'POST', headers: bearer() });
    await new Promise((r) => setTimeout(r, 60));
    await fetch(`${baseUrl}/roles/tracker/stop`, { method: 'POST', headers: bearer() });

    const list = await (await fetch(`${baseUrl}/roles/tracker/captures`, { headers: bearer() })).json();
    const id = list.captures[0].id;
    const res = await fetch(`${baseUrl}/roles/tracker/captures/${id}/replay`, {
      method: 'POST',
      headers: { ...bearer(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ promptOverride: 'OVERRIDE: find the dog' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.original.result.json.objects[0].label, 'person');
    assert.equal(body.replay.result.json.objects[0].label, 'dog');
  });

  it('404s for an unknown capture id (once a provider is configured)', async () => {
    setRoleConfig(db, 'key1', 'tracker', { enabled: true, providerId, modelName: 'gpt-4o-mini' });
    await startApp();
    const res = await fetch(`${baseUrl}/roles/tracker/captures/nonexistent/replay`, {
      method: 'POST', headers: { ...bearer(), 'Content-Type': 'application/json' }, body: '{}',
    });
    assert.equal(res.status, 404);
  });
});
