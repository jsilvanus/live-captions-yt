import { anonymizeKey, deleteKey } from './keys.js';
import { reassignOrDeleteOwnedOrgs } from './orgs.js';

/**
 * User CRUD operations for the `users` table.
 *  * Used when USE_USER_LOGINS=1 (default).
 */

/**
 * Create a new user account.
 * @param {import('./connection.js').Db} db
 * @param {{ email: string, passwordHash: string, name?: string }} opts
 * @returns {Promise<{ id: number, email: string, name: string|null }>}
 */
export async function createUser(db, { email, passwordHash, name = null }) {
  const row = await db.users.create({
    data: { email: email.toLowerCase().trim(), password_hash: passwordHash, name: name || null },
  });
  return { id: row.id, email: row.email, name: row.name };
}

/**
 * Fetch a user by email (includes password_hash for verification).
 * @param {import('./connection.js').Db} db
 * @param {string} email
 * @returns {Promise<object|undefined>}
 */
export async function getUserByEmail(db, email) {
  return (await db.users.findFirst({ where: { email: email.toLowerCase().trim(), active: 1 } })) ?? undefined;
}

const PUBLIC_USER_FIELDS = { id: true, email: true, name: true, created_at: true, active: true, is_admin: true, admin_role: true };

/**
 * Fetch a user by ID (excludes password_hash).
 * @param {import('./connection.js').Db} db
 * @param {number} id
 * @returns {Promise<{ id: number, email: string, name: string|null, created_at: string, active: number, is_admin: number, admin_role: string }|undefined>}
 */
export async function getUserById(db, id) {
  return (await db.users.findUnique({ where: { id }, select: PUBLIC_USER_FIELDS })) ?? undefined;
}

/**
 * Update a user's password hash.
 * @param {import('./connection.js').Db} db
 * @param {number} id
 * @param {string} passwordHash
 */
export async function updateUserPassword(db, id, passwordHash) {
  await db.users.updateMany({ where: { id }, data: { password_hash: passwordHash } });
}

/**
 * Get all API keys belonging to a user.
 * @param {import('./connection.js').Db} db
 * @param {number} userId
 * @returns {Promise<object[]>}
 */
export async function getKeysByUserId(db, userId) {
  return db.api_keys.findMany({ where: { user_id: userId }, orderBy: [{ created_at: 'desc' }, { id: 'desc' }] });
}

/**
 * Grant or revoke admin rights for a user.
 * @param {import('./connection.js').Db} db
 * @param {number} userId
 * @param {boolean} isAdmin
 */
export async function setUserAdmin(db, userId, isAdmin) {
  await db.users.updateMany({ where: { id: userId }, data: { is_admin: isAdmin ? 1 : 0 } });
}

/**
 * Set the admin role for a user (when is_admin = 1).
 * @param {import('./connection.js').Db} db
 * @param {number} userId
 * @param {string} role - 'full' or 'readonly'
 */
export async function setUserAdminRole(db, userId, role) {
  const validRoles = ['full', 'readonly'];
  if (!validRoles.includes(role)) {
    throw new Error(`Invalid admin_role: ${role}. Must be one of: ${validRoles.join(', ')}`);
  }
  await db.users.updateMany({ where: { id: userId }, data: { admin_role: role } });
}

/**
 * List all users (excludes password_hash).
 * @param {import('./connection.js').Db} db
 * @returns {Promise<object[]>}
 */
export async function getAllUsers(db) {
  return db.users.findMany({ select: PUBLIC_USER_FIELDS, orderBy: { id: 'asc' } });
}

/**
 * Update user fields (name, active).
 * @param {import('./connection.js').Db} db
 * @param {number} userId
 * @param {{ name?: string|null, active?: boolean }} updates
 */
export async function updateUser(db, userId, updates) {
  const data = {};
  if ('name' in updates) data.name = updates.name ?? null;
  if ('active' in updates) data.active = updates.active ? 1 : 0;
  if (Object.keys(data).length === 0) return;
  await db.users.updateMany({ where: { id: userId }, data });
}

const PROJECT_ROLE_RANK = { owner: 5, admin: 4, editor: 3, operator: 2, viewer: 1 };

function normalizeProjectRole(role) {
  if (!role) return null;
  if (role === 'owner' || role === 'admin' || role === 'editor' || role === 'operator' || role === 'viewer') return role;
  if (role === 'member') return 'viewer';
  return null;
}

function pickHigherRole(primary, secondary) {
  if (!primary) return secondary;
  if (!secondary) return primary;
  return (PROJECT_ROLE_RANK[primary] ?? 0) >= (PROJECT_ROLE_RANK[secondary] ?? 0) ? primary : secondary;
}

