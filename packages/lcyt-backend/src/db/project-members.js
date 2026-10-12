/**
 * Project membership helpers.
 *
 * Access levels: 'owner' | 'admin' | 'editor' | 'operator' | 'viewer'
 * (plan_project_roles.md, decided 2026-07-26 — replaces the old 'member'
 * value, migrated to 'editor' in schema.js):
 * - owner:    full access; sole holder of delete-project right; only one per project
 * - admin:    full access except cannot delete project; the only tier that can
 *             write in Setup (see requireProjectRole('setup') in middleware/
 *             project-access.js)
 * - editor:   can write in Assets (uploads, cue rules); no Setup access
 * - operator: full live-operate/Production rights (camera/mixer switching,
 *             PTZ preset recall); no Setup or Assets-write access by itself
 * - viewer:   read-only everywhere; sees Assets and produced files, not Setup
 *
 * This access_level ladder is the source of truth for the page-scoped Setup/
 * Assets/Production gates. The ROLE_BUNDLES below are a separate, older,
 * granular permission-code overlay (project_member_permissions deltas) that
 * predates that ladder and has no live route enforcement anywhere in this
 * codebase today (`memberHasPermission` has zero call sites outside this
 * file) — kept only for the project-members list UI's informational display,
 * not the thing actually gating requests.
 */
import { sqlNow } from './helpers.js';
import { getKey } from './keys.js';
import { getKeysByUserId } from './users.js';
import { getOrgMembership, listOrganizationsForUser, listOrganizationProjects } from './orgs.js';

const ROLE_BUNDLES = {
  owner:  new Set([
    'captioner', 'file-manager', 'graphics-editor', 'graphics-broadcaster',
    'production-operator', 'stream-manager', 'stt-operator', 'planner',
    'stats-viewer', 'device-manager', 'member-manager', 'settings-manager',
  ]),
  admin:  new Set([
    'captioner', 'file-manager', 'graphics-editor', 'graphics-broadcaster',
    'production-operator', 'stream-manager', 'stt-operator', 'planner',
    'stats-viewer', 'device-manager', 'member-manager', 'settings-manager',
  ]),
  editor: new Set(['captioner', 'file-manager', 'graphics-editor', 'planner', 'stats-viewer']),
  operator: new Set(['captioner', 'production-operator', 'stream-manager', 'stt-operator', 'graphics-broadcaster', 'planner', 'stats-viewer']),
  viewer: new Set(['stats-viewer']),
};

/**
 * Add a user as a project member. No-op if already a member (returns existing row).
 * @param {import('./connection.js').Db} db
 * @param {string} apiKey
 * @param {number} userId
 * @param {'owner'|'admin'|'editor'|'operator'|'viewer'} accessLevel
 * @param {number|null} [invitedBy]
 * @returns {Promise<{ id: number, api_key: string, user_id: number, access_level: string, joined_at: string }>}
 */
export async function addMember(db, apiKey, userId, accessLevel = 'editor', invitedBy = null) {
  await db.project_members.upsert({
    where: { api_key_user_id: { api_key: apiKey, user_id: userId } },
    create: { api_key: apiKey, user_id: userId, access_level: accessLevel, invited_by: invitedBy ?? null, joined_at: sqlNow() },
    update: {}, // already a member: keep the existing row
  });
  return getMember(db, apiKey, userId);
}

/**
 * Get a single member row with user email/name joined.
 * @param {import('./connection.js').Db} db
 * @param {string} apiKey
 * @param {number} userId
 * @returns {Promise<object|null>}
 */
export async function getMember(db, apiKey, userId) {
  const pm = await db.project_members.findUnique({
    where: { api_key_user_id: { api_key: apiKey, user_id: userId } },
    include: { users_project_members_user_idTousers: { select: { email: true, name: true } } },
  });
  if (!pm) return null;
  const { users_project_members_user_idTousers: u, ...row } = pm;
  return { ...row, email: u.email, name: u.name };
}

/**
 * Get all members for a project with their user info and individual permissions.
 * @param {import('./connection.js').Db} db
 * @param {string} apiKey
 * @returns {Promise<Array>}
 */
export async function getMembers(db, apiKey) {
  const pms = await db.project_members.findMany({
    where: { api_key: apiKey },
    include: { users_project_members_user_idTousers: { select: { email: true, name: true } } },
    orderBy: [{ joined_at: 'asc' }, { id: 'asc' }],
  });

  const result = [];
  for (const pm of pms) {
    result.push({
      id: pm.id,
      user_id: pm.user_id,
      access_level: pm.access_level,
      joined_at: pm.joined_at,
      email: pm.users_project_members_user_idTousers.email,
      name: pm.users_project_members_user_idTousers.name,
      permissions: await getEffectivePermissions(db, pm.id),
    });
  }
  return result;
}

/**
 * Remove a member from a project. Refuses to remove the owner.
 * @param {import('./connection.js').Db} db
 * @param {string} apiKey
 * @param {number} userId
 * @returns {Promise<{ removed: boolean, reason?: string }>}
 */
