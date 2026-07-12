import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import { initDb } from '../src/db.js';
import { createKey } from '../src/db/keys.js';
import { addMember } from '../src/db/project-members.js';
import { createUser } from '../src/db/users.js';
import { createMcpToken } from '../src/db/mcp-tokens.js';
import { createProjectAccessMiddleware } from '../src/middleware/project-access.js';

const JWT_SECRET = 'test-project-access-secret';

let server, baseUrl, db, projectKey;

before(() => new Promise((resolve) => {
  db = initDb(':memory:');
  const user = createUser(db, { email: 'project-access@example.com', passwordHash: 'hash', name: 'Project Access' });
  projectKey = createKey(db, { owner: 'Project Access', user_id: user.id }).key;
  addMember(db, projectKey, user.id, 'owner');

  const projectAuth = createProjectAccessMiddleware(db, JWT_SECRET);
  const scopedAuth = createProjectAccessMiddleware(db, JWT_SECRET, { requiredScope: 'cue:write' });
  // jwtOnly gate: external tokens are rejected (our-UI-only resources).
  const jwtOnlyAuth = createProjectAccessMiddleware(db, JWT_SECRET, { jwtOnly: true });
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    if (req.path === '/scoped') return scopedAuth(req, res, next);
    if (req.path === '/jwt-only') return jwtOnlyAuth(req, res, next);
    return projectAuth(req, res, next);
  });
  app.get('/check', (req, res) => res.json({ ok: true, auth: req.auth }));
  app.get('/scoped', (req, res) => res.json({ ok: true, auth: req.auth }));
  app.get('/jwt-only', (req, res) => res.json({ ok: true, auth: req.auth }));

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

describe('project access middleware', () => {
  it('accepts a project-scoped user token with an explicit project id', async () => {
    const token = jwt.sign(
      { kind: 'project', type: 'user', userId: 1, email: 'project-access@example.com', projectId: projectKey, projectRole: 'member' },
      JWT_SECRET,
      { expiresIn: '1h' },
    );
    const res = await fetch(`${baseUrl}/check`, {
      headers: { Authorization: `Bearer ${token}`, 'X-Project-Id': projectKey },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.auth.kind, 'project');
    assert.equal(body.auth.projectId, projectKey);
    assert.equal(body.auth.projectRole, 'member');
  });

  it('accepts an external token and records its project and scope metadata', async () => {
    const token = createMcpToken(db, projectKey, { label: 'Scope token', userId: 1, projectId: projectKey, scopes: ['dsk:read'] }).token;
    const res = await fetch(`${baseUrl}/check`, {
      headers: { Authorization: `Bearer ${token}`, 'X-Project-Id': projectKey },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.auth.kind, 'external');
    assert.equal(body.auth.projectId, projectKey);
    assert.deepEqual(body.auth.scopes, ['dsk:read']);
  });

  it('rejects external tokens that lack a required scope', async () => {
    const token = createMcpToken(db, projectKey, { label: 'No scope', userId: 1, projectId: projectKey, scopes: ['dsk:read'] }).token;
    const res = await fetch(`${baseUrl}/scoped`, {
      headers: { Authorization: `Bearer ${token}`, 'X-Project-Id': projectKey },
    });
    assert.equal(res.status, 403);
  });
});

describe('jwtOnly gating (our-UI-only resources)', () => {
  const H = (token) => ({ headers: { Authorization: `Bearer ${token}`, 'X-Project-Id': projectKey } });

  it('rejects any external token, even a full-access one', async () => {
    const full = createMcpToken(db, projectKey, { label: 'jwtonly-full', userId: 1, projectId: projectKey }).token;
    const scoped = createMcpToken(db, projectKey, { label: 'jwtonly-scoped', userId: 1, projectId: projectKey, scopes: ['events:read', 'variable.*'] }).token;
    assert.equal((await fetch(`${baseUrl}/jwt-only`, H(full))).status, 403);
    assert.equal((await fetch(`${baseUrl}/jwt-only`, H(scoped))).status, 403);
  });

  it('accepts a project-member JWT', async () => {
    const token = jwt.sign({ kind: 'project', type: 'user', userId: 1, email: 'project-access@example.com', projectId: projectKey, projectRole: 'member' }, JWT_SECRET, { expiresIn: '1h' });
    const res = await fetch(`${baseUrl}/jwt-only`, H(token));
    assert.equal(res.status, 200);
    assert.equal((await res.json()).auth.kind, 'project');
  });
});
