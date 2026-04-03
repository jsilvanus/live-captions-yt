/**
 * Tests for the /admin router (user/project management, search, batch ops).
 *
 * Uses an in-memory SQLite database. Supports both X-Admin-Key and user-based admin auth.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import { initDb } from '../src/db.js';
import { createAdminRouter } from '../src/routes/admin.js';
import { createUser, getUserById, setUserAdmin } from '../src/db/users.js';
import { createKey, getKey, formatKey } from '../src/db/keys.js';
import bcrypt from 'bcryptjs';

const ADMIN_KEY = 'test-admin-key-123';
const JWT_SECRET = 'test-jwt-secret-for-admin';

let server, baseUrl, db;

before(() => new Promise((resolve) => {
  process.env.ADMIN_KEY = ADMIN_KEY;
  db = initDb(':memory:');

  const app = express();
  app.use(express.json());
  app.use('/admin', createAdminRouter(db, JWT_SECRET));

  server = createServer(app);
  server.listen(0, () => {
    baseUrl = `http://localhost:${server.address().port}`;
    resolve();
  });
}));

after(() => new Promise((resolve) => {
  delete process.env.ADMIN_KEY;
  db.close();
  server.close(resolve);
}));

// Helpers

async function adminGet(path) {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { 'X-Admin-Key': ADMIN_KEY },
  });
  return { status: res.status, body: await res.json() };
}

async function adminPost(path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Key': ADMIN_KEY },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function adminPatch(path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Key': ADMIN_KEY },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function adminPut(path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Key': ADMIN_KEY },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function adminDelete(path) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'DELETE',
    headers: { 'X-Admin-Key': ADMIN_KEY },
  });
  return { status: res.status, body: await res.json() };
}

// Seed a test user directly in DB
// Uses bcrypt rounds=1 intentionally for test speed — not security-relevant in tests.
function seedUser(email, name = null) {
  const hash = bcrypt.hashSync('password123', 1);
  return createUser(db, { email, passwordHash: hash, name });
}

// Seed a test project (API key)
function seedProject(owner, userId = null) {
  return createKey(db, { owner, user_id: userId });
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

describe('/admin — authentication', () => {
  it('rejects requests without X-Admin-Key', async () => {
    const res = await fetch(`${baseUrl}/admin/users`);
    assert.equal(res.status, 401);
  });

  it('rejects requests with wrong admin key', async () => {
    const res = await fetch(`${baseUrl}/admin/users`, {
      headers: { 'X-Admin-Key': 'wrong-key' },
    });
    assert.equal(res.status, 403);
  });

  it('rejects non-admin user JWT tokens', async () => {
    const hash = bcrypt.hashSync('pass1234', 1);
    const user = createUser(db, { email: 'nonadmin@test.com', passwordHash: hash });
    const token = jwt.sign({ type: 'user', userId: user.id, email: user.email }, JWT_SECRET);
    const res = await fetch(`${baseUrl}/admin/users`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    assert.equal(res.status, 401);
    assert.ok(body.error, 'should include error message');
    db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
  });

  it('accepts user JWT token when user has is_admin = 1', async () => {
    const hash = bcrypt.hashSync('pass1234', 1);
    const user = createUser(db, { email: 'adminuser@test.com', passwordHash: hash });
    setUserAdmin(db, user.id, true);
    const token = jwt.sign({ type: 'user', userId: user.id, email: user.email }, JWT_SECRET);
    const res = await fetch(`${baseUrl}/admin/users`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(body.users), 'should return users array');
    db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
  });
});

// ---------------------------------------------------------------------------
// Users CRUD
// ---------------------------------------------------------------------------

describe('/admin/users', () => {
  let testUser;

  beforeEach(() => {
    // Clean in FK-safe order
    try { db.prepare('DELETE FROM project_member_permissions').run(); } catch { /* */ }
    try { db.prepare('DELETE FROM project_members').run(); } catch { /* */ }
    try { db.prepare('DELETE FROM project_features').run(); } catch { /* */ }
    try { db.prepare('DELETE FROM user_features').run(); } catch { /* */ }
    db.prepare('DELETE FROM api_keys').run();
    db.prepare('DELETE FROM users').run();
  });

  it('GET /admin/users returns empty list', async () => {
    const { status, body } = await adminGet('/admin/users');
    assert.equal(status, 200);
    assert.deepEqual(body.users, []);
    assert.equal(body.total, 0);
  });

  it('GET /admin/users lists users', async () => {
    seedUser('alice@test.com', 'Alice');
    seedUser('bob@test.com', 'Bob');

    const { status, body } = await adminGet('/admin/users');
    assert.equal(status, 200);
    assert.equal(body.users.length, 2);
    assert.equal(body.total, 2);
  });

  it('GET /admin/users?q= searches by email', async () => {
    seedUser('alice@test.com', 'Alice');
    seedUser('bob@test.com', 'Bob');

    const { body } = await adminGet('/admin/users?q=alice');
    assert.equal(body.users.length, 1);
    assert.equal(body.users[0].email, 'alice@test.com');
  });

  it('GET /admin/users?q= searches by name', async () => {
    seedUser('alice@test.com', 'Alice');
    seedUser('bob@test.com', 'Bob');

    const { body } = await adminGet('/admin/users?q=Bob');
    assert.equal(body.users.length, 1);
    assert.equal(body.users[0].name, 'Bob');
  });

  it('GET /admin/users supports pagination', async () => {
    for (let i = 0; i < 5; i++) seedUser(`user${i}@test.com`);

    const { body } = await adminGet('/admin/users?limit=2&offset=0');
    assert.equal(body.users.length, 2);
    assert.equal(body.total, 5);
    assert.equal(body.limit, 2);
    assert.equal(body.offset, 0);
  });

  it('GET /admin/users/:id returns user with projects', async () => {
    const user = seedUser('detail@test.com', 'Detail User');
    seedProject('Test Project', user.id);

    const { status, body } = await adminGet(`/admin/users/${user.id}`);
    assert.equal(status, 200);
    assert.equal(body.email, 'detail@test.com');
    assert.equal(body.name, 'Detail User');
    assert.equal(body.projects.length, 1);
    assert.equal(body.projects[0].owner, 'Test Project');
  });

  it('GET /admin/users/:id returns 404 for missing user', async () => {
    const { status } = await adminGet('/admin/users/99999');
    assert.equal(status, 404);
  });

  it('POST /admin/users creates a user', async () => {
    const { status, body } = await adminPost('/admin/users', {
      email: 'new@test.com',
      password: 'secret123',
      name: 'New User',
    });
    assert.equal(status, 201);
    assert.equal(body.email, 'new@test.com');
    assert.equal(body.name, 'New User');
    assert.ok(body.id);
  });

  it('POST /admin/users rejects duplicate email', async () => {
    seedUser('dup@test.com');
    const { status } = await adminPost('/admin/users', {
      email: 'dup@test.com',
      password: 'secret',
    });
    assert.equal(status, 409);
  });

  it('PATCH /admin/users/:id updates name', async () => {
    const user = seedUser('patch@test.com', 'Old Name');
    const { status } = await adminPatch(`/admin/users/${user.id}`, { name: 'New Name' });
    assert.equal(status, 200);

    const updated = getUserById(db, user.id);
    assert.equal(updated.name, 'New Name');
  });

  it('PATCH /admin/users/:id deactivates user', async () => {
    const user = seedUser('deact@test.com');
    const { status } = await adminPatch(`/admin/users/${user.id}`, { active: false });
    assert.equal(status, 200);

    const updated = getUserById(db, user.id);
    assert.equal(updated.active, 0);
  });

  it('POST /admin/users/:id/set-password changes password', async () => {
    const user = seedUser('pw@test.com');
    const { status, body } = await adminPost(`/admin/users/${user.id}/set-password`, {
      password: 'newpassword123',
    });
    assert.equal(status, 200);
    assert.equal(body.ok, true);

    // Verify new password works
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id);
    assert.ok(await bcrypt.compare('newpassword123', row.password_hash));
  });

  it('DELETE /admin/users/:id refuses without force when user has active projects', async () => {
    const user = seedUser('del@test.com');
    seedProject('Project1', user.id);

    const { status, body } = await adminDelete(`/admin/users/${user.id}`);
    assert.equal(status, 409);
    assert.ok(body.activeProjects > 0);
  });

  it('DELETE /admin/users/:id?force=true deletes user and unlinks projects', async () => {
    const user = seedUser('delforce@test.com');
    const project = seedProject('Project2', user.id);

    const { status, body } = await adminDelete(`/admin/users/${user.id}?force=true`);
    assert.equal(status, 200);
    assert.equal(body.deleted, true);

    // User should be gone
    assert.equal(getUserById(db, user.id), undefined);
    // Project should still exist but unlinked
    const key = getKey(db, project.key);
    assert.ok(key);
    assert.equal(key.user_id, null);
  });
});

