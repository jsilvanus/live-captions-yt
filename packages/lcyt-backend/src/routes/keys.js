import { Router } from 'express';
import { join, resolve, basename } from 'node:path';
import { existsSync, unlinkSync } from 'node:fs';
import { getAllKeys, getKey, getKeyByEmail, createKey, revokeKey, deleteKey, updateKey, formatKey, deleteAllImages } from '../db.js';
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
 * Public route (requires FREE_APIKEY_ACTIVE=1):
 *   POST   /keys?freetier — Self-service free-tier key sign-up (name + email required)
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {Router}
 */
export function createKeysRouter(db) {
  const router = Router();

  // POST /keys — Create API key (admin) OR free-tier sign-up (?freetier)
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

  // GET /keys — List all API keys (admin)
  router.get('/', adminMiddleware, (req, res) => {
    const keys = getAllKeys(db);
    return res.status(200).json({ keys: keys.map(formatKey) });
  });

  // GET /keys/:key — Get details for a specific key (admin)
  router.get('/:key', adminMiddleware, (req, res) => {
    const row = getKey(db, req.params.key);
    if (!row) {
      return res.status(404).json({ error: 'API key not found' });
    }
    return res.status(200).json(formatKey(row));
  });

  // PATCH /keys/:key — Update owner, expiration, or limits (admin)
  router.patch('/:key', adminMiddleware, (req, res) => {
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

    updateKey(db, req.params.key, updates);

    const updated = getKey(db, req.params.key);
    return res.status(200).json(formatKey(updated));
  });

  // DELETE /keys/:key — Revoke or permanently delete (admin)
  router.delete('/:key', adminMiddleware, (req, res) => {
    const existing = getKey(db, req.params.key);
    if (!existing) {
      return res.status(404).json({ error: 'API key not found' });
    }

    if (req.query.permanent === 'true') {
      // Delete all images from disk before removing DB rows
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

  return router;
}
