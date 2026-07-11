import jwt from 'jsonwebtoken';

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  for (const segment of cookieHeader.split(';')) {
    const [rawName, ...rest] = segment.split('=');
    const name = rawName?.trim();
    if (!name) continue;
    cookies[name] = decodeURIComponent(rest.join('=').trim());
  }
  return cookies;
}

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
    const token = extractAuthToken(req);

    if (!token) {
      return res.status(401).json({ error: 'Authorization header required' });
    }

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
 * Extract a bearer token from the Authorization header, a `?token=` query param,
 * a request body token field, or common auth cookies.
 * @param {import('express').Request} req
 * @returns {string|null}
 */
export function extractAuthToken(req) {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  const queryToken = req.query?.token;
  if (typeof queryToken === 'string' && queryToken.trim()) {
    return queryToken.trim();
  }
  const bodyToken = req.body?.token;
  if (typeof bodyToken === 'string' && bodyToken.trim()) {
    return bodyToken.trim();
  }
  const cookies = parseCookies(req.headers.cookie || '');
  for (const cookieName of ['lcyt_project', 'lcyt_identity']) {
    const cookieValue = cookies[cookieName];
    if (typeof cookieValue === 'string' && cookieValue.trim()) {
      return cookieValue.trim();
    }
  }
  return null;
}

/**
 * Extract a bearer token from either the Authorization header or a `?token=`
 * query param — for SSE endpoints, since EventSource can't set custom headers.
 * @param {import('express').Request} req
 * @returns {string|null}
 */
export function extractSseToken(req) {
  return extractAuthToken(req);
}

/**
 * Normalize a JWT payload into a minimal user identity object.
 * @param {object} payload
 * @returns {{ userId: number|null, email: string|null, isAdmin: boolean, siteRole: string|null }}
 */
export function normalizeUserPayload(payload) {
  const userId = payload.userId ?? payload.sub ?? payload.user_id ?? payload.id ?? null;
  const email = payload.email ?? payload.userEmail ?? null;
  const siteRole = payload.siteRole ?? payload.site_role ?? (payload.isAdmin ? 'admin' : null);
  return {
    userId: userId == null ? null : Number(userId),
    email: typeof email === 'string' && email.trim() ? email : null,
    isAdmin: Boolean(payload.isAdmin ?? payload.is_admin),
    siteRole: typeof siteRole === 'string' && siteRole.trim() ? siteRole : null,
  };
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
