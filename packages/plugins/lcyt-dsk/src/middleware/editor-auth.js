/**
 * Editor auth middleware for DSK template management.
 *
 * Accepts either:
 *   1. X-API-Key: <rawkey>  header  (editor/control panel — no live session needed)
 *   2. Falls through to the standard JWT Bearer `auth` middleware
 *
 * On success sets req.session = { apiKey } so existing checkOwner() logic works.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {import('express').RequestHandler}
 */
export function createEditorAuth(db) {
  return function editorAuth(req, res, next) {
    const rawKey = req.headers['x-api-key'];
    if (!rawKey) return next(); // no header → fall through to JWT auth

    const row = db.prepare('SELECT key, active FROM api_keys WHERE key = ?').get(rawKey);
    if (!row || row.active !== 1) {
      return res.status(401).json({ error: 'Invalid or inactive API key' });
    }

    req.session = { apiKey: rawKey };
    next();
  };
}

/**
 * Returns a middleware that tries editorAuth first, then falls through to the
 * standard JWT Bearer auth. If neither sets req.session, returns 401.
 *
 * @param {import('express').RequestHandler} jwtAuth
 * @param {import('express').RequestHandler} editorAuth
 * @returns {import('express').RequestHandler}
 */
export function editorAuthOrBearer(jwtAuth, editorAuth) {
  return function combinedAuth(req, res, next) {
    // If X-API-Key is present, run editorAuth (synchronous; sets req.session or returns 401)
    if (req.headers['x-api-key']) {
      return editorAuth(req, res, next);
    }
    // Otherwise run standard JWT auth
    return jwtAuth(req, res, next);
  };
}
