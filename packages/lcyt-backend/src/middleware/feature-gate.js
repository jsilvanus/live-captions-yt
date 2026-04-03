/**
 * Feature-gate middleware factory (Phase 2 of plan_userprojects).
 *
 * Enforcement is controlled by the `FEATURE_GATE_ENFORCE` environment variable:
 *   - Unset / '0' / 'false': middleware is a no-op (pass-through). Default.
 *   - '1' / 'true':          middleware actively blocks requests when the feature
 *                             is not enabled for the project key.
 *
 * Two flavours:
 *   createRequireFeature(db, featureCode)
 *     → for session-based routes that use the standard JWT auth middleware.
 *       Reads `req.session.apiKey` (set by createAuthMiddleware).
 *
 *   createRequireKeyFeature(db, featureCode)
 *     → for project-param routes (/keys/:key/*).
 *       Reads `req.params.key`.
 *
 * Both return HTTP 403 with `{ error, feature }` when the gate fires.
 */

import { hasFeature } from '../db/project-features.js';

/**
 * Returns true when feature-gate enforcement is active.
 * Reads the env var once per call so tests can override it.
 * @returns {boolean}
 */
export function isEnforced() {
  const v = process.env.FEATURE_GATE_ENFORCE;
  return v === '1' || v === 'true';
}

/**
 * Middleware for **session-based** routes (POST /captions, POST /sync, etc.).
 * Requires `createAuthMiddleware` to have run first (sets `req.session.apiKey`).
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} featureCode
 * @returns {import('express').RequestHandler}
 */
export function createRequireFeature(db, featureCode) {
  return function requireFeature(req, res, next) {
    if (!isEnforced()) return next();

    const apiKey = req.session?.apiKey;
    if (!apiKey) {
      // No apiKey means auth has not run yet — let auth handle the 401.
      return next();
    }

    if (!hasFeature(db, apiKey, featureCode)) {
      return res.status(403).json({
        error: `Feature '${featureCode}' is not enabled for this project`,
        feature: featureCode,
      });
    }

    return next();
  };
}

/**
 * Middleware for **project-param** routes (/keys/:key/*).
 * Reads the API key from `req.params.key`.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} featureCode
 * @returns {import('express').RequestHandler}
 */
export function createRequireKeyFeature(db, featureCode) {
  return function requireKeyFeature(req, res, next) {
    if (!isEnforced()) return next();

    const apiKey = req.params.key;
    if (!apiKey) return next();

    if (!hasFeature(db, apiKey, featureCode)) {
      return res.status(403).json({
        error: `Feature '${featureCode}' is not enabled for this project`,
        feature: featureCode,
      });
    }

    return next();
  };
}
