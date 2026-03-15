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
 * @returns {{ id: number, email: string, name: string|null, created_at: string, active: number }|undefined}
 */
export function getUserById(db, id) {
  return db.prepare(
    'SELECT id, email, name, created_at, active FROM users WHERE id = ?'
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