// ---------------------------------------------------------------------------
// Projects CRUD
// ---------------------------------------------------------------------------

describe('/admin/projects', () => {
  beforeEach(() => {
    db.prepare('DELETE FROM api_keys').run();
    db.prepare('DELETE FROM users').run();
  });

  it('GET /admin/projects returns empty list', async () => {
    const { status, body } = await adminGet('/admin/projects');
    assert.equal(status, 200);
    assert.deepEqual(body.projects, []);
  });

  it('GET /admin/projects lists projects with user info', async () => {
    const user = seedUser('projowner@test.com', 'Owner');
    seedProject('MyProject', user.id);

    const { status, body } = await adminGet('/admin/projects');
    assert.equal(status, 200);
    assert.equal(body.projects.length, 1);
    assert.equal(body.projects[0].owner, 'MyProject');
    assert.equal(body.projects[0].userEmail, 'projowner@test.com');
  });

  it('GET /admin/projects?q= searches by owner name', async () => {
    seedProject('AlphaProject');
    seedProject('BetaProject');

    const { body } = await adminGet('/admin/projects?q=Alpha');
    assert.equal(body.projects.length, 1);
    assert.equal(body.projects[0].owner, 'AlphaProject');
  });

  it('GET /admin/projects?q=user:email filters by user', async () => {
    const alice = seedUser('alice@org.com');
    const bob = seedUser('bob@org.com');
    seedProject('AliceProject', alice.id);
    seedProject('BobProject', bob.id);
    seedProject('Unowned');

    const { body } = await adminGet('/admin/projects?q=user:alice@org.com');
    assert.equal(body.projects.length, 1);
    assert.equal(body.projects[0].owner, 'AliceProject');
  });

  it('GET /admin/projects?q= with multiple user: filters', async () => {
    const alice = seedUser('alice2@org.com');
    const bob = seedUser('bob2@org.com');
    seedProject('AliceP', alice.id);
    seedProject('BobP', bob.id);
    seedProject('Unowned2');

    const { body } = await adminGet('/admin/projects?q=user:alice2 user:bob2');
    assert.equal(body.projects.length, 2);
  });

  it('GET /admin/projects/:key returns project detail', async () => {
    const user = seedUser('detail@proj.com');
    const project = seedProject('DetailProj', user.id);

    const { status, body } = await adminGet(`/admin/projects/${project.key}`);
    assert.equal(status, 200);
    assert.equal(body.owner, 'DetailProj');
    assert.ok(body.user);
    assert.equal(body.user.email, 'detail@proj.com');
    assert.ok(Array.isArray(body.features));
    assert.ok(Array.isArray(body.members));
  });

  it('GET /admin/projects/:key returns 404 for missing key', async () => {
    const { status } = await adminGet('/admin/projects/nonexistent');
    assert.equal(status, 404);
  });

  it('PATCH /admin/projects/:key updates project', async () => {
    const project = seedProject('UpdateMe');
    const { status } = await adminPatch(`/admin/projects/${project.key}`, { owner: 'Updated' });
    assert.equal(status, 200);

    const updated = getKey(db, project.key);
    assert.equal(updated.owner, 'Updated');
  });

  it('PUT /admin/projects/:key/features updates features', async () => {
    const project = seedProject('FeatureProj');
    const { status, body } = await adminPut(`/admin/projects/${project.key}/features`, {
      features: { captions: true, 'graphics-client': true },
    });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
  });
});

