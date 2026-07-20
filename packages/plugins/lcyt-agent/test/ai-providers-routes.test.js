/**
 * Route-level tests for the AI provider registry routers:
 * ownership rules (granted site providers are read-only for projects),
 * visibility 404s, and admin CRUD + grants.
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
  console.log('# deps not available — skipping ai-providers route tests');
  process.exit(0);
}

import { runProviderRegistryMigrations, createProvider, setGrant, getProvider } from '../src/provider-registry.js';
import { createAdminAiProvidersRouter } from '../src/routes/ai-providers-admin.js';
import { createProjectAiProvidersRouter } from '../src/routes/ai-providers-project.js';

const JWT_SECRET = 'test-ai-providers-secret';
const ADMIN_HEADER = { 'x-test-admin': '1' };

let server, baseUrl, db, tokenA, tokenB;

function sessionAuth(req, res, next) {
  const header = req.headers.authorization || '';
  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET);
    req.session = payload;
    if (payload.userId != null) req.user = { userId: payload.userId };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// tokenA/tokenB's userId (1/2) are each explicit owner/admin on their own
// project (keyA/keyB) — matches server.js's real isExplicitProjectAdmin,
// which resolves this from project_members via getMemberAccessLevel.
function isExplicitProjectAdmin(apiKey, userId) {
  return (apiKey === 'keyA' && userId === 1) || (apiKey === 'keyB' && userId === 2);
}

function adminAuth(req, res, next) {
  if (req.headers['x-test-admin'] === '1') return next();
  res.status(401).json({ error: 'Admin authentication required' });
}

before(() => new Promise((resolve) => {
  db = new Database(':memory:');
  runProviderRegistryMigrations(db);

  const app = express();
  app.use(express.json());
  app.use('/ai/providers', createProjectAiProvidersRouter(db, sessionAuth, { isExplicitProjectAdmin }));
  app.use('/admin/ai-providers', createAdminAiProvidersRouter(db, adminAuth));

  tokenA = jwt.sign({ sessionId: 'sA', apiKey: 'keyA', userId: 1 }, JWT_SECRET, { expiresIn: '1h' });
  tokenB = jwt.sign({ sessionId: 'sB', apiKey: 'keyB', userId: 2 }, JWT_SECRET, { expiresIn: '1h' });

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

function req(path, { method = 'GET', token, admin = false, body } = {}) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(admin ? ADMIN_HEADER : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe('project /ai/providers', () => {
  it('creates a project provider and lists it', async () => {
    const res = await req('/ai/providers', {
      method: 'POST', token: tokenA,
      body: { kind: 'ollama', vendor: 'ollama', name: 'My Ollama', baseUrl: 'http://o:11434' },
    });
    assert.equal(res.status, 201);
    const { provider } = await res.json();
    assert.equal(provider.scope, 'project');
    assert.equal(provider.ownerApiKey, 'keyA');

    const list = await (await req('/ai/providers', { token: tokenA })).json();
    assert.ok(list.providers.some((p) => p.id === provider.id));
  });

  it('another project cannot see, edit, or delete it (404)', async () => {
    const created = await (await req('/ai/providers', {
      method: 'POST', token: tokenA,
      body: { kind: 'api', vendor: 'openai', name: 'Private', baseUrl: 'https://api.openai.com' },
    })).json();
    const id = created.provider.id;

    assert.equal((await req(`/ai/providers/${id}/models`, { token: tokenB })).status, 404);
    assert.equal((await req(`/ai/providers/${id}`, { method: 'PUT', token: tokenB, body: { name: 'X' } })).status, 404);
    assert.equal((await req(`/ai/providers/${id}`, { method: 'DELETE', token: tokenB })).status, 404);
  });

  it('a granted site provider is visible but read-only (403 on write)', async () => {
    const site = createProvider(db, { scope: 'site', kind: 'ollama', name: 'Shared box', baseUrl: 'http://s:11434' });
    setGrant(db, site.id, 'keyA', true);

    const list = await (await req('/ai/providers', { token: tokenA })).json();
    assert.ok(list.providers.some((p) => p.id === site.id));

    assert.equal((await req(`/ai/providers/${site.id}`, { method: 'PUT', token: tokenA, body: { name: 'Hijack' } })).status, 403);
    assert.equal((await req(`/ai/providers/${site.id}`, { method: 'DELETE', token: tokenA })).status, 403);
    // Reading models is allowed
    assert.equal((await req(`/ai/providers/${site.id}/models`, { token: tokenA })).status, 200);
    // Ungranted project still gets 404
    assert.equal((await req(`/ai/providers/${site.id}/models`, { token: tokenB })).status, 404);
  });
});

describe('project /ai/providers write access requires explicit project admin', () => {
  // Adding/editing/removing a provider stores a real credential — org-baseline
  // access (which passes the outer session/project-access gate today) must
  // not be enough; the router requires deps.isExplicitProjectAdmin(apiKey,
  // userId) to say yes.
  it('POST 403s when isExplicitProjectAdmin is not injected at all', async () => {
    const app = express();
    app.use(express.json());
    app.use('/ai/providers', createProjectAiProvidersRouter(db, sessionAuth)); // no deps
    const noDepsServer = createServer(app);
    await new Promise((resolve) => noDepsServer.listen(0, resolve));
    const noDepsUrl = `http://localhost:${noDepsServer.address().port}`;
    const res = await fetch(`${noDepsUrl}/ai/providers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'api', vendor: 'openai', name: 'X', baseUrl: 'https://api.openai.com' }),
    });
    assert.equal(res.status, 403);
    await new Promise((resolve) => noDepsServer.close(resolve));
  });

  it('POST 403s for a user isExplicitProjectAdmin says is not an explicit admin on this project', async () => {
    const outsiderToken = jwt.sign({ sessionId: 'sC', apiKey: 'keyA', userId: 999 }, JWT_SECRET, { expiresIn: '1h' });
    const res = await req('/ai/providers', {
      method: 'POST', token: outsiderToken,
      body: { kind: 'api', vendor: 'openai', name: 'Should fail', baseUrl: 'https://api.openai.com' },
    });
    assert.equal(res.status, 403);
  });

  it('PUT/DELETE 403 for a non-admin even on their own project-scope provider', async () => {
    const created = await (await req('/ai/providers', {
      method: 'POST', token: tokenA,
      body: { kind: 'api', vendor: 'openai', name: 'Owned', baseUrl: 'https://api.openai.com' },
    })).json();
    const id = created.provider.id;
    const outsiderToken = jwt.sign({ sessionId: 'sC', apiKey: 'keyA', userId: 999 }, JWT_SECRET, { expiresIn: '1h' });

    assert.equal((await req(`/ai/providers/${id}`, { method: 'PUT', token: outsiderToken, body: { name: 'X' } })).status, 403);
    assert.equal((await req(`/ai/providers/${id}`, { method: 'DELETE', token: outsiderToken })).status, 403);
  });

  it('GET still works for a user isExplicitProjectAdmin would reject (read stays on the broader gate)', async () => {
    const outsiderToken = jwt.sign({ sessionId: 'sC', apiKey: 'keyA', userId: 999 }, JWT_SECRET, { expiresIn: '1h' });
    const res = await req('/ai/providers', { token: outsiderToken });
    assert.equal(res.status, 200);
  });
});

describe('admin /admin/ai-providers', () => {
  it('requires admin auth', async () => {
    assert.equal((await req('/admin/ai-providers')).status, 401);
  });

  it('creates, updates, grants, and deletes a site provider', async () => {
    const createRes = await req('/admin/ai-providers', {
      method: 'POST', admin: true,
      body: { kind: 'ollama', vendor: 'ollama', name: 'Admin Ollama', baseUrl: 'http://a:11434' },
    });
    assert.equal(createRes.status, 201);
    const { provider } = await createRes.json();
    assert.equal(provider.scope, 'site');

    const putRes = await req(`/admin/ai-providers/${provider.id}`, {
      method: 'PUT', admin: true, body: { name: 'Renamed' },
    });
    assert.equal((await putRes.json()).provider.name, 'Renamed');

    await req(`/admin/ai-providers/${provider.id}/grants/keyB`, { method: 'PUT', admin: true, body: { enabled: true } });
    const grants = await (await req(`/admin/ai-providers/${provider.id}/grants`, { admin: true })).json();
    assert.deepEqual(grants.grants, [{ apiKey: 'keyB', enabled: true }]);
    assert.ok(getProvider(db, provider.id));

    assert.equal((await req(`/admin/ai-providers/${provider.id}`, { method: 'DELETE', admin: true })).status, 200);
    assert.equal(getProvider(db, provider.id), null);
  });

  it('manual model add is rejected for api-kind providers', async () => {
    const { provider } = await (await req('/admin/ai-providers', {
      method: 'POST', admin: true,
      body: { kind: 'api', vendor: 'openai', name: 'Cloud', baseUrl: 'https://api.openai.com' },
    })).json();
    const res = await req(`/admin/ai-providers/${provider.id}/models`, {
      method: 'POST', admin: true, body: { modelName: 'gpt-4o-mini' },
    });
    assert.equal(res.status, 400);
  });

  it('project-scope providers are invisible to the admin site list', async () => {
    createProvider(db, { scope: 'project', ownerApiKey: 'keyA', kind: 'api', vendor: 'openai', name: 'ProjOnly', baseUrl: 'https://api.openai.com' });
    const { providers } = await (await req('/admin/ai-providers', { admin: true })).json();
    assert.equal(providers.some((p) => p.name === 'ProjOnly'), false);
  });
});
