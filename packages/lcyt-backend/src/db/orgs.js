import { inTx } from './keys.js';
import { sqlNow } from './helpers.js';
import {
  clearOrgFeatureOverride,
  KNOWN_FEATURE_CODES,
  setOrgFeatureOverride,
  getOrgFeatureOverrides,
} from './project-features.js';

const mapProject = (project) => ({
  key: project.key,
  owner: project.owner,
  createdAt: project.created_at,
  active: project.active === 1,
  email: project.email,
  userId: project.user_id,
  orgId: project.org_id,
});

const PROJECT_SELECT = { key: true, owner: true, created_at: true, active: true, email: true, user_id: true, org_id: true };

/** @param {import('./connection.js').Db} db */
export async function getOrgMembership(db, orgId, userId) {
  const om = await db.org_members.findUnique({
    where: { org_id_user_id: { org_id: orgId, user_id: userId } },
    select: { role: true, invited_by: true, joined_at: true, organizations: { select: { owner_user_id: true } } },
  });
  if (!om) return null;
  return { role: om.role, invited_by: om.invited_by, joined_at: om.joined_at, owner_user_id: om.organizations.owner_user_id };
}

/**
 * @param {import('./connection.js').Db} db
 * @returns {Promise<boolean>}
 */
export async function slugExists(db, slug) {
  return (await db.organizations.count({ where: { slug } })) > 0;
}

/** @param {import('./connection.js').Db} db */
export async function buildUniqueSlug(db, base) {
  const slugBase = String(base || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'team';
  let slug = slugBase;
  let counter = 2;
  while (await slugExists(db, slug)) {
    slug = `${slugBase}-${counter}`;
    counter += 1;
  }
  return slug;
}

/** @param {import('./connection.js').Db} db */
export async function listOrganizationsForUser(db, userId) {
  const rows = await db.org_members.findMany({
    where: { user_id: userId },
    select: { role: true, organizations: { select: { id: true, name: true, slug: true, owner_user_id: true, created_at: true } } },
  });
  rows.sort((a, b) => (a.organizations.created_at < b.organizations.created_at ? 1 : a.organizations.created_at > b.organizations.created_at ? -1 : 0));

  const out = [];
  for (const { role, organizations: o } of rows) {
    out.push({
      id: o.id,
      name: o.name,
      slug: o.slug,
      ownerUserId: o.owner_user_id,
      createdAt: o.created_at,
      role,
      memberCount: await db.org_members.count({ where: { org_id: o.id } }),
      projectCount: await db.api_keys.count({ where: { org_id: o.id } }),
    });
  }
  return out;
}

/** @param {import('./connection.js').Db} db */
export async function getOrganizationDetails(db, orgId) {
  const org = await db.organizations.findUnique({
    where: { id: orgId },
    select: { id: true, name: true, slug: true, owner_user_id: true, project_slug_policy: true, created_at: true },
  });
  if (!org) return null;

  const members = await db.org_members.findMany({
    where: { org_id: orgId },
    select: { id: true, org_id: true, user_id: true, role: true, invited_by: true, joined_at: true, users_org_members_user_idTousers: { select: { email: true, name: true } } },
    orderBy: [{ joined_at: 'asc' }, { id: 'asc' }],
  });

  const projects = await db.api_keys.findMany({
    where: { org_id: orgId }, select: PROJECT_SELECT, orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
  });

  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    projectSlugPolicy: org.project_slug_policy ?? 'none',
    ownerUserId: org.owner_user_id,
    createdAt: org.created_at,
    members: members.map(member => ({
      id: member.id,
      userId: member.user_id,
      email: member.users_org_members_user_idTousers.email,
      name: member.users_org_members_user_idTousers.name,
      role: member.role,
      invitedBy: member.invited_by,
      joinedAt: member.joined_at,
    })),
    projects: projects.map(mapProject),
  };
}

