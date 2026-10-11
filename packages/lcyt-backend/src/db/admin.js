/**
 * Queries used by the admin routes (src/routes/admin.js): paged lists with filters,
 * user deletion cascades, export and import helpers.
 */
import { getDialect } from './connection.js';
import { num, sqlNow } from './helpers.js';
import { inTx } from './keys.js';
import { reassignOrDeleteOwnedOrgs } from './orgs.js';
import { clearUserReferences } from './users.js';

/** Positional placeholder for the current dialect ($n on PostgreSQL, ? on SQLite). */
const ph = (i) => (getDialect() === 'postgres' ? `$${i}` : '?');

/** Raw rows may carry BigInt values; API code wants plain numbers. */
function plainRow(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) out[k] = num(v);
  return out;
}

/** Collects SQL conditions with dialect-correct placeholders. */
function createFilter() {
  const conditions = [];
  const params = [];
  return {
    params,
    conditions,
    /** Add a raw param and return its placeholder. */
    p(value) {
      params.push(value);
      return ph(params.length);
    },
    add(sql) {
      conditions.push(sql);
    },
  };
}

// ---------------------------------------------------------------------------
// Organizations
// ---------------------------------------------------------------------------

/**
 * Orgs for site administration, newest first, with member and project counts.
 * @param {import('./connection.js').Db} db
 * @param {{ q?: string, limit: number, offset: number }} opts
 * @returns {Promise<{ orgs: Array<{ id: number, name: string, slug: string, memberCount: number, projectCount: number }>, total: number }>}
 */
export async function listOrgsAdmin(db, { q = '', limit, offset }) {
  const f = createFilter();
  if (q) {
    const like = `%${q}%`;
    f.add(`(LOWER(name) LIKE LOWER(${f.p(like)}) OR LOWER(slug) LIKE LOWER(${f.p(like)}))`);
  }
  const where = f.conditions.length > 0 ? `WHERE ${f.conditions.join(' AND ')}` : '';
  const filterParams = [...f.params];
  const rows = await db.$queryRawUnsafe(
    `SELECT id, name, slug FROM organizations ${where} ORDER BY created_at DESC, id DESC LIMIT ${ph(filterParams.length + 1)} OFFSET ${ph(filterParams.length + 2)}`,
    ...filterParams, limit, offset,
  );
  const [{ count }] = await db.$queryRawUnsafe(`SELECT COUNT(*) as count FROM organizations ${where}`, ...filterParams);

  const orgs = [];
  for (const row of rows) {
    const id = num(row.id);
    orgs.push({
      id,
      name: row.name,
      slug: row.slug,
      memberCount: await db.org_members.count({ where: { org_id: id } }),
      projectCount: await db.api_keys.count({ where: { org_id: id } }),
    });
  }
  return { orgs, total: num(count) };
}

/**
 * True when an organization with this id exists.
 * @param {import('./connection.js').Db} db
 * @param {number} orgId
 */
