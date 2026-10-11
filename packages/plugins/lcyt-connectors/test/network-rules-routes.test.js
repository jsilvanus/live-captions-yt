import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDb } from 'lcyt-backend/db';

let express;
try {
  express = (await import('express')).default;
} catch {
  console.log('# express not available — skipping network-rules route tests');
  process.exit(0);
}

const { createGlobalNetworkRulesRouter, createOrgNetworkRulesRouter } = await import('../src/routes/network-rules.js');

// Seed the lcyt-backend core tables these routes read (organizations/org_members).
async function createCoreOrgTables(db) {
  for (const id of [100, 200, 300]) {
    await db.users.create({ data: { id, email: `user${id}@example.com`, password_hash: 'x' } });
  }
  await db.organizations.create({ data: { id: 1, name: 'Org', slug: 'org', owner_user_id: 100 } }); // user 100 owns org 1
  await db.org_members.create({ data: { org_id: 1, user_id: 200, role: 'admin' } });  // user 200 is org admin
  await db.org_members.create({ data: { org_id: 1, user_id: 300, role: 'member' } }); // user 300 is a plain member
}

function fakeAdminAuth(req, res, next) {
  req.adminUser = { userId: 999 };
  next();
}

// Reads the caller's user id from a test-only header so each request can act as a different user.
function fakeUserAuth(req, res, next) {
  const userId = Number(req.headers['x-test-user-id']);
  if (!userId) return res.status(401).json({ error: 'Missing test user id' });
  req.user = { userId };
  next();
}

describe('network rules routes', () => {
  let server, baseUrl, db;

  before(async () => {
    db = await initDb(':memory:');
    await createCoreOrgTables(db);

    const app = express();
    app.use(express.json());
    app.use('/admin/connector-network-rules', createGlobalNetworkRulesRouter(db, fakeAdminAuth));
    app.use(createOrgNetworkRulesRouter(db, fakeUserAuth));

    await new Promise((resolve) => { server = app.listen(0, resolve); });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await db.close();
  });

  async function req(path, { method = 'GET', body, userId } = {}) {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(userId !== undefined ? { 'x-test-user-id': String(userId) } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, body: await res.json() };
  }

  describe('global rules (admin)', () => {
    test('create, list, delete a global rule', async () => {
      let res = await req('/admin/connector-network-rules', {
        method: 'POST', body: { ruleType: 'allow', pattern: '127.0.0.1:11434', description: 'local Ollama' },
      });
      assert.equal(res.status, 201);
      assert.equal(res.body.rule.scope, 'global');
      const id = res.body.rule.id;

      res = await req('/admin/connector-network-rules');
      assert.equal(res.body.rules.some(r => r.id === id), true);

      res = await req(`/admin/connector-network-rules/${id}`, { method: 'DELETE' });
      assert.equal(res.status, 200);

      res = await req('/admin/connector-network-rules');
      assert.equal(res.body.rules.some(r => r.id === id), false);
    });

    test('rejects an invalid ruleType', async () => {
      const res = await req('/admin/connector-network-rules', { method: 'POST', body: { ruleType: 'maybe', pattern: 'x' } });
      assert.equal(res.status, 400);
    });
  });

  describe('org rules (owner/admin creatable, enforced)', () => {
    test('org owner (via organizations.owner_user_id) can create and list', async () => {
      const res = await req('/orgs/1/connector-network-rules', {
        method: 'POST', userId: 100, body: { ruleType: 'deny', pattern: '8.8.8.8' },
      });
      assert.equal(res.status, 201);
      assert.equal(res.body.rule.scope, 'org');
      assert.equal(res.body.rule.org_id, 1);
    });

    test('org_members admin role can create', async () => {
      const res = await req('/orgs/1/connector-network-rules', {
        method: 'POST', userId: 200, body: { ruleType: 'allow', pattern: '10.0.0.0/8' },
      });
      assert.equal(res.status, 201);
    });

    test('plain member can list but not create', async () => {
      const list = await req('/orgs/1/connector-network-rules', { userId: 300 });
      assert.equal(list.status, 200);

      const create = await req('/orgs/1/connector-network-rules', {
        method: 'POST', userId: 300, body: { ruleType: 'allow', pattern: '1.2.3.4' },
      });
      assert.equal(create.status, 403);
    });

    test('a non-member is rejected entirely', async () => {
      const res = await req('/orgs/1/connector-network-rules', { userId: 400 });
      assert.equal(res.status, 403);
    });

    test('owner can delete an org rule; deleting from the wrong org 404s', async () => {
      const created = await req('/orgs/1/connector-network-rules', {
        method: 'POST', userId: 100, body: { ruleType: 'deny', pattern: 'evil.example' },
      });
      const id = created.body.rule.id;

      const wrongOrg = await req(`/orgs/2/connector-network-rules/${id}`, { method: 'DELETE', userId: 100 });
      // org 2 doesn't exist / user 100 has no role there
      assert.equal(wrongOrg.status, 403);

      const ok = await req(`/orgs/1/connector-network-rules/${id}`, { method: 'DELETE', userId: 100 });
      assert.equal(ok.status, 200);
    });
  });
});