export async function removeMember(db, apiKey, userId) {
  const row = await getMember(db, apiKey, userId);
  if (!row) return { removed: false, reason: 'not_found' };
  if (row.access_level === 'owner') return { removed: false, reason: 'cannot_remove_owner' };
  await db.project_members.deleteMany({ where: { api_key: apiKey, user_id: userId } });
  return { removed: true };
}

/**
 * Update access level for a member.
 * @param {import('./connection.js').Db} db
 * @param {number} memberId
 * @param {'admin'|'member'} accessLevel
 * @returns {Promise<void>}
 */
export async function updateMemberAccessLevel(db, memberId, accessLevel) {
  await db.project_members.updateMany({ where: { id: memberId }, data: { access_level: accessLevel } });
}

/**
 * Transfer ownership from current owner to another member.
 * @param {import('./connection.js').Db} db
 * @param {string} apiKey
 * @param {number} fromUserId - current owner
 * @param {number} toUserId   - new owner (must already be a member)
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
export async function transferOwnership(db, apiKey, fromUserId, toUserId) {
  const fromMember = await getMember(db, apiKey, fromUserId);
  if (!fromMember || fromMember.access_level !== 'owner') return { ok: false, reason: 'not_owner' };
  const toMember = await getMember(db, apiKey, toUserId);
  if (!toMember) return { ok: false, reason: 'target_not_member' };

  const run = async (tx) => {
    await tx.project_members.updateMany({ where: { id: fromMember.id }, data: { access_level: 'admin' } });
    await tx.project_members.updateMany({ where: { id: toMember.id }, data: { access_level: 'owner' } });
  };
  if (typeof db.$transaction === 'function') await db.$transaction(run);
  else await run(db);
  return { ok: true };
}

/**
 * Grant or revoke an individual permission for a member.
 * @param {import('./connection.js').Db} db
 * @param {number} memberId
 * @param {string} permission
 * @param {boolean} granted
 * @returns {Promise<void>}
 */
export async function setMemberPermission(db, memberId, permission, granted) {
  const g = granted ? 1 : 0;
  await db.project_member_permissions.upsert({
    where: { member_id_permission: { member_id: memberId, permission } },
    create: { member_id: memberId, permission, granted: g },
    update: { granted: g },
  });
}

/**
 * Get the effective Set of permissions for a member (role bundle + individual overrides).
 * @param {import('./connection.js').Db} db
 * @param {number} memberId
 * @returns {Promise<string[]>} sorted array of permission codes
 */
export async function getEffectivePermissions(db, memberId) {
  const row = await db.project_members.findUnique({ where: { id: memberId }, select: { access_level: true } });
  if (!row) return [];

  const bundle = new Set(ROLE_BUNDLES[row.access_level] || []);

  const overrides = await db.project_member_permissions.findMany({
    where: { member_id: memberId },
    select: { permission: true, granted: true },
  });

  for (const { permission, granted } of overrides) {
    if (granted) bundle.add(permission);
    else bundle.delete(permission);
  }

  return [...bundle].sort();
}

/**
 * Check whether a user has a specific permission on a project.
 * @param {import('./connection.js').Db} db
 * @param {string} apiKey
 * @param {number} userId
 * @param {string} permission
 * @returns {Promise<boolean>}
 */
export async function memberHasPermission(db, apiKey, userId, permission) {
  const member = await getMember(db, apiKey, userId);
  if (!member) return false;
  const perms = await getEffectivePermissions(db, member.id);
  return perms.includes(permission);
}

/**
 * Get the access level for a user in a project, or null if not a member.
 * @param {import('./connection.js').Db} db
 * @param {string} apiKey
 * @param {number} userId
 * @returns {Promise<'owner'|'admin'|'member'|null>}
 */
export async function getMemberAccessLevel(db, apiKey, userId) {
  const row = await db.project_members.findUnique({
    where: { api_key_user_id: { api_key: apiKey, user_id: userId } },
    select: { access_level: true },
  });
  if (row?.access_level) return row.access_level;

  const keyRow = await db.api_keys.findUnique({ where: { key: apiKey }, select: { user_id: true } });
  if (keyRow?.user_id === userId) return 'owner';

  return null;
}

