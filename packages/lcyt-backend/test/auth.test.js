/**
 * Tests for the /auth router (register, login, me, change-password).
 *
 * Uses an in-memory SQLite database so no persistent state is needed.
 * Bcrypt rounds are reduced to 1 in tests to keep them fast — this is safe
 * because correctness (not security) is what we're verifying.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import { initDb } from '../src/db.js';
import { createKey } from '../src/db/keys.js';
import { addMember } from '../src/db/project-members.js';
import { createAuthRouter } from '../src/routes/auth.js';

// Reduce bcrypt rounds for speed — override the module-level constant via the
// fact that bcrypt.hash takes the rounds as a parameter (the router uses its
// own constant of 12). We accept slower tests (~0.5 s per hash) rather than
// patching internals. All tests share one registered user to amortise cost.

const JWT_SECRET = 'test-auth-secret';

let server, baseUrl, db;

before(() => new Promise((resolve) => {
  db = initDb(':memory:');

  const app = express();
  app.use(express.json());
  app.use('/auth', createAuthRouter(db, JWT_SECRET, { loginEnabled: true }));

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

// Helper — register a user and return the response body
async function register(email, password, name) {
  const res = await fetch(`${baseUrl}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name }),
  });
  return { status: res.status, body: await res.json() };
}

async function login(email, password) {
  const res = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return { status: res.status, body: await res.json() };
}

// ---------------------------------------------------------------------------
// Disabled logins
// ---------------------------------------------------------------------------

describe('/auth — loginEnabled: false', () => {
  let disabledServer, disabledUrl;

  before(() => new Promise((resolve) => {
    const app = express();
    app.use(express.json());
    app.use('/auth', createAuthRouter(db, JWT_SECRET, { loginEnabled: false }));
    disabledServer = createServer(app);
    disabledServer.listen(0, () => {
      disabledUrl = `http://localhost:${disabledServer.address().port}`;
      resolve();
    });
  }));

  after(() => new Promise(r => disabledServer.close(r)));

  it('returns 503 for any auth route', async () => {
    const res = await fetch(`${disabledUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.com', password: 'password123' }),
    });
    assert.equal(res.status, 503);
  });
});

// ---------------------------------------------------------------------------
// POST /auth/register
// ---------------------------------------------------------------------------

describe('POST /auth/register', () => {
  it('returns 400 when email is missing', async () => {
    const { status, body } = await register('', 'password123');
    assert.equal(status, 400);
    assert.ok(body.error);
  });

  it('returns 400 when password is too short', async () => {
    const { status, body } = await register('test@example.com', 'short');
    assert.equal(status, 400);
    assert.ok(body.error.toLowerCase().includes('password'));
  });

  it('registers successfully and returns a JWT token', async () => {
    const { status, body } = await register('newuser@example.com', 'password123', 'Test User');
    assert.equal(status, 201);
    assert.ok(body.token, 'should return a JWT token');
    assert.ok(body.userId);
    assert.equal(body.email, 'newuser@example.com');
    assert.equal(body.name, 'Test User');

    // Verify it's a valid JWT
    const payload = jwt.verify(body.token, JWT_SECRET);
    assert.equal(payload.type, 'user');
    assert.equal(payload.email, 'newuser@example.com');
  });

  it('returns 409 when email already exists', async () => {
    await register('dup@example.com', 'password123');
    const { status, body } = await register('dup@example.com', 'password456');
    assert.equal(status, 409);
    assert.ok(body.error.toLowerCase().includes('exists'));
  });

  it('stores email in lowercase', async () => {
    const { status, body } = await register('Upper@Example.Com', 'password123');
    assert.equal(status, 201);
    assert.equal(body.email, 'upper@example.com');
  });
});

// ---------------------------------------------------------------------------
// POST /auth/login
// ---------------------------------------------------------------------------

describe('POST /auth/login', () => {
  before(async () => {
    // Create a known user for login tests
    await register('login-test@example.com', 'correctpassword');
  });

  it('returns 400 when email or password is missing', async () => {
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'login-test@example.com' }),
    });
    assert.equal(res.status, 400);
  });

  it('returns 401 for unknown email', async () => {
    const { status } = await login('nobody@example.com', 'password123');
    assert.equal(status, 401);
  });

  it('returns 401 for wrong password', async () => {
    const { status } = await login('login-test@example.com', 'wrongpassword');
    assert.equal(status, 401);
  });

  it('returns 200 with JWT for correct credentials', async () => {
    const { status, body } = await login('login-test@example.com', 'correctpassword');
    assert.equal(status, 200);
    assert.ok(body.token, 'should return a token');
    const payload = jwt.verify(body.token, JWT_SECRET);
    assert.equal(payload.type, 'user');
  });
});

// ---------------------------------------------------------------------------
// GET /auth/me
// ---------------------------------------------------------------------------

describe('POST /auth/project-token', () => {
  let userToken;
  let projectKey;

  before(async () => {
    const { body } = await register('project-token@example.com', 'password123', 'Project User');
    userToken = body.token;
    projectKey = createKey(db, { owner: 'Project User', user_id: body.userId }).key;
    addMember(db, projectKey, body.userId, 'owner');
  });

  it('issues a project-scoped token for a project member', async () => {
    const res = await fetch(`${baseUrl}/auth/project-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({ projectId: projectKey, projectRole: 'editor' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.projectId, projectKey);
    assert.equal(body.projectRole, 'editor');
    assert.ok(body.token);
  });

  it('rejects project-scoped token issuance for non-members', async () => {
    const res = await fetch(`${baseUrl}/auth/project-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({ projectId: 'not-a-project' }),
    });
    assert.equal(res.status, 403);
  });
});

describe('GET /auth/me', () => {
  let userToken;

  before(async () => {
    const { body } = await register('me-test@example.com', 'password123', 'Me User');
    userToken = body.token;
  });

  it('returns 401 without token', async () => {
    const res = await fetch(`${baseUrl}/auth/me`);
    assert.equal(res.status, 401);
  });

  it('returns 401 with a session token (wrong type)', async () => {
    const sessionToken = jwt.sign({ sessionId: 'sid', apiKey: 'ak', domain: 'https://t.com' }, JWT_SECRET);
    const res = await fetch(`${baseUrl}/auth/me`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    assert.equal(res.status, 401);
  });

  it('returns user profile with valid user token', async () => {
    const res = await fetch(`${baseUrl}/auth/me`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.email, 'me-test@example.com');
    assert.equal(body.name, 'Me User');
    assert.ok(body.userId);
    assert.ok(body.createdAt);
    assert.equal(body.password_hash, undefined, 'must not expose password hash');
  });
});

// ---------------------------------------------------------------------------
// PATCH /auth/me
// ---------------------------------------------------------------------------

describe('PATCH /auth/me', () => {
  let userToken;

  before(async () => {
    const { body } = await register('patch-me-test@example.com', 'password123', 'Original Name');
    userToken = body.token;
  });

  it('returns 401 without token', async () => {
    const res = await fetch(`${baseUrl}/auth/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Name' }),
    });
    assert.equal(res.status, 401);
  });

  it('returns 400 when name is missing', async () => {
    const res = await fetch(`${baseUrl}/auth/me`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.error);
  });

  it('returns 400 when name is not a string', async () => {
    const res = await fetch(`${baseUrl}/auth/me`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({ name: 12345 }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.error);
  });

  it('returns 400 when name is empty after trimming', async () => {
    const res = await fetch(`${baseUrl}/auth/me`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({ name: '   ' }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.error);
  });

  it('updates the name successfully and returns the /auth/me response shape', async () => {
    const res = await fetch(`${baseUrl}/auth/me`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({ name: '  Updated Name  ' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.name, 'Updated Name', 'name should be trimmed');
    assert.equal(body.email, 'patch-me-test@example.com');
    assert.ok(body.userId);
    assert.ok(body.createdAt);
    assert.equal(typeof body.isAdmin, 'boolean');
    assert.equal(body.password_hash, undefined, 'must not expose password hash');
  });

  it('GET /auth/me reflects the updated name afterward', async () => {
    const res = await fetch(`${baseUrl}/auth/me`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.name, 'Updated Name');
  });
});

// ---------------------------------------------------------------------------
// GET /auth/me/export
// ---------------------------------------------------------------------------

describe('GET /auth/me/export', () => {
  it('returns the current user export payload with projects and orgs', async () => {
    const { body } = await register('export-user@example.com', 'password123', 'Export User');
    const userId = body.userId;

    createKey(db, { key: 'export-project-key', owner: 'Export Project', email: 'export-user@example.com', user_id: userId });
    db.prepare('INSERT INTO project_features (api_key, feature_code, enabled) VALUES (?, ?, 1)').run('export-project-key', 'captions');

    const orgResult = db.prepare('INSERT INTO organizations (name, slug, owner_user_id) VALUES (?, ?, ?)').run('Export Org', 'export-org', userId);
    db.prepare('INSERT INTO org_members (org_id, user_id, role, invited_by) VALUES (?, ?, ?, ?)').run(orgResult.lastInsertRowid, userId, 'editor', userId);
    db.prepare('UPDATE api_keys SET org_id = ? WHERE key = ?').run(orgResult.lastInsertRowid, 'export-project-key');

    const res = await fetch(`${baseUrl}/auth/me/export`, {
      headers: { Authorization: `Bearer ${body.token}` },
    });

    assert.equal(res.status, 200);
    const exportBody = await res.json();
    assert.equal(exportBody.user.email, 'export-user@example.com');
    assert.equal(exportBody.projects.length, 1);
    assert.equal(exportBody.projects[0].key, 'export-project-key');
    assert.equal(exportBody.orgs.length, 1);
    assert.equal(exportBody.orgs[0].name, 'Export Org');
  });
});

// ---------------------------------------------------------------------------
// DELETE /auth/me/data
// ---------------------------------------------------------------------------

describe('DELETE /auth/me/data', () => {
  it('deletes owned projects but leaves unrelated shared projects intact', async () => {
    const { body } = await register('delete-data@example.com', 'password123', 'Delete Data');
    const userId = body.userId;

    createKey(db, { key: 'owned-project-key', owner: 'Owned Project', email: 'delete-data@example.com', user_id: userId });
    createKey(db, { key: 'shared-project-key', owner: 'Shared Project', email: 'shared@example.com' });
    db.prepare('INSERT INTO project_members (api_key, user_id, access_level, invited_by) VALUES (?, ?, ?, ?)').run('shared-project-key', userId, 'member', userId);

    const res = await fetch(`${baseUrl}/auth/me/data`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${body.token}` },
    });

    assert.equal(res.status, 200);
    const deleteBody = await res.json();
    assert.equal(deleteBody.deletedProjectCount, 1);
    assert.equal(db.prepare('SELECT key FROM api_keys WHERE key = ?').get('owned-project-key'), undefined);
    assert.ok(db.prepare('SELECT key FROM api_keys WHERE key = ?').get('shared-project-key'));
    assert.equal(db.prepare('SELECT COUNT(*) as count FROM project_members WHERE api_key = ? AND user_id = ?').get('shared-project-key', userId).count, 0);
  });
});

// ---------------------------------------------------------------------------
// DELETE /auth/me
// ---------------------------------------------------------------------------

describe('DELETE /auth/me', () => {
  it('deletes the account and removes the user row', async () => {
    const { body } = await register('delete-account@example.com', 'password123', 'Delete Account');

    const res = await fetch(`${baseUrl}/auth/me`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${body.token}` },
    });

    assert.equal(res.status, 200);
    const deleteBody = await res.json();
    assert.equal(deleteBody.deleted, true);
    assert.equal(db.prepare('SELECT id FROM users WHERE email = ?').get('delete-account@example.com'), undefined);
  });

  // `organizations.owner_user_id` is NOT NULL with no ON DELETE action, so a
  // user who owns an org (even solo) can't just be deleted out from under it
  // under live FK enforcement — deleteUserAccount() must resolve ownership
  // first. This route's own pre-check only blocks the "owns an org WITH
  // other members" case; a solo-owned org used to fall through to
  // deleteUserAccount() and throw SQLITE_CONSTRAINT_FOREIGNKEY.
  it('tears down an org this user solely owns, then deletes the account', async () => {
    const { body } = await register('solo-org-owner@example.com', 'password123', 'Solo Owner');
    const userId = body.userId;

    const orgResult = db.prepare('INSERT INTO organizations (name, slug, owner_user_id) VALUES (?, ?, ?)').run('Solo Org', 'solo-org', userId);
    const orgId = orgResult.lastInsertRowid;
    db.prepare("INSERT INTO org_members (org_id, user_id, role, invited_by) VALUES (?, ?, 'owner', ?)").run(orgId, userId, userId);
    createKey(db, { key: 'solo-org-project', owner: 'Solo Org Project', org_id: orgId });

    const res = await fetch(`${baseUrl}/auth/me`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${body.token}` },
    });

    assert.equal(res.status, 200);
    const deleteBody = await res.json();
    assert.equal(deleteBody.deleted, true);
    assert.equal(db.prepare('SELECT id FROM users WHERE email = ?').get('solo-org-owner@example.com'), undefined);
    assert.equal(db.prepare('SELECT id FROM organizations WHERE id = ?').get(orgId), undefined);
    // The org's project must survive, just detached — same "an org vanishing
    // must never delete/break its projects" convention as DELETE /orgs/:id.
    const project = db.prepare('SELECT org_id, active FROM api_keys WHERE key = ?').get('solo-org-project');
    assert.ok(project);
    assert.equal(project.org_id, null);
  });

  it('still blocks deletion when the user is sole owner of an org that has other members', async () => {
    const { body } = await register('blocked-org-owner@example.com', 'password123', 'Blocked Owner');
    const userId = body.userId;
    const otherUser = await register('other-member@example.com', 'password123', 'Other Member');

    const orgResult = db.prepare('INSERT INTO organizations (name, slug, owner_user_id) VALUES (?, ?, ?)').run('Shared Org', 'shared-org', userId);
    const orgId = orgResult.lastInsertRowid;
    db.prepare("INSERT INTO org_members (org_id, user_id, role, invited_by) VALUES (?, ?, 'owner', ?)").run(orgId, userId, userId);
    db.prepare("INSERT INTO org_members (org_id, user_id, role, invited_by) VALUES (?, ?, 'viewer', ?)").run(orgId, otherUser.body.userId, userId);

    const res = await fetch(`${baseUrl}/auth/me`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${body.token}` },
    });

    assert.equal(res.status, 409);
    assert.ok(db.prepare('SELECT id FROM users WHERE email = ?').get('blocked-org-owner@example.com'));
    assert.ok(db.prepare('SELECT id FROM organizations WHERE id = ?').get(orgId));
  });
});

// ---------------------------------------------------------------------------
// POST /auth/change-password
// ---------------------------------------------------------------------------

describe('POST /auth/change-password', () => {
  let userToken, userEmail;

  before(async () => {
    userEmail = 'chpw@example.com';
    const { body } = await register(userEmail, 'oldpassword123');
    userToken = body.token;
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await fetch(`${baseUrl}/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({ currentPassword: 'oldpassword123' }),
    });
    assert.equal(res.status, 400);
  });

  it('returns 400 when newPassword is too short', async () => {
    const res = await fetch(`${baseUrl}/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({ currentPassword: 'oldpassword123', newPassword: 'short' }),
    });
    assert.equal(res.status, 400);
  });

  it('returns 401 when currentPassword is wrong', async () => {
    const res = await fetch(`${baseUrl}/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({ currentPassword: 'wrongpassword', newPassword: 'newpassword123' }),
    });
    assert.equal(res.status, 401);
  });

  it('changes password successfully', async () => {
    const res = await fetch(`${baseUrl}/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({ currentPassword: 'oldpassword123', newPassword: 'newpassword456' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);

    // Old password no longer works
    const { status: oldStatus } = await login(userEmail, 'oldpassword123');
    assert.equal(oldStatus, 401);

    // New password works
    const { status: newStatus } = await login(userEmail, 'newpassword456');
    assert.equal(newStatus, 200);
  });
});
