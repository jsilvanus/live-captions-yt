const CORS_HEADERS = 'Content-Type, Authorization, X-Admin-Key, X-API-Key';
const CORS_METHODS = 'GET, POST, PUT, DELETE, PATCH, OPTIONS';

/**
 * Dynamic CORS middleware.
 *
 * - POST /live and GET /health: permissive — any origin may call (API key is the real gate)
 * - /dsk/* and /images: permissive — authenticated by X-API-Key or Bearer JWT, not session domain
 * - /events with ?token=: permissive — authenticated by token, origin is not the security gate
 * - /keys routes: permissive CORS — user project CRUD uses Bearer JWT from the browser; admin key is protected by the route handler
 * - All other routes: look up sessions by domain; allow only registered origins
 *
 * @param {import('../store.js').SessionStore} store
 */
export function createCorsMiddleware(store) {
  return function corsMiddleware(req, res, next) {
    const origin = req.headers['origin'];
    const path = req.path;
    const method = req.method;

    // Free-tier key signup — any origin, POST only (must check before the /keys block)
    if (method === 'POST' && path === '/keys' && 'freetier' in req.query) {
      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Access-Control-Allow-Credentials', 'true');
      }
      return next();
    }

    // /keys routes — user project CRUD uses Bearer JWT (needs CORS for browser apps like
    // the Projects page at app.lcyt.fi). Admin operations are protected by X-Admin-Key in
    // the route handler; CORS being open here does not weaken that protection.
    if (path.startsWith('/keys')) {
      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Methods', CORS_METHODS);
        res.setHeader('Access-Control-Allow-Headers', CORS_HEADERS);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
      }
      if (method === 'OPTIONS') {
        res.sendStatus(204);
        return;
      }
      return next();
    }

    // Permissive routes — any origin can call; the auth header/token is the real gate
    const isPermissive =
      (method === 'POST' && path === '/live') ||
      (method === 'GET' && path === '/health') ||
      (method === 'GET' && path === '/contact') ||
      // DSK routes: authenticated by X-API-Key or Bearer JWT, not by session domain
      path.startsWith('/dsk') ||
      path.startsWith('/images') ||
      // /events with ?token= is token-authenticated; origin is not the security gate
      (path === '/events' && req.query.token) ||
      method === 'OPTIONS';

    if (isPermissive) {
      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Methods', CORS_METHODS);
        res.setHeader('Access-Control-Allow-Headers', CORS_HEADERS);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
      }
      if (method === 'OPTIONS') {
        res.sendStatus(204);
        return;
      }
      return next();
    }

    // Dynamic origin matching for session-authenticated routes
    if (origin) {
      const matches = store.getByDomain(origin);
      if (matches.length > 0) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Methods', CORS_METHODS);
        res.setHeader('Access-Control-Allow-Headers', CORS_HEADERS);
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
