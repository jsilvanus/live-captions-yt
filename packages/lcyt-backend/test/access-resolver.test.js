/**
 * getEffectiveProjectAccessLevel() — org-baseline-plus-project-override
 * resolver (plan_team_org_backend.md). Combines explicit project_members
 * roles with an org-membership baseline of 'member'.
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

before(() => {
  db = initDb(':memory:');
});

after(() => {
  db.close();
});

beforeEach(() => {
  db.prepare('DELETE FROM project_member_permissions').run();
  db.prepare('DELETE FROM project_members').run();
  db.prepare('DELETE FROM org_members').run();
  db.prepare('DELETE FROM api_keys').run();
  db.prepare('DELETE FROM organizations').run();
  db.prepare('DELETE FROM users').run();

  owner = createUser(db, { email: 'owner@example.com', passwordHash: 'hash', name: 'Owner' });
  member = createUser(db, { email: 'member@example.com', passwordHash: 'hash', name: 'Member' });
  stranger = createUser(db, { email: 'stranger@example.com', passwordHash: 'hash', name: 'Stranger' });
});

describe('getEffectiveProjectAccessLevel', () => {
  it('grants org baseline "member" when the user has org membership but no explicit project row', () => {
    const org = createOrganization(db, { name: 'Team', slug: 'team', ownerUserId: owner.id });
    createOrganizationMember(db, { orgId: org.id, userId: member.id, role: 'operator', invitedBy: owner.id });
    const key = createKey(db, { key: 'proj-1', owner: 'proj-1', user_id: owner.id, org_id: org.id });

    const level = getEffectiveProjectAccessLevel(db, key.key, member.id);
    assert.strictEqual(level, 'member');
  });

  it('lets an explicit role win when it is higher than the org baseline', () => {
    const org = createOrganization(db, { name: 'Team', slug: 'team', ownerUserId: owner.id });
    createOrganizationMember(db, { orgId: org.id, userId: member.id, role: 'viewer', invitedBy: owner.id });
    const key = createKey(db, { key: 'proj-2', owner: 'proj-2', user_id: owner.id, org_id: org.id });
    addMember(db, key.key, member.id, 'admin', owner.id);

    const level = getEffectiveProjectAccessLevel(db, key.key, member.id);
    assert.strictEqual(level, 'admin');
  });

  it('does not escalate when the explicit role equals the org baseline (member + member = member)', () => {
    const org = createOrganization(db, { name: 'Team', slug: 'team', ownerUserId: owner.id });
    createOrganizationMember(db, { orgId: org.id, userId: member.id, role: 'admin', invitedBy: owner.id });
    const key = createKey(db, { key: 'proj-3', owner: 'proj-3', user_id: owner.id, org_id: org.id });
    addMember(db, key.key, member.id, 'member', owner.id);

    const level = getEffectiveProjectAccessLevel(db, key.key, member.id);
    assert.strictEqual(level, 'member');
  });

  it('gives zero org-baseline contribution when the project is restricted, even with real org membership', () => {
    const org = createOrganization(db, { name: 'Team', slug: 'team', ownerUserId: owner.id });
    createOrganizationMember(db, { orgId: org.id, userId: member.id, role: 'admin', invitedBy: owner.id });
    const key = createKey(db, { key: 'proj-4', owner: 'proj-4', user_id: owner.id, org_id: org.id });
    db.prepare('UPDATE api_keys SET restricted = 1 WHERE key = ?').run(key.key);

    const level = getEffectiveProjectAccessLevel(db, key.key, member.id);
    assert.strictEqual(level, null, 'org membership must not grant access to a restricted project');
  });

  it('still lets an explicit project_members row grant access on a restricted project', () => {
    const org = createOrganization(db, { name: 'Team', slug: 'team', ownerUserId: owner.id });
    createOrganizationMember(db, { orgId: org.id, userId: member.id, role: 'admin', invitedBy: owner.id });
    const key = createKey(db, { key: 'proj-4b', owner: 'proj-4b', user_id: owner.id, org_id: org.id });
    db.prepare('UPDATE api_keys SET restricted = 1 WHERE key = ?').run(key.key);
    addMember(db, key.key, member.id, 'member', owner.id);

    const level = getEffectiveProjectAccessLevel(db, key.key, member.id);
    assert.strictEqual(level, 'member');
  });

  it('behaves exactly like the explicit-only lookup for a project with no org_id (regression)', () => {
    const key = createKey(db, { key: 'proj-5', owner: 'proj-5', user_id: owner.id });
    addMember(db, key.key, member.id, 'admin', owner.id);

    assert.strictEqual(getEffectiveProjectAccessLevel(db, key.key, member.id), 'admin');
    assert.strictEqual(getEffectiveProjectAccessLevel(db, key.key, stranger.id), null);
  });

  it('grants project baseline "member" for org membership via any of the 5 org roles', () => {
    // Each role gets its own org (an org can only have one 'owner' row) with a
    // project created by an unrelated third user, so the role-under-test's
    // access is purely the org baseline, never an explicit row or the
    // project-creator shortcut.
    let n = 0;
    for (const role of ['owner', 'admin', 'editor', 'operator', 'viewer']) {
      n += 1;
      const orgOwner = createUser(db, { email: `org${n}-creator@example.com`, passwordHash: 'hash' });
      const projCreator = createUser(db, { email: `org${n}-projcreator@example.com`, passwordHash: 'hash' });
      const org = createOrganization(db, { name: `Team ${n}`, slug: `team-${n}`, ownerUserId: orgOwner.id });
      const key = createKey(db, { key: `proj-6-${n}`, owner: `proj-6-${n}`, user_id: projCreator.id, org_id: org.id });

      const u = role === 'owner'
        ? orgOwner
        : createUser(db, { email: `org${n}-${role}@example.com`, passwordHash: 'hash', name: role });
      if (role !== 'owner') {
        createOrganizationMember(db, { orgId: org.id, userId: u.id, role, invitedBy: orgOwner.id });
      }

      const level = getEffectiveProjectAccessLevel(db, key.key, u.id);
      assert.strictEqual(level, 'member', `org role "${role}" should still grant project baseline member`);
    }
  });

  it('returns null for a user with no org membership and no explicit project role', () => {
    const org = createOrganization(db, { name: 'Team', slug: 'team', ownerUserId: owner.id });
    const key = createKey(db, { key: 'proj-7', owner: 'proj-7', user_id: owner.id, org_id: org.id });

    const level = getEffectiveProjectAccessLevel(db, key.key, stranger.id);
    assert.strictEqual(level, null);
  });

  it('gives the project-creator-owner shortcut regardless of org membership (getMemberAccessLevel fallback)', () => {
    const org = createOrganization(db, { name: 'Team', slug: 'team', ownerUserId: owner.id });
    const key = createKey(db, { key: 'proj-8', owner: 'proj-8', user_id: owner.id, org_id: org.id });

    const level = getEffectiveProjectAccessLevel(db, key.key, owner.id);
    assert.strictEqual(level, 'owner');
  });
});
