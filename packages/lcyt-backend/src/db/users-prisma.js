/**
 * User database operations
 * 
 * Migration status: Phase 1 - Using DbClient abstraction
 * Compatible with both SQLite and PostgreSQL
 */

/**
 * Create a new user account
 * @param {import('../db-factory').DbClient} db
 * @param {{ email: string, passwordHash: string, name?: string }} opts
 * @returns {{ id: number, email: string, name: string|null }}
 */
export function createUser(db, { email, passwordHash, name = null }) {
  const stmt = db.prepare(
    'INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)'
  );
  const result = stmt.run(email.toLowerCase().trim(), passwordHash, name || null);
  
  return { 
    id: result.lastInsertRowid || result.id, 
    email: email.toLowerCase().trim(), 
    name: name || null 
  };
}

/**
 * Fetch a user by email (includes password_hash for verification)
 * @param {import('../db-factory').DbClient} db
 * @param {string} email
 * @returns {object|undefined}
 */
export function getUserByEmail(db, email) {
  return db.get(
    'SELECT * FROM users WHERE email = ? AND active = 1',
    email.toLowerCase().trim()
  );
}

/**
 * Fetch a user by ID (excludes password_hash)
 * @param {import('../db-factory').DbClient} db
 * @param {number} id
 * @returns {{ id: number, email: string, name: string|null, created_at: string, active: number, is_admin: number, admin_role: string }|undefined}
 */
export function getUserById(db, id) {
  return db.get(
    'SELECT id, email, name, created_at, active, is_admin, admin_role FROM users WHERE id = ?',
    id
  );
}

/**
 * Update a user's password hash
 * @param {import('../db-factory').DbClient} db
 * @param {number} id
 * @param {string} passwordHash
 */
export function updateUserPassword(db, id, passwordHash) {
  db.run('UPDATE users SET password_hash = ? WHERE id = ?', passwordHash, id);
}

/**
 * Get all API keys belonging to a user
 * @param {import('../db-factory').DbClient} db
 * @param {number} userId
 * @returns {object[]}
 */
export function getUserApiKeys(db, userId) {
  return db.all(
    'SELECT * FROM api_keys WHERE user_id = ? AND active = 1 ORDER BY created_at DESC',
    userId
  );
}

/**
 * Get all organizations a user is a member of
 * @param {import('../db-factory').DbClient} db
 * @param {number} userId
 * @returns {object[]}
 */
export function getUserOrganizations(db, userId) {
  return db.all(
    `SELECT o.* FROM organizations o
     INNER JOIN org_members om ON om.org_id = o.id
     WHERE om.user_id = ? 
     ORDER BY o.name`,
    userId
  );
}

/**
 * Get user's admin privileges
 * @param {import('../db-factory').DbClient} db
 * @param {number} id
 * @returns {{ is_admin: number, admin_role: string }|undefined}
 */
export function getUserAdmin(db, id) {
  return db.get(
    'SELECT is_admin, admin_role FROM users WHERE id = ?',
    id
  );
}

/**
 * Set user admin status
 * @param {import('../db-factory').DbClient} db
 * @param {number} id
 * @param {number} isAdmin - 1 or 0
 * @param {string} adminRole - 'full' or 'partial'
 */
export function setUserAdmin(db, id, isAdmin, adminRole = 'full') {
  db.run(
    'UPDATE users SET is_admin = ?, admin_role = ? WHERE id = ?',
    isAdmin,
    adminRole,
    id
  );
}

/**
 * Deactivate a user (soft delete)
 * @param {import('../db-factory').DbClient} db
 * @param {number} id
 */
export function deactivateUser(db, id) {
  db.run('UPDATE users SET active = 0 WHERE id = ?', id);
}

/**
 * Activate a user
 * @param {import('../db-factory').DbClient} db
 * @param {number} id
 */
export function activateUser(db, id) {
  db.run('UPDATE users SET active = 1 WHERE id = ?', id);
}

/**
 * Get all active users
 * @param {import('../db-factory').DbClient} db
 * @returns {object[]}
 */
export function getAllActiveUsers(db) {
  return db.all(
    'SELECT id, email, name, created_at, active, is_admin FROM users WHERE active = 1 ORDER BY created_at DESC'
  );
}

/**
 * Count total users
 * @param {import('../db-factory').DbClient} db
 * @returns {number}
 */
export function countUsers(db) {
  const result = db.get('SELECT COUNT(*) as count FROM users');
  return result?.count || 0;
}

/**
 * Update user profile
 * @param {import('../db-factory').DbClient} db
 * @param {number} id
 * @param {{ name?: string, email?: string }} updates
 */
export function updateUserProfile(db, id, updates) {
  const fields = [];
  const values = [];

  if (updates.name !== undefined) {
    fields.push('name = ?');
    values.push(updates.name);
  }
  if (updates.email !== undefined) {
    fields.push('email = ?');
    values.push(updates.email.toLowerCase().trim());
  }

  if (fields.length === 0) return;

  fields.push('id = ?');
  values.push(id);

  const sql = `UPDATE users SET ${fields.slice(0, -1).join(', ')} WHERE id = ?`;
  db.run(sql, ...values);
}