export async function orgExists(db, orgId) {
  return (await db.organizations.findUnique({ where: { id: orgId }, select: { id: true } })) != null;
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

/**
 * Users with their first organization (name and role), filtered and paged.
 * @param {import('./connection.js').Db} db
 * @param {{ q?: string, from?: string, to?: string, active?: string, orgId?: number, limit: number, offset: number }} opts
 * @returns {Promise<{ rows: object[], total: number }>}
 */
export async function listUsersAdmin(db, { q = '', from = '', to = '', active, orgId, limit, offset }) {
  const f = createFilter();
  if (q) {
    const like = `%${q}%`;
    f.add(`(LOWER(u.email) LIKE LOWER(${f.p(like)}) OR LOWER(u.name) LIKE LOWER(${f.p(like)}) OR CAST(u.id AS TEXT) = ${f.p(q)})`);
  }
  if (from) f.add(`u.created_at >= ${f.p(from)}`);
  if (to) f.add(`u.created_at <= ${f.p(to + 'T23:59:59')}`);
  if (active === '1') f.add('u.active = 1');
  else if (active === '0') f.add('u.active = 0');
  if (Number.isFinite(orgId)) {
    f.add(`EXISTS (SELECT 1 FROM org_members om WHERE om.user_id = u.id AND om.org_id = ${f.p(orgId)})`);
  }
  const where = f.conditions.length > 0 ? `WHERE ${f.conditions.join(' AND ')}` : '';
  const filterParams = [...f.params];
  const rows = await db.$queryRawUnsafe(
    `SELECT u.id, u.email, u.name, u.created_at, u.active, u.is_admin, u.admin_role,
            (SELECT o.name FROM org_members om JOIN organizations o ON o.id = om.org_id WHERE om.user_id = u.id ORDER BY om.joined_at ASC, om.id ASC LIMIT 1) AS org_name,
            (SELECT om.role FROM org_members om WHERE om.user_id = u.id ORDER BY om.joined_at ASC, om.id ASC LIMIT 1) AS org_role
     FROM users u ${where} ORDER BY u.id LIMIT ${ph(filterParams.length + 1)} OFFSET ${ph(filterParams.length + 2)}`,
    ...filterParams, limit, offset,
  );
  const [{ count }] = await db.$queryRawUnsafe(`SELECT COUNT(*) as count FROM users u ${where}`, ...filterParams);
  return { rows: rows.map(plainRow), total: num(count) };
}

/**
 * Id of the user with this email (case-insensitive after trimming), active or not.
 * @param {import('./connection.js').Db} db
 * @param {string} email
 * @returns {Promise<{ id: number }|undefined>}
 */
export async function findUserIdByEmail(db, email) {
  const row = await db.users.findUnique({ where: { email: String(email).toLowerCase().trim() }, select: { id: true } });
  return row ?? undefined;
}

/**
 * Update user columns (any of name, active, admin_role, is_admin).
 * @param {import('./connection.js').Db} db
 * @param {number} id
 * @param {{ name?: string|null, active?: number, admin_role?: string, is_admin?: number }} fields
 */
export async function updateUserFields(db, id, fields) {
  await db.users.updateMany({ where: { id }, data: fields });
}

/**
 * Ids of the organizations a user owns.
 * @param {import('./connection.js').Db} db
 * @param {number} userId
 * @returns {Promise<Array<{ id: number }>>}
 */
export async function getOwnedOrgIds(db, userId) {
  return db.organizations.findMany({ where: { owner_user_id: userId }, select: { id: true } });
}

/** Unlink keys, drop feature rows and memberships, delete the user. Runs on a transaction client. */
async function removeUserRows(tx, userId) {
  await tx.api_keys.updateMany({ where: { user_id: userId }, data: { user_id: null } });
  return tx;
}

/**
 * Delete a user and everything that hangs off it (admin ?force=true): API keys are unlinked,
 * owned organizations are transferred or torn down, attributions are cleared. Atomic.
 * @param {import('./connection.js').Db} db
 * @param {number} userId
 */
export async function deleteUserForce(db, userId) {
  await inTx(db, async (tx) => {
    await removeUserRows(tx, userId);
    await reassignOrDeleteOwnedOrgs(tx, userId);
    await clearUserReferences(tx, userId);
    await tx.user_features.deleteMany({ where: { user_id: userId } });
    await tx.project_members.deleteMany({ where: { user_id: userId } });
    await tx.org_members.deleteMany({ where: { user_id: userId } });
    await tx.users.deleteMany({ where: { id: userId } });
  });
}

/**
 * Delete a user the way the batch endpoint does: unlink keys, drop feature rows and project
 * memberships, delete the user row (fails and rolls back if other rows still reference it). Atomic.
 * @param {import('./connection.js').Db} db
 * @param {number} userId
 */
export async function deleteUserBasic(db, userId) {
  await inTx(db, async (tx) => {
    await removeUserRows(tx, userId);
    await tx.user_features.deleteMany({ where: { user_id: userId } });
    await tx.project_members.deleteMany({ where: { user_id: userId } });
    await tx.users.deleteMany({ where: { id: userId } });
  });
}

/**
 * Set many user features in one transaction (all or nothing).
 * @param {import('./connection.js').Db} db
 * @param {(tx: import('./connection.js').Db) => Promise<void>} fn
 */
export function inTransaction(db, fn) {
  return inTx(db, fn);
}

// ---------------------------------------------------------------------------
// Projects (API keys)
// ---------------------------------------------------------------------------

/**
 * Projects with owner user and organization names, filtered and paged.
 * `userFilters` are email fragments (user:email search); a project must belong to one of the matching users.
 * @param {import('./connection.js').Db} db
 * @param {{ userFilters?: string[], textQuery?: string, from?: string, to?: string, status?: string, orgId?: number|null, limit: number, offset: number }} opts
 * @returns {Promise<{ rows: object[], total: number }>}
 */
export async function listProjectsAdmin(db, { userFilters = [], textQuery = '', from = '', to = '', status, orgId = null, limit, offset }) {
  const f = createFilter();

  if (userFilters.length > 0) {
    const userIds = [];
    for (const filter of userFilters) {
      const users = await db.$queryRawUnsafe(
        `SELECT id FROM users WHERE LOWER(email) LIKE LOWER(${ph(1)})`, `%${filter}%`);
      userIds.push(...users.map((r) => num(r.id)));
    }
    if (userIds.length === 0) return { rows: [], total: 0 };
    f.add(`k.user_id IN (${userIds.map((id) => f.p(id)).join(',')})`);
    if (textQuery) {
      const like = `%${textQuery}%`;
      f.add(`(LOWER(k.owner) LIKE LOWER(${f.p(like)}) OR LOWER(k.key) LIKE LOWER(${f.p(like)}))`);
    }
  } else if (textQuery) {
    const like = `%${textQuery}%`;
    f.add(`(LOWER(k.owner) LIKE LOWER(${f.p(like)}) OR LOWER(k.key) LIKE LOWER(${f.p(like)}) OR LOWER(u.email) LIKE LOWER(${f.p(like)}))`);
  }
  if (from) f.add(`k.created_at >= ${f.p(from)}`);
  if (to) f.add(`k.created_at <= ${f.p(to + 'T23:59:59')}`);
  if (status === 'active') f.add('k.active = 1');
  if (status === 'revoked') f.add('k.active = 0');
  if (orgId != null && Number.isFinite(orgId)) f.add(`k.org_id = ${f.p(orgId)}`);

  const where = f.conditions.length > 0 ? `WHERE ${f.conditions.join(' AND ')}` : '';
  const filterParams = [...f.params];
  const joins = 'FROM api_keys k LEFT JOIN users u ON k.user_id = u.id LEFT JOIN organizations o ON o.id = k.org_id';
  const rows = await db.$queryRawUnsafe(
    `SELECT k.*, u.email as user_email, u.name as user_name, o.name as org_name ${joins} ${where} ORDER BY k.id LIMIT ${ph(filterParams.length + 1)} OFFSET ${ph(filterParams.length + 2)}`,
    ...filterParams, limit, offset,
  );
  const [{ count }] = await db.$queryRawUnsafe(`SELECT COUNT(*) as count ${joins} ${where}`, ...filterParams);
  return { rows: rows.map(plainRow), total: num(count) };
}

/**
 * Re-activate a project (active = 1, revoked_at cleared).
 * @param {import('./connection.js').Db} db
 * @param {string} key
 */
export async function activateKey(db, key) {
  await db.api_keys.updateMany({ where: { key }, data: { active: 1, revoked_at: null } });
}

// ---------------------------------------------------------------------------
// Export / import
// ---------------------------------------------------------------------------

/**
 * All users and all user feature rows, for export.
 * @param {import('./connection.js').Db} db
 */
export async function exportUsersData(db) {
  const users = await db.users.findMany({
    select: { id: true, email: true, name: true, created_at: true, active: true, is_admin: true },
    orderBy: { id: 'asc' },
  });
  const features = await db.user_features.findMany({
    select: { user_id: true, feature_code: true, enabled: true, granted_at: true },
    orderBy: [{ user_id: 'asc' }, { feature_code: 'asc' }],
  });
  return { users, features };
}

/**
 * All projects (with owner email) and all project feature rows, for export.
 * @param {import('./connection.js').Db} db
 */
export async function exportProjectsData(db) {
  const keys = await db.api_keys.findMany({ include: { users: { select: { email: true } } }, orderBy: { id: 'asc' } });
  const projects = keys.map(({ users, ...row }) => ({ ...row, user_email: users?.email ?? null }));
  const features = await db.project_features.findMany({
    select: { api_key: true, feature_code: true, enabled: true, granted_at: true },
    orderBy: [{ api_key: 'asc' }, { feature_code: 'asc' }],
  });
  return { projects, features };
}

/**
 * True when a project with this key exists.
 * @param {import('./connection.js').Db} db
 * @param {string} key
 */
export async function projectKeyExists(db, key) {
  return (await db.api_keys.findUnique({ where: { key }, select: { key: true } })) != null;
}

/**
 * Insert an imported project and its feature flags (existing flags are kept). Atomic.
 * @param {import('./connection.js').Db} db
 * @param {{ key: string, owner: string, active?: boolean, email?: string, dailyLimit?: number, lifetimeLimit?: number, features?: Array<{ code?: string, enabled?: boolean }> }} p
 */
export async function importProject(db, p) {
  await inTx(db, async (tx) => {
    await tx.api_keys.create({
      data: {
        key: p.key,
        owner: p.owner,
        created_at: sqlNow(),
        active: p.active !== false ? 1 : 0,
        email: p.email || null,
        daily_limit: p.dailyLimit || null,
        lifetime_limit: p.lifetimeLimit || null,
      },
    });
    if (Array.isArray(p.features)) {
      for (const f of p.features) {
        if (!f.code) continue;
        await tx.project_features.upsert({
          where: { api_key_feature_code: { api_key: p.key, feature_code: f.code } },
          create: { api_key: p.key, feature_code: f.code, enabled: f.enabled !== false ? 1 : 0, granted_at: sqlNow() },
          update: {},
        });
      }
    }
  });
}
