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
