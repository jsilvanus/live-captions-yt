import { Router } from 'express';
import { join, resolve, basename } from 'node:path';
import { existsSync, unlinkSync } from 'node:fs';
import { getAllKeys, getKey, getKeyByEmail, createKey, revokeKey, deleteKey, updateKey, formatKey, deleteAllImages, getKeysByUserId } from '../db.js';
import { provisionDefaultProjectFeatures, getEnabledFeatureSet } from '../db/project-features.js';
import { addMember, getMemberAccessLevel, getMemberCount } from '../db/project-members.js';
import { adminMiddleware } from '../middleware/admin.js';

const GRAPHICS_BASE_DIR = resolve(process.env.GRAPHICS_DIR || '/data/images');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Factory for the /keys router.
 *
 * Admin routes (all require X-Admin-Key header):
 *   GET    /keys         — List all API keys
 *   POST   /keys         — Create a new API key (accepts optional daily_limit, lifetime_limit)
 *   GET    /keys/:key    — Get details for a specific key
 *   PATCH  /keys/:key    — Update owner, expiration, or limits
 *   DELETE /keys/:key    — Revoke (soft-delete) or permanently delete
 *
 * User routes (when loginEnabled=true, require Bearer user token):
 *   GET    /keys         — List own API keys (projects)
 *   POST   /keys         — Create a new project key for the authenticated user
 *   PATCH  /keys/:key    — Rename own project (owner field only)
 *   DELETE /keys/:key    — Revoke own project key
 *
 * Public route (requires FREE_APIKEY_ACTIVE=1):
 *   POST   /keys?freetier — Self-service free-tier key sign-up (name + email required)
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{ loginEnabled?: boolean, jwtSecret?: string }} [opts]
 * @returns {Router}
 */
export function createKeysRouter(db, { loginEnabled = false, jwtSecret = null } = {}) {
  const router = Router();

  // POST /keys — Create API key (admin) OR user project OR free-tier sign-up (?freetier)
  router.post('/', (req, res) => {
    // ── free-tier path ────────────────────────────────────────────────────────
    if ('freetier' in req.query) {
      if (process.env.FREE_APIKEY_ACTIVE !== '1') {
        return res.status(404).json({ error: 'Not found' });
      }

      const { name, email } = req.body || {};

      if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ error: 'name is required' });
      }
      if (!email || typeof email !== 'string' || !EMAIL_RE.test(email.trim())) {
        return res.status(400).json({ error: 'a valid email is required' });
      }

      const normalizedEmail = email.trim().toLowerCase();
      if (getKeyByEmail(db, normalizedEmail)) {
        return res.status(409).json({ error: 'A key already exists for this email' });
      }

      const expiresAt = (() => {
        const d = new Date();
        d.setMonth(d.getMonth() + 1);
        return d.toISOString().replace('T', ' ').slice(0, 19);
      })();

      const newKey = createKey(db, {
        owner: name.trim(),
        email: normalizedEmail,
        expiresAt,
        daily_limit: 200,
        lifetime_limit: 1000,
      });

      return res.status(201).json(formatKey(newKey));
    }

    // ── user path (loginEnabled + Bearer token, no X-Admin-Key) ──────────────
    const hasAdminKey = !!req.headers['x-admin-key'];
    if (loginEnabled && !hasAdminKey) {
      return _userCreateKey(db, jwtSecret, req, res);
    }

    // ── admin path ────────────────────────────────────────────────────────────
    return adminMiddleware(req, res, () => {
      const { owner, key, expires, daily_limit, lifetime_limit } = req.body || {};

      if (!owner) {
        return res.status(400).json({ error: 'owner is required' });
      }

      const newKey = createKey(db, {
        key,
        owner,
        expiresAt: expires || null,
        daily_limit: daily_limit ?? null,
        lifetime_limit: lifetime_limit ?? null,
      });
      return res.status(201).json(formatKey(newKey));
    });
  });

  // GET /keys — List API keys (admin or user-scoped)
  router.get('/', (req, res) => {
    const hasAdminKey = !!req.headers['x-admin-key'];
    if (loginEnabled && !hasAdminKey) {
      return _userListKeys(db, jwtSecret, req, res);
    }
    return adminMiddleware(req, res, () => {
      const keys = getAllKeys(db);
      return res.status(200).json({ keys: keys.map(formatKey) });
    });
  });

  // GET /keys/:key — Get details for a specific key (admin only)
  router.get('/:key', adminMiddleware, (req, res) => {
    const row = getKey(db, req.params.key);
    if (!row) {
      return res.status(404).json({ error: 'API key not found' });
    }
    return res.status(200).json(formatKey(row));
  });

  // PATCH /keys/:key — Update key (admin or user for own keys)
  router.patch('/:key', (req, res) => {
    const hasAdminKey = !!req.headers['x-admin-key'];
    if (loginEnabled && !hasAdminKey) {
      return _userUpdateKey(db, jwtSecret, req, res);
    }
    return adminMiddleware(req, res, () => {
      const existing = getKey(db, req.params.key);
      if (!existing) {
        return res.status(404).json({ error: 'API key not found' });
      }

      const body = req.body || {};
      const updates = {};
      if (body.owner !== undefined) updates.owner = body.owner;
      if ('expires' in body) updates.expiresAt = body.expires || null;
      if ('daily_limit' in body) updates.daily_limit = body.daily_limit ?? null;
      if ('lifetime_limit' in body) updates.lifetime_limit = body.lifetime_limit ?? null;
      if ('backend_file_enabled' in body) updates.backend_file_enabled = !!body.backend_file_enabled;
      if ('relay_allowed' in body) updates.relay_allowed = !!body.relay_allowed;
      if ('radio_enabled' in body) updates.radio_enabled = !!body.radio_enabled;
      if ('hls_enabled' in body) updates.hls_enabled = !!body.hls_enabled;
      if ('cea708_delay_ms' in body) updates.cea708_delay_ms = body.cea708_delay_ms;
      if ('graphics_enabled' in body) updates.graphics_enabled = !!body.graphics_enabled;
      if ('embed_cors' in body) updates.embed_cors = body.embed_cors ?? '*';

      updateKey(db, req.params.key, updates);

      const updated = getKey(db, req.params.key);
      return res.status(200).json(formatKey(updated));
    });
  });

  // DELETE /keys/:key — Revoke or permanently delete (admin or user for own keys)
  router.delete('/:key', (req, res) => {
    const hasAdminKey = !!req.headers['x-admin-key'];
    if (loginEnabled && !hasAdminKey) {
      return _userDeleteKey(db, jwtSecret, req, res);
    }
    return adminMiddleware(req, res, () => {
      const existing = getKey(db, req.params.key);
      if (!existing) {
        return res.status(404).json({ error: 'API key not found' });
      }

      if (req.query.permanent === 'true') {
        const imageRows = deleteAllImages(db, req.params.key);
        for (const row of imageRows) {
          try {
            const safe = row.api_key.replace(/[^a-zA-Z0-9-]/g, '_').slice(0, 40);
            const filepath = join(GRAPHICS_BASE_DIR, safe, basename(row.filename));
            if (existsSync(filepath)) unlinkSync(filepath);
          } catch (e) {
            console.warn('[keys] Could not delete image file on key deletion:', e.message);
          }
        }
        deleteKey(db, req.params.key);
        return res.status(200).json({ key: req.params.key, deleted: true });
      } else {
        revokeKey(db, req.params.key);
        return res.status(200).json({ key: req.params.key, revoked: true });
      }
    });
  });

  return router;
}

