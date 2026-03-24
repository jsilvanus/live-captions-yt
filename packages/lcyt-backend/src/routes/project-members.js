/**
 * Project membership routes.
 *
 * GET    /keys/:key/members                             — list members
 * POST   /keys/:key/members                             — invite member by email
 * DELETE /keys/:key/members/:userId                     — remove member
 * PATCH  /keys/:key/members/:userId                     — change access_level / permissions
 * POST   /keys/:key/members/:userId/transfer-ownership  — transfer owner role
 *
 * All routes require a user Bearer token. The acting user must be a project member
 * (for GET) or owner/admin (for mutations). X-Admin-Key bypasses auth on all routes.
 */

import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { getKey } from '../db/keys.js';
import { getUserByEmail, getUserById } from '../db/users.js';
import {
  addMember,
  getMember,
  getMembers,
  removeMember,
  updateMemberAccessLevel,
  transferOwnership,
  setMemberPermission,
  getMemberAccessLevel,
  getMemberCount,
} from '../db/project-members.js';
import { adminMiddleware } from '../middleware/admin.js';

function verifyUserToken(jwtSecret, req) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  try {
    const payload = jwt.verify(header.slice(7), jwtSecret);
    if (payload.type !== 'user') return null;
    return { userId: payload.userId, email: payload.email };
  } catch { return null; }
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {{ loginEnabled?: boolean, jwtSecret?: string }} opts
 */
export function createProjectMembersRouter(db, { loginEnabled = false, jwtSecret = null } = {}) {
  const router = Router({ mergeParams: true });

  // GET /keys/:key/members
  router.get('/', (req, res) => {
    const hasAdmin = !!req.headers['x-admin-key'];
    if (hasAdmin) return adminMiddleware(req, res, () => _listMembers(db, req, res));
    if (!loginEnabled) return res.status(404).json({ error: 'Not found' });
    const user = verifyUserToken(jwtSecret, req);
    if (!user) return res.status(401).json({ error: 'Authentication required' });
    const level = getMemberAccessLevel(db, req.params.key, user.userId);
    if (!level) return res.status(403).json({ error: 'Not a project member' });
    return _listMembers(db, req, res);
  });

  // POST /keys/:key/members — invite by email
  router.post('/', (req, res) => {
    const hasAdmin = !!req.headers['x-admin-key'];
    if (hasAdmin) return adminMiddleware(req, res, () => _inviteMember(db, null, req, res));
    if (!loginEnabled) return res.status(404).json({ error: 'Not found' });
    const user = verifyUserToken(jwtSecret, req);
    if (!user) return res.status(401).json({ error: 'Authentication required' });
    const level = getMemberAccessLevel(db, req.params.key, user.userId);
    if (level !== 'owner' && level !== 'admin') {
      return res.status(403).json({ error: 'owner or admin required to invite members' });
    }
    return _inviteMember(db, user, req, res);
  });

  // DELETE /keys/:key/members/:userId
  router.delete('/:userId', (req, res) => {
    const hasAdmin = !!req.headers['x-admin-key'];
    if (hasAdmin) return adminMiddleware(req, res, () => _removeMember(db, req, res));
    if (!loginEnabled) return res.status(404).json({ error: 'Not found' });
    const user = verifyUserToken(jwtSecret, req);
    if (!user) return res.status(401).json({ error: 'Authentication required' });
    const targetId = Number(req.params.userId);
    // Members may remove themselves; admins/owners may remove others
    if (user.userId !== targetId) {
      const level = getMemberAccessLevel(db, req.params.key, user.userId);
      if (level !== 'owner' && level !== 'admin') {
        return res.status(403).json({ error: 'owner or admin required to remove other members' });
      }
    }
    return _removeMember(db, req, res);
  });

  // PATCH /keys/:key/members/:userId — change access_level or permissions
  router.patch('/:userId', (req, res) => {
    const hasAdmin = !!req.headers['x-admin-key'];
    if (hasAdmin) return adminMiddleware(req, res, () => _updateMember(db, req, res));
    if (!loginEnabled) return res.status(404).json({ error: 'Not found' });
    const user = verifyUserToken(jwtSecret, req);
    if (!user) return res.status(401).json({ error: 'Authentication required' });
    const level = getMemberAccessLevel(db, req.params.key, user.userId);
    if (level !== 'owner' && level !== 'admin') {
      return res.status(403).json({ error: 'owner or admin required' });
    }
    return _updateMember(db, req, res);
  });

  // POST /keys/:key/members/:userId/transfer-ownership
  router.post('/:userId/transfer-ownership', (req, res) => {
    if (!loginEnabled) return res.status(404).json({ error: 'Not found' });
    const user = verifyUserToken(jwtSecret, req);
    if (!user) return res.status(401).json({ error: 'Authentication required' });
    const toUserId = Number(req.params.userId);
    const result = transferOwnership(db, req.params.key, user.userId, toUserId);
    if (!result.ok) {
      const status = result.reason === 'not_owner' ? 403 : 400;
      return res.status(status).json({ error: result.reason });
    }
    return res.json({ ok: true });
  });

  return router;
}

