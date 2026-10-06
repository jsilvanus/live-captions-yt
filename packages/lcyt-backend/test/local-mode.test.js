import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import { initDb } from '../src/db.js';
import { createKey } from '../src/db/keys.js';
import { createProjectAccessMiddleware, requireProjectRole } from '../src/middleware/project-access.js';
import { createUserAuthMiddleware } from '../src/middleware/user-auth.js';
import { createAdminMiddleware } from '../src/middleware/admin.js';
import {
  isLocalMode, resolveLocalBind, ensureLocalIdentity, createLocalModeMiddleware, LOCAL_USER_EMAIL,
} from '../src/local-mode.js';

const SECRET = 'local-mode-test-secret';

describe('isLocalMode', () => {
  it('is off by default and for "server"', () => {
    assert.equal(isLocalMode({}), false);
    assert.equal(isLocalMode({ LCYT_INSTALL_MODE: 'server' }), false);
  });
  it('is on for "local" (case-insensitive)', () => {
    assert.equal(isLocalMode({ LCYT_INSTALL_MODE: 'Local' }), true);
  });
  it('rejects unknown values rather than silently running with or without auth', () => {
    assert.throws(() => isLocalMode({ LCYT_INSTALL_MODE: 'yes' }), /Invalid LCYT_INSTALL_MODE/);
  });
});

describe('resolveLocalBind', () => {
  it('defaults to loopback', () => {
    assert.deepEqual(resolveLocalBind({}), { host: '127.0.0.1', exposed: false });
    assert.equal(resolveLocalBind({ HOST: 'localhost' }).exposed, false);
  });
  it('refuses a public HOST without the explicit allow flag', () => {
    const r = resolveLocalBind({ HOST: '0.0.0.0' });
    assert.ok(r.error);
    assert.equal(r.exposed, true);
  });
  it('allows a public HOST with LCYT_LOCAL_ALLOW_REMOTE=1', () => {
    const r = resolveLocalBind({ HOST: '0.0.0.0', LCYT_LOCAL_ALLOW_REMOTE: '1' });
    assert.equal(r.error, undefined);
    assert.equal(r.exposed, true);
  });
});

describe('local mode middleware', () => {
  let server, baseUrl, db, identity, localKey;

  before(() => new Promise((resolve) => {
    db = initDb(':memory:');
    identity = ensureLocalIdentity(db);
    const app = express();
    app.use(express.json());
    app.use(createLocalModeMiddleware(db, SECRET, identity));
    const scoped = createProjectAccessMiddleware(db, SECRET, { requiredScope: 'dsk' });
    app.get('/project', scoped, (req, res) => res.json({ project: req.project.projectId, userId: req.user.userId }));
    app.put('/setup', scoped, requireProjectRole(db, 'setup'), (_req, res) => res.json({ ok: true }));
    app.get('/me', createUserAuthMiddleware(SECRET), (req, res) => res.json(req.user));
    app.get('/admin', createAdminMiddleware(db, SECRET), (_req, res) => res.json({ ok: true }));
    server = createServer(app);
    server.listen(0, () => { baseUrl = `http://localhost:${server.address().port}`; resolve(); });
  }));
  after(() => new Promise((r) => server.close(r)));

  it('creates the local admin and project once', () => {
    const again = ensureLocalIdentity(db);
    assert.deepEqual(again, identity);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users WHERE email = ?').get(LOCAL_USER_EMAIL).n, 1);
  });

  it('lets credential-less requests through as the local owner', async () => {
    const res = await fetch(`${baseUrl}/project`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.project, identity.projectId);
    assert.equal(body.userId, identity.userId);
    assert.equal((await fetch(`${baseUrl}/me`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/admin`)).status, 200);
  });

  it('owns projects created later, including setup-tier writes', async () => {
    const other = createKey(db, { owner: 'Someone else' }).key;
    const res = await fetch(`${baseUrl}/setup`, { method: 'PUT', headers: { 'x-project-id': other } });
    assert.equal(res.status, 200);
  });

  it('still rejects a supplied bad token', async () => {
    const res = await fetch(`${baseUrl}/project`, { headers: { Authorization: 'Bearer nope' } });
    assert.equal(res.status, 401);
    const forged = jwt.sign({ type: 'user', userId: identity.userId }, 'other-secret');
    assert.equal((await fetch(`${baseUrl}/me`, { headers: { Authorization: `Bearer ${forged}` } })).status, 401);
  });

  it('still honours revoked project keys', async () => {
    const revoked = createKey(db, { owner: 'Revoked' }).key;
    db.prepare('UPDATE api_keys SET active = 0 WHERE key = ?').run(revoked);
    const res = await fetch(`${baseUrl}/project`, { headers: { 'x-project-id': revoked } });
    assert.equal(res.status, 401);
  });

  it('does not override a supplied X-Admin-Key', async () => {
    const res = await fetch(`${baseUrl}/admin`, { headers: { 'x-admin-key': 'wrong' } });
    assert.notEqual(res.status, 200);
  });
});
