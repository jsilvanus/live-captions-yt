/**
 * Project public-slug routes (plan_dsk_viewport_settings Phase 1).
 *
 * GET  /keys/:key/slug        — current slug + org-policy-required prefix (member or admin)
 * GET  /keys/:key/slug/check  — ?slug=… availability probe with reason (member or admin)
 * PUT  /keys/:key/slug        — { slug: string|null } set or clear (owner/admin member, or X-Admin-Key)
 *
 * User routes require a user Bearer token; X-Admin-Key bypasses the org
 * prefix policy (site admin may assign any valid, non-reserved, free slug).
 */

import { Router } from 'express';
import jwt from 'jsonwebtoken';
import {
  getKey,
  getRequiredSlugPrefix,
  checkPublicSlugAvailability,
  setPublicSlug,
} from '../db/keys.js';
import { getEffectiveProjectAccessLevel } from '../db/project-members.js';
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

/**
 * @param {import('better-sqlite3').Database} db
 * @param {{ loginEnabled?: boolean, jwtSecret?: string }} opts
 * @returns {Router}
 */
export function createProjectSlugRouter(db, { loginEnabled = false, jwtSecret = null } = {}) {
  const router = Router({ mergeParams: true });

  /**
   * Shared auth gate. `write` requires project owner or owner/admin member;
   * read allows any project member. X-Admin-Key always passes (isAdmin=true).
   * Calls next(user, isAdmin) on success, responds itself on failure.
   */
  function authorize(req, res, { write }, next) {
    if (req.headers['x-admin-key']) {
      return adminMiddleware(req, res, () => {
        if (!getKey(db, req.params.key)) return res.status(404).json({ error: 'Project not found' });
        next(null, true);
      });
    }
    if (!loginEnabled) return res.status(404).json({ error: 'Not found' });
    const user = verifyUserToken(jwtSecret, req);
    if (!user) return res.status(401).json({ error: 'Authentication required' });

    const row = getKey(db, req.params.key);
    if (!row) return res.status(404).json({ error: 'Project not found' });
    if (row.user_id !== user.userId) {
      const level = getEffectiveProjectAccessLevel(db, req.params.key, user.userId);
      if (!level) return res.status(403).json({ error: 'Project access required' });
      if (write && level !== 'owner' && level !== 'admin') {
        return res.status(403).json({ error: 'settings-manager permission required' });
      }
    }
    next(user, false);
  }

  // GET /keys/:key/slug
  router.get('/', (req, res) => {
    authorize(req, res, { write: false }, () => {
      const row = getKey(db, req.params.key);
      res.json({
        slug: row.public_slug ?? null,
        requiredPrefix: getRequiredSlugPrefix(db, req.params.key),
      });
    });
  });

  // GET /keys/:key/slug/check?slug=…
  router.get('/check', (req, res) => {
    authorize(req, res, { write: false }, (_user, isAdmin) => {
      const slug = String(req.query.slug ?? '');
      const result = checkPublicSlugAvailability(db, req.params.key, slug, { bypassPolicy: isAdmin });
      res.json(result.available ? { available: true } : { available: false, reason: result.reason });
    });
  });

  // PUT /keys/:key/slug  { slug: string | null }
  router.put('/', (req, res) => {
    authorize(req, res, { write: true }, (_user, isAdmin) => {
      const { slug } = req.body ?? {};

      if (slug === null) {
        setPublicSlug(db, req.params.key, null);
        return res.json({ ok: true, slug: null });
      }

      const result = checkPublicSlugAvailability(db, req.params.key, slug, { bypassPolicy: isAdmin });
      if (!result.available) return res.status(400).json({ error: result.reason });

      try {
        setPublicSlug(db, req.params.key, slug);
      } catch (err) {
        // Unique-index race: someone claimed the slug between check and write
        if (String(err.message).includes('UNIQUE')) {
          return res.status(409).json({ error: 'slug is already taken' });
        }
        throw err;
      }
      return res.json({ ok: true, slug });
    });
  });

  return router;
}
