/**
 * Device role helpers.
 *
 * Device roles provide pin-code based scoped logins for physical devices (camera tablets,
 * mic stations, mixer panels) without requiring full user accounts.
 *
 * PIN scheme (two-level):
 *   - api_keys.device_code  — 6-digit project code; identifies which project on the login page
 *   - project_device_roles.pin_hash — bcrypt of the 6-digit role PIN; identifies the specific role
 *
 * Role types: 'camera' | 'mic' | 'mixer' | 'custom'
 * Session lifetime: indefinite (no JWT expiry); admin deletes/deactivates role to revoke.
 */

import { randomInt } from 'node:crypto';

/**
 * Generate a random 6-digit numeric PIN string (zero-padded).
 * @returns {string}
 */
export function generatePin() {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/**
 * Generate a random 6-digit project device code.
 * @returns {string}
 */
export function generateDeviceCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/**
 * Set (or regenerate) the project-level device code for an API key.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @param {string} code
 */
export function setProjectDeviceCode(db, apiKey, code) {
  db.prepare('UPDATE api_keys SET device_code = ? WHERE key = ?').run(code, apiKey);
}

/**
 * Find an API key row by its 6-digit device_code.
 * @param {import('better-sqlite3').Database} db
 * @param {string} deviceCode
 * @returns {object|null}
 */
export function getKeyByDeviceCode(db, deviceCode) {
  return db.prepare('SELECT * FROM api_keys WHERE device_code = ? AND active = 1').get(deviceCode) || null;
}

/**
 * Create a new device role for a project.
 * Returns the plain-text PIN (must be shown to the user exactly once) and the created row.
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @param {{ roleType: string, name: string, pinHash: string, permissions?: string[], config?: object }} opts
 * @returns {{ id: number, api_key: string, role_type: string, name: string, permissions: string[], config: object|null, created_at: string }}
 */
export function createDeviceRole(db, apiKey, { roleType, name, pinHash, permissions = [], config = null }) {
  const result = db.prepare(`
    INSERT INTO project_device_roles (api_key, role_type, name, pin_hash, permissions, config)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(apiKey, roleType, name, pinHash, JSON.stringify(permissions), config ? JSON.stringify(config) : null);
  return getDeviceRole(db, result.lastInsertRowid);
}

/**
 * Get a single device role by id.
 * @param {import('better-sqlite3').Database} db
 * @param {number} id
 * @returns {object|null}
 */
export function getDeviceRole(db, id) {
  const row = db.prepare('SELECT * FROM project_device_roles WHERE id = ?').get(id);
  return row ? _formatRole(row) : null;
}

/**
 * List all active device roles for a project (pin_hash excluded).
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @returns {Array}
 */
export function getDeviceRoles(db, apiKey) {
  return db.prepare(
    'SELECT * FROM project_device_roles WHERE api_key = ? ORDER BY created_at ASC'
  ).all(apiKey).map(_formatRole);
}

/**
 * Find an active device role by api_key + pin_hash (for login verification).
 * @param {import('better-sqlite3').Database} db
 * @param {string} apiKey
 * @returns {Array} all active roles for the key (caller bcrypt-compares PIN)
 */
export function getActiveDeviceRolesForKey(db, apiKey) {
  return db.prepare(
    'SELECT * FROM project_device_roles WHERE api_key = ? AND active = 1'
  ).all(apiKey);
}

/**
 * Update a device role's name and/or permissions.
 * @param {import('better-sqlite3').Database} db
 * @param {number} id
 * @param {{ name?: string, permissions?: string[], config?: object }} updates
 */
export function updateDeviceRole(db, id, { name, permissions, config } = {}) {
  const parts = [];
  const params = [];
  if (name !== undefined)        { parts.push('name = ?');        params.push(name); }
  if (permissions !== undefined) { parts.push('permissions = ?'); params.push(JSON.stringify(permissions)); }
  if (config !== undefined)      { parts.push('config = ?');      params.push(config ? JSON.stringify(config) : null); }
  if (parts.length === 0) return;
  params.push(id);
  db.prepare(`UPDATE project_device_roles SET ${parts.join(', ')} WHERE id = ?`).run(...params);
}

/**
 * Reset the PIN hash for a device role.
 * @param {import('better-sqlite3').Database} db
 * @param {number} id
 * @param {string} newPinHash
 */
export function resetDeviceRolePin(db, id, newPinHash) {
  db.prepare('UPDATE project_device_roles SET pin_hash = ? WHERE id = ?').run(newPinHash, id);
}

/**
 * Deactivate (soft-delete) a device role.
 * @param {import('better-sqlite3').Database} db
 * @param {number} id
 * @returns {boolean}
 */
export function deactivateDeviceRole(db, id) {
  const result = db.prepare('UPDATE project_device_roles SET active = 0 WHERE id = ?').run(id);
  return result.changes > 0;
}

function _formatRole(row) {
  let permissions = [];
  try { permissions = JSON.parse(row.permissions || '[]'); } catch {}
  let config = null;
  try { if (row.config) config = JSON.parse(row.config); } catch {}
  return {
    id: row.id,
    apiKey: row.api_key,
    roleType: row.role_type,
    name: row.name,
    permissions,
    config,
    active: row.active === 1,
    createdAt: row.created_at,
  };
}
