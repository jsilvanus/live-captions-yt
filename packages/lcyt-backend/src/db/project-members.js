/**
 * Project membership helpers.
 *
 * Access levels: 'owner' | 'admin' | 'member'
 * - owner:  full access; sole holder of delete-project right; only one per project
 * - admin:  full access except cannot delete project
 * - member: captioner by default; admin grants additional permissions
 *
 * Permission overrides are stored in project_member_permissions as delta
 * on top of the role bundle (granted=1 adds, granted=0 explicitly revokes).
 */
import { getKey } from './keys.js';
import { getOrgMembership } from './orgs.js';

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
  member: new Set(['captioner']),
};

/**
 * Add a user as a project member. No-op if already a member (returns existing row).
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @param {number} userId
 * @param {'owner'|'admin'|'member'} accessLevel
 * @param {number|null} [invitedBy]
 * @returns {{ id: number, api_key: string, user_id: number, access_level: string, joined_at: string }}
 */
export function addMember(db, apiKey, userId, accessLevel = 'member', invitedBy = null) {
  db.prepare(`
    INSERT INTO project_members (api_key, user_id, access_level, invited_by)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (api_key, user_id) DO NOTHING
  `).run(apiKey, userId, accessLevel, invitedBy ?? null);
  return getMember(db, apiKey, userId);
}

/**
 * Get a single member row with user email/name joined.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @param {number} userId
 * @returns {object|null}
 */
export function getMember(db, apiKey, userId) {
  return db.prepare(`
    SELECT pm.id, pm.api_key, pm.user_id, pm.access_level, pm.invited_by, pm.joined_at,
           u.email, u.name
    FROM project_members pm
    JOIN users u ON u.id = pm.user_id
    WHERE pm.api_key = ? AND pm.user_id = ?
  `).get(apiKey, userId) || null;
}

/**
 * Get all members for a project with their user info and individual permissions.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @returns {Array}
 */
export function getMembers(db, apiKey) {
  const rows = db.prepare(`
    SELECT pm.id, pm.user_id, pm.access_level, pm.joined_at,
           u.email, u.name
    FROM project_members pm
    JOIN users u ON u.id = pm.user_id
    WHERE pm.api_key = ?
    ORDER BY pm.joined_at ASC
  `).all(apiKey);

  return rows.map(row => ({
    ...row,
    permissions: getEffectivePermissions(db, row.id),
  }));
}

/**
 * Remove a member from a project. Refuses to remove the owner.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @param {number} userId
 * @returns {{ removed: boolean, reason?: string }}
 */
export function removeMember(db, apiKey, userId) {
  const row = getMember(db, apiKey, userId);
  if (!row) return { removed: false, reason: 'not_found' };
  if (row.access_level === 'owner') return { removed: false, reason: 'cannot_remove_owner' };
  db.prepare('DELETE FROM project_members WHERE api_key = ? AND user_id = ?').run(apiKey, userId);
  return { removed: true };
}

/**
 * Update access level for a member.
 * @param {import('better-sqlite3').Database} db
 * @param {number} memberId
 * @param {'admin'|'member'} accessLevel
 */
export function updateMemberAccessLevel(db, memberId, accessLevel) {
  db.prepare('UPDATE project_members SET access_level = ? WHERE id = ?').run(accessLevel, memberId);
}

/**
 * Transfer ownership from current owner to another member.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @param {number} fromUserId - current owner
 * @param {number} toUserId   - new owner (must already be a member)
 * @returns {{ ok: boolean, reason?: string }}
 */
export function transferOwnership(db, apiKey, fromUserId, toUserId) {
  const fromMember = getMember(db, apiKey, fromUserId);
  if (!fromMember || fromMember.access_level !== 'owner') return { ok: false, reason: 'not_owner' };
  const toMember = getMember(db, apiKey, toUserId);
  if (!toMember) return { ok: false, reason: 'target_not_member' };

  db.transaction(() => {
    db.prepare('UPDATE project_members SET access_level = ? WHERE id = ?').run('admin', fromMember.id);
    db.prepare('UPDATE project_members SET access_level = ? WHERE id = ?').run('owner', toMember.id);
  })();
  return { ok: true };
}

/**
 * Grant or revoke an individual permission for a member.
 * @param {import('better-sqlite3').Database} db
 * @param {number} memberId
 * @param {string} permission
 * @param {boolean} granted
 */
