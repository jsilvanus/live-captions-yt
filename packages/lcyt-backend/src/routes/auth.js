import { Router } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { createUser, getUserByEmail, getUserById, updateUserPassword } from '../db/users.js';
import { provisionDefaultUserFeatures } from '../db/project-features.js';
import { createUserAuthMiddleware } from '../middleware/user-auth.js';
import { deviceLoginHandler } from './device-roles.js';

const BCRYPT_ROUNDS = 12;
const USER_TOKEN_TTL_DAYS = 30;

function issueUserToken(jwtSecret, { userId, email, isAdmin = false }) {
  return jwt.sign(
    { type: 'user', userId, email, isAdmin: !!isAdmin },
    jwtSecret,
    { expiresIn: `${USER_TOKEN_TTL_DAYS}d` }
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
  router.post('/register', async (req, res) => {
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
      res.status(201).json({ token, userId: user.id, email: user.email, name: user.name, isAdmin: false });
    } catch (err) {
      console.error('[auth] register error:', err.message);
      res.status(500).json({ error: 'Registration failed' });
    }
  });

  // POST /auth/login
  router.post('/login', async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }
    const user = getUserByEmail(db, email);
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    try {
      const match = await bcrypt.compare(password, user.password_hash);
      if (!match) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }
      const token = issueUserToken(jwtSecret, { userId: user.id, email: user.email, isAdmin: !!user.is_admin });
      res.json({ token, userId: user.id, email: user.email, name: user.name, isAdmin: !!user.is_admin });
    } catch (err) {
      console.error('[auth] login error:', err.message);
      res.status(500).json({ error: 'Login failed' });
    }
  });

  // GET /auth/me — requires user token
  router.get('/me', userAuth, (req, res) => {
    const user = getUserById(db, req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ userId: user.id, email: user.email, name: user.name, createdAt: user.created_at, isAdmin: !!user.is_admin });
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