export async function getUserAccountExport(db, userId) {
  const user = await getUserById(db, userId);
  if (!user) return null;

  const projectRows = await db.$queryRaw`
    SELECT
      ak.key,
      ak.owner,
      ak.created_at,
      ak.expires_at,
      ak.org_id,
      ak.user_id,
      (SELECT pm.access_level FROM project_members pm WHERE pm.api_key = ak.key AND pm.user_id = ${userId} LIMIT 1) AS explicit_access_level,
      (SELECT om.role FROM org_members om WHERE om.org_id = ak.org_id AND om.user_id = ${userId} LIMIT 1) AS org_role
    FROM api_keys ak
    WHERE ak.user_id = ${userId}
       OR EXISTS (
          SELECT 1 FROM project_members pm WHERE pm.api_key = ak.key AND pm.user_id = ${userId}
       )
       OR EXISTS (
          SELECT 1 FROM org_members om WHERE om.org_id = ak.org_id AND om.user_id = ${userId}
       )
    ORDER BY ak.created_at DESC
  `;

  const projects = [];
  for (const row of projectRows) {
    const explicitRole = normalizeProjectRole(row.explicit_access_level);
    const orgRole = normalizeProjectRole(row.org_role);
    const effectiveRole = pickHigherRole(explicitRole, orgRole);
    const effectiveAccessLevel = effectiveRole || (row.user_id === userId ? 'owner' : 'viewer');

    const featureRows = await db.project_features.findMany({
      where: { api_key: row.key, enabled: 1 },
      select: { feature_code: true },
      orderBy: { feature_code: 'asc' },
    });

    projects.push({
      key: row.key,
      name: row.owner,
      role: effectiveAccessLevel,
      createdAt: row.created_at,
      expires: row.expires_at,
      features: featureRows.map(feature => feature.feature_code),
    });
  }

  const orgRows = await db.$queryRaw`
    SELECT o.id, o.name, o.slug, om.role, om.joined_at
    FROM org_members om
    JOIN organizations o ON o.id = om.org_id
    WHERE om.user_id = ${userId}
    ORDER BY om.joined_at ASC
  `;

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.created_at,
    },
    projects,
    orgs: orgRows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      role: row.role,
      joinedAt: row.joined_at,
    })),
  };
}

export async function deleteOwnedProjectsForUser(db, userId) {
  const ownedKeyRows = await db.api_keys.findMany({
    where: { user_id: userId }, select: { key: true }, orderBy: { created_at: 'desc' },
  });
  const explicitOwnerRows = await db.project_members.findMany({
    where: { user_id: userId, access_level: 'owner' }, select: { api_key: true },
  });

  const keys = [...new Set([...ownedKeyRows.map(row => row.key), ...explicitOwnerRows.map(row => row.api_key)])];

  for (const key of keys) {
    const existing = await db.api_keys.findUnique({ where: { key }, select: { key: true } });
    if (!existing) continue;
    await anonymizeKey(db, key);
    await db.project_features.deleteMany({ where: { api_key: key } });
    await db.project_member_permissions.deleteMany({ where: { project_members: { api_key: key } } });
    await db.project_members.deleteMany({ where: { api_key: key } });
    await deleteKey(db, key);
  }
  await db.project_members.deleteMany({ where: { user_id: userId } });
  return keys.length;
}

/**
 * Null out every nullable "who did this" FK column that references
 * `users(id)` with no ON DELETE action (`invited_by`/`granted_by`/`set_by`/
 * `updated_by` across org_members, project_members, project_features,
 * user_features, site_feature_policies, org_feature_overrides). These are
 * audit-trail-style attributions, not ownership — safe to clear rather than
 * block a user delete on. `api_keys.user_id` is handled by callers
 * (deleteOwnedProjectsForUser deletes those keys outright; the admin route
 * SETs it NULL to keep the project alive) and `organizations.owner_user_id`
 * is NOT NULL, so it's resolved separately via `reassignOrDeleteOwnedOrgs`.
 * @param {import('./connection.js').Db} db
 * @param {number} userId
 */
export async function clearUserReferences(db, userId) {
  await db.org_members.updateMany({ where: { invited_by: userId }, data: { invited_by: null } });
  await db.project_members.updateMany({ where: { invited_by: userId }, data: { invited_by: null } });
  await db.project_features.updateMany({ where: { granted_by: userId }, data: { granted_by: null } });
  await db.user_features.updateMany({ where: { granted_by: userId }, data: { granted_by: null } });
  await db.site_feature_policies.updateMany({ where: { updated_by: userId }, data: { updated_by: null } });
  await db.org_feature_overrides.updateMany({ where: { set_by: userId }, data: { set_by: null } });
}

/**
 * Full self-service account deletion (`DELETE /auth/me`). Deletes the user's
 * owned projects, resolves organizations they own (transfer ownership to
 * another member, or tear the org down if they're its sole member — see
 * `reassignOrDeleteOwnedOrgs`), clears their org_members rows and any
 * dangling invited_by/granted_by/etc. attributions, then deletes the user
 * row. Order matters under live FK enforcement: organizations.owner_user_id
 * (NOT NULL, no ON DELETE action) must be resolved before `DELETE FROM users`
 * or the delete throws SQLITE_CONSTRAINT_FOREIGNKEY.
 * @param {import('./connection.js').Db} db
 * @param {number} userId
 */
export async function deleteUserAccount(db, userId) {
  await db.$transaction(async (tx) => {
    await deleteOwnedProjectsForUser(tx, userId);
    await reassignOrDeleteOwnedOrgs(tx, userId);
    await clearUserReferences(tx, userId);
    await tx.org_members.deleteMany({ where: { user_id: userId } });
    await tx.users.deleteMany({ where: { id: userId } });
  });
  return true;
}
