/**
 * getEffectiveProjectAccessLevel() — org-baseline-plus-project-override
 * resolver. Combines explicit project_members roles (owner/admin/editor/
 * operator/viewer) with an org-membership baseline: an org owner/admin
 * resolves unconditionally to project 'admin' on a team-visible project;
 * any other org role resolves to the project's configurable ceiling
 * (api_keys.org_baseline_role, 'viewer' or 'editor', default 'viewer').
 * (plan_project_roles.md, decided 2026-07-26 — supersedes the old flat
 * 'member' baseline from plan_team_org_backend.md.)
 */
import { before, after, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert';
import { initDb } from '../src/db.js';
import { createUser } from '../src/db/users.js';
import { createKey } from '../src/db/keys.js';
import { createOrganization, createOrganizationMember } from '../src/db/orgs.js';
import { addMember, getEffectiveProjectAccessLevel } from '../src/db/project-members.js';

let db;
let owner;
let member;
let stranger;

before(async () => {
  db = await initDb(':memory:');
});

after(() => {
  db.close();
});

beforeEach(async () => {
  await db.prepare('DELETE FROM project_member_permissions').run();
  await db.prepare('DELETE FROM project_members').run();
  await db.prepare('DELETE FROM org_members').run();
  await db.prepare('DELETE FROM api_keys').run();
  await db.prepare('DELETE FROM organizations').run();
  await db.prepare('DELETE FROM users').run();

  owner = await createUser(db, { email: 'owner@example.com', passwordHash: 'hash', name: 'Owner' });
  member = await createUser(db, { email: 'member@example.com', passwordHash: 'hash', name: 'Member' });
  stranger = await createUser(db, { email: 'stranger@example.com', passwordHash: 'hash', name: 'Stranger' });
});

describe('getEffectiveProjectAccessLevel', () => {
  it('grants the default ceiling ("viewer") for an ordinary org member with no explicit project row', async () => {
    const org = await createOrganization(db, { name: 'Team', slug: 'team', ownerUserId: owner.id });
    await createOrganizationMember(db, { orgId: org.id, userId: member.id, role: 'operator', invitedBy: owner.id });
    const key = await createKey(db, { key: 'proj-1', owner: 'proj-1', user_id: owner.id, org_id: org.id });

    const level = await getEffectiveProjectAccessLevel(db, key.key, member.id);
    assert.strictEqual(level, 'viewer');
  });

  it('grants the "editor" ceiling when the project raises it', async () => {
    const org = await createOrganization(db, { name: 'Team', slug: 'team', ownerUserId: owner.id });
    await createOrganizationMember(db, { orgId: org.id, userId: member.id, role: 'editor', invitedBy: owner.id });
    const key = await createKey(db, { key: 'proj-1b', owner: 'proj-1b', user_id: owner.id, org_id: org.id });
    await db.prepare("UPDATE api_keys SET org_baseline_role = 'editor' WHERE key = ?").run(key.key);

    const level = await getEffectiveProjectAccessLevel(db, key.key, member.id);
    assert.strictEqual(level, 'editor');
  });

  it('gives an org owner project "admin" unconditionally, ignoring the ceiling', async () => {
    const org = await createOrganization(db, { name: 'Team', slug: 'team', ownerUserId: owner.id });
    const key = await createKey(db, { key: 'proj-1c', owner: 'proj-1c', user_id: stranger.id, org_id: org.id });
    // Ceiling stays at the default 'viewer' — the org owner must still get 'admin'.

    const level = await getEffectiveProjectAccessLevel(db, key.key, owner.id);
    assert.strictEqual(level, 'admin');
  });

  it('gives an org admin project "admin" unconditionally, ignoring the ceiling', async () => {
    const org = await createOrganization(db, { name: 'Team', slug: 'team', ownerUserId: owner.id });
    await createOrganizationMember(db, { orgId: org.id, userId: member.id, role: 'admin', invitedBy: owner.id });
    const key = await createKey(db, { key: 'proj-1d', owner: 'proj-1d', user_id: owner.id, org_id: org.id });

    const level = await getEffectiveProjectAccessLevel(db, key.key, member.id);
    assert.strictEqual(level, 'admin');
  });

  it('never gives an ordinary org member project "admin" via the ceiling, even if misconfigured', async () => {
    const org = await createOrganization(db, { name: 'Team', slug: 'team', ownerUserId: owner.id });
    await createOrganizationMember(db, { orgId: org.id, userId: member.id, role: 'viewer', invitedBy: owner.id });
    const key = await createKey(db, { key: 'proj-1e', owner: 'proj-1e', user_id: owner.id, org_id: org.id });
    // Column has no DB-level CHECK constraint; simulate a bad value and confirm the
    // resolver still won't treat it as 'editor' (falls back to 'viewer').
    await db.prepare("UPDATE api_keys SET org_baseline_role = 'admin' WHERE key = ?").run(key.key);

    const level = await getEffectiveProjectAccessLevel(db, key.key, member.id);
    assert.strictEqual(level, 'viewer');
  });

  it('lets an explicit role win when it is higher than the org baseline', async () => {
    const org = await createOrganization(db, { name: 'Team', slug: 'team', ownerUserId: owner.id });
    await createOrganizationMember(db, { orgId: org.id, userId: member.id, role: 'viewer', invitedBy: owner.id });
    const key = await createKey(db, { key: 'proj-2', owner: 'proj-2', user_id: owner.id, org_id: org.id });
    await addMember(db, key.key, member.id, 'operator', owner.id);

    const level = await getEffectiveProjectAccessLevel(db, key.key, member.id);
    assert.strictEqual(level, 'operator');
  });

  it('lets the org-admin override win over a lower explicit project role', async () => {
    const org = await createOrganization(db, { name: 'Team', slug: 'team', ownerUserId: owner.id });
    await createOrganizationMember(db, { orgId: org.id, userId: member.id, role: 'admin', invitedBy: owner.id });
    const key = await createKey(db, { key: 'proj-3', owner: 'proj-3', user_id: owner.id, org_id: org.id });
    await addMember(db, key.key, member.id, 'editor', owner.id);

    const level = await getEffectiveProjectAccessLevel(db, key.key, member.id);
    assert.strictEqual(level, 'admin');
  });

  it('gives zero org-baseline contribution when the project is restricted, even for an org admin', async () => {
    const org = await createOrganization(db, { name: 'Team', slug: 'team', ownerUserId: owner.id });
    await createOrganizationMember(db, { orgId: org.id, userId: member.id, role: 'admin', invitedBy: owner.id });
    const key = await createKey(db, { key: 'proj-4', owner: 'proj-4', user_id: owner.id, org_id: org.id });
    await db.prepare('UPDATE api_keys SET restricted = 1 WHERE key = ?').run(key.key);

    const level = await getEffectiveProjectAccessLevel(db, key.key, member.id);
    assert.strictEqual(level, null, 'org membership must not grant access to a restricted project, admin override included');
  });

  it('still lets an explicit project_members row grant access on a restricted project', async () => {
    const org = await createOrganization(db, { name: 'Team', slug: 'team', ownerUserId: owner.id });
    await createOrganizationMember(db, { orgId: org.id, userId: member.id, role: 'admin', invitedBy: owner.id });
    const key = await createKey(db, { key: 'proj-4b', owner: 'proj-4b', user_id: owner.id, org_id: org.id });
    await db.prepare('UPDATE api_keys SET restricted = 1 WHERE key = ?').run(key.key);
    await addMember(db, key.key, member.id, 'editor', owner.id);

    const level = await getEffectiveProjectAccessLevel(db, key.key, member.id);
    assert.strictEqual(level, 'editor');
  });

  it('behaves exactly like the explicit-only lookup for a project with no org_id (regression)', async () => {
    const key = await createKey(db, { key: 'proj-5', owner: 'proj-5', user_id: owner.id });
    await addMember(db, key.key, member.id, 'admin', owner.id);

    assert.strictEqual(await getEffectiveProjectAccessLevel(db, key.key, member.id), 'admin');
    assert.strictEqual(await getEffectiveProjectAccessLevel(db, key.key, stranger.id), null);
  });

  it('resolves each of the 5 org roles to the correct project baseline', async () => {
    // Each role gets its own org (an org can only have one 'owner' row) with a
    // project created by an unrelated third user, so the role-under-test's
    // access is purely the org baseline, never an explicit row or the
    // project-creator shortcut.
    const expected = { owner: 'admin', admin: 'admin', editor: 'viewer', operator: 'viewer', viewer: 'viewer' };
    let n = 0;
    for (const role of ['owner', 'admin', 'editor', 'operator', 'viewer']) {
      n += 1;
      const orgOwner = await createUser(db, { email: `org${n}-creator@example.com`, passwordHash: 'hash' });
      const projCreator = await createUser(db, { email: `org${n}-projcreator@example.com`, passwordHash: 'hash' });
      const org = await createOrganization(db, { name: `Team ${n}`, slug: `team-${n}`, ownerUserId: orgOwner.id });
      const key = await createKey(db, { key: `proj-6-${n}`, owner: `proj-6-${n}`, user_id: projCreator.id, org_id: org.id });

      const u = role === 'owner'
        ? orgOwner
        : await createUser(db, { email: `org${n}-${role}@example.com`, passwordHash: 'hash', name: role });
      if (role !== 'owner') {
        await createOrganizationMember(db, { orgId: org.id, userId: u.id, role, invitedBy: orgOwner.id });
      }

      const level = await getEffectiveProjectAccessLevel(db, key.key, u.id);
      assert.strictEqual(level, expected[role], `org role "${role}" should resolve to project "${expected[role]}"`);
    }
  });

  it('returns null for a user with no org membership and no explicit project role', async () => {
    const org = await createOrganization(db, { name: 'Team', slug: 'team', ownerUserId: owner.id });
    const key = await createKey(db, { key: 'proj-7', owner: 'proj-7', user_id: owner.id, org_id: org.id });

    const level = await getEffectiveProjectAccessLevel(db, key.key, stranger.id);
    assert.strictEqual(level, null);
  });

  it('gives the project-creator-owner shortcut regardless of org membership (getMemberAccessLevel fallback)', async () => {
    const org = await createOrganization(db, { name: 'Team', slug: 'team', ownerUserId: owner.id });
    const key = await createKey(db, { key: 'proj-8', owner: 'proj-8', user_id: owner.id, org_id: org.id });

    const level = await getEffectiveProjectAccessLevel(db, key.key, owner.id);
    assert.strictEqual(level, 'owner');
  });
});
