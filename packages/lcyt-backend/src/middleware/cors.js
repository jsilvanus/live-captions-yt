/**
 * Dynamic CORS middleware.
 *
 * - POST /live and GET /health: permissive — any origin may call (API key is the real gate)
 * - /keys routes: no CORS headers — admin endpoints are server-side only
 * - All other routes: look up sessions by domain; allow only registered origins
 *
 * @param {import('../store.js').SessionStore} store
 */
export function createCorsMiddleware(store) {
  return function corsMiddleware(req, res, next) {
    const origin = req.headers['origin'];
    const path = req.path;
    const method = req.method;

    // Admin endpoints — no CORS headers at all
    if (path.startsWith('/keys')) {
      if (method === 'OPTIONS') {
        res.sendStatus(204);
        return;
      }
      return next();
    }

    // Permissive routes — any origin can call
    const isPermissive =
      (method === 'POST' && path === '/live') ||
      (method === 'GET' && path === '/health') ||
      method === 'OPTIONS';

    if (isPermissive && origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, PATCH, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Key');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      if (method === 'OPTIONS') {
        res.sendStatus(204);
        return;
      }
      return next();
    }

    // Dynamic origin matching for authenticated routes
    if (origin) {
      const matches = store.getByDomain(origin);
      if (matches.length > 0) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, PATCH, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.setHeader('Access-Control-Allow-Credentials', 'true');
      }
      // No match → omit CORS headers (browser will block the request)
    }

    if (method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }

    next();
  };
}
