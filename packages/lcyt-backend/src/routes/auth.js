import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { createUser, getUserByEmail, getUserById, updateUserPassword, updateUser, getUserAccountExport, deleteOwnedProjectsForUser, deleteUserAccount } from '../db/users.js';
import { provisionDefaultUserFeatures } from '../db/project-features.js';
import { getEffectiveProjectAccessLevel, PROJECT_ROLE_ORDER } from '../db/project-members.js';
import { createUserAuthMiddleware } from '../middleware/user-auth.js';
import { writeAuditLog } from '../db/audit-log.js';
import { getMetricsInstance } from '../metrics/index.js';
import { getActiveBroadcastId } from '../db/keys.js';
import { deviceLoginHandler } from './device-roles.js';

const BCRYPT_ROUNDS = 12;
const USER_TOKEN_TTL_DAYS = 30;
const FAILED_LOGIN_AUDIT_THROTTLE_MS = 10_000;
// Brute-force guard on /auth/login + /auth/register: only failed attempts
// count toward the limit, so normal traffic (and the test suite) is unaffected.
// LOGIN_RATE_LIMIT_MAX=0 disables.
const LOGIN_RATE_LIMIT_MAX = Number(process.env.LOGIN_RATE_LIMIT_MAX ?? 50);
const LOGIN_RATE_LIMIT = LOGIN_RATE_LIMIT_MAX > 0
  ? rateLimit({
      windowMs: 15 * 60 * 1000,
      max: LOGIN_RATE_LIMIT_MAX,
      skipSuccessfulRequests: true,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'Too many login attempts' },
    })
  : (req, res, next) => next();

function issueUserToken(jwtSecret, { userId, email, isAdmin = false }) {
  return jwt.sign(
    { type: 'user', userId, email, isAdmin: !!isAdmin },
    jwtSecret,
    { expiresIn: `${USER_TOKEN_TTL_DAYS}d` }
  );
}

function issueProjectToken(jwtSecret, { userId, email, isAdmin = false, projectId, projectRole = 'member', siteRole = null, scopes = null, activeBroadcastId = null }) {
  return jwt.sign(
    {
      kind: 'project',
      type: 'user',
      userId,
      email,
      isAdmin: !!isAdmin,
      siteRole: siteRole || (isAdmin ? 'admin' : null),
      projectId,
      projectRole,
      scopes,
      activeBroadcastId,
    },
    jwtSecret,
    { expiresIn: '2h' }
  );
}

/**
 * Creates the /auth router for user registration and login.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} jwtSecret
 * @param {{ loginEnabled: boolean }} opts
 * @returns {import('express').Router}
 */
