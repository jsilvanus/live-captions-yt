/**
 * Route-level tests for the chat-driven-dialog agentic_chat roles
 * (POST /roles/:roleCode/message, GET /roles/:roleCode/events).
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
  console.log('# deps not available — skipping roles-chat route tests');
  process.exit(0);
}

import { runAiRolesMigrations, setRoleConfig } from '../src/ai-roles.js';
import { runProviderRegistryMigrations, createProvider } from '../src/provider-registry.js';
import { createRolesChatRouter } from '../src/routes/roles-chat.js';
import { RolesBus } from '../src/roles-bus.js';

const JWT_SECRET = 'test-roles-chat-secret';
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

const FAKE_TOOLS = [
  { name: 'camera.list', description: 'List cameras', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } },
  { name: 'camera.preset', description: 'Trigger preset', inputSchema: { type: 'object', properties: {} }, annotations: { destructiveHint: true } },
  { name: 'caption_target.create', description: 'Create target', inputSchema: { type: 'object', properties: {} }, annotations: {} },
];

function makeToolsContext(handlers = {}) {
  return {
    tools: FAKE_TOOLS,
    callTool: async (name, args, ctx) => {
      if (handlers[name]) return handlers[name](args, ctx);
      return { ok: true };
    },
  };
}

before(() => new Promise((resolve) => {
  db = new Database(':memory:');
  runAiRolesMigrations(db);
  runProviderRegistryMigrations(db);
  providerId = createProvider(db, {
    scope: 'site', kind: 'api', vendor: 'openai', name: 'Test provider', baseUrl: 'https://api.test', apiKeyRef: 'sk-test',
  }).id;
  token = jwt.sign({ sessionId: 's1', apiKey: 'key1' }, JWT_SECRET, { expiresIn: '1h' });
  resolve();
}));

after(() => db.close());
afterEach(() => { global.fetch = realFetch; if (server) { server.close(); server = null; } });

function startApp(toolsContext) {
  const rolesBus = new RolesBus();
  const app = express();
  app.use(express.json());
  app.use('/roles', createRolesChatRouter(db, sessionAuth, toolsContext, rolesBus));
  return new Promise((resolve) => {
    server = createServer(app);
    server.listen(0, () => { baseUrl = `http://localhost:${server.address().port}`; resolve({ rolesBus }); });
  });
}

function bearer(tok = token) {
  return { Authorization: `Bearer ${tok}` };
}

// global.fetch is shared with the test's own calls to the local test server —
// only intercept requests to the fake chat-completions endpoint, pass
// everything else (including our own `fetch(baseUrl + ...)` calls) through.
function mockChat(responder) {
  global.fetch = async (url, init) => {
    if (typeof url === 'string' && url.includes('api.test')) {
      const body = JSON.parse(init.body);
      return { ok: true, json: async () => ({ choices: [{ message: responder(body) }] }) };
    }
    return realFetch(url, init);
  };
}

describe('POST /roles/:roleCode/message', () => {
  it('404s for an unknown or non-chat-dialog role', async () => {
    await startApp(makeToolsContext());
    const res1 = await fetch(`${baseUrl}/roles/not-a-role/message`, {
      method: 'POST', headers: { ...bearer(), 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'hi' }),
    });
    assert.equal(res1.status, 404);
    const res2 = await fetch(`${baseUrl}/roles/planner/message`, {
      method: 'POST', headers: { ...bearer(), 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'hi' }),
    });
    assert.equal(res2.status, 404, 'planner is excluded from the generic chat-dialog route');
  });

  it('requires auth and a non-empty text field', async () => {
    await startApp(makeToolsContext());
    const noAuth = await fetch(`${baseUrl}/roles/setup_assistant/message`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'hi' }),
    });
    assert.equal(noAuth.status, 401);
    const noText = await fetch(`${baseUrl}/roles/setup_assistant/message`, {
      method: 'POST', headers: { ...bearer(), 'Content-Type': 'application/json' }, body: JSON.stringify({}),
    });
    assert.equal(noText.status, 400);
  });

  it('503s when the role is not enabled', async () => {
    await startApp(makeToolsContext());
    const res = await fetch(`${baseUrl}/roles/setup_assistant/message`, {
      method: 'POST', headers: { ...bearer(), 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'hi' }),
    });
    assert.equal(res.status, 503);
  });

  it('503s when the configured provider is unresolvable', async () => {
    setRoleConfig(db, 'key1', 'setup_assistant', { enabled: true, providerId: 'no-such-provider', modelName: 'gpt-4o-mini' });
    await startApp(makeToolsContext());
    const res = await fetch(`${baseUrl}/roles/setup_assistant/message`, {
      method: 'POST', headers: { ...bearer(), 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'hi' }),
    });
    assert.equal(res.status, 503);
  });

  it('runs a full turn and returns the reply when no tools are held back', async () => {
    setRoleConfig(db, 'key1', 'setup_assistant', { enabled: true, providerId, modelName: 'gpt-4o-mini' });
    mockChat(() => ({ role: 'assistant', content: 'Here is your setup.' }));
    await startApp(makeToolsContext());
    const res = await fetch(`${baseUrl}/roles/setup_assistant/message`, {
      method: 'POST', headers: { ...bearer(), 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'help me set up' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.reply, 'Here is your setup.');
    assert.deepEqual(body.pendingActions, []);
  });

  it('returns pendingActions for a destructive tool call in confirm mode (the default)', async () => {
    setRoleConfig(db, 'key1', 'setup_assistant', { enabled: true, providerId, modelName: 'gpt-4o-mini', harnessConfig: {} });
    let call = 0;
    mockChat(() => {
      call++;
      return { role: 'assistant', content: 'Triggering preset', tool_calls: [{ id: 'c1', function: { name: 'camera.preset', arguments: '{}' } }] };
    });
    await startApp(makeToolsContext());
    const res = await fetch(`${baseUrl}/roles/setup_assistant/message`, {
      method: 'POST', headers: { ...bearer(), 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'go home' }),
    });
    const body = await res.json();
    assert.equal(body.pendingActions.length, 1);
    assert.equal(body.pendingActions[0].name, 'camera.preset');
  });

  it('executes a non-destructive mutating tool directly in auto mode', async () => {
    setRoleConfig(db, 'key1', 'setup_assistant', {
      enabled: true, providerId, modelName: 'gpt-4o-mini',
      harnessConfig: { mode: 'auto', autoConfirmed: true },
    });
    let executed = false;
    mockChat((body) => {
      const hasToolResult = body.messages.some((m) => m.role === 'tool');
      if (hasToolResult) return { role: 'assistant', content: 'Created it.' };
      return { role: 'assistant', content: null, tool_calls: [{ id: 'c1', function: { name: 'caption_target.create', arguments: '{"type":"youtube"}' } }] };
    });
    await startApp(makeToolsContext({ 'caption_target.create': () => { executed = true; return { ok: true }; } }));
    const res = await fetch(`${baseUrl}/roles/setup_assistant/message`, {
      method: 'POST', headers: { ...bearer(), 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'add a youtube target' }),
    });
    const body = await res.json();
    assert.equal(executed, true);
    assert.equal(body.ok, true);
    assert.equal(body.reply, 'Created it.');
  });

  it("uses harnessConfig.toolAllowlist to narrow the role's default tool set", async () => {
    setRoleConfig(db, 'key1', 'dsk_designer', { enabled: true, providerId, modelName: 'gpt-4o-mini', harnessConfig: { toolAllowlist: ['camera.list'] } });
    let sentTools = null;
    mockChat((body) => { sentTools = body.tools; return { role: 'assistant', content: 'ok' }; });
    await startApp(makeToolsContext());
    await fetch(`${baseUrl}/roles/dsk_designer/message`, {
      method: 'POST', headers: { ...bearer(), 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'hi' }),
    });
    assert.deepEqual(sentTools.map((t) => t.function.name), ['camera.list']);
  });
});

describe('GET /roles/:roleCode/events', () => {
  it('404s for an unknown role and 401s without auth', async () => {
    await startApp(makeToolsContext());
    const noAuth = await fetch(`${baseUrl}/roles/setup_assistant/events`);
    assert.equal(noAuth.status, 401);
    const badRole = await fetch(`${baseUrl}/roles/not-a-role/events`, { headers: bearer() });
    assert.equal(badRole.status, 404);
  });
});
