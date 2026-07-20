/**
 * Tests for project-scoped audit/usage routes (plan_metering_audit §5.5, §6.1)
 * — previously untested. Added alongside the org-baseline access-resolver
 * sweep (plan_team_org_backend.md) since these routes now call
 * getEffectiveProjectAccessLevel() instead of getMemberAccessLevel().
 */
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert';
import { createServer } from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';

import { initDb } from '../src/db.js';
import { createUser } from '../src/db/users.js';
import { createKey } from '../src/db/keys.js';
import { createOrganization, createOrganizationMember } from '../src/db/orgs.js';
import { addMember } from '../src/db/project-members.js';
import { writeAuditLog } from '../src/db/audit-log.js';
import { createProjectObservabilityRouter } from '../src/routes/project-observability.js';

const JWT_SECRET = 'test-observability-secret';
const ADMIN_KEY = 'test-admin-key-observability';

let server, baseUrl, db, owner, outsider;

function makeToken(user) {
  return jwt.sign({ type: 'user', userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '1h' });
}

function authed(user) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${makeToken(user)}` };
}

before(() => new Promise(resolve => {
  process.env.ADMIN_KEY = ADMIN_KEY;
  db = initDb(':memory:');

  const app = express();
  app.use(express.json());
  app.use('/keys/:key', createProjectObservabilityRouter(db, { loginEnabled: true, jwtSecret: JWT_SECRET }));

  server = createServer(app);
  server.listen(0, () => {
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    resolve();
  });
}));

after(() => new Promise(resolve => {
  delete process.env.ADMIN_KEY;
  db.close();
  server.close(resolve);
}));

beforeEach(() => {
  // FK-safe order: project_members -> org_members -> api_keys -> organizations -> users
  db.prepare('DELETE FROM project_member_permissions').run();
  db.prepare('DELETE FROM project_members').run();
  db.prepare('DELETE FROM org_members').run();
  db.prepare('DELETE FROM api_keys').run();
  db.prepare('DELETE FROM organizations').run();
  db.prepare('DELETE FROM users').run();
  owner = createUser(db, { email: 'owner@example.com', passwordHash: 'hash', name: 'Owner' });
  outsider = createUser(db, { email: 'outsider@example.com', passwordHash: 'hash', name: 'Outsider' });
});

describe('GET /keys/:key/audit', () => {
  it('401s with no token', async () => {
    const key = createKey(db, { key: 'proj-a', owner: 'P', user_id: owner.id });
    const res = await fetch(`${baseUrl}/keys/${key.key}/audit`);
    assert.strictEqual(res.status, 401);
  });

  it('404s for unknown project', async () => {
    const res = await fetch(`${baseUrl}/keys/nonexistent/audit`, { headers: authed(owner) });
    assert.strictEqual(res.status, 404);
  });

  it('allows the owning user', async () => {
    const key = createKey(db, { key: 'proj-b', owner: 'P', user_id: owner.id });
    writeAuditLog(db, { actor: 'owner', actorKind: 'user', action: 'auth.login', apiKey: key.key });
    const res = await fetch(`${baseUrl}/keys/${key.key}/audit`, { headers: authed(owner) });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.total, 1);
  });

  it('403s an explicit member-level user (admin required for audit)', async () => {
    const key = createKey(db, { key: 'proj-c', owner: 'P', user_id: owner.id });
    addMember(db, key.key, outsider.id, 'member', owner.id);
    const res = await fetch(`${baseUrl}/keys/${key.key}/audit`, { headers: authed(outsider) });
    assert.strictEqual(res.status, 403);
  });

  it('allows an explicit admin member', async () => {
    const key = createKey(db, { key: 'proj-d', owner: 'P', user_id: owner.id });
    addMember(db, key.key, outsider.id, 'admin', owner.id);
    const res = await fetch(`${baseUrl}/keys/${key.key}/audit`, { headers: authed(outsider) });
    assert.strictEqual(res.status, 200);
  });

  it('403s a user whose only access is an org-baseline "member" (audit requires admin)', async () => {
    const org = createOrganization(db, { name: 'Team', slug: 'team-obs-1', ownerUserId: owner.id });
    createOrganizationMember(db, { orgId: org.id, userId: outsider.id, role: 'operator', invitedBy: owner.id });
    const key = createKey(db, { key: 'proj-e', owner: 'P', user_id: owner.id, org_id: org.id });
    const res = await fetch(`${baseUrl}/keys/${key.key}/audit`, { headers: authed(outsider) });
    assert.strictEqual(res.status, 403);
  });

  it('403s a user with org membership on a restricted project (no baseline at all)', async () => {
    const org = createOrganization(db, { name: 'Team', slug: 'team-obs-2', ownerUserId: owner.id });
    createOrganizationMember(db, { orgId: org.id, userId: outsider.id, role: 'admin', invitedBy: owner.id });
    const key = createKey(db, { key: 'proj-f', owner: 'P', user_id: owner.id, org_id: org.id });
    db.prepare('UPDATE api_keys SET restricted = 1 WHERE key = ?').run(key.key);
    const res = await fetch(`${baseUrl}/keys/${key.key}/audit`, { headers: authed(outsider) });
    assert.strictEqual(res.status, 403);
  });
});

describe('GET /keys/:key/usage', () => {
  it('allows any explicit member (member-level is enough for usage)', async () => {
    const key = createKey(db, { key: 'proj-g', owner: 'P', user_id: owner.id });
    addMember(db, key.key, outsider.id, 'member', owner.id);
    const res = await fetch(`${baseUrl}/keys/${key.key}/usage`, { headers: authed(outsider) });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.series));
  });

  it('allows a user whose only access is the org baseline "member"', async () => {
    const org = createOrganization(db, { name: 'Team', slug: 'team-obs-3', ownerUserId: owner.id });
    createOrganizationMember(db, { orgId: org.id, userId: outsider.id, role: 'viewer', invitedBy: owner.id });
    const key = createKey(db, { key: 'proj-h', owner: 'P', user_id: owner.id, org_id: org.id });
    const res = await fetch(`${baseUrl}/keys/${key.key}/usage`, { headers: authed(outsider) });
    assert.strictEqual(res.status, 200);
  });

  it('403s an org member on a restricted project with no explicit row', async () => {
    const org = createOrganization(db, { name: 'Team', slug: 'team-obs-4', ownerUserId: owner.id });
    createOrganizationMember(db, { orgId: org.id, userId: outsider.id, role: 'viewer', invitedBy: owner.id });
    const key = createKey(db, { key: 'proj-i', owner: 'P', user_id: owner.id, org_id: org.id });
    db.prepare('UPDATE api_keys SET restricted = 1 WHERE key = ?').run(key.key);
    const res = await fetch(`${baseUrl}/keys/${key.key}/usage`, { headers: authed(outsider) });
    assert.strictEqual(res.status, 403);
  });

  it('403s a plain outsider with no membership at all', async () => {
    const key = createKey(db, { key: 'proj-j', owner: 'P', user_id: owner.id });
    const res = await fetch(`${baseUrl}/keys/${key.key}/usage`, { headers: authed(outsider) });
    assert.strictEqual(res.status, 403);
  });

  it('allows X-Admin-Key regardless of membership', async () => {
    const key = createKey(db, { key: 'proj-k', owner: 'P', user_id: owner.id });
    const res = await fetch(`${baseUrl}/keys/${key.key}/usage`, { headers: { 'X-Admin-Key': ADMIN_KEY } });
    assert.strictEqual(res.status, 200);
  });
});
