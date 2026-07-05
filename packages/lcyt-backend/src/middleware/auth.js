import jwt from 'jsonwebtoken';

/**
 * JWT authentication middleware factory.
 *
 * Verifies `Authorization: Bearer <token>` on incoming requests.
 * On success, attaches decoded payload to `req.session`:
 *   { sessionId, apiKey, streamKey, domain }
 *
 * @param {string} jwtSecret - Secret used to verify JWT signatures
 * @returns {import('express').RequestHandler}
 */
export function createAuthMiddleware(jwtSecret) {
  return function authMiddleware(req, res, next) {
    const authHeader = req.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authorization header required' });
    }

    const token = authHeader.slice(7);

    try {
      const payload = jwt.verify(token, jwtSecret);
      req.session = payload;
      next();
    } catch {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  };
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
 * Verify a session JWT and return its decoded payload, or null if missing/
 * invalid/expired. Real signature verification — not a raw base64 decode of
 * the payload segment, which would let anyone forge a token claiming any
 * apiKey/sessionId.
 * @param {string|null} token
 * @param {string} jwtSecret
 * @returns {object|null}
 */
export function verifySessionToken(token, jwtSecret) {
  if (!token) return null;
  try {
    return jwt.verify(token, jwtSecret);
  } catch {
    return null;
  }
}
