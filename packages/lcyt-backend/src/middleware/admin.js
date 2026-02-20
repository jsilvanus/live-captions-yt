import { timingSafeEqual } from 'node:crypto';

/**
 * Admin key authentication middleware.
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
