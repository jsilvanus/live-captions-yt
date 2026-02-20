import { Router } from 'express';
import { getAllKeys, getKey, createKey, revokeKey, deleteKey, updateKey } from '../db.js';
import { adminMiddleware } from '../middleware/admin.js';

/**
 * Format a raw db row into the API response shape.
 * @param {object} row
 * @returns {object}
 */
function formatKey(row) {
  return {
    key: row.key,
    owner: row.owner,
    active: row.active === 1,
    expires: row.expires_at || null,
    createdAt: row.created_at
  };
}

/**
 * Factory for the /keys router (admin CRUD for API keys).
 *
 * All routes require a valid X-Admin-Key header (enforced via adminMiddleware).
 *
 * GET    /keys         — List all API keys
 * POST   /keys         — Create a new API key
 * GET    /keys/:key    — Get details for a specific key
 * PATCH  /keys/:key    — Update owner or expiration
 * DELETE /keys/:key    — Revoke (soft-delete) or permanently delete
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {Router}
 */
export function createKeysRouter(db) {
  const router = Router();

  // Apply admin auth to all routes in this router
  router.use(adminMiddleware);

  // GET /keys — List all API keys
  router.get('/', (req, res) => {
    const keys = getAllKeys(db);
    return res.status(200).json({ keys: keys.map(formatKey) });
  });

  // POST /keys — Create a new API key
  router.post('/', (req, res) => {
    const { owner, key, expires } = req.body || {};

    if (!owner) {
      return res.status(400).json({ error: 'owner is required' });
    }

    const newKey = createKey(db, { key, owner, expiresAt: expires || null });
    return res.status(201).json(formatKey(newKey));
  });

  // GET /keys/:key — Get details for a specific key
  router.get('/:key', (req, res) => {
    const row = getKey(db, req.params.key);
    if (!row) {
      return res.status(404).json({ error: 'API key not found' });
    }
    return res.status(200).json(formatKey(row));
  });

  // PATCH /keys/:key — Update owner and/or expiration
  router.patch('/:key', (req, res) => {
    const existing = getKey(db, req.params.key);
    if (!existing) {
      return res.status(404).json({ error: 'API key not found' });
    }

    const body = req.body || {};
    const updates = {};
    if (body.owner !== undefined) updates.owner = body.owner;
    if ('expires' in body) updates.expiresAt = body.expires || null;

    updateKey(db, req.params.key, updates);

    const updated = getKey(db, req.params.key);
    return res.status(200).json(formatKey(updated));
  });

  // DELETE /keys/:key — Revoke (soft-delete) or permanently delete
  router.delete('/:key', (req, res) => {
    const existing = getKey(db, req.params.key);
    if (!existing) {
      return res.status(404).json({ error: 'API key not found' });
    }

    if (req.query.permanent === 'true') {
      deleteKey(db, req.params.key);
      return res.status(200).json({ key: req.params.key, deleted: true });
    } else {
      revokeKey(db, req.params.key);
      return res.status(200).json({ key: req.params.key, revoked: true });
    }
  });

  return router;
}
