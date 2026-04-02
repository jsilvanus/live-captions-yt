/**
 * Tests for:
 *  - src/middleware/feature-gate.js  (Phase 2: requireFeature, requireKeyFeature)
 *  - Admin user features endpoints   (Phase 3: GET/PATCH /admin/users/:id/features)
 *  - Project features/members/device-roles routes (Phase 1 confirmation)
 */

import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { initDb } from '../src/db.js';
import { createAdminRouter } from '../src/routes/admin.js';
import { createAccountRouters } from '../src/routes/account.js';
import { createRequireFeature, createRequireKeyFeature, isEnforced } from '../src/middleware/feature-gate.js';
import { createUser } from '../src/db/users.js';
import { createKey } from '../src/db/keys.js';
import { setProjectFeature, provisionDefaultProjectFeatures } from '../src/db/project-features.js';

const ADMIN_KEY  = 'test-admin-key-fg';
const JWT_SECRET = 'test-jwt-secret-fg';

let server, baseUrl, db;

before(() => new Promise(resolve => {
  process.env.ADMIN_KEY = ADMIN_KEY;
  db = initDb(':memory:');

  const app = express();
  app.use(express.json());
  app.use('/admin', createAdminRouter(db, JWT_SECRET));
  app.use(createAccountRouters(db, JWT_SECRET, { loginEnabled: true }));

  server = createServer(app);
  server.listen(0, () => {
    baseUrl = `http://localhost:${server.address().port}`;
    resolve();
  });
}));

after(() => new Promise(resolve => {
  delete process.env.ADMIN_KEY;
  delete process.env.FEATURE_GATE_ENFORCE;
  db.close();
  server.close(resolve);
}));