// ---------------------------------------------------------------------------
// Batch operations
// ---------------------------------------------------------------------------

describe('/admin/batch', () => {
  beforeEach(() => {
    db.prepare('DELETE FROM api_keys').run();
    db.prepare('DELETE FROM users').run();
  });

  it('POST /admin/batch/users activates multiple users', async () => {
    const u1 = seedUser('batch1@test.com');
    const u2 = seedUser('batch2@test.com');
    // Deactivate them first
    db.prepare('UPDATE users SET active = 0 WHERE id IN (?, ?)').run(u1.id, u2.id);

    const { status, body } = await adminPost('/admin/batch/users', {
      ids: [u1.id, u2.id],
      action: 'activate',
    });
    assert.equal(status, 200);
    assert.equal(body.succeeded, 2);
    assert.equal(body.failed, 0);

    assert.equal(getUserById(db, u1.id).active, 1);
    assert.equal(getUserById(db, u2.id).active, 1);
  });

  it('POST /admin/batch/users deactivates multiple users', async () => {
    const u1 = seedUser('batchd1@test.com');
    const u2 = seedUser('batchd2@test.com');

    const { status, body } = await adminPost('/admin/batch/users', {
      ids: [u1.id, u2.id],
      action: 'deactivate',
    });
    assert.equal(status, 200);
    assert.equal(body.succeeded, 2);

    assert.equal(getUserById(db, u1.id).active, 0);
    assert.equal(getUserById(db, u2.id).active, 0);
  });

  it('POST /admin/batch/users handles non-existent users', async () => {
    const { status, body } = await adminPost('/admin/batch/users', {
      ids: [99999],
      action: 'deactivate',
    });
    assert.equal(status, 200);
    assert.equal(body.failed, 1);
    assert.equal(body.errors[0].error, 'User not found');
  });

  it('POST /admin/batch/projects revokes multiple projects', async () => {
    const p1 = seedProject('BatchP1');
    const p2 = seedProject('BatchP2');

    const { status, body } = await adminPost('/admin/batch/projects', {
      keys: [p1.key, p2.key],
      action: 'revoke',
    });
    assert.equal(status, 200);
    assert.equal(body.succeeded, 2);

    assert.equal(getKey(db, p1.key).active, 0);
    assert.equal(getKey(db, p2.key).active, 0);
  });

  it('POST /admin/batch/projects updates features for multiple projects', async () => {
    const p1 = seedProject('FeatP1');
    const p2 = seedProject('FeatP2');

    const { status, body } = await adminPost('/admin/batch/projects', {
      keys: [p1.key, p2.key],
      features: { captions: true, 'viewer-target': true },
    });
    assert.equal(status, 200);
    assert.equal(body.succeeded, 2);
  });

  it('POST /admin/batch/users rejects invalid action', async () => {
    const { status } = await adminPost('/admin/batch/users', {
      ids: [1],
      action: 'invalid',
    });
    assert.equal(status, 400);
  });

  it('POST /admin/batch/projects rejects empty keys', async () => {
    const { status } = await adminPost('/admin/batch/projects', {
      keys: [],
      action: 'revoke',
    });
    assert.equal(status, 400);
  });
});

