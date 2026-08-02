/**
 * GET /keys (user-scoped listing, `_userListKeys` in routes/keys.js) —
 * accessible-projects fix (plan_project_roles.md / CONSIDER.md).
 *
 * Previously this endpoint only ever returned projects the caller directly
 * owned (`getKeysByUserId`) and hardcoded `myAccessLevel: 'owner'` on every
 * row, so an invited project member or an org-baseline/org-admin-override
 * user had no way to see a project they had real access to. It now uses
 * `getAccessibleProjectsForUser()` (db/project-members.js), which unions
 * directly-owned projects, explicit `project_members` rows, and team-visible
 * org-baseline access, each with its real effective access level.
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

const JWT_SECRET = 'test-accessible-listing-secret';

let server, baseUrl, db;
let owner, orgAdmin, orgViewer, explicitEditor, stranger;
let teamVisibleKey, restrictedKey, ownedKey;

before(() => new Promise((resolve) => {
  db = initDb(':memory:');
  const app = express();
  app.use(express.json());
  app.use('/keys', createKeysRouter(db, { loginEnabled: true, jwtSecret: JWT_SECRET }));

  owner = createUser(db, { email: 'owner@example.com', passwordHash: 'x' });
  orgAdmin = createUser(db, { email: 'org-admin@example.com', passwordHash: 'x' });
  orgViewer = createUser(db, { email: 'org-viewer@example.com', passwordHash: 'x' });
  explicitEditor = createUser(db, { email: 'explicit-editor@example.com', passwordHash: 'x' });
  stranger = createUser(db, { email: 'stranger@example.com', passwordHash: 'x' });

  const org = createOrganization(db, { name: 'Team', slug: 'team', ownerUserId: owner.id });
  createOrganizationMember(db, { orgId: org.id, userId: orgAdmin.id, role: 'admin', invitedBy: owner.id });
  createOrganizationMember(db, { orgId: org.id, userId: orgViewer.id, role: 'viewer', invitedBy: owner.id });
  // explicitEditor and stranger are deliberately NOT org members.

  // Team-visible (default restricted=0) project with an org, an explicit
  // editor member, and org-baseline/org-admin-override reachable.
  teamVisibleKey = createKey(db, { owner: 'Team-visible project', user_id: owner.id, org_id: org.id }).key;
  addMember(db, teamVisibleKey, explicitEditor.id, 'editor', owner.id);

  // Restricted (private) project in the same org — org baseline/override
  // must contribute nothing here, even for the org admin.
  restrictedKey = createKey(db, { owner: 'Restricted project', user_id: owner.id, org_id: org.id }).key;
  db.prepare('UPDATE api_keys SET restricted = 1 WHERE key = ?').run(restrictedKey);

  // Plain owned project, no org at all.
  ownedKey = createKey(db, { owner: 'No-org project', user_id: owner.id }).key;

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

async function listKeys(user) {
  const res = await fetch(`${baseUrl}/keys`, { headers: { Authorization: `Bearer ${tokenFor(user)}` } });
  assert.equal(res.status, 200);
  return res.json();
}

function findByKey(keys, key) {
  return keys.find(k => k.key === key);
}

describe('GET /keys — accessible-projects listing', () => {
  it('owner sees every owned project, myAccessLevel "owner"', async () => {
    const { keys } = await listKeys(owner);
    assert.equal(findByKey(keys, teamVisibleKey)?.myAccessLevel, 'owner');
    assert.equal(findByKey(keys, restrictedKey)?.myAccessLevel, 'owner');
    assert.equal(findByKey(keys, ownedKey)?.myAccessLevel, 'owner');
  });

  it('an explicitly-invited member sees the project via their explicit role, not ownership', async () => {
    const { keys } = await listKeys(explicitEditor);
    const row = findByKey(keys, teamVisibleKey);
    assert.ok(row, 'explicit member should see the project in their listing');
    assert.equal(row.myAccessLevel, 'editor');
    // Never granted access to the owner's other, unrelated projects.
    assert.equal(findByKey(keys, restrictedKey), undefined);
    assert.equal(findByKey(keys, ownedKey), undefined);
  });

  it('an org admin sees a team-visible project via the unconditional override, with no explicit membership row', async () => {
    const { keys } = await listKeys(orgAdmin);
    const row = findByKey(keys, teamVisibleKey);
    assert.ok(row, 'org admin should see the team-visible project');
    assert.equal(row.myAccessLevel, 'admin');
  });

  it('an org admin does NOT see a restricted project in the same org (override never applies)', async () => {
    const { keys } = await listKeys(orgAdmin);
    assert.equal(findByKey(keys, restrictedKey), undefined);
  });

  it('an ordinary org member sees the team-visible project via the baseline ceiling', async () => {
    const { keys } = await listKeys(orgViewer);
    const row = findByKey(keys, teamVisibleKey);
    assert.ok(row, 'ordinary org member should see the team-visible project');
    assert.equal(row.myAccessLevel, 'viewer'); // default org_baseline_role
  });

  it('an ordinary org member does NOT see the restricted project', async () => {
    const { keys } = await listKeys(orgViewer);
    assert.equal(findByKey(keys, restrictedKey), undefined);
  });

  it('a stranger with no relationship sees nothing', async () => {
    const { keys } = await listKeys(stranger);
    assert.equal(findByKey(keys, teamVisibleKey), undefined);
    assert.equal(findByKey(keys, restrictedKey), undefined);
    assert.equal(findByKey(keys, ownedKey), undefined);
  });

  it('a project with no org behaves exactly like plain ownership (no duplicate/phantom rows)', async () => {
    const { keys } = await listKeys(owner);
    const matches = keys.filter(k => k.key === ownedKey);
    assert.equal(matches.length, 1);
  });
});
