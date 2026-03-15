import jwt from 'jsonwebtoken';

/**
 * Middleware factory for verifying user-level JWT tokens.
 * User tokens have payload `{ type: 'user', userId, email }`.
 * Distinct from session tokens which have `{ sessionId, apiKey }`.
 *
 * @param {string} jwtSecret
 * @returns {import('express').RequestHandler}
 */
export function createUserAuthMiddleware(jwtSecret) {
  return (req, res, next) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }
    try {
      const payload = jwt.verify(header.slice(7), jwtSecret);
      if (payload.type !== 'user') {
        return res.status(401).json({ error: 'Invalid token type' });
      }
      req.user = { userId: payload.userId, email: payload.email };
      next();
    } catch {
      res.status(401).json({ error: 'Invalid or expired token' });
    }
  };
}