// ---------------------------------------------------------------------------
// Phase 2: Advanced filtering (date ranges, status)
// ---------------------------------------------------------------------------

describe('/admin/users — advanced filters', () => {
  beforeEach(() => {
    try { db.prepare('DELETE FROM project_member_permissions').run(); } catch { /* */ }
    try { db.prepare('DELETE FROM project_members').run(); } catch { /* */ }
    try { db.prepare('DELETE FROM project_features').run(); } catch { /* */ }
    try { db.prepare('DELETE FROM user_features').run(); } catch { /* */ }
    db.prepare('DELETE FROM api_keys').run();
    db.prepare('DELETE FROM users').run();
  });

  it('GET /admin/users?active=1 returns only active users', async () => {
    seedUser('active@test.com');
    const inactive = seedUser('inactive@test.com');
    db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(inactive.id);

    const { body } = await adminGet('/admin/users?active=1');
    assert.ok(body.users.every(u => u.active), 'all returned users should be active');
    assert.equal(body.users.length, 1);
  });

  it('GET /admin/users?active=0 returns only inactive users', async () => {
    seedUser('active2@test.com');
    const inactive = seedUser('inactive2@test.com');
    db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(inactive.id);

    const { body } = await adminGet('/admin/users?active=0');
    assert.ok(body.users.every(u => !u.active));
    assert.equal(body.users.length, 1);
  });

  it('GET /admin/users?from= filters by creation date', async () => {
    seedUser('datefilter@test.com');

    const past = '2000-01-01';
    const future = '2099-01-01';

    const { body: withFrom } = await adminGet(`/admin/users?from=${future}`);
    assert.equal(withFrom.users.length, 0);

    const { body: withOldFrom } = await adminGet(`/admin/users?from=${past}`);
    assert.ok(withOldFrom.users.length >= 1);
  });
});

