import { anonymizeKey, deleteKey } from './keys.js';
import { reassignOrDeleteOwnedOrgs } from './orgs.js';

/**
 * User CRUD operations for the `users` table.
 * Used when USE_USER_LOGINS=1 (default).
 */

/**
 * Create a new user account.
 * @param {import('better-sqlite3').Database} db
 * @param {{ email: string, passwordHash: string, name?: string }} opts
 * @returns {{ id: number, email: string, name: string|null }}
 */
export function createUser(db, { email, passwordHash, name = null }) {
  const stmt = db.prepare(
    'INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)'
  );
  const result = stmt.run(email.toLowerCase().trim(), passwordHash, name || null);
  return { id: result.lastInsertRowid, email: email.toLowerCase().trim(), name: name || null };
}

/**
 * Fetch a user by email (includes password_hash for verification).
 * @param {import('better-sqlite3').Database} db
 * @param {string} email
 * @returns {object|undefined}
 */
export function getUserByEmail(db, email) {
  return db.prepare('SELECT * FROM users WHERE email = ? AND active = 1').get(
    email.toLowerCase().trim()
  );
}

/**
 * Fetch a user by ID (excludes password_hash).
 * @param {import('better-sqlite3').Database} db
 * @param {number} id
 * @returns {{ id: number, email: string, name: string|null, created_at: string, active: number, is_admin: number, admin_role: string }|undefined}
 */
export function getUserById(db, id) {
  return db.prepare(
    'SELECT id, email, name, created_at, active, is_admin, admin_role FROM users WHERE id = ?'
  ).get(id);
}

/**
 * Update a user's password hash.
 * @param {import('better-sqlite3').Database} db
 * @param {number} id
 * @param {string} passwordHash
 */
export function updateUserPassword(db, id, passwordHash) {
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, id);
}

/**
 * Get all API keys belonging to a user.
 * @param {import('better-sqlite3').Database} db
 * @param {number} userId
 * @returns {object[]}
 */
export function getKeysByUserId(db, userId) {
  return db.prepare(
    'SELECT * FROM api_keys WHERE user_id = ? ORDER BY created_at DESC'
  ).all(userId);
}

/**
 * Grant or revoke admin rights for a user.
 * @param {import('better-sqlite3').Database} db
 * @param {number} userId
 * @param {boolean} isAdmin
 */
export function setUserAdmin(db, userId, isAdmin) {
  db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(isAdmin ? 1 : 0, userId);
}

/**
 * Set the admin role for a user (when is_admin = 1).
 * @param {import('better-sqlite3').Database} db
 * @param {number} userId
 * @param {string} role - 'full' or 'readonly'
 */
export function setUserAdminRole(db, userId, role) {
  const validRoles = ['full', 'readonly'];
  if (!validRoles.includes(role)) {
    throw new Error(`Invalid admin_role: ${role}. Must be one of: ${validRoles.join(', ')}`);
  }
  db.prepare('UPDATE users SET admin_role = ? WHERE id = ?').run(role, userId);
}

/**
 * List all users (excludes password_hash).
 * @param {import('better-sqlite3').Database} db
 * @returns {object[]}
 */
export function getAllUsers(db) {
  return db.prepare(
    'SELECT id, email, name, created_at, active, is_admin, admin_role FROM users ORDER BY id'
  ).all();
}

/**
 * Update user fields (name, active).
 * @param {import('better-sqlite3').Database} db
 * @param {number} userId
 * @param {{ name?: string|null, active?: boolean }} updates
 */