// ── User-scoped handlers ──────────────────────────────────────────────────────

import jwt from 'jsonwebtoken';

function _verifyUserToken(jwtSecret, req) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  try {
    const payload = jwt.verify(header.slice(7), jwtSecret);
    if (payload.type !== 'user') return null;
    return { userId: payload.userId, email: payload.email };
  } catch {
    return null;
  }
}

function _userListKeys(db, jwtSecret, req, res) {
  const user = _verifyUserToken(jwtSecret, req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });
  const keys = getKeysByUserId(db, user.userId);
  return res.status(200).json({
    keys: keys.map(row => {
      const base = formatKey(row);
      const features = [...getEnabledFeatureSet(db, row.key)].sort();
      const memberCount = getMemberCount(db, row.key);
      return { ...base, features, memberCount, myAccessLevel: 'owner' };
    }),
  });
}

function _userCreateKey(db, jwtSecret, req, res) {
  const user = _verifyUserToken(jwtSecret, req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });
  const { name, features: requestedFeatures } = req.body || {};
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  const newKey = createKey(db, {
    owner: name.trim(),
    user_id: user.userId,
  });
  // Provision default features + any requested extras (validated against user entitlements)
  const extra = Array.isArray(requestedFeatures) ? requestedFeatures.filter(f => typeof f === 'string') : [];
  provisionDefaultProjectFeatures(db, newKey.key, extra);
  // Add creating user as owner
  addMember(db, newKey.key, user.userId, 'owner');
  const features = [...getEnabledFeatureSet(db, newKey.key)].sort();
  return res.status(201).json({ ...formatKey(newKey), features, memberCount: 1, myAccessLevel: 'owner' });
}

function _userUpdateKey(db, jwtSecret, req, res) {
  const user = _verifyUserToken(jwtSecret, req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });
  const existing = getKey(db, req.params.key);
  if (!existing) return res.status(404).json({ error: 'API key not found' });
  if (existing.user_id !== user.userId) return res.status(403).json({ error: 'Forbidden' });
  const { name } = req.body || {};
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  updateKey(db, req.params.key, { owner: name.trim() });
  const updated = getKey(db, req.params.key);
  return res.status(200).json(formatKey(updated));
}

function _userDeleteKey(db, jwtSecret, req, res) {
  const user = _verifyUserToken(jwtSecret, req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });
  const existing = getKey(db, req.params.key);
  if (!existing) return res.status(404).json({ error: 'API key not found' });
  if (existing.user_id !== user.userId) return res.status(403).json({ error: 'Forbidden' });
  revokeKey(db, req.params.key);
  return res.status(200).json({ key: req.params.key, revoked: true });
}