describe('/admin/projects — advanced filters', () => {
  beforeEach(() => {
    db.prepare('DELETE FROM api_keys').run();
    db.prepare('DELETE FROM users').run();
  });

  it('GET /admin/projects?status=active returns only active projects', async () => {
    const p1 = seedProject('ActiveP');
    const p2 = seedProject('RevokedP');
    db.prepare('UPDATE api_keys SET active = 0 WHERE key = ?').run(p2.key);

    const { body } = await adminGet('/admin/projects?status=active');
    assert.ok(body.projects.every(p => p.active));
    assert.ok(body.projects.some(p => p.key === p1.key));
    assert.ok(!body.projects.some(p => p.key === p2.key));
  });

  it('GET /admin/projects?status=revoked returns only revoked projects', async () => {
    const p1 = seedProject('ActiveP2');
    const p2 = seedProject('RevokedP2');
    db.prepare('UPDATE api_keys SET active = 0 WHERE key = ?').run(p2.key);

    const { body } = await adminGet('/admin/projects?status=revoked');
    assert.ok(body.projects.every(p => !p.active));
    assert.ok(body.projects.some(p => p.key === p2.key));
    assert.ok(!body.projects.some(p => p.key === p1.key));
  });
});

// ---------------------------------------------------------------------------
// Phase 2: User feature entitlements
// ---------------------------------------------------------------------------

describe('/admin/users/:id/features', () => {
  let testUser;

  beforeEach(() => {
    try { db.prepare('DELETE FROM user_features').run(); } catch { /* */ }
    db.prepare('DELETE FROM users').run();
    testUser = seedUser('featuser@test.com', 'Feature User');
  });

  it('GET /admin/users/:id/features returns feature list', async () => {
    const { status, body } = await adminGet(`/admin/users/${testUser.id}/features`);
    assert.equal(status, 200);
    assert.equal(body.userId, testUser.id);
    assert.ok(Array.isArray(body.features));
  });

  it('PATCH /admin/users/:id/features grants and revokes features', async () => {
    const { status, body } = await adminPatch(`/admin/users/${testUser.id}/features`, {
      features: { radio: true, ingest: true, captions: false },
    });
    assert.equal(status, 200);
    assert.equal(body.userId, testUser.id);
    const radio = body.features.find(f => f.code === 'radio');
    assert.ok(radio, 'radio feature should be present');
    assert.equal(radio.enabled, true);
    const captions = body.features.find(f => f.code === 'captions');
    assert.ok(captions, 'captions feature should be present');
    assert.equal(captions.enabled, false);
  });

  it('PATCH /admin/users/:id/features returns 400 for missing features body', async () => {
    const { status } = await adminPatch(`/admin/users/${testUser.id}/features`, {});
    assert.equal(status, 400);
  });

  it('PATCH /admin/users/:id/features returns 404 for missing user', async () => {
    const { status } = await adminPatch('/admin/users/99999/features', {
      features: { captions: true },
    });
    assert.equal(status, 404);
  });
});

// ---------------------------------------------------------------------------
// Phase 2: Audit log
// ---------------------------------------------------------------------------