afterEach(() => {
  delete process.env.FEATURE_GATE_ENFORCE;
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeUserToken(userId, email) {
  return jwt.sign({ type: 'user', userId, email }, JWT_SECRET, { expiresIn: '1d' });
}

async function adminGet(path) {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { 'X-Admin-Key': ADMIN_KEY },
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

// ── Phase 2: feature-gate middleware unit tests ────────────────────────────────

describe('feature-gate middleware — isEnforced()', () => {
  it('returns false when FEATURE_GATE_ENFORCE is unset', () => {
    delete process.env.FEATURE_GATE_ENFORCE;
    assert.equal(isEnforced(), false);
  });

  it('returns false when FEATURE_GATE_ENFORCE=0', () => {
    process.env.FEATURE_GATE_ENFORCE = '0';
    assert.equal(isEnforced(), false);
  });

  it('returns true when FEATURE_GATE_ENFORCE=1', () => {
    process.env.FEATURE_GATE_ENFORCE = '1';
    assert.equal(isEnforced(), true);
  });

  it('returns true when FEATURE_GATE_ENFORCE=true', () => {
    process.env.FEATURE_GATE_ENFORCE = 'true';
    assert.equal(isEnforced(), true);
  });
});

describe('createRequireFeature — session-based middleware', () => {
  it('passes through when FEATURE_GATE_ENFORCE is off', () => {
    delete process.env.FEATURE_GATE_ENFORCE;
    const mw = createRequireFeature(db, 'captions');
    const next = { called: false };
    const req = { session: { apiKey: 'does-not-exist' } };
    const res = {};
    mw(req, res, () => { next.called = true; });
    assert.ok(next.called, 'should call next when enforcement is off');
  });

  it('passes through when no apiKey on req.session', () => {
    process.env.FEATURE_GATE_ENFORCE = '1';
    const mw = createRequireFeature(db, 'captions');
    const next = { called: false };
    const req = { session: {} };
    const res = {};
    mw(req, res, () => { next.called = true; });
    assert.ok(next.called, 'should call next when no apiKey (let auth handle 401)');
  });

  it('returns 403 when enforcement is on and feature is disabled', () => {
    process.env.FEATURE_GATE_ENFORCE = '1';
    const key = createKey(db, { owner: 'gate-test', user_id: null });
    // Explicitly disable 'captions'
    setProjectFeature(db, key.key, 'captions', false);

    const mw = createRequireFeature(db, 'captions');
    let statusCode = null;
    let responseBody = null;
    const req = { session: { apiKey: key.key } };
    const res = {
      status(code) { statusCode = code; return this; },
      json(body) { responseBody = body; },
    };
    mw(req, res, () => { throw new Error('should not call next'); });

    assert.equal(statusCode, 403);
    assert.equal(responseBody.feature, 'captions');
    assert.ok(responseBody.error);
  });

  it('calls next when enforcement is on and feature is enabled', () => {
    process.env.FEATURE_GATE_ENFORCE = '1';
    const key = createKey(db, { owner: 'gate-enabled', user_id: null });
    setProjectFeature(db, key.key, 'captions', true);

    const mw = createRequireFeature(db, 'captions');
    let nextCalled = false;
    const req = { session: { apiKey: key.key } };
    const res = {};
    mw(req, res, () => { nextCalled = true; });
    assert.ok(nextCalled);
  });
});

describe('createRequireKeyFeature — key-param middleware', () => {
  it('passes through when FEATURE_GATE_ENFORCE is off', () => {
    delete process.env.FEATURE_GATE_ENFORCE;
    const mw = createRequireKeyFeature(db, 'stats');
    let nextCalled = false;
    const req = { params: { key: 'does-not-exist' } };
    const res = {};
    mw(req, res, () => { nextCalled = true; });
    assert.ok(nextCalled);
  });

  it('returns 403 when enforcement is on and feature is disabled', () => {
    process.env.FEATURE_GATE_ENFORCE = '1';
    const key = createKey(db, { owner: 'key-gate', user_id: null });
    setProjectFeature(db, key.key, 'stats', false);

    const mw = createRequireKeyFeature(db, 'stats');
    let statusCode = null;
    let responseBody = null;
    const req = { params: { key: key.key } };
    const res = {
      status(code) { statusCode = code; return this; },
      json(body) { responseBody = body; },
    };
    mw(req, res, () => { throw new Error('should not call next'); });

    assert.equal(statusCode, 403);
    assert.equal(responseBody.feature, 'stats');
  });

  it('calls next when feature is enabled', () => {
    process.env.FEATURE_GATE_ENFORCE = '1';
    const key = createKey(db, { owner: 'key-gate-enabled', user_id: null });
    setProjectFeature(db, key.key, 'stats', true);

    const mw = createRequireKeyFeature(db, 'stats');
    let nextCalled = false;
    const req = { params: { key: key.key } };
    const res = {};
    mw(req, res, () => { nextCalled = true; });
    assert.ok(nextCalled);
  });
});

// ── Phase 3: Admin user features API tests ─────────────────────────────────────

describe('GET /admin/users/:id/features', () => {
  it('returns 404 for non-existent user', async () => {
    const { status } = await adminGet('/admin/users/99999/features');
    assert.equal(status, 404);
  });

  it('returns 400 for invalid user ID', async () => {
    const { status } = await adminGet('/admin/users/not-a-number/features');
    assert.equal(status, 400);
  });

  it('returns features array for a user with provisioned features', async () => {
    const hash = bcrypt.hashSync('pass1234', 1);
    const user = createUser(db, { email: 'featuser1@test.com', passwordHash: hash });
    // Provision default user features by directly writing them
    db.prepare(`INSERT INTO user_features (user_id, feature_code, enabled) VALUES (?, 'captions', 1) ON CONFLICT DO NOTHING`).run(user.id);
    db.prepare(`INSERT INTO user_features (user_id, feature_code, enabled) VALUES (?, 'stats', 1) ON CONFLICT DO NOTHING`).run(user.id);

    const { status, body } = await adminGet(`/admin/users/${user.id}/features`);
    assert.equal(status, 200);
    assert.equal(body.userId, user.id);
    assert.ok(Array.isArray(body.features), 'features should be an array');
    const codes = body.features.map(f => f.code);
    assert.ok(codes.includes('captions'), 'should include captions');
    assert.ok(codes.includes('stats'), 'should include stats');
    const captionsFeat = body.features.find(f => f.code === 'captions');
    assert.equal(captionsFeat.enabled, true);
  });

  it('returns empty features array for a user with no entitlements', async () => {
    const hash = bcrypt.hashSync('pass1234', 1);
    const user = createUser(db, { email: 'featuser-empty@test.com', passwordHash: hash });
    const { status, body } = await adminGet(`/admin/users/${user.id}/features`);
    assert.equal(status, 200);
    assert.deepEqual(body.features, []);
  });
});

describe('PATCH /admin/users/:id/features', () => {
  it('returns 404 for non-existent user', async () => {
    const { status } = await adminPatch('/admin/users/99999/features', { features: { captions: true } });
    assert.equal(status, 404);
  });

  it('returns 400 when features is not an object', async () => {
    const hash = bcrypt.hashSync('pass1234', 1);
    const user = createUser(db, { email: 'featuser-badreq@test.com', passwordHash: hash });
    const { status } = await adminPatch(`/admin/users/${user.id}/features`, { features: ['captions'] });
    assert.equal(status, 400);
  });

  it('grants new feature entitlements', async () => {
    const hash = bcrypt.hashSync('pass1234', 1);
    const user = createUser(db, { email: 'featuser-grant@test.com', passwordHash: hash });

    const { status, body } = await adminPatch(`/admin/users/${user.id}/features`, {
      features: { 'stt-server': true, 'radio': true },
    });
    assert.equal(status, 200);
    assert.equal(body.userId, user.id);
    const codes = body.features.map(f => f.code);
    assert.ok(codes.includes('stt-server'), 'stt-server should be granted');
    assert.ok(codes.includes('radio'), 'radio should be granted');
    const sttFeat = body.features.find(f => f.code === 'stt-server');
    assert.equal(sttFeat.enabled, true);
  });

  it('revokes a feature entitlement', async () => {
    const hash = bcrypt.hashSync('pass1234', 1);
    const user = createUser(db, { email: 'featuser-revoke@test.com', passwordHash: hash });
    // First grant
    db.prepare(`INSERT INTO user_features (user_id, feature_code, enabled) VALUES (?, 'captions', 1) ON CONFLICT(user_id, feature_code) DO UPDATE SET enabled = 1`).run(user.id);

    // Then revoke
    const { status, body } = await adminPatch(`/admin/users/${user.id}/features`, {
      features: { 'captions': false },
    });
    assert.equal(status, 200);
    const captionsFeat = body.features.find(f => f.code === 'captions');
    assert.ok(captionsFeat, 'captions should appear in response');
    assert.equal(captionsFeat.enabled, false, 'captions should be disabled');
  });

  it('is idempotent — updating a feature twice gives consistent result', async () => {
    const hash = bcrypt.hashSync('pass1234', 1);
    const user = createUser(db, { email: 'featuser-idem@test.com', passwordHash: hash });

    await adminPatch(`/admin/users/${user.id}/features`, { features: { 'stats': true } });
    const { status, body } = await adminPatch(`/admin/users/${user.id}/features`, { features: { 'stats': true } });
    assert.equal(status, 200);
    const statsFeat = body.features.find(f => f.code === 'stats');
    assert.equal(statsFeat.enabled, true);
  });
});

// ── Phase 1 confirmation: project features/members/device-roles routes ─────────

describe('GET /keys/:key/features — user auth', () => {
  it('returns 401 without token', async () => {
    const res = await fetch(`${baseUrl}/keys/somekey/features`);
    assert.equal(res.status, 401);
  });

  it('returns 403 when user is not a member', async () => {
    const hash = bcrypt.hashSync('pass1234', 1);
    const user = createUser(db, { email: 'notmember@test.com', passwordHash: hash });
    const key = createKey(db, { owner: 'other', user_id: null });
    const token = makeUserToken(user.id, user.email);

    const res = await fetch(`${baseUrl}/keys/${key.key}/features`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 403);
  });

  it('returns features for a project member', async () => {
    const hash = bcrypt.hashSync('pass1234', 1);
    const user = createUser(db, { email: 'member-feat@test.com', passwordHash: hash });
    const key = createKey(db, { owner: 'proj1', user_id: user.id });
    provisionDefaultProjectFeatures(db, key.key);
    // Add user as member (owner)
    db.prepare(`INSERT INTO project_members (api_key, user_id, access_level) VALUES (?, ?, 'owner') ON CONFLICT DO NOTHING`).run(key.key, user.id);
    const token = makeUserToken(user.id, user.email);

    const res = await fetch(`${baseUrl}/keys/${key.key}/features`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(body.features));
    assert.ok(body.features.length > 0, 'should have provisioned features');
  });
});

describe('GET /keys/:key/members — user auth', () => {
  it('returns 401 without token', async () => {
    const res = await fetch(`${baseUrl}/keys/somekey/members`);
    assert.equal(res.status, 401);
  });

  it('returns members list for owner', async () => {
    const hash = bcrypt.hashSync('pass1234', 1);
    const user = createUser(db, { email: 'owner-mbr@test.com', passwordHash: hash });
    const key = createKey(db, { owner: 'mbrproj', user_id: user.id });
    db.prepare(`INSERT INTO project_members (api_key, user_id, access_level) VALUES (?, ?, 'owner') ON CONFLICT DO NOTHING`).run(key.key, user.id);
    const token = makeUserToken(user.id, user.email);

    const res = await fetch(`${baseUrl}/keys/${key.key}/members`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(body.members));
    assert.equal(body.members.length, 1);
    assert.equal(body.members[0].accessLevel, 'owner');
  });
});

describe('POST /auth/device-login', () => {
  it('returns 400 when deviceCode or pin missing', async () => {
    const res = await fetch(`${baseUrl}/auth/device-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceCode: '123456' }),
    });
    assert.equal(res.status, 400);
  });

  it('returns 401 for unknown device code', async () => {
    const res = await fetch(`${baseUrl}/auth/device-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceCode: '000000', pin: '123456' }),
    });
    assert.equal(res.status, 401);
  });

  it('returns device JWT when credentials are valid', async () => {
    // Create project with device code
    const key = createKey(db, { owner: 'device-proj', user_id: null });
    db.prepare('UPDATE api_keys SET device_code = ? WHERE key = ?').run('777777', key.key);
    // Create device role with known PIN
    const pin = '654321';
    const pinHash = bcrypt.hashSync(pin, 1); // rounds=1 for speed
    db.prepare(`
      INSERT INTO project_device_roles (api_key, role_type, name, pin_hash, permissions)
      VALUES (?, 'camera', 'Camera 1', ?, '[]')
    `).run(key.key, pinHash);

    const res = await fetch(`${baseUrl}/auth/device-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceCode: '777777', pin }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.ok(body.token, 'should return a JWT token');
    assert.equal(body.roleType, 'camera');
    assert.equal(body.apiKey, key.key);

    // Verify the JWT payload
    const payload = jwt.verify(body.token, JWT_SECRET);
    assert.equal(payload.type, 'device');
    assert.equal(payload.apiKey, key.key);
    assert.equal(payload.roleType, 'camera');
  });
});