export function createAuthRouter(db, jwtSecret, { loginEnabled }) {
  const router = Router();
  const userAuth = createUserAuthMiddleware(jwtSecret);
  const metrics = getMetricsInstance();
  const recentFailedLogins = new Map();

  function resolveIp(req) {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || null;
  }

  function shouldRecordFailedLogin(req, email) {
    const ip = resolveIp(req);
    const key = `${String(email || '').toLowerCase()}::${ip || 'unknown'}`;
    const now = Date.now();
    const previous = recentFailedLogins.get(key);
    if (previous && now - previous < FAILED_LOGIN_AUDIT_THROTTLE_MS) {
      return false;
    }
    recentFailedLogins.set(key, now);
    return true;
  }

  // POST /auth/device-login — always available regardless of loginEnabled
  router.post('/device-login', async (req, res) => {
    try {
      await deviceLoginHandler(db, jwtSecret, req, res);
    } catch (err) {
      console.error('[auth] device-login error:', err.message);
      res.status(500).json({ error: 'Device login failed' });
    }
  });

  // All remaining routes return 503 if logins are disabled
  router.use((req, res, next) => {
    if (!loginEnabled) {
      return res.status(503).json({ error: 'User logins are disabled on this server' });
    }
    next();
  });

  // POST /auth/register
  router.post('/register', LOGIN_RATE_LIMIT, async (req, res) => {
    const { email, password, name } = req.body || {};
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'email is required' });
    }
    if (!password || typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'password must be at least 8 characters' });
    }
    // Check for existing account
    const existing = getUserByEmail(db, email);
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }
    try {
      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      const user = createUser(db, { email, passwordHash, name: name || null });
      provisionDefaultUserFeatures(db, user.id);
      const token = issueUserToken(jwtSecret, { userId: user.id, email: user.email, isAdmin: false });
      writeAuditLog(db, { actor: user.email, actorKind: 'user', actorId: user.email, userId: user.id, action: 'auth.register', targetType: 'user', targetId: String(user.id), details: { email: user.email }, ip: resolveIp(req) });
      res.status(201).json({ token, userId: user.id, email: user.email, name: user.name, isAdmin: false });
    } catch (err) {
      console.error('[auth] register error:', err.message);
      res.status(500).json({ error: 'Registration failed' });
    }
  });

  // POST /auth/login
  router.post('/login', LOGIN_RATE_LIMIT, async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }
    metrics?.count('auth.logins', 1, { project: 'system' });
    const user = getUserByEmail(db, email);
    if (!user) {
      if (shouldRecordFailedLogin(req, email)) {
        writeAuditLog(db, { actor: String(email), actorKind: 'user', actorId: String(email), action: 'auth.login_failed', targetType: 'user', details: { email }, ip: resolveIp(req) });
      }
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    try {
      const match = await bcrypt.compare(password, user.password_hash);
      if (!match) {
        if (shouldRecordFailedLogin(req, email)) {
          writeAuditLog(db, { actor: user.email, actorKind: 'user', actorId: user.email, userId: user.id, action: 'auth.login_failed', targetType: 'user', targetId: String(user.id), details: { email: user.email }, ip: resolveIp(req) });
        }
        return res.status(401).json({ error: 'Invalid email or password' });
      }
      const token = issueUserToken(jwtSecret, { userId: user.id, email: user.email, isAdmin: !!user.is_admin });
      writeAuditLog(db, { actor: user.email, actorKind: 'user', actorId: user.email, userId: user.id, action: 'auth.login', targetType: 'user', targetId: String(user.id), details: { email: user.email }, ip: resolveIp(req) });
      res.json({ token, userId: user.id, email: user.email, name: user.name, isAdmin: !!user.is_admin });
    } catch (err) {
      console.error('[auth] login error:', err.message);
      res.status(500).json({ error: 'Login failed' });
    }
  });

  // POST /auth/project-token — exchange a user JWT for a project-scoped access JWT
  router.post('/project-token', userAuth, (req, res) => {
    const { projectId, projectRole = 'member', scopes } = req.body || {};
    if (!projectId || typeof projectId !== 'string' || !projectId.trim()) {
      return res.status(400).json({ error: 'projectId is required' });
    }
    const accessLevel = getEffectiveProjectAccessLevel(db, projectId.trim(), req.user.userId);
    if (!accessLevel) {
      return res.status(403).json({ error: 'Not a project member' });
    }
    // projectRole is client-supplied. middleware/project-access.js's
    // normalizeProjectRole() only ever branches specially on 'owner'/'admin'
    // — every other value (org-tier labels like 'editor'/'operator'/
    // 'viewer', or anything unrecognized, which normalizeProjectRole falls
    // back to 'member' for) behaves identically to 'member' at every
    // project-route access check, so there's nothing to escalate by
    // requesting one of those (e.g. a real owner deliberately minting a
    // token labeled 'editor' is fine, and expected). Only a request for
    // 'owner' or 'admin' needs capping to what getEffectiveProjectAccessLevel
    // actually resolved, so a lower-privileged caller can't self-grant one
    // of those two labels.
    let grantedRole = projectRole || accessLevel;
    if (grantedRole === 'owner' || grantedRole === 'admin') {
      if (PROJECT_ROLE_ORDER[accessLevel] < PROJECT_ROLE_ORDER[grantedRole]) grantedRole = accessLevel;
    }
    const activeBroadcastId = getActiveBroadcastId(db, projectId.trim());
    const token = issueProjectToken(jwtSecret, {
      userId: req.user.userId,
      email: req.user.email,
      projectId: projectId.trim(),
      projectRole: grantedRole,
      scopes,
      activeBroadcastId,
    });
    return res.json({ token, projectId: projectId.trim(), projectRole: grantedRole, accessLevel, activeBroadcastId });
  });

  // GET /auth/me — requires user token
  router.get('/me', userAuth, (req, res) => {
    const user = getUserById(db, req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ userId: user.id, email: user.email, name: user.name, createdAt: user.created_at, isAdmin: !!user.is_admin });
  });

  // PATCH /auth/me — update own profile (name); requires user token
  router.patch('/me', userAuth, (req, res) => {
    const { name } = req.body || {};
    if (name === undefined) {
      return res.status(400).json({ error: 'name is required' });
    }
    if (typeof name !== 'string') {
      return res.status(400).json({ error: 'name must be a string' });
    }
    const trimmed = name.trim();
    if (trimmed === '') {
      return res.status(400).json({ error: 'name cannot be empty' });
    }
    try {
      updateUser(db, req.user.userId, { name: trimmed });
      const user = getUserById(db, req.user.userId);
      if (!user) return res.status(404).json({ error: 'User not found' });
      res.json({ userId: user.id, email: user.email, name: user.name, createdAt: user.created_at, isAdmin: !!user.is_admin });
    } catch (err) {
      console.error('[auth] update-me error:', err.message);
      res.status(500).json({ error: 'Profile update failed' });
    }
  });

  // GET /auth/me/export — export the current user's own data
  router.get('/me/export', userAuth, (req, res) => {
    const exportData = getUserAccountExport(db, req.user.userId);
    if (!exportData) return res.status(404).json({ error: 'User not found' });
    res.json(exportData);
  });

  // DELETE /auth/me/data — delete the user's owned projects, keep the account
  router.delete('/me/data', userAuth, (req, res) => {
    const deletedProjectCount = deleteOwnedProjectsForUser(db, req.user.userId);
    res.json({ deletedProjectCount });
  });

  // DELETE /auth/me — full account deletion
  router.delete('/me', userAuth, (req, res) => {
    const orgRows = db.prepare(`
      SELECT om.org_id
      FROM org_members om
      JOIN organizations o ON o.id = om.org_id
      WHERE om.user_id = ? AND om.role = 'owner'
    `).all(req.user.userId);

    for (const orgRow of orgRows) {
      const memberCount = db.prepare(
        'SELECT COUNT(*) as count FROM org_members WHERE org_id = ? AND user_id != ?'
      ).get(orgRow.org_id, req.user.userId).count;
      if (memberCount > 0) {
        return res.status(409).json({
          error: 'Cannot delete your account while you are the sole owner of an org with other members. Transfer ownership or remove them first.',
        });
      }
    }

    deleteUserAccount(db, req.user.userId);
    res.json({ deleted: true });
  });

  // POST /auth/change-password — requires user token
  router.post('/change-password', userAuth, async (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'currentPassword and newPassword are required' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'newPassword must be at least 8 characters' });
    }
    const user = getUserByEmail(db, req.user.email);
    if (!user) return res.status(404).json({ error: 'User not found' });
    try {
      const match = await bcrypt.compare(currentPassword, user.password_hash);
      if (!match) {
        return res.status(401).json({ error: 'Current password is incorrect' });
      }
      const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
      updateUserPassword(db, user.id, newHash);
      res.json({ ok: true });
    } catch (err) {
      console.error('[auth] change-password error:', err.message);
      res.status(500).json({ error: 'Password change failed' });
    }
  });

  return router;
}
