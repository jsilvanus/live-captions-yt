/**
 * Route-level tests for Production Assistant (POST /roles/assistant/prompt,
 * GET .../suggestions, POST .../suggestions/:id/confirm|reject, GET .../events).
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
  console.log('# deps not available — skipping production-assistant route tests');
  process.exit(0);
}

import { runAiRolesMigrations, setRoleConfig } from '../src/ai-roles.js';
import { runProviderRegistryMigrations, createProvider } from '../src/provider-registry.js';
import { createProductionAssistantRouter } from '../src/routes/production-assistant.js';
import { ProductionAssistantManager } from '../src/production-assistant.js';
import { RolesBus } from '../src/roles-bus.js';

const JWT_SECRET = 'test-assistant-secret';
const realFetch = global.fetch;

let server, baseUrl, db, token, providerId;

function sessionAuth(req, res, next) {
  const header = req.headers.authorization || '';
  try {
    req.session = jwt.verify(header.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

function makeFakeAgent() {
  const contexts = new Map();
  return {
    addContext: (apiKey, type, text) => {
      if (!contexts.has(apiKey)) contexts.set(apiKey, []);
      contexts.get(apiKey).push({ type, text });
    },
    getContext: (apiKey) => contexts.get(apiKey) ?? [],
  };
}

const FAKE_TOOLS = [
  { name: 'camera.preset', description: 'x', inputSchema: { type: 'object', properties: {} }, annotations: { destructiveHint: true } },
  { name: 'mixer.switch', description: 'x', inputSchema: { type: 'object', properties: {} }, annotations: { destructiveHint: true } },
];

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
afterEach(() => { global.fetch = realFetch; if (server) { server.close(); server = null; } });

function startApp(callToolImpl = async () => ({ ok: true })) {
  const rolesBus = new RolesBus();
  const manager = new ProductionAssistantManager(db, rolesBus);
  const toolsContext = { tools: FAKE_TOOLS, callTool: callToolImpl };
  const agent = makeFakeAgent();
  const app = express();
  app.use(express.json());
  app.use('/roles/assistant', createProductionAssistantRouter(db, sessionAuth, toolsContext, manager, rolesBus, agent));
  return new Promise((resolve) => {
    server = createServer(app);
    server.listen(0, () => { baseUrl = `http://localhost:${server.address().port}`; resolve({ manager, rolesBus }); });
  });
}

function bearer(tok = token) { return { Authorization: `Bearer ${tok}` }; }

function mockPresetProposal() {
  global.fetch = async (url, init) => {
    if (typeof url === 'string' && url.includes('api.test')) {
      return {
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              role: 'assistant', content: 'Switching camera.',
              tool_calls: [{ id: 'c1', function: { name: 'camera.preset', arguments: '{"cameraId":"cam1","presetId":"wide"}' } }],
            },
          }],
        }),
      };
    }
    return realFetch(url, init);
  };
}

describe('POST /roles/assistant/prompt', () => {
  it('503s when the role is not enabled', async () => {
    await startApp();
    const res = await fetch(`${baseUrl}/roles/assistant/prompt`, {
      method: 'POST', headers: { ...bearer(), 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'hi' }),
    });
    assert.equal(res.status, 503);
  });

  it('queues a suggestion in confirm mode (default) without calling the tool', async () => {
    setRoleConfig(db, 'key1', 'assistant', { enabled: true, providerId, modelName: 'gpt-4o-mini' });
    mockPresetProposal();
    let called = false;
    await startApp(async () => { called = true; return { ok: true }; });
    const res = await fetch(`${baseUrl}/roles/assistant/prompt`, {
      method: 'POST', headers: { ...bearer(), 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'camera looks off' }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.ok(body.suggestion);
    assert.equal(called, false);

    const list = await (await fetch(`${baseUrl}/roles/assistant/suggestions`, { headers: bearer() })).json();
    assert.equal(list.suggestions.length, 1);
  });
});

describe('confirm/reject suggestions', () => {
  it('confirm executes the tool and clears the queue', async () => {
    setRoleConfig(db, 'key1', 'assistant', { enabled: true, providerId, modelName: 'gpt-4o-mini' });
    mockPresetProposal();
    let called = false;
    await startApp(async () => { called = true; return { ok: true }; });
    await fetch(`${baseUrl}/roles/assistant/prompt`, {
      method: 'POST', headers: { ...bearer(), 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'x' }),
    });
    const { suggestions } = await (await fetch(`${baseUrl}/roles/assistant/suggestions`, { headers: bearer() })).json();
    const id = suggestions[0].id;

    const res = await fetch(`${baseUrl}/roles/assistant/suggestions/${id}/confirm`, { method: 'POST', headers: bearer() });
    assert.equal(res.status, 200);
    assert.equal(called, true);
    const after = await (await fetch(`${baseUrl}/roles/assistant/suggestions`, { headers: bearer() })).json();
    assert.equal(after.suggestions.length, 0);
  });

  it('404s confirming/rejecting an unknown suggestion id', async () => {
    setRoleConfig(db, 'key1', 'assistant', { enabled: true, providerId, modelName: 'gpt-4o-mini' });
    await startApp();
    const res1 = await fetch(`${baseUrl}/roles/assistant/suggestions/nope/confirm`, { method: 'POST', headers: bearer() });
    assert.equal(res1.status, 404);
    const res2 = await fetch(`${baseUrl}/roles/assistant/suggestions/nope/reject`, { method: 'POST', headers: bearer() });
    assert.equal(res2.status, 404);
  });

  it('reject removes without executing', async () => {
    setRoleConfig(db, 'key1', 'assistant', { enabled: true, providerId, modelName: 'gpt-4o-mini' });
    mockPresetProposal();
    let called = false;
    await startApp(async () => { called = true; return { ok: true }; });
    await fetch(`${baseUrl}/roles/assistant/prompt`, {
      method: 'POST', headers: { ...bearer(), 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'x' }),
    });
    const { suggestions } = await (await fetch(`${baseUrl}/roles/assistant/suggestions`, { headers: bearer() })).json();
    const res = await fetch(`${baseUrl}/roles/assistant/suggestions/${suggestions[0].id}/reject`, { method: 'POST', headers: bearer() });
    assert.equal(res.status, 200);
    assert.equal(called, false);
  });
});

describe('auth requirements', () => {
  it('every route requires session auth', async () => {
    await startApp();
    const routes = [
      ['POST', '/roles/assistant/prompt'],
      ['GET', '/roles/assistant/suggestions'],
      ['POST', '/roles/assistant/suggestions/x/confirm'],
      ['POST', '/roles/assistant/suggestions/x/reject'],
      ['GET', '/roles/assistant/events'],
    ];
    for (const [method, path] of routes) {
      const res = await fetch(`${baseUrl}${path}`, { method, headers: { 'Content-Type': 'application/json' } });
      assert.equal(res.status, 401, `${method} ${path} should require auth`);
    }
  });
});