/**
 * Resolve the *effective* access level a user has on a project, combining
 * org-membership baseline with explicit project membership. Returns the
 * higher of the two, or null if the user has neither.
 *
 * plan_project_roles.md (decided 2026-07-26) replaces the old flat 'member'
 * baseline with two org-membership cases:
 *
 * - **Org-admin override**: if the user's org role (org_members.role — its
 *   own separate owner/admin/editor/operator/viewer vocabulary, see
 *   `ROLE_ORDER` in routes/orgs.js) is 'owner' or 'admin', they resolve to
 *   project 'admin' unconditionally on a team-visible project — this is on
 *   top of the ceiling below, not gated by it.
 * - **Ordinary org member**: any other org role resolves to the project's
 *   configurable ceiling, `api_keys.org_baseline_role` ('viewer' or 'editor',
 *   default 'viewer') — never 'admin'. The ceiling is one dial per project,
 *   not a role-to-role mapping — an org 'operator'/'editor' still only gets
 *   the ceiling here unless explicitly invited into this project.
 *
 * Either way, the higher of (explicit project role, resolved org baseline)
 * wins, per PROJECT_ROLE_ORDER.
 *
 * A project with `restricted = 1` gets zero org-baseline contribution even
 * when the user is a real org member (including org owners/admins — the
 * override only applies when NOT restricted) — only explicit project_members
 * rows grant access on a restricted/private project. A project with no
 * org_id behaves exactly like `getMemberAccessLevel()` (no org to draw a
 * baseline from).
 *
 * This resolver is for day-to-day *operational* access only. Irreversible/
 * ownership-only actions (transfer ownership, delete project, revoke a key)
 * must keep calling `getMemberAccessLevel()` directly so an org-wide
 * baseline can never escalate into a destructive right.
 *
 * @param {import('./connection.js').Db} db
 * @param {string} apiKey
 * @param {number} userId
 * @returns {Promise<'owner'|'admin'|'editor'|'operator'|'viewer'|null>}
 */
export const PROJECT_ROLE_ORDER = { viewer: 1, editor: 2, operator: 3, admin: 4, owner: 5 };

export async function getEffectiveProjectAccessLevel(db, apiKey, userId) {
  const explicit = await getMemberAccessLevel(db, apiKey, userId);
  // 'owner' already beats anything an org baseline could ever contribute
  // (the org-admin override tops out at project 'admin') — skip the
  // getKey()/getOrgMembership() lookups entirely for that common case (this
  // runs on every authenticated request via middleware/project-access.js).
  if (explicit === 'owner') return explicit;

  const project = await getKey(db, apiKey);
  if (!project?.org_id || project.restricted) return explicit;

  const membership = await getOrgMembership(db, project.org_id, userId);
  if (!membership) return explicit;

  const orgBaseline = (membership.role === 'owner' || membership.role === 'admin')
    ? 'admin'
    : (project.org_baseline_role === 'editor' ? 'editor' : 'viewer');
  if (!explicit) return orgBaseline;
  return PROJECT_ROLE_ORDER[explicit] >= PROJECT_ROLE_ORDER[orgBaseline] ? explicit : orgBaseline;
}

/**
 * Count members for a project.
 * @param {import('./connection.js').Db} db
 * @param {string} apiKey
 * @returns {Promise<number>}
 */
export async function getMemberCount(db, apiKey) {
  return db.project_members.count({ where: { api_key: apiKey } });
}

/**
 * Every project a user can see: projects they directly own, projects they
 * have an explicit `project_members` row on, and team-visible projects
 * belonging to an org they're a member of (org-baseline/org-admin-override
 * access, `getEffectiveProjectAccessLevel()`). Each row carries the real
 * effective access level, not a hardcoded 'owner' — the gap this closes
 * (plan_project_roles.md, CONSIDER.md): `GET /keys` previously only ever
 * returned directly-owned projects via `getKeysByUserId()` alone, so a
 * project member who wasn't the owner — an invited editor/operator/viewer,
 * or an org admin relying on the org-admin override — had no way to see
 * that project via `GET /keys` at all.
 * @param {import('./connection.js').Db} db
 * @param {number} userId
 * @returns {Promise<{ row: object, myAccessLevel: 'owner'|'admin'|'editor'|'operator'|'viewer' }[]>}
 */
export async function getAccessibleProjectsForUser(db, userId) {
  const owned = await getKeysByUserId(db, userId);
  const seen = new Set(owned.map(row => row.key));
  const result = owned.map(row => ({ row, myAccessLevel: 'owner' }));

  // Explicit project memberships on projects the user doesn't own.
  const memberRows = await db.project_members.findMany({ where: { user_id: userId }, select: { api_key: true } });
  for (const { api_key: apiKey } of memberRows) {
    if (seen.has(apiKey)) continue;
    seen.add(apiKey);
    const row = await getKey(db, apiKey);
    if (!row) continue; // stale membership row (shouldn't happen, FK cascades on key delete)
    const level = await getEffectiveProjectAccessLevel(db, apiKey, userId);
    if (level) result.push({ row, myAccessLevel: level });
  }

  // Org-baseline access: team-visible projects belonging to an org this user
  // is a member of, with no explicit membership row of their own.
  for (const org of await listOrganizationsForUser(db, userId)) {
    for (const project of await listOrganizationProjects(db, org.id)) {
      if (seen.has(project.key)) continue;
      seen.add(project.key);
      const row = await getKey(db, project.key);
      // getEffectiveProjectAccessLevel() already zeroes out org-baseline
      // contribution for a restricted project, but skip the resolver call
      // entirely for the common case rather than relying on that alone.
      if (!row || row.restricted) continue;
      const level = await getEffectiveProjectAccessLevel(db, project.key, userId);
      if (level) result.push({ row, myAccessLevel: level });
    }
  }

  return result;
}