export function setMemberPermission(db, memberId, permission, granted) {
  db.prepare(`
    INSERT INTO project_member_permissions (member_id, permission, granted)
    VALUES (?, ?, ?)
    ON CONFLICT (member_id, permission) DO UPDATE SET granted = excluded.granted
  `).run(memberId, permission, granted ? 1 : 0);
}

/**
 * Get the effective Set of permissions for a member (role bundle + individual overrides).
 * @param {import('better-sqlite3').Database} db
 * @param {number} memberId
 * @returns {string[]} sorted array of permission codes
 */
export function getEffectivePermissions(db, memberId) {
  const row = db.prepare('SELECT access_level FROM project_members WHERE id = ?').get(memberId);
  if (!row) return [];

  const bundle = new Set(ROLE_BUNDLES[row.access_level] || []);

  const overrides = db.prepare(
    'SELECT permission, granted FROM project_member_permissions WHERE member_id = ?'
  ).all(memberId);

  for (const { permission, granted } of overrides) {
    if (granted) bundle.add(permission);
    else bundle.delete(permission);
  }

  return [...bundle].sort();
}

/**
 * Check whether a user has a specific permission on a project.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @param {number} userId
 * @param {string} permission
 * @returns {boolean}
 */
export function memberHasPermission(db, apiKey, userId, permission) {
  const member = getMember(db, apiKey, userId);
  if (!member) return false;
  const perms = getEffectivePermissions(db, member.id);
  return perms.includes(permission);
}

/**
 * Get the access level for a user in a project, or null if not a member.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @param {number} userId
 * @returns {'owner'|'admin'|'member'|null}
 */
export function getMemberAccessLevel(db, apiKey, userId) {
  const row = db.prepare(
    'SELECT access_level FROM project_members WHERE api_key = ? AND user_id = ?'
  ).get(apiKey, userId);
  if (row?.access_level) return row.access_level;

  const keyRow = db.prepare('SELECT user_id FROM api_keys WHERE key = ?').get(apiKey);
  if (keyRow?.user_id === userId) return 'owner';

  return null;
}

/**
 * Resolve the *effective* access level a user has on a project, combining
 * org-membership baseline with explicit project membership. Returns the
 * higher of the two, or null if the user has neither.
 *
 * Org membership contributes a flat project-baseline of 'member' regardless
 * of which of the 5 org roles (owner/admin/editor/operator/viewer, see
 * `ROLE_ORDER` in routes/orgs.js) the user holds there — org roles do not
 * cascade into a higher project baseline. That cascade (e.g. org owner ->
 * project admin) is explicitly deferred; see plan_team_org_backend.md's
 * "Future extension (not in scope now)" section.
 *
 * A project with `restricted = 1` gets zero org-baseline contribution even
 * when the user is a real org member — only explicit project_members rows
 * grant access on a restricted project. A project with no org_id behaves
 * exactly like `getMemberAccessLevel()` (no org to draw a baseline from).
 *
 * This resolver is for day-to-day *operational* access only. Irreversible/
 * ownership-only actions (transfer ownership, delete project, revoke a key)
 * must keep calling `getMemberAccessLevel()` directly so an org-wide
 * baseline of 'member' can never escalate into a destructive right.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @param {number} userId
 * @returns {'owner'|'admin'|'member'|null}
 */
export const PROJECT_ROLE_ORDER = { member: 1, admin: 2, owner: 3 };

export function getEffectiveProjectAccessLevel(db, apiKey, userId) {
  const explicit = getMemberAccessLevel(db, apiKey, userId);
  // 'owner'/'admin' already beats (or ties) anything an org baseline could
  // ever contribute ('member') — skip the getKey()/getOrgMembership() lookups
  // entirely for the common case (this runs on every authenticated request
  // via middleware/project-access.js).
  if (explicit === 'owner' || explicit === 'admin') return explicit;

  const project = getKey(db, apiKey);
  if (!project?.org_id || project.restricted) return explicit;

  const membership = getOrgMembership(db, project.org_id, userId);
  if (!membership) return explicit;

  const orgBaseline = 'member';
  if (!explicit) return orgBaseline;
  return PROJECT_ROLE_ORDER[explicit] >= PROJECT_ROLE_ORDER[orgBaseline] ? explicit : orgBaseline;
}

/**
 * Count members for a project.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @returns {number}
 */
export function getMemberCount(db, apiKey) {
  return db.prepare('SELECT COUNT(*) as n FROM project_members WHERE api_key = ?').get(apiKey)?.n ?? 0;
}