/** @param {import('./connection.js').Db} db */
export async function createOrganization(db, { name, slug, ownerUserId }) {
  return inTx(db, async (tx) => {
    const now = sqlNow();
    const org = await tx.organizations.create({
      data: { name, slug, owner_user_id: ownerUserId, created_at: now },
    });
    await tx.org_members.create({
      data: { org_id: org.id, user_id: ownerUserId, role: 'owner', invited_by: ownerUserId, joined_at: now },
    });
    return { id: org.id, name, slug };
  });
}

/** @param {import('./connection.js').Db} db */
export async function updateOrganization(db, orgId, updates) {
  const data = {};
  if ('name' in updates) data.name = updates.name;
  if ('slug' in updates) data.slug = updates.slug;
  if ('projectSlugPolicy' in updates) data.project_slug_policy = updates.projectSlugPolicy;
  if (Object.keys(data).length === 0) return null;
  await db.organizations.updateMany({ where: { id: orgId }, data });
  return (await db.organizations.findUnique({
    where: { id: orgId },
    select: { id: true, name: true, slug: true, owner_user_id: true, project_slug_policy: true, created_at: true },
  })) ?? undefined;
}

/**
 * Delete an organization. `api_keys.org_id` has no ON DELETE action (it must
 * stay usable for projects created before an org existed), so a project
 * attached to this org would otherwise block the delete under live FK
 * enforcement — and per the Caption Target Architecture convention, an org
 * vanishing must never delete or break its projects. Detach them (SET
 * org_id = NULL) before deleting the org row; org_members/org_feature_overrides
 * are ON DELETE CASCADE and are cleaned up by the engine.
 * @param {import('./connection.js').Db} db
 * @param {number} orgId
 * @returns {Promise<boolean>} true if a row was deleted
 */
export async function deleteOrganization(db, orgId) {
  return inTx(db, async (tx) => {
    await tx.api_keys.updateMany({ where: { org_id: orgId }, data: { org_id: null } });
    return (await tx.organizations.deleteMany({ where: { id: orgId } })).count > 0;
  });
}

/**
 * Resolve every organization owned by `userId` (`organizations.owner_user_id`,
 * NOT NULL + no ON DELETE action — it can never be left dangling or nulled)
 * before that user is deleted. For each owned org:
 *   - if another member exists, promote the highest-ranked one (admin over
 *     editor/operator/viewer, then earliest-joined) to owner and transfer
 *     `owner_user_id`;
 *   - otherwise (the user is the org's sole member) the org has no one left
 *     to own it, so it is torn down: member projects are detached
 *     (`api_keys.org_id = NULL`, same semantic as deleteOrganization) and the
 *     org row is deleted (org_members/org_feature_overrides cascade).
 * Callers that want to preserve a multi-member org's ownership unchanged
 * should block/require confirmation *before* calling this (see
 * `DELETE /auth/me`'s sole-owner check and `DELETE /admin/users/:id`'s
 * `ownedOrgs` guard) — this function always resolves ownership one way or
 * the other so the subsequent `DELETE FROM users` never violates the FK.
 * @param {import('./connection.js').Db} db
 * @param {number} userId
 * @returns {Promise<{ reassigned: Array<{orgId: number, newOwnerUserId: number}>, deleted: number[] }>}
 */
export async function reassignOrDeleteOwnedOrgs(db, userId) {
  const ownedOrgs = await db.organizations.findMany({ where: { owner_user_id: userId }, select: { id: true }, orderBy: { id: 'asc' } });
  const result = { reassigned: [], deleted: [] };
  const rank = { admin: 0, editor: 1, operator: 2 };

  for (const { id: orgId } of ownedOrgs) {
    const others = await db.org_members.findMany({
      where: { org_id: orgId, user_id: { not: userId } },
      select: { user_id: true, role: true, joined_at: true },
      orderBy: [{ joined_at: 'asc' }, { id: 'asc' }],
    });
    others.sort((a, b) => (rank[a.role] ?? 3) - (rank[b.role] ?? 3)); // stable: earliest joined first within a rank
    const nextOwner = others[0];

    if (nextOwner) {
      await db.organizations.updateMany({ where: { id: orgId }, data: { owner_user_id: nextOwner.user_id } });
      await db.org_members.updateMany({ where: { org_id: orgId, user_id: nextOwner.user_id }, data: { role: 'owner' } });
      result.reassigned.push({ orgId, newOwnerUserId: nextOwner.user_id });
    } else {
      await db.api_keys.updateMany({ where: { org_id: orgId }, data: { org_id: null } });
      await db.organizations.deleteMany({ where: { id: orgId } });
      result.deleted.push(orgId);
    }
  }

  return result;
}