describe('/admin/audit-log', () => {
  before(() => {
    // Ensure clean audit log for this suite
    try { db.prepare('DELETE FROM admin_audit_log').run(); } catch { /* */ }
  });

  it('GET /admin/audit-log returns entries list', async () => {
    // Trigger an auditable action first
    const user = seedUser('audituser@test.com');
    await adminPost('/admin/users', { email: 'auditcreated@test.com', password: 'p' });

    const { status, body } = await adminGet('/admin/audit-log');
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.entries));
    assert.ok(typeof body.total === 'number');
  });

  it('GET /admin/audit-log?action= filters by action', async () => {
    await adminPost('/admin/users', { email: 'foraudit@test.com', password: 'p' });

    const { body } = await adminGet('/admin/audit-log?action=user.create');
    assert.ok(body.entries.every(e => e.action === 'user.create'));
  });

  it('GET /admin/audit-log?from=9999 returns empty for future date', async () => {
    const { body } = await adminGet('/admin/audit-log?from=9999-01-01');
    assert.equal(body.entries.length, 0);
  });

  it('GET /admin/audit-log supports pagination', async () => {
    const { body } = await adminGet('/admin/audit-log?limit=2&offset=0');
    assert.ok(body.limit <= 2);
  });
});

// ---------------------------------------------------------------------------
// Phase 2: Export / Import
// ---------------------------------------------------------------------------

describe('/admin/export + /admin/import', () => {
  beforeEach(() => {
    try { db.prepare('DELETE FROM project_member_permissions').run(); } catch { /* */ }
    try { db.prepare('DELETE FROM project_members').run(); } catch { /* */ }
    try { db.prepare('DELETE FROM project_features').run(); } catch { /* */ }
    try { db.prepare('DELETE FROM user_features').run(); } catch { /* */ }
    db.prepare('DELETE FROM api_keys').run();
    db.prepare('DELETE FROM users').run();
  });

  it('GET /admin/export/users returns users JSON', async () => {
    seedUser('export1@test.com', 'Exported');

    const { status, body } = await adminGet('/admin/export/users');
    assert.equal(status, 200);
    assert.ok(body.exportedAt);
    assert.ok(Array.isArray(body.users));
    assert.equal(body.count, body.users.length);
    assert.ok(body.users[0].email);
  });

  it('GET /admin/export/projects returns projects JSON', async () => {
    seedProject('ExportedProject');

    const { status, body } = await adminGet('/admin/export/projects');
    assert.equal(status, 200);
    assert.ok(body.exportedAt);
    assert.ok(Array.isArray(body.projects));
    assert.equal(body.count, body.projects.length);
  });

  it('POST /admin/import/users imports new users', async () => {
    const { status, body } = await adminPost('/admin/import/users', {
      users: [
        { email: 'import1@test.com', name: 'Imported One', features: [{ code: 'captions', enabled: true }] },
        { email: 'import2@test.com' },
      ],
    });
    assert.equal(status, 200);
    assert.equal(body.imported, 2);
    assert.equal(body.failed, 0);

    const u1 = db.prepare('SELECT id FROM users WHERE email = ?').get('import1@test.com');
    assert.ok(u1);
  });

  it('POST /admin/import/users skips existing users by default', async () => {
    seedUser('existing@test.com');

    const { body } = await adminPost('/admin/import/users', {
      users: [{ email: 'existing@test.com' }],
    });
    assert.equal(body.skipped, 1);
    assert.equal(body.imported, 0);
  });

  it('POST /admin/import/users rejects missing users array', async () => {
    const { status } = await adminPost('/admin/import/users', {});
    assert.equal(status, 400);
  });

  it('POST /admin/import/projects imports new projects', async () => {
    const { status, body } = await adminPost('/admin/import/projects', {
      projects: [
        { key: 'importkey-abc', owner: 'ImportedProject', features: [{ code: 'captions', enabled: true }] },
      ],
    });
    assert.equal(status, 200);
    assert.equal(body.imported, 1);
    assert.equal(body.failed, 0);

    const proj = db.prepare('SELECT key FROM api_keys WHERE key = ?').get('importkey-abc');
    assert.ok(proj);
  });

  it('POST /admin/import/projects skips existing keys by default', async () => {
    const existing = seedProject('ExistingForImport');

    const { body } = await adminPost('/admin/import/projects', {
      projects: [{ key: existing.key, owner: 'whatever' }],
    });
    assert.equal(body.skipped, 1);
    assert.equal(body.imported, 0);
  });

  it('POST /admin/import/projects rejects missing projects array', async () => {
    const { status } = await adminPost('/admin/import/projects', {});
    assert.equal(status, 400);
  });
});
