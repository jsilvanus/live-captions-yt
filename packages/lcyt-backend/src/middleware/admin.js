import { timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { getUserById } from '../db/users.js';

/**
 * Admin key authentication middleware (legacy).
 *
 * Protects the /keys routes. All requests must include the correct X-Admin-Key header.
 *
 * Behavior:
 * - If ADMIN_KEY env var is not set: responds 503 (admin API not configured)
 * - If X-Admin-Key header is missing: responds 401
 * - If key does not match: responds 403 (constant-time comparison to prevent timing attacks)
 * - If key matches: calls next()
 */
export function adminMiddleware(req, res, next) {
  const adminKey = process.env.ADMIN_KEY;

  if (!adminKey) {
    return res.status(503).json({ error: 'Admin API not configured' });
  }

  const providedKey = req.headers['x-admin-key'];

  if (!providedKey) {
    return res.status(401).json({ error: 'X-Admin-Key header required' });
  }

  // Constant-time comparison to prevent timing attacks
  const adminKeyBuf = Buffer.from(adminKey);
  const providedKeyBuf = Buffer.from(providedKey);

  if (
    adminKeyBuf.length !== providedKeyBuf.length ||
    !timingSafeEqual(adminKeyBuf, providedKeyBuf)
  ) {
    return res.status(403).json({ error: 'Invalid admin key' });
  }

  next();
}

/**
 * Create an admin authentication middleware that accepts either:
 * 1. A user JWT Bearer token where the user has `is_admin = 1` in the DB.
 * 2. The legacy `X-Admin-Key` header (when ADMIN_KEY env var is set).
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} jwtSecret
 * @returns {import('express').RequestHandler}
 */
export function createAdminMiddleware(db, jwtSecret) {
  return (req, res, next) => {
    // --- Check user JWT Bearer token (user-based admin) ---
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ') && jwtSecret) {
      try {
        const payload = jwt.verify(authHeader.slice(7), jwtSecret);
        if (payload.type === 'user') {
          const user = getUserById(db, payload.userId);
          if (user?.is_admin) {
            req.adminUser = { userId: user.id, email: user.email };
            return next();
          }
        }
      } catch {
        // Invalid token — fall through to check ADMIN_KEY
      }
    }

    // --- Legacy X-Admin-Key header support ---
    const adminKey = process.env.ADMIN_KEY;
    if (adminKey) {
      const providedKey = req.headers['x-admin-key'];
      if (providedKey) {
        const adminKeyBuf = Buffer.from(adminKey);
        const providedKeyBuf = Buffer.from(providedKey);
        if (
          adminKeyBuf.length === providedKeyBuf.length &&
          timingSafeEqual(adminKeyBuf, providedKeyBuf)
        ) {
          return next();
        }
        return res.status(403).json({ error: 'Invalid admin key' });
      }
    }

    // --- No valid admin auth ---
    return res.status(401).json({ error: 'Admin authentication required' });
  };
}
