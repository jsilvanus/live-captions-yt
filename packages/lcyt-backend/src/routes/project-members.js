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
import { extractAndVerifyUserToken } from '../middleware/user-auth.js';

/**
 * @param {import('better-sqlite3').Database} db
 * @param {{ loginEnabled?: boolean, jwtSecret?: string }} opts
 */
export function createProjectMembersRouter(db, { loginEnabled = false, jwtSecret = null } = {}) {
  const router = Router({ mergeParams: true });

  // GET /keys/:key/members
  router.get('/', async (req, res) => {
    const hasAdmin = !!req.headers['x-admin-key'];
    if (hasAdmin) return adminMiddleware(req, res, async () => await _listMembers(db, req, res));
    if (!loginEnabled) return res.status(404).json({ error: 'Not found' });
    const user = extractAndVerifyUserToken(jwtSecret, req);
    if (!user) return res.status(401).json({ error: 'Authentication required' });
    const level = await getMemberAccessLevel(db, req.params.key, user.userId);
    if (!level) return res.status(403).json({ error: 'Not a project member' });
    return await _listMembers(db, req, res);
  });

  // POST /keys/:key/members — invite by email
  router.post('/', async (req, res) => {
    const hasAdmin = !!req.headers['x-admin-key'];
    if (hasAdmin) return adminMiddleware(req, res, async () => await _inviteMember(db, null, req, res));
    if (!loginEnabled) return res.status(404).json({ error: 'Not found' });
    const user = extractAndVerifyUserToken(jwtSecret, req);
    if (!user) return res.status(401).json({ error: 'Authentication required' });
    const level = await getMemberAccessLevel(db, req.params.key, user.userId);
    if (level !== 'owner' && level !== 'admin') {
      return res.status(403).json({ error: 'owner or admin required to invite members' });
    }
    return await _inviteMember(db, user, req, res);
  });

  // DELETE /keys/:key/members/:userId
  router.delete('/:userId', async (req, res) => {
    const hasAdmin = !!req.headers['x-admin-key'];
    if (hasAdmin) return adminMiddleware(req, res, async () => await _removeMember(db, req, res));
    if (!loginEnabled) return res.status(404).json({ error: 'Not found' });
    const user = extractAndVerifyUserToken(jwtSecret, req);
    if (!user) return res.status(401).json({ error: 'Authentication required' });
    const targetId = Number(req.params.userId);
    // Members may remove themselves; admins/owners may remove others
    if (user.userId !== targetId) {
      const level = await getMemberAccessLevel(db, req.params.key, user.userId);
      if (level !== 'owner' && level !== 'admin') {
        return res.status(403).json({ error: 'owner or admin required to remove other members' });
      }
    }
    return await _removeMember(db, req, res);
  });

  // PATCH /keys/:key/members/:userId — change access_level or permissions
  router.patch('/:userId', async (req, res) => {
    const hasAdmin = !!req.headers['x-admin-key'];
    if (hasAdmin) return adminMiddleware(req, res, async () => await _updateMember(db, req, res));
    if (!loginEnabled) return res.status(404).json({ error: 'Not found' });
    const user = extractAndVerifyUserToken(jwtSecret, req);
    if (!user) return res.status(401).json({ error: 'Authentication required' });
    const level = await getMemberAccessLevel(db, req.params.key, user.userId);
    if (level !== 'owner' && level !== 'admin') {
      return res.status(403).json({ error: 'owner or admin required' });
    }
    return await _updateMember(db, req, res);
  });

  // POST /keys/:key/members/:userId/transfer-ownership
  router.post('/:userId/transfer-ownership', async (req, res) => {
    if (!loginEnabled) return res.status(404).json({ error: 'Not found' });
    const user = extractAndVerifyUserToken(jwtSecret, req);
    if (!user) return res.status(401).json({ error: 'Authentication required' });
    const toUserId = Number(req.params.userId);
    const result = await transferOwnership(db, req.params.key, user.userId, toUserId);
    if (!result.ok) {
      const status = result.reason === 'not_owner' ? 403 : 400;
      return res.status(status).json({ error: result.reason });
    }
    return res.json({ ok: true });
  });

  return router;
}

async function _listMembers(db, req, res) {
  const rows = await getMembers(db, req.params.key);
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

async function _inviteMember(db, actingUser, req, res) {
  const { email, accessLevel = 'editor', permissions = [] } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email is required' });

  const targetUser = await getUserByEmail(db, email);
  if (!targetUser) return res.status(404).json({ error: 'No account found with that email' });
  if (!targetUser.active) return res.status(400).json({ error: 'User account is not active' });

  const existing = await getMember(db, req.params.key, targetUser.id);
  if (existing) return res.status(409).json({ error: 'User is already a member of this project' });

  const validLevels = ['admin', 'editor', 'operator', 'viewer'];
  if (!validLevels.includes(accessLevel)) {
    return res.status(400).json({ error: 'accessLevel must be admin, editor, operator, or viewer' });
  }

  const member = await addMember(db, req.params.key, targetUser.id, accessLevel, actingUser?.userId ?? null);
  return res.status(201).json({
    memberId:    member.id,
    userId:      member.user_id,
    email:       member.email,
    accessLevel: member.access_level,
    joinedAt:    member.joined_at,
  });
}

async function _removeMember(db, req, res) {
  const targetId = Number(req.params.userId);
  const result = await removeMember(db, req.params.key, targetId);
  if (!result.removed) {
    const status = result.reason === 'not_found' ? 404 : 400;
    return res.status(status).json({ error: result.reason });
  }
  return res.json({ removed: true });
}

async function _updateMember(db, req, res) {
  const targetId = Number(req.params.userId);
  const member = await getMember(db, req.params.key, targetId);
  if (!member) return res.status(404).json({ error: 'Member not found' });

  const { accessLevel, permissions } = req.body || {};

  if (accessLevel !== undefined) {
    if (!['admin', 'editor', 'operator', 'viewer'].includes(accessLevel)) {
      return res.status(400).json({ error: 'accessLevel must be admin, editor, operator, or viewer (cannot set owner this way)' });
    }
    if (member.access_level === 'owner') {
      return res.status(400).json({ error: 'Cannot change access level of owner; use transfer-ownership' });
    }
    await updateMemberAccessLevel(db, member.id, accessLevel);
  }

  // permissions: array of '+code' / '-code' delta strings
  if (Array.isArray(permissions)) {
    for (const p of permissions) {
      if (typeof p !== 'string') continue;
      if (p.startsWith('+')) await setMemberPermission(db, member.id, p.slice(1), true);
      else if (p.startsWith('-')) await setMemberPermission(db, member.id, p.slice(1), false);
    }
  }

  const updated = await getMember(db, req.params.key, targetId);
  return res.json({
    userId:      updated.user_id,
    accessLevel: updated.access_level,
    permissions: [], // caller should re-fetch /members for full effective set
  });
}
