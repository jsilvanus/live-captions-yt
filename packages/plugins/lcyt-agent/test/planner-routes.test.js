/**
 * Route-level tests for Planner Assistant (POST /roles/planner/assist),
 * which supersedes the old POST /agent/generate-rundown / edit-rundown.
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
  console.log('# deps not available — skipping planner route tests');
  process.exit(0);
}

import { runAiRolesMigrations, setRoleConfig } from '../src/ai-roles.js';
import { runProviderRegistryMigrations, createProvider } from '../src/provider-registry.js';
import { runMigrations as runAgentDbMigrations } from '../src/db.js';
import { runAiMigrations } from '../src/ai-config.js';
import { AgentEngine } from '../src/agent-engine.js';
import { createPlannerRouter } from '../src/routes/planner.js';

const JWT_SECRET = 'test-planner-secret';
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

before(() => {
  db = new Database(':memory:');
  runAgentDbMigrations(db);
  runAiMigrations(db);
  runAiRolesMigrations(db);
  runProviderRegistryMigrations(db);
  providerId = createProvider(db, {
    scope: 'site', kind: 'api', vendor: 'openai', name: 'Test provider', baseUrl: 'https://api.test', apiKeyRef: 'sk-test',
  }).id;
  token = jwt.sign({ sessionId: 's1', apiKey: 'key1' }, JWT_SECRET, { expiresIn: '1h' });
});

after(() => db.close());
afterEach(() => { global.fetch = realFetch; if (server) { server.close(); server = null; } });

function startApp() {
  const agent = new AgentEngine(db);
  const app = express();
  app.use(express.json());
  app.use('/roles/planner', createPlannerRouter(db, sessionAuth, agent));
  return new Promise((resolve) => {
    server = createServer(app);
    server.listen(0, () => { baseUrl = `http://localhost:${server.address().port}`; resolve(); });
  });
}

function bearer(tok = token) { return { Authorization: `Bearer ${tok}` }; }

function mockChat(responder) {
  global.fetch = async (url, init) => {
    if (typeof url === 'string' && url.includes('api.test')) {
      const body = JSON.parse(init.body);
      return { ok: true, json: async () => ({ choices: [{ message: { content: responder(body) } }] }) };
    }
    return realFetch(url, init);
  };
}

describe('POST /roles/planner/assist', () => {
  it('requires auth and a non-empty goal', async () => {
    await startApp();
    const noAuth = await fetch(`${baseUrl}/roles/planner/assist`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ goal: 'x' }),
    });
    assert.equal(noAuth.status, 401);
    const noGoal = await fetch(`${baseUrl}/roles/planner/assist`, {
      method: 'POST', headers: { ...bearer(), 'Content-Type': 'application/json' }, body: JSON.stringify({}),
    });
    assert.equal(noGoal.status, 400);
  });

  it('503s when the role is not enabled', async () => {
    await startApp();
    const res = await fetch(`${baseUrl}/roles/planner/assist`, {
      method: 'POST', headers: { ...bearer(), 'Content-Type': 'application/json' }, body: JSON.stringify({ goal: 'A church service' }),
    });
    assert.equal(res.status, 503);
  });

  it('503s when the configured provider is unresolvable', async () => {
    setRoleConfig(db, 'key1', 'planner', { enabled: true, providerId: 'no-such-provider', modelName: 'gpt-4o-mini' });
    await startApp();
    const res = await fetch(`${baseUrl}/roles/planner/assist`, {
      method: 'POST', headers: { ...bearer(), 'Content-Type': 'application/json' }, body: JSON.stringify({ goal: 'x' }),
    });
    assert.equal(res.status, 503);
  });

  it('generates from scratch when currentPlan is omitted', async () => {
    setRoleConfig(db, 'key1', 'planner', { enabled: true, providerId, modelName: 'gpt-4o-mini' });
    mockChat(() => '<!-- section: Welcome -->\nWelcome everyone.');
    await startApp();
    const res = await fetch(`${baseUrl}/roles/planner/assist`, {
      method: 'POST', headers: { ...bearer(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ goal: 'A church service' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.match(body.content, /Welcome everyone/);
  });

  it('edits the existing plan when currentPlan is present', async () => {
    setRoleConfig(db, 'key1', 'planner', { enabled: true, providerId, modelName: 'gpt-4o-mini' });
    let sentUserPrompt = null;
    mockChat((body) => { sentUserPrompt = body.messages[1].content; return 'Edited rundown text'; });
    await startApp();
    const res = await fetch(`${baseUrl}/roles/planner/assist`, {
      method: 'POST', headers: { ...bearer(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPlan: 'Original rundown', goal: 'Add a pause' }),
    });
    const body = await res.json();
    assert.equal(body.content, 'Edited rundown text');
    assert.match(sentUserPrompt, /Original rundown/);
    assert.match(sentUserPrompt, /Add a pause/);
  });

  it('an empty-string currentPlan is treated as generate-from-scratch, not edit', async () => {
    setRoleConfig(db, 'key1', 'planner', { enabled: true, providerId, modelName: 'gpt-4o-mini' });
    let sentSystemPrompt = null;
    mockChat((body) => { sentSystemPrompt = body.messages[0].content; return 'Generated'; });
    await startApp();
    await fetch(`${baseUrl}/roles/planner/assist`, {
      method: 'POST', headers: { ...bearer(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPlan: '', goal: 'A concert' }),
    });
    assert.match(sentSystemPrompt, /script writer/);
  });

  it('threads harnessConfig.systemPromptOverride into the system prompt', async () => {
    setRoleConfig(db, 'key1', 'planner', {
      enabled: true, providerId, modelName: 'gpt-4o-mini',
      harnessConfig: { systemPromptOverride: 'Always write in Finnish.' },
    });
    let sentSystemPrompt = null;
    mockChat((body) => { sentSystemPrompt = body.messages[0].content; return 'ok'; });
    await startApp();
    await fetch(`${baseUrl}/roles/planner/assist`, {
      method: 'POST', headers: { ...bearer(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ goal: 'x' }),
    });
    assert.match(sentSystemPrompt, /Always write in Finnish/);
  });

  it('uses harnessConfig.defaultTemplateId when templateId is omitted from the request', async () => {
    setRoleConfig(db, 'key1', 'planner', {
      enabled: true, providerId, modelName: 'gpt-4o-mini',
      harnessConfig: { defaultTemplateId: 'church_service' },
    });
    let sentUserPrompt = null;
    mockChat((body) => { sentUserPrompt = body.messages[1].content; return 'ok'; });
    await startApp();
    await fetch(`${baseUrl}/roles/planner/assist`, {
      method: 'POST', headers: { ...bearer(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ goal: 'Customise for Easter' }),
    });
    assert.match(sentUserPrompt, /Starting from this template/);
  });
});
