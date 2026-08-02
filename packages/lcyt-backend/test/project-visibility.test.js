/**
 * PATCH /keys/:key/visibility — team visibility (restricted) + org-baseline
 * ceiling (orgBaselineRole) (plan_project_roles.md, decided 2026-07-26).
 * Setup-tier: explicit project owner/admin, or an org owner/admin's
 * unconditional override — never the ordinary org-baseline ceiling itself.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import { initDb, createKey } from '../src/db.js';
import { createUser } from '../src/db/users.js';
import { createOrganization, createOrganizationMember } from '../src/db/orgs.js';
import { addMember } from '../src/db/project-members.js';
import { createKeysRouter } from '../src/routes/keys.js';

const JWT_SECRET = 'test-visibility-secret';

let server, baseUrl, db;
let apiKey, orgAdmin, orgViewer, explicitEditor, stranger;

before(() => new Promise((resolve) => {
  db = initDb(':memory:');
  const app = express();
  app.use(express.json());
  app.use('/keys', createKeysRouter(db, { loginEnabled: true, jwtSecret: JWT_SECRET }));

  const creator = createUser(db, { email: 'creator@example.com', passwordHash: 'x' });
  orgAdmin = createUser(db, { email: 'org-admin@example.com', passwordHash: 'x' });
  orgViewer = createUser(db, { email: 'org-viewer@example.com', passwordHash: 'x' });
  explicitEditor = createUser(db, { email: 'explicit-editor@example.com', passwordHash: 'x' });
  stranger = createUser(db, { email: 'stranger@example.com', passwordHash: 'x' });

  const org = createOrganization(db, { name: 'Team', slug: 'team', ownerUserId: creator.id });
  createOrganizationMember(db, { orgId: org.id, userId: orgAdmin.id, role: 'admin', invitedBy: creator.id });
  createOrganizationMember(db, { orgId: org.id, userId: orgViewer.id, role: 'viewer', invitedBy: creator.id });

  apiKey = createKey(db, { owner: 'proj', user_id: creator.id, org_id: org.id }).key;
  addMember(db, apiKey, explicitEditor.id, 'editor', creator.id);

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

function tokenFor(user) {
  return jwt.sign({ type: 'user', userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '1h' });
}

async function patchVisibility(user, body) {
  return fetch(`${baseUrl}/keys/${apiKey}/visibility`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${tokenFor(user)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('PATCH /keys/:key/visibility', () => {
  it('403s an explicit editor (below admin)', async () => {
    const res = await patchVisibility(explicitEditor, { restricted: false, orgBaselineRole: 'editor' });
    assert.equal(res.status, 403);
  });

  it('403s an ordinary org member (viewer-tier org role, ceiling only)', async () => {
    const res = await patchVisibility(orgViewer, { orgBaselineRole: 'editor' });
    assert.equal(res.status, 403);
  });

  it('403s a stranger with no relationship to the project', async () => {
    const res = await patchVisibility(stranger, { restricted: true });
    assert.equal(res.status, 403);
  });

  it('lets an org admin set it via the unconditional override, without any explicit project_members row', async () => {
    const res = await patchVisibility(orgAdmin, { restricted: false, orgBaselineRole: 'editor' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.restricted, false);
    assert.equal(body.orgBaselineRole, 'editor');
  });

  it('persists across calls (second PATCH reflects the change made by the first)', async () => {
    // Deliberately never sets restricted: true here — an org-admin-only actor
    // (no explicit project_members row, relying purely on the override) would
    // lock themselves out of their own next call, since restricted blocks the
    // override too (see access-resolver.test.js's matching case). That's
    // correct product behavior, just not what this test is checking.
    await patchVisibility(orgAdmin, { orgBaselineRole: 'viewer' });
    const res = await patchVisibility(orgAdmin, { orgBaselineRole: 'editor' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.orgBaselineRole, 'editor');
    assert.equal(body.restricted, false, 'restricted should be unaffected by an orgBaselineRole-only patch');
  });

  it('rejects an invalid orgBaselineRole value', async () => {
    const res = await patchVisibility(orgAdmin, { orgBaselineRole: 'admin' });
    assert.equal(res.status, 400);
  });

  it('400s an empty body', async () => {
    const res = await patchVisibility(orgAdmin, {});
    assert.equal(res.status, 400);
  });

  it('404s an unknown project key', async () => {
    const res = await fetch(`${baseUrl}/keys/does-not-exist/visibility`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${tokenFor(orgAdmin)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ restricted: true }),
    });
    assert.equal(res.status, 404);
  });
});