export function updateUser(db, userId, updates) {
  const parts = [];
  const params = [];
  if ('name' in updates) { parts.push('name = ?'); params.push(updates.name ?? null); }
  if ('active' in updates) { parts.push('active = ?'); params.push(updates.active ? 1 : 0); }
  if (parts.length === 0) return;
  params.push(userId);
  db.prepare(`UPDATE users SET ${parts.join(', ')} WHERE id = ?`).run(...params);
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

export function getUserAccountExport(db, userId) {
  const user = getUserById(db, userId);
  if (!user) return null;

  const projectRows = db.prepare(`
    SELECT
      ak.key,
      ak.owner,
      ak.created_at,
      ak.expires_at,
      ak.org_id,
      ak.user_id,
      (SELECT pm.access_level FROM project_members pm WHERE pm.api_key = ak.key AND pm.user_id = ? LIMIT 1) AS explicit_access_level,
      (SELECT om.role FROM org_members om WHERE om.org_id = ak.org_id AND om.user_id = ? LIMIT 1) AS org_role
    FROM api_keys ak
    WHERE ak.user_id = ?
       OR EXISTS (
          SELECT 1 FROM project_members pm WHERE pm.api_key = ak.key AND pm.user_id = ?
       )
       OR EXISTS (
          SELECT 1 FROM org_members om WHERE om.org_id = ak.org_id AND om.user_id = ?
       )
    ORDER BY ak.created_at DESC
  `).all(userId, userId, userId, userId, userId);

  const projects = projectRows.map((row) => {
    const explicitRole = normalizeProjectRole(row.explicit_access_level);
    const orgRole = normalizeProjectRole(row.org_role);
    const effectiveRole = pickHigherRole(explicitRole, orgRole);
    const effectiveAccessLevel = effectiveRole || (row.user_id === userId ? 'owner' : 'viewer');

    const featureRows = db.prepare(
      'SELECT feature_code FROM project_features WHERE api_key = ? AND enabled = 1 ORDER BY feature_code'
    ).all(row.key);

    return {
      key: row.key,
      name: row.owner,
      role: effectiveAccessLevel,
      createdAt: row.created_at,
      expires: row.expires_at,
      features: featureRows.map(feature => feature.feature_code),
    };
  });

  const orgRows = db.prepare(`
    SELECT o.id, o.name, o.slug, om.role, om.joined_at
    FROM org_members om
    JOIN organizations o ON o.id = om.org_id
    WHERE om.user_id = ?
    ORDER BY om.joined_at ASC
  `).all(userId);

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

export function deleteOwnedProjectsForUser(db, userId) {
  const ownedKeyRows = db.prepare(
    'SELECT key FROM api_keys WHERE user_id = ? ORDER BY created_at DESC'
  ).all(userId);
  const explicitOwnerRows = db.prepare(
    "SELECT api_key FROM project_members WHERE user_id = ? AND access_level = 'owner'"
  ).all(userId);

  const keys = [...new Set([...ownedKeyRows.map(row => row.key), ...explicitOwnerRows.map(row => row.api_key)])];

  for (const key of keys) {
    const existing = db.prepare('SELECT key FROM api_keys WHERE key = ?').get(key);
    if (!existing) continue;
    anonymizeKey(db, key);
    db.prepare('DELETE FROM project_features WHERE api_key = ?').run(key);
    db.prepare('DELETE FROM project_member_permissions WHERE member_id IN (SELECT id FROM project_members WHERE api_key = ?)').run(key);
    db.prepare('DELETE FROM project_members WHERE api_key = ?').run(key);
    deleteKey(db, key);
  }
  db.prepare('DELETE FROM project_members WHERE user_id = ?').run(userId);
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
 * @param {import('better-sqlite3').Database} db
 * @param {number} userId
 */
export function clearUserReferences(db, userId) {
  db.prepare('UPDATE org_members SET invited_by = NULL WHERE invited_by = ?').run(userId);
  db.prepare('UPDATE project_members SET invited_by = NULL WHERE invited_by = ?').run(userId);
  db.prepare('UPDATE project_features SET granted_by = NULL WHERE granted_by = ?').run(userId);
  db.prepare('UPDATE user_features SET granted_by = NULL WHERE granted_by = ?').run(userId);
  db.prepare('UPDATE site_feature_policies SET updated_by = NULL WHERE updated_by = ?').run(userId);
  db.prepare('UPDATE org_feature_overrides SET set_by = NULL WHERE set_by = ?').run(userId);
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
 * @param {import('better-sqlite3').Database} db
 * @param {number} userId
 */
export function deleteUserAccount(db, userId) {
  const tx = db.transaction(() => {
    deleteOwnedProjectsForUser(db, userId);
    reassignOrDeleteOwnedOrgs(db, userId);
    clearUserReferences(db, userId);
    db.prepare('DELETE FROM org_members WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  });
  tx();
  return true;
}
