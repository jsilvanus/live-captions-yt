/**
 * Integration-level regression test for the real mount order used by
 * lcyt-backend/src/server.js: createRolesRouter + createRolesChatRouter
 * mounted at '/roles', then createProductionAssistantRouter mounted at
 * '/roles/assistant'.
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
import { createVisionRolesRouter } from '../src/routes/vision-roles.js';
import { ProductionAssistantManager } from '../src/production-assistant.js';
import { VisionRoleManager } from '../src/vision-role-manager.js';
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
  const visionManager = new VisionRoleManager(rolesBus);
  const toolsContext = { tools: [], callTool: async () => ({ ok: true }) };
  const agent = { addContext() {}, getContext: () => [] };

  const app = express();
  app.use(express.json());
  // Exact mount order from lcyt-backend/src/server.js:
  app.use('/roles', createRolesRouter(db, sessionAuth));
  app.use('/roles', createRolesChatRouter(db, sessionAuth, toolsContext, rolesBus));
  app.use('/roles', createVisionRolesRouter(db, sessionAuth, visionManager));
  app.use('/roles/assistant', createProductionAssistantRouter(db, sessionAuth, toolsContext, manager, agent));

  server = createServer(app);
  server.listen(0, () => { baseUrl = `http://localhost:${server.address().port}`; resolve(); });
}));

after(() => new Promise((resolve) => { db.close(); server.close(resolve); }));

function bearer(tok = token) { return { Authorization: `Bearer ${tok}` }; }

describe('GET /roles/assistant/events through the real mount stack', () => {
  it('is retired and 404s', async () => {
    const res = await fetch(`${baseUrl}/roles/assistant/events`, { headers: bearer() });
    assert.equal(res.status, 404);
  });

  it('still requires auth', async () => {
    const res = await fetch(`${baseUrl}/roles/assistant/events`);
    assert.equal(res.status, 401);
  });
});

describe('GET /roles/setup_assistant/events', () => {
  it('is retired and 404s', async () => {
    const res = await fetch(`${baseUrl}/roles/setup_assistant/events`, { headers: bearer() });
    assert.equal(res.status, 404);
  });
});

describe('GET /roles/planner/events', () => {
  it('404s', async () => {
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

describe('vision roles reachable alongside chat-dialog/assistant routes', () => {
  it('GET /roles/tracker/events is retired and 404s', async () => {
    const res = await fetch(`${baseUrl}/roles/tracker/events`, { headers: bearer() });
    assert.equal(res.status, 404);
  });

  it('GET /roles/describer/events is retired and 404s', async () => {
    const res = await fetch(`${baseUrl}/roles/describer/events`, { headers: bearer() });
    assert.equal(res.status, 404);
  });

  it('POST /roles/tracker/start reaches vision-roles.js, not roles-chat.js', async () => {
    // Role isn't enabled in this test's db — a 503 here (not a 404) proves
    // the request reached vision-roles.js's own handler.
    const res = await fetch(`${baseUrl}/roles/tracker/start`, { method: 'POST', headers: bearer() });
    assert.equal(res.status, 503);
  });

  it('GET /roles/tracker/status reaches vision-roles.js, not roles.js\'s GET /:roleCode/config', async () => {
    const res = await fetch(`${baseUrl}/roles/tracker/status`, { headers: bearer() });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.running, false);
  });
});
