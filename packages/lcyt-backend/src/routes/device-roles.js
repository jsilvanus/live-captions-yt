/**
 * Device role routes.
 *
 * GET    /keys/:key/device-roles           — list device roles (no PINs)
 * POST   /keys/:key/device-roles           — create device role (returns plain PIN once)
 * PATCH  /keys/:key/device-roles/:id       — rename / change permissions
 * DELETE /keys/:key/device-roles/:id       — deactivate role
 * POST   /keys/:key/device-roles/:id/reset-pin — regenerate PIN (returned once)
 *
 * GET    /keys/:key/device-code            — get current 6-digit project code
 * POST   /keys/:key/device-code            — generate new project device code
 *
 * POST   /auth/device-login               — { deviceCode, pin } → device JWT
 *   (Mounted separately on the auth router)
 */

import { Router } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import {
  getDeviceRoles,
  getDeviceRole,
  createDeviceRole,
  updateDeviceRole,
  resetDeviceRolePin,
  deactivateDeviceRole,
  generatePin,
  generateDeviceCode,
  setProjectDeviceCode,
  getKeyByDeviceCode,
  getActiveDeviceRolesForKey,
} from '../db/device-roles.js';
import { getKey } from '../db/keys.js';
import { getMemberAccessLevel } from '../db/project-members.js';
import { adminMiddleware } from '../middleware/admin.js';

const BCRYPT_ROUNDS = 10;

function verifyUserToken(jwtSecret, req) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  try {
    const payload = jwt.verify(header.slice(7), jwtSecret);
    if (payload.type !== 'user') return null;
    return { userId: payload.userId, email: payload.email };
  } catch { return null; }
}

