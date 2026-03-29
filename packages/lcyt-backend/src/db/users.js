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
 * @returns {{ id: number, email: string, name: string|null, created_at: string, active: number, is_admin: number }|undefined}
 */
export function getUserById(db, id) {
  return db.prepare(
    'SELECT id, email, name, created_at, active, is_admin FROM users WHERE id = ?'
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
 * List all users (excludes password_hash).
 * @param {import('better-sqlite3').Database} db
 * @returns {object[]}
 */
export function getAllUsers(db) {
  return db.prepare(
    'SELECT id, email, name, created_at, active, is_admin FROM users ORDER BY id'
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
