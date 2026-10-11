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
 * @param {import('./connection.js').Db} db
 * @param {string} apiKey
 * @param {string} code
 * @returns {Promise<void>}
 */
export async function setProjectDeviceCode(db, apiKey, code) {
  await db.api_keys.updateMany({ where: { key: apiKey }, data: { device_code: code } });
}

/**
 * Find an API key row by its 6-digit device_code.
 * @param {import('./connection.js').Db} db
 * @param {string} deviceCode
 * @returns {Promise<object|null>}
 */
export async function getKeyByDeviceCode(db, deviceCode) {
  return (await db.api_keys.findFirst({ where: { device_code: deviceCode, active: 1 } })) ?? null;
}

/**
 * Create a new device role for a project.
 * Returns the plain-text PIN (must be shown to the user exactly once) and the created row.
 * @param {import('./connection.js').Db} db
 * @param {string} apiKey
 * @param {{ roleType: string, name: string, pinHash: string, permissions?: string[], config?: object, expiresAt?: string }} opts
 * @returns {Promise<{ id: number, apiKey: string, roleType: string, name: string, permissions: string[], config: object|null, active: boolean, createdAt: string }>}
 */
export async function createDeviceRole(db, apiKey, { roleType, name, pinHash, permissions = [], config = null, expiresAt = null }) {
  const row = await db.project_device_roles.create({
    data: {
      api_key: apiKey,
      role_type: roleType,
      name,
      pin_hash: pinHash,
      permissions: JSON.stringify(permissions),
      config: config ? JSON.stringify(config) : null,
      expires_at: expiresAt,
    },
  });
  return getDeviceRole(db, row.id);
}

/**
 * Get a single device role by id.
 * @param {import('./connection.js').Db} db
 * @param {number} id
 * @returns {Promise<object|null>}
 */
export async function getDeviceRole(db, id) {
  const row = await db.project_device_roles.findUnique({ where: { id } });
  return row ? _formatRole(row) : null;
}

/**
 * Check if a device role is currently active (not deactivated and not expired).
 * Used by middleware to validate device JWTs on every request (Item 4 — Phase 4).
 * @param {import('./connection.js').Db} db
 * @param {number} id
 * @returns {Promise<boolean>}
 */
export async function isDeviceRoleActive(db, id) {
  const row = await db.project_device_roles.findUnique({ where: { id }, select: { active: true, expires_at: true } });
  if (!row || row.active === 0) return false;
  if (row.expires_at && new Date(row.expires_at) <= new Date()) return false;
  return true;
}

/**
 * List all active device roles for a project (pin_hash excluded).
 * @param {import('./connection.js').Db} db
 * @param {string} apiKey
 * @returns {Promise<Array>}
 */
export async function getDeviceRoles(db, apiKey) {
  const rows = await db.project_device_roles.findMany({
    where: { api_key: apiKey },
    orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
  });
  return rows.map(_formatRole);
}

/**
 * Find an active device role by api_key + pin_hash (for login verification).
 * @param {import('./connection.js').Db} db
 * @param {string} apiKey
 * @returns {Promise<Array>} all active roles for the key (caller bcrypt-compares PIN)
 */
export async function getActiveDeviceRolesForKey(db, apiKey) {
  return db.project_device_roles.findMany({ where: { api_key: apiKey, active: 1 } });
}

/**
 * Update a device role's name and/or permissions.
 * @param {import('./connection.js').Db} db
 * @param {number} id
 * @param {{ name?: string, permissions?: string[], config?: object }} updates
 * @returns {Promise<void>}
 */
export async function updateDeviceRole(db, id, { name, permissions, config } = {}) {
  const data = {};
  if (name !== undefined)        data.name = name;
  if (permissions !== undefined) data.permissions = JSON.stringify(permissions);
  if (config !== undefined)      data.config = config ? JSON.stringify(config) : null;
  if (Object.keys(data).length === 0) return;
  await db.project_device_roles.updateMany({ where: { id }, data });
}

/**
 * Reset the PIN hash for a device role.
 * @param {import('./connection.js').Db} db
 * @param {number} id
 * @param {string} newPinHash
 * @returns {Promise<void>}
 */
export async function resetDeviceRolePin(db, id, newPinHash) {
  await db.project_device_roles.updateMany({ where: { id }, data: { pin_hash: newPinHash } });
}

/**
 * Deactivate (soft-delete) a device role.
 * @param {import('./connection.js').Db} db
 * @param {number} id
 * @returns {Promise<boolean>}
 */
export async function deactivateDeviceRole(db, id) {
  const result = await db.project_device_roles.updateMany({ where: { id }, data: { active: 0 } });
  return result.count > 0;
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
