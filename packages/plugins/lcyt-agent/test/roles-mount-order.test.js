/**
 * Integration-level regression test for the real mount order used by
 * lcyt-backend/src/server.js: createRolesRouter + createRolesChatRouter
 * mounted at '/roles', then createProductionAssistantRouter mounted at
 * '/roles/assistant'.
 *
 * This exists because a unit test of createProductionAssistantRouter in
 * isolation (production-assistant-routes.test.js) can't catch an Express
 * routing collision: roles-chat.js's GET /:roleCode/events matches ANY
 * request of the shape /roles/<x>/events, including /roles/assistant/events
 * — and since it's mounted first, it would intercept that request before
 * production-assistant.js's own (now-removed) /events route ever ran. Only
 * mounting both routers together, in the same order server.js uses, proves
 * the real wiring works.
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
  console.log('# deps not available — skipping roles mount-order test');
  process.exit(0);
}

import { runAiRolesMigrations } from '../src/ai-roles.js';
import { runProviderRegistryMigrations } from '../src/provider-registry.js';
import { createRolesRouter } from '../src/routes/roles.js';
import { createRolesChatRouter } from '../src/routes/roles-chat.js';
import { createProductionAssistantRouter } from '../src/routes/production-assistant.js';
import { ProductionAssistantManager } from '../src/production-assistant.js';
import { RolesBus } from '../src/roles-bus.js';

const JWT_SECRET = 'test-mount-order-secret';
let server, baseUrl, db, token;

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
  runProviderRegistryMigrations(db);
  token = jwt.sign({ sessionId: 's1', apiKey: 'key1' }, JWT_SECRET, { expiresIn: '1h' });

  const rolesBus = new RolesBus();
  const manager = new ProductionAssistantManager(db, rolesBus);
  const toolsContext = { tools: [], callTool: async () => ({ ok: true }) };
  const agent = { addContext() {}, getContext: () => [] };

  const app = express();
  app.use(express.json());
  // Exact mount order from lcyt-backend/src/server.js:
  app.use('/roles', createRolesRouter(db, sessionAuth));
  app.use('/roles', createRolesChatRouter(db, sessionAuth, toolsContext, rolesBus));
  app.use('/roles/assistant', createProductionAssistantRouter(db, sessionAuth, toolsContext, manager, agent));

  server = createServer(app);
  server.listen(0, () => { baseUrl = `http://localhost:${server.address().port}`; resolve(); });
}));

after(() => new Promise((resolve) => { db.close(); server.close(resolve); }));

function bearer(tok = token) { return { Authorization: `Bearer ${tok}` }; }

describe('GET /roles/assistant/events through the real mount stack', () => {
  it('reaches roles-chat.js\'s generic events route rather than 404ing', async () => {
    const res = await fetch(`${baseUrl}/roles/assistant/events`, { headers: bearer() });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /^text\/event-stream/);
    res.body?.cancel?.();
  });

  it('still requires auth', async () => {
    const res = await fetch(`${baseUrl}/roles/assistant/events`);
    assert.equal(res.status, 401);
  });
});

describe('GET /roles/setup_assistant/events (a chat-dialog role) still works alongside assistant', () => {
  it('200s with an event-stream', async () => {
    const res = await fetch(`${baseUrl}/roles/setup_assistant/events`, { headers: bearer() });
    assert.equal(res.status, 200);
    res.body?.cancel?.();
  });
});

describe('GET /roles/planner/events', () => {
  it('404s — Planner never streams', async () => {
    const res = await fetch(`${baseUrl}/roles/planner/events`, { headers: bearer() });
    assert.equal(res.status, 404);
  });
});

describe('GET /roles/no-such-role/events', () => {
  it('404s for a role code that does not exist in the catalog', async () => {
    const res = await fetch(`${baseUrl}/roles/no-such-role/events`, { headers: bearer() });
    assert.equal(res.status, 404);
  });
});

describe('other assistant routes still reachable under the shared /roles prefix', () => {
  it('POST /roles/assistant/prompt reaches production-assistant.js, not roles-chat.js', async () => {
    // If this were misrouted to roles-chat's POST /:roleCode/message (it
    // isn't — different path segment, "prompt" vs "message" — this is a
    // belt-and-suspenders check), it would 503 for a different reason
    // (no provider configured) rather than succeed with a fake tools context.
    const res = await fetch(`${baseUrl}/roles/assistant/prompt`, {
      method: 'POST', headers: { ...bearer(), 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'hi' }),
    });
    // Role isn't enabled in this test's db, so 503 is expected — the point
    // is that it's THIS router's 503 (role not enabled), proving the
    // request reached production-assistant.js's own handler.
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.match(body.error, /not enabled/);
  });
});