function _listMembers(db, req, res) {
  const rows = getMembers(db, req.params.key);
  return res.json({
    members: rows.map(r => ({
      userId:      r.user_id,
      email:       r.email,
      name:        r.name || null,
      accessLevel: r.access_level,
      permissions: r.permissions,
      joinedAt:    r.joined_at,
    })),
    total: rows.length,
  });
}

function _inviteMember(db, actingUser, req, res) {
  const { email, accessLevel = 'member', permissions = [] } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email is required' });

  const targetUser = getUserByEmail(db, email);
  if (!targetUser) return res.status(404).json({ error: 'No account found with that email' });
  if (!targetUser.active) return res.status(400).json({ error: 'User account is not active' });

  const existing = getMember(db, req.params.key, targetUser.id);
  if (existing) return res.status(409).json({ error: 'User is already a member of this project' });

  const validLevels = ['admin', 'member'];
  if (!validLevels.includes(accessLevel)) {
    return res.status(400).json({ error: 'accessLevel must be admin or member' });
  }

  const member = addMember(db, req.params.key, targetUser.id, accessLevel, actingUser?.userId ?? null);
  return res.status(201).json({
    memberId:    member.id,
    userId:      member.user_id,
    email:       member.email,
    accessLevel: member.access_level,
    joinedAt:    member.joined_at,
  });
}

function _removeMember(db, req, res) {
  const targetId = Number(req.params.userId);
  const result = removeMember(db, req.params.key, targetId);
  if (!result.removed) {
    const status = result.reason === 'not_found' ? 404 : 400;
    return res.status(status).json({ error: result.reason });
  }
  return res.json({ removed: true });
}

function _updateMember(db, req, res) {
  const targetId = Number(req.params.userId);
  const member = getMember(db, req.params.key, targetId);
  if (!member) return res.status(404).json({ error: 'Member not found' });

  const { accessLevel, permissions } = req.body || {};

  if (accessLevel !== undefined) {
    if (!['admin', 'member'].includes(accessLevel)) {
      return res.status(400).json({ error: 'accessLevel must be admin or member (cannot set owner this way)' });
    }
    if (member.access_level === 'owner') {
      return res.status(400).json({ error: 'Cannot change access level of owner; use transfer-ownership' });
    }
    updateMemberAccessLevel(db, member.id, accessLevel);
  }

  // permissions: array of '+code' / '-code' delta strings
  if (Array.isArray(permissions)) {
    for (const p of permissions) {
      if (typeof p !== 'string') continue;
      if (p.startsWith('+')) setMemberPermission(db, member.id, p.slice(1), true);
      else if (p.startsWith('-')) setMemberPermission(db, member.id, p.slice(1), false);
    }
  }

  const updated = getMember(db, req.params.key, targetId);
  return res.json({
    userId:      updated.user_id,
    accessLevel: updated.access_level,
    permissions: [], // caller should re-fetch /members for full effective set
  });
}