function requireOwnerOrAdmin(db, apiKey, user) {
  const level = getMemberAccessLevel(db, apiKey, user.userId);
  return level === 'owner' || level === 'admin';
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {{ loginEnabled?: boolean, jwtSecret?: string }} opts
 */
export function createDeviceRolesRouter(db, { loginEnabled = false, jwtSecret = null } = {}) {
  const router = Router({ mergeParams: true });

  // GET /keys/:key/device-code
  router.get('/device-code', (req, res) => {
    const hasAdmin = !!req.headers['x-admin-key'];
    if (!hasAdmin) {
      if (!loginEnabled) return res.status(404).json({ error: 'Not found' });
      const user = verifyUserToken(jwtSecret, req);
      if (!user) return res.status(401).json({ error: 'Authentication required' });
      if (!requireOwnerOrAdmin(db, req.params.key, user)) {
        return res.status(403).json({ error: 'owner or admin required' });
      }
    } else {
      // Admin path — still check key exists
      const row = getKey(db, req.params.key);
      if (!row) return res.status(404).json({ error: 'Project not found' });
    }
    const row = getKey(db, req.params.key);
    return res.json({ deviceCode: row?.device_code || null });
  });

  // POST /keys/:key/device-code — generate / regenerate
  router.post('/device-code', (req, res) => {
    const hasAdmin = !!req.headers['x-admin-key'];
    if (!hasAdmin) {
      if (!loginEnabled) return res.status(404).json({ error: 'Not found' });
      const user = verifyUserToken(jwtSecret, req);
      if (!user) return res.status(401).json({ error: 'Authentication required' });
      if (!requireOwnerOrAdmin(db, req.params.key, user)) {
        return res.status(403).json({ error: 'owner or admin required' });
      }
    } else {
      return adminMiddleware(req, res, () => _generateDeviceCode(db, req, res));
    }
    return _generateDeviceCode(db, req, res);
  });

  // GET /keys/:key/device-roles
  router.get('/device-roles', (req, res) => {
    const hasAdmin = !!req.headers['x-admin-key'];
    if (!hasAdmin) {
      if (!loginEnabled) return res.status(404).json({ error: 'Not found' });
      const user = verifyUserToken(jwtSecret, req);
      if (!user) return res.status(401).json({ error: 'Authentication required' });
      const level = getMemberAccessLevel(db, req.params.key, user.userId);
      if (!level) return res.status(403).json({ error: 'Not a project member' });
    }
    const roles = getDeviceRoles(db, req.params.key);
    return res.json({ deviceRoles: roles });
  });

  // POST /keys/:key/device-roles — create
  router.post('/device-roles', async (req, res) => {
    const hasAdmin = !!req.headers['x-admin-key'];
    if (!hasAdmin) {
      if (!loginEnabled) return res.status(404).json({ error: 'Not found' });
      const user = verifyUserToken(jwtSecret, req);
      if (!user) return res.status(401).json({ error: 'Authentication required' });
      if (!requireOwnerOrAdmin(db, req.params.key, user)) {
        return res.status(403).json({ error: 'owner or admin required' });
      }
    }
    const { roleType, name, permissions = [], config } = req.body || {};
    if (!roleType) return res.status(400).json({ error: 'roleType is required' });
    if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
    if (!['camera', 'mic', 'mixer', 'custom'].includes(roleType)) {
      return res.status(400).json({ error: 'roleType must be camera, mic, mixer, or custom' });
    }

    const pin = generatePin();
    const pinHash = await bcrypt.hash(pin, BCRYPT_ROUNDS);
    const role = createDeviceRole(db, req.params.key, {
      roleType,
      name: name.trim(),
      pinHash,
      permissions,
      config: config || null,
    });

    // Return plain PIN exactly once
    return res.status(201).json({ ...role, pin });
  });

  // PATCH /keys/:key/device-roles/:id
  router.patch('/device-roles/:id', async (req, res) => {
    const hasAdmin = !!req.headers['x-admin-key'];
    if (!hasAdmin) {
      if (!loginEnabled) return res.status(404).json({ error: 'Not found' });
      const user = verifyUserToken(jwtSecret, req);
      if (!user) return res.status(401).json({ error: 'Authentication required' });
      if (!requireOwnerOrAdmin(db, req.params.key, user)) {
        return res.status(403).json({ error: 'owner or admin required' });
      }
    }
    const id = Number(req.params.id);
    const existing = getDeviceRole(db, id);
    if (!existing || existing.apiKey !== req.params.key) {
      return res.status(404).json({ error: 'Device role not found' });
    }
    const { name, permissions, config } = req.body || {};
    updateDeviceRole(db, id, { name, permissions, config });
    return res.json(getDeviceRole(db, id));
  });

  // DELETE /keys/:key/device-roles/:id
  router.delete('/device-roles/:id', (req, res) => {
    const hasAdmin = !!req.headers['x-admin-key'];
    if (!hasAdmin) {
      if (!loginEnabled) return res.status(404).json({ error: 'Not found' });
      const user = verifyUserToken(jwtSecret, req);
      if (!user) return res.status(401).json({ error: 'Authentication required' });
      if (!requireOwnerOrAdmin(db, req.params.key, user)) {
        return res.status(403).json({ error: 'owner or admin required' });
      }
    }
    const id = Number(req.params.id);
    const existing = getDeviceRole(db, id);
    if (!existing || existing.apiKey !== req.params.key) {
      return res.status(404).json({ error: 'Device role not found' });
    }
    deactivateDeviceRole(db, id);
    return res.json({ deactivated: true });
  });

  // POST /keys/:key/device-roles/:id/reset-pin
  router.post('/device-roles/:id/reset-pin', async (req, res) => {
    const hasAdmin = !!req.headers['x-admin-key'];
    if (!hasAdmin) {
      if (!loginEnabled) return res.status(404).json({ error: 'Not found' });
      const user = verifyUserToken(jwtSecret, req);
      if (!user) return res.status(401).json({ error: 'Authentication required' });
      if (!requireOwnerOrAdmin(db, req.params.key, user)) {
        return res.status(403).json({ error: 'owner or admin required' });
      }
    }
    const id = Number(req.params.id);
    const existing = getDeviceRole(db, id);
    if (!existing || existing.apiKey !== req.params.key) {
      return res.status(404).json({ error: 'Device role not found' });
    }
    const pin = generatePin();
    const pinHash = await bcrypt.hash(pin, BCRYPT_ROUNDS);
    resetDeviceRolePin(db, id, pinHash);
    return res.json({ pin });
  });

  return router;
}

/**
 * Device login handler — mounted on /auth/device-login.
 * Body: { deviceCode: '123456', pin: '654321' }
 * Returns: { token, roleType, name, permissions, apiKey }
 *
 * The JWT has no expiry (sessions are revoked by deactivating the device role).
 */
export async function deviceLoginHandler(db, jwtSecret, req, res) {
  const { deviceCode, pin } = req.body || {};
  if (!deviceCode || !pin) {
    return res.status(400).json({ error: 'deviceCode and pin are required' });
  }

  const keyRow = getKeyByDeviceCode(db, deviceCode);
  if (!keyRow) {
    return res.status(401).json({ error: 'Invalid device code' });
  }

  const candidates = getActiveDeviceRolesForKey(db, keyRow.key);
  let matchedRole = null;
  for (const candidate of candidates) {
    const match = await bcrypt.compare(String(pin), candidate.pin_hash);
    if (match) {
      matchedRole = candidate;
      break;
    }
  }

  if (!matchedRole) {
    return res.status(401).json({ error: 'Invalid PIN' });
  }

  let permissions = [];
  try { permissions = JSON.parse(matchedRole.permissions || '[]'); } catch {}

  // No expiry — role must be deactivated to revoke
  const token = jwt.sign(
    {
      type:        'device',
      apiKey:      keyRow.key,
      roleId:      matchedRole.id,
      roleType:    matchedRole.role_type,
      permissions,
    },
    jwtSecret,
  );

  return res.json({
    token,
    apiKey:      keyRow.key,
    roleId:      matchedRole.id,
    roleType:    matchedRole.role_type,
    name:        matchedRole.name,
    permissions,
  });
}

function _generateDeviceCode(db, req, res) {
  const row = getKey(db, req.params.key);
  if (!row) return res.status(404).json({ error: 'Project not found' });
  const code = generateDeviceCode();
  setProjectDeviceCode(db, req.params.key, code);
  return res.json({ deviceCode: code });
}