/** @param {import('./connection.js').Db} db */
export async function listOrganizationMembers(db, orgId) {
  const rows = await db.org_members.findMany({
    where: { org_id: orgId },
    select: { id: true, user_id: true, role: true, invited_by: true, joined_at: true, users_org_members_user_idTousers: { select: { email: true, name: true } } },
    orderBy: [{ joined_at: 'asc' }, { id: 'asc' }],
  });
  const projectCount = await db.api_keys.count({ where: { org_id: orgId } });

  return rows.map(row => ({
    id: row.id,
    userId: row.user_id,
    email: row.users_org_members_user_idTousers.email,
    name: row.users_org_members_user_idTousers.name,
    role: row.role,
    invitedBy: row.invited_by,
    joinedAt: row.joined_at,
    projectCount,
  }));
}

/** @param {import('./connection.js').Db} db */
export async function getOrganizationMember(db, orgId, userId) {
  return (await db.org_members.findUnique({
    where: { org_id_user_id: { org_id: orgId, user_id: userId } }, select: { role: true },
  })) || null;
}

/** @param {import('./connection.js').Db} db */
export async function createOrganizationMember(db, { orgId, userId, role, invitedBy }) {
  const row = await db.org_members.create({
    data: { org_id: orgId, user_id: userId, role, invited_by: invitedBy ?? null, joined_at: sqlNow() },
  });
  return {
    id: row.id,
    userId,
    role,
    invitedBy,
    joinedAt: new Date().toISOString(),
  };
}

/** @param {import('./connection.js').Db} db */
export async function updateOrganizationMemberRole(db, { orgId, userId, role }) {
  await db.org_members.updateMany({ where: { org_id: orgId, user_id: userId }, data: { role } });
  return { userId, role };
}

/** @param {import('./connection.js').Db} db */
export async function removeOrganizationMember(db, { orgId, userId }) {
  await db.org_members.deleteMany({ where: { org_id: orgId, user_id: userId } });
}

/** @param {import('./connection.js').Db} db */
export async function listOrganizationProjects(db, orgId) {
  const rows = await db.api_keys.findMany({
    where: { org_id: orgId }, select: PROJECT_SELECT, orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
  });
  return rows.map(mapProject);
}

/** @param {import('./connection.js').Db} db */
export async function getOrganizationFeatureCodes(db, orgId) {
  return (await getOrgFeatureOverrides(db, orgId))
    .filter(row => row.mode === 'available')
    .map(row => row.feature_code);
}

/** @param {import('./connection.js').Db} db */
export async function setOrganizationFeatureCodes(db, { orgId, userId, features }) {
  const requested = Array.isArray(features) ? features : [];
  const normalized = requested.filter(code => typeof code === 'string' && KNOWN_FEATURE_CODES.has(code));
  const existing = new Set((await getOrgFeatureOverrides(db, orgId)).map(row => row.feature_code));

  await inTx(db, async (tx) => {
    for (const code of existing) {
      if (!normalized.includes(code)) await clearOrgFeatureOverride(tx, orgId, code);
    }
    for (const code of normalized) {
      await setOrgFeatureOverride(tx, orgId, code, 'available', userId);
    }
  });

  return getOrganizationFeatureCodes(db, orgId);
}
