/**
 * Project feature flag routes.
 *
 * GET    /keys/:key/features           — list features (member or admin)
 * PUT    /keys/:key/features           — batch update features (settings-manager or admin)
 * PATCH  /keys/:key/features/:code     — update one feature (settings-manager or admin)
 *
 * User routes require a user Bearer token. Admin routes require X-Admin-Key.
 * Users may only enable features they are entitled to (user_features table).
 */

import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { getKey } from '../db/keys.js';
import {
  getProjectFeatures,
  setProjectFeature,
  setProjectFeatures,
  getUserFeatureSet,
} from '../db/project-features.js';
import { getMemberAccessLevel } from '../db/project-members.js';
import { adminMiddleware } from '../middleware/admin.js';

function verifyUserToken(jwtSecret, req) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  try {
    const payload = jwt.verify(header.slice(7), jwtSecret);
    if (payload.type !== 'user') return null;
    return { userId: payload.userId, email: payload.email };
  } catch { return null; }
}

function formatFeatures(rows) {
  return rows.map(r => {
    let config = null;
    try { if (r.config) config = JSON.parse(r.config); } catch {}
    return { code: r.feature_code, enabled: r.enabled === 1, config, grantedAt: r.granted_at };
  });
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {{ loginEnabled?: boolean, jwtSecret?: string }} opts
 */
export function createProjectFeaturesRouter(db, { loginEnabled = false, jwtSecret = null } = {}) {
  const router = Router({ mergeParams: true });

  // GET /keys/:key/features
  router.get('/', (req, res) => {
    const hasAdmin = !!req.headers['x-admin-key'];
    if (hasAdmin) {
      return adminMiddleware(req, res, () => _listFeatures(db, req, res));
    }
    if (!loginEnabled) return res.status(404).json({ error: 'Not found' });
    const user = verifyUserToken(jwtSecret, req);
    if (!user) return res.status(401).json({ error: 'Authentication required' });

    const row = getKey(db, req.params.key);
    if (!row) return res.status(404).json({ error: 'Project not found' });

    const level = getMemberAccessLevel(db, req.params.key, user.userId);
    if (!level) return res.status(403).json({ error: 'Not a project member' });

    return _listFeatures(db, req, res);
  });

  // PUT /keys/:key/features — batch update
  router.put('/', (req, res) => {
    const hasAdmin = !!req.headers['x-admin-key'];
    if (hasAdmin) {
      return adminMiddleware(req, res, () => _batchUpdateFeatures(db, null, req, res));
    }
    if (!loginEnabled) return res.status(404).json({ error: 'Not found' });
    const user = verifyUserToken(jwtSecret, req);
    if (!user) return res.status(401).json({ error: 'Authentication required' });

    const row = getKey(db, req.params.key);
    if (!row) return res.status(404).json({ error: 'Project not found' });
    if (row.user_id !== user.userId) {
      const level = getMemberAccessLevel(db, req.params.key, user.userId);
      if (level !== 'owner' && level !== 'admin') {
        return res.status(403).json({ error: 'settings-manager permission required' });
      }
    }

    return _batchUpdateFeatures(db, user, req, res);
  });

  // PATCH /keys/:key/features/:code — single feature update
  router.patch('/:code', (req, res) => {
    const hasAdmin = !!req.headers['x-admin-key'];
    if (hasAdmin) {
      return adminMiddleware(req, res, () => _patchFeature(db, null, req, res));
    }
    if (!loginEnabled) return res.status(404).json({ error: 'Not found' });
    const user = verifyUserToken(jwtSecret, req);
    if (!user) return res.status(401).json({ error: 'Authentication required' });

    const row = getKey(db, req.params.key);
    if (!row) return res.status(404).json({ error: 'Project not found' });
    if (row.user_id !== user.userId) {
      const level = getMemberAccessLevel(db, req.params.key, user.userId);
      if (level !== 'owner' && level !== 'admin') {
        return res.status(403).json({ error: 'settings-manager permission required' });
      }
    }

    return _patchFeature(db, user, req, res);
  });

  return router;
}

function _listFeatures(db, req, res) {
  const rows = getProjectFeatures(db, req.params.key);
  return res.json({ features: formatFeatures(rows) });
}

function _batchUpdateFeatures(db, user, req, res) {
  const { features } = req.body || {};
  if (!features || typeof features !== 'object' || Array.isArray(features)) {
    return res.status(400).json({ error: 'features must be an object mapping code → boolean or { enabled, config }' });
  }

  // If acting as user, validate against entitlements
  if (user) {
    const entitled = getUserFeatureSet(db, user.userId);
    for (const code of Object.keys(features)) {
      const val = features[code];
      const enabling = typeof val === 'boolean' ? val : val?.enabled;
      if (enabling && !entitled.has(code)) {
        return res.status(403).json({ error: `You are not entitled to enable feature '${code}'` });
      }
    }
  }

  setProjectFeatures(db, req.params.key, features, user?.userId ?? null);
  const rows = getProjectFeatures(db, req.params.key);
  return res.json({ features: formatFeatures(rows) });
}

function _patchFeature(db, user, req, res) {
  const code = req.params.code;
  const body = req.body || {};
  if (body.enabled === undefined) {
    return res.status(400).json({ error: 'enabled is required' });
  }

  // If acting as user, check entitlement when enabling
  if (user && body.enabled) {
    const entitled = getUserFeatureSet(db, user.userId);
    if (!entitled.has(code)) {
      return res.status(403).json({ error: `You are not entitled to enable feature '${code}'` });
    }
  }

  setProjectFeature(db, req.params.key, code, !!body.enabled, body.config ?? null, user?.userId ?? null);
  const rows = getProjectFeatures(db, req.params.key);
  const updated = formatFeatures(rows).find(f => f.code === code);
  return res.json(updated || { code, enabled: !!body.enabled, config: body.config ?? null });
}
