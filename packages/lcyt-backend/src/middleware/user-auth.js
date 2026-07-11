import jwt from 'jsonwebtoken';
import { extractAuthToken, normalizeUserPayload } from './auth.js';

/**
 * Extract and verify a user JWT from a request.
 * Returns normalized user identity or null if token missing/invalid/expired.
 * @param {string} jwtSecret
 * @param {import('express').Request} req
 * @returns {{ userId: number, email: string|null, siteRole: string|null } | null}
 */
export function extractAndVerifyUserToken(jwtSecret, req) {
  const token = extractAuthToken(req);
  if (!token) return null;
  try {
    const payload = jwt.verify(token, jwtSecret);
    if (payload.type !== 'user' && payload.kind !== 'identity' && payload.kind !== 'project') {
      return null;
    }
    const user = normalizeUserPayload(payload);
    if (!user.userId) return null;
    return user;
  } catch {
    return null;
  }
}

/**
 * Middleware factory for verifying user-level JWT tokens.
 * User tokens have payload `{ type: 'user', userId, email }`.
 * Distinct from session tokens which have `{ sessionId, apiKey }`.
 *
 * Supports bearer tokens and HttpOnly identity/project cookies.
 *
 * @param {string} jwtSecret
 * @returns {import('express').RequestHandler}
 */
export function createUserAuthMiddleware(jwtSecret) {
  return (req, res, next) => {
    const token = extractAuthToken(req);
    if (!token) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }
    try {
      const payload = jwt.verify(token, jwtSecret);
      if (payload.type !== 'user' && payload.kind !== 'identity' && payload.kind !== 'project') {
        return res.status(401).json({ error: 'Invalid token type' });
      }
      const user = normalizeUserPayload(payload);
      if (!user.userId) {
        return res.status(401).json({ error: 'Invalid token payload' });
      }
      req.user = { userId: user.userId, email: user.email, isAdmin: user.isAdmin, siteRole: user.siteRole };
      req.auth = req.auth || {};
      req.auth.user = user;
      next();
    } catch {
      res.status(401).json({ error: 'Invalid or expired token' });
    }
  };
}
