/**
 * Shared route helpers for lcyt-connectors' Express routers.
 *
 * Not shared with lcyt-backend's own copies of the same shape (see
 * middleware/auth.js's extractSseToken/verifySessionToken) — lcyt-backend
 * depends on this plugin, so this plugin can't depend back on lcyt-backend
 * without a circular dependency. This is the unavoidable duplication that
 * package boundary creates.
 */
import jwt from 'jsonwebtoken';

/**
 * Reads `req.session.apiKey` (set by lcyt-backend's session auth middleware),
 * 401ing if absent. Shared by routes/connectors.js and routes/variables.js.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {string|null}
 */
export function requireApiKey(req, res) {
  const apiKey = req.session?.apiKey;
  if (!apiKey) {
    res.status(401).json({ error: 'Not authenticated' });
    return null;
  }
  return apiKey;
}

/**
 * Extract a bearer token from either the Authorization header or a `?token=`
 * query param — for SSE endpoints, since EventSource can't set custom headers.
 * @param {import('express').Request} req
 * @returns {string|null}
 */
export function extractSseToken(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) return authHeader.slice(7);
  return req.query.token || null;
}

/**
 * Verify a session JWT and return its apiKey claim, or null if missing/
 * invalid/expired. Real signature verification — not a raw base64 decode of
 * the payload segment, which would let anyone forge a token claiming any
 * apiKey.
 * @param {string|null} token
 * @param {string} jwtSecret
 * @returns {string|null}
 */
export function verifyApiKeyFromToken(token, jwtSecret) {
  if (!token) return null;
  try {
    return jwt.verify(token, jwtSecret).apiKey ?? null;
  } catch {
    return null;
  }
}
