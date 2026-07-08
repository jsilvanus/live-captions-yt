import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert';
import { createServer } from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import { initDb } from '../src/db.js';
import { createOrganizationsRouter } from '../src/routes/orgs.js';
import { createUserAuthMiddleware } from '../src/middleware/user-auth.js';
import { createUser } from '../src/db/users.js';

const JWT_SECRET = 'test-org-secret';
let server;
let baseUrl;
let db;
let userAuth;
let userA;
let userB;

function makeToken(user) {
  return jwt.sign({ type: 'user', userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '1h' });
}

before(() => new Promise(resolve => {
  db = initDb(':memory:');
  userAuth = createUserAuthMiddleware(JWT_SECRET);

  const app = express();
  app.use(express.json());
  app.use('/orgs', createOrganizationsRouter(db, userAuth, { loginEnabled: true }));

  server = createServer(app);
  server.listen(0, () => {
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    resolve();
  });
}));

after(() => new Promise(resolve => {
  db.close();
  server.close(resolve);
}));

beforeEach(() => {
  db.prepare('DELETE FROM org_feature_overrides').run();
  db.prepare('DELETE FROM org_members').run();
  db.prepare('DELETE FROM organizations').run();
  db.prepare('DELETE FROM api_keys').run();
  db.prepare('DELETE FROM users').run();
  userA = createUser(db, { email: 'owner@example.com', passwordHash: 'hash', name: 'Owner' });
  userB = createUser(db, { email: 'member@example.com', passwordHash: 'hash', name: 'Member' });
});

describe('Organizations routes', () => {
  it('creates a team and owner membership', async () => {
    const res = await fetch(`${baseUrl}/orgs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${makeToken(userA)}`,
      },
      body: JSON.stringify({ name: 'Broadcast Team' }),
    });

    const data = await res.json();
    assert.strictEqual(res.status, 201);
    assert.strictEqual(data.organization.name, 'Broadcast Team');
    assert.strictEqual(data.organization.slug, 'broadcast-team');
  });

  it('invites members and updates roles', async () => {
    const createRes = await fetch(`${baseUrl}/orgs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${makeToken(userA)}`,
      },
      body: JSON.stringify({ name: 'Broadcast Team' }),
    });
    const created = await createRes.json();

    const inviteRes = await fetch(`${baseUrl}/orgs/${created.organization.id}/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${makeToken(userA)}`,
      },
      body: JSON.stringify({ email: userB.email, role: 'editor' }),
    });
    const invited = await inviteRes.json();
    assert.strictEqual(inviteRes.status, 201);
    assert.strictEqual(invited.member.role, 'editor');

    const updateRes = await fetch(`${baseUrl}/orgs/${created.organization.id}/members/${userB.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${makeToken(userA)}`,
      },
      body: JSON.stringify({ role: 'admin' }),
    });
    const updated = await updateRes.json();
    assert.strictEqual(updateRes.status, 200);
    assert.strictEqual(updated.member.role, 'admin');
  });

  it('stores team feature defaults', async () => {
    const createRes = await fetch(`${baseUrl}/orgs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${makeToken(userA)}`,
      },
      body: JSON.stringify({ name: 'Defaults Team' }),
    });
    const created = await createRes.json();

    const defaultsRes = await fetch(`${baseUrl}/orgs/${created.organization.id}/features`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${makeToken(userA)}`,
      },
      body: JSON.stringify({ features: ['captions', 'translations'] }),
    });
    const defaults = await defaultsRes.json();
    assert.strictEqual(defaultsRes.status, 200);
    assert.deepStrictEqual(defaults.features, ['captions', 'translations']);
  });

  it('returns project counts for org members', async () => {
    const createRes = await fetch(`${baseUrl}/orgs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${makeToken(userA)}`,
      },
      body: JSON.stringify({ name: 'Member Count Team' }),
    });
    const created = await createRes.json();

    db.prepare('INSERT INTO api_keys (key, owner, org_id) VALUES (?, ?, ?)').run('counted-project', 'Counted Project', created.organization.id);
    db.prepare('INSERT INTO project_members (api_key, user_id, access_level, invited_by) VALUES (?, ?, ?, ?)').run('counted-project', userB.id, 'member', userA.id);

    const membersRes = await fetch(`${baseUrl}/orgs/${created.organization.id}/members`, {
      headers: { Authorization: `Bearer ${makeToken(userA)}` },
    });
    const membersData = await membersRes.json();

    assert.strictEqual(membersRes.status, 200);
    assert.strictEqual(membersData.members[0].projectCount, 1);
  });
});
