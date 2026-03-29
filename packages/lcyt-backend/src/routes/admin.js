/**
 * Admin routes — user, project, and feature management.
 *
 * All routes require either:
 * - A user JWT Bearer token for a user with `is_admin = 1`, OR
 * - The legacy `X-Admin-Key` header (when ADMIN_KEY env var is set).
 *
 * Mount: app.use('/admin', createAdminRouter(db, jwtSecret))
 */
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { createAdminMiddleware } from '../middleware/admin.js';
import {
  getUserById,
  getKeysByUserId,
  updateUserPassword,
  createUser,
} from '../db/users.js';
import {
  getAllKeys,
  getKey,
  formatKey,
  updateKey,
  revokeKey,
  deleteKey,
} from '../db/keys.js';
import {
  getProjectFeatures,
  setProjectFeatures,
  applyFeatureDeps,
} from '../db/project-features.js';
import { getMembers } from '../db/project-members.js';

const BCRYPT_ROUNDS = 12;

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} jwtSecret
 * @returns {Router}
 */
export function createAdminRouter(db, jwtSecret) {
  const router = Router();

  // All admin routes require admin authentication (user-based or legacy key)
  router.use(createAdminMiddleware(db, jwtSecret));

  // -----------------------------------------------------------------------
  // Users
  // -----------------------------------------------------------------------

  /**
   * GET /admin/users?q=&limit=&offset=
   * List users with optional search.
   */
  router.get('/users', (req, res) => {
    const q = (req.query.q || '').trim();
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    let rows;
    let total;
    if (q) {
      const like = `%${q}%`;
      rows = db.prepare(
        'SELECT id, email, name, created_at, active FROM users WHERE email LIKE ? OR name LIKE ? OR CAST(id AS TEXT) = ? ORDER BY id LIMIT ? OFFSET ?'
      ).all(like, like, q, limit, offset);
      total = db.prepare(
        'SELECT COUNT(*) as count FROM users WHERE email LIKE ? OR name LIKE ? OR CAST(id AS TEXT) = ?'
      ).get(like, like, q).count;
    } else {
      rows = db.prepare(
        'SELECT id, email, name, created_at, active FROM users ORDER BY id LIMIT ? OFFSET ?'
      ).all(limit, offset);
      total = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    }

    res.json({
      users: rows.map(r => ({ ...r, active: r.active === 1 })),
      total,
      limit,
      offset,
    });
  });

  /**
   * GET /admin/users/:id
   * User detail with their projects (API keys).
   */
  router.get('/users/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid user ID' });

    const user = getUserById(db, id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const keys = getKeysByUserId(db, id);
    res.json({
      ...user,
      active: user.active === 1,
      projects: keys.map(formatKey),
    });
  });

  /**
   * POST /admin/users
   * Create a new user. Body: { email, password, name? }
   */
  router.post('/users', async (req, res) => {
    const { email, password, name } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }

    // Check if user already exists
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim());
    if (existing) {
      return res.status(409).json({ error: 'User with this email already exists' });
    }

    try {
      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      const user = createUser(db, { email, passwordHash, name });
      res.status(201).json({ id: user.id, email: user.email, name: user.name });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * PATCH /admin/users/:id
   * Update user fields: name, active.
   */
  router.patch('/users/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid user ID' });

    const user = getUserById(db, id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { name, active } = req.body || {};
    const parts = [];
    const params = [];

    if (name !== undefined) {
      parts.push('name = ?');
      params.push(name || null);
    }
    if (active !== undefined) {
      parts.push('active = ?');
      params.push(active ? 1 : 0);
    }

    if (parts.length === 0) return res.status(400).json({ error: 'No fields to update' });

    params.push(id);
    db.prepare(`UPDATE users SET ${parts.join(', ')} WHERE id = ?`).run(...params);
    res.json({ ok: true });
  });

  /**
   * POST /admin/users/:id/set-password
   * Admin password reset. Body: { password }
   */
  router.post('/users/:id/set-password', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid user ID' });

    const user = getUserById(db, id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { password } = req.body || {};
    if (!password) return res.status(400).json({ error: 'password is required' });

    try {
      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      updateUserPassword(db, id, passwordHash);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * DELETE /admin/users/:id?force=true
   * Delete a user. Without ?force, fails if user has active projects.
   */
  router.delete('/users/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid user ID' });

    const user = getUserById(db, id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const keys = getKeysByUserId(db, id);
    const activeKeys = keys.filter(k => k.active === 1);

    if (activeKeys.length > 0 && req.query.force !== 'true') {
      return res.status(409).json({
        error: 'User has active projects. Use ?force=true to unlink and delete.',
        activeProjects: activeKeys.length,
      });
    }

    db.transaction(() => {
      // Unlink API keys from user
      db.prepare('UPDATE api_keys SET user_id = NULL WHERE user_id = ?').run(id);
      // Remove user features
      try { db.prepare('DELETE FROM user_features WHERE user_id = ?').run(id); } catch { /* table may not exist */ }
      // Remove project membership
      try { db.prepare('DELETE FROM project_members WHERE user_id = ?').run(id); } catch { /* table may not exist */ }
      // Delete user
      db.prepare('DELETE FROM users WHERE id = ?').run(id);
    })();

    res.json({ ok: true, deleted: true });
  });

  // -----------------------------------------------------------------------
  // Projects (API keys)
  // -----------------------------------------------------------------------

  /**
   * GET /admin/projects?q=&limit=&offset=
   * List projects with search. Supports user:email syntax for cross-entity search.
   */
  router.get('/projects', (req, res) => {
    const q = (req.query.q || '').trim();
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    let rows;
    let total;

    // Parse user:email directives for cross-entity search
    const userFilters = [];
    let textQuery = q;
    const userRegex = /user:(\S+)/g;
    let match;
    while ((match = userRegex.exec(q)) !== null) {
      userFilters.push(match[1]);
    }
    if (userFilters.length > 0) {
      textQuery = q.replace(userRegex, '').trim();
    }

    if (userFilters.length > 0) {
      // Find user IDs matching the email filters
      const userIds = [];
      for (const filter of userFilters) {
        const userRows = db.prepare(
          'SELECT id FROM users WHERE email LIKE ?'
        ).all(`%${filter}%`);
        userIds.push(...userRows.map(r => r.id));
      }

      if (userIds.length === 0) {
        return res.json({ projects: [], total: 0, limit, offset });
      }

      const placeholders = userIds.map(() => '?').join(',');
      const baseWhere = `user_id IN (${placeholders})`;
      const params = [...userIds];

      if (textQuery) {
        const like = `%${textQuery}%`;
        rows = db.prepare(
          `SELECT k.*, u.email as user_email, u.name as user_name FROM api_keys k LEFT JOIN users u ON k.user_id = u.id WHERE ${baseWhere} AND (k.owner LIKE ? OR k.key LIKE ?) ORDER BY k.id LIMIT ? OFFSET ?`
        ).all(...params, like, like, limit, offset);
        total = db.prepare(
          `SELECT COUNT(*) as count FROM api_keys WHERE ${baseWhere} AND (owner LIKE ? OR key LIKE ?)`
        ).get(...params, like, like).count;
      } else {
        rows = db.prepare(
          `SELECT k.*, u.email as user_email, u.name as user_name FROM api_keys k LEFT JOIN users u ON k.user_id = u.id WHERE ${baseWhere} ORDER BY k.id LIMIT ? OFFSET ?`
        ).all(...params, limit, offset);
        total = db.prepare(
          `SELECT COUNT(*) as count FROM api_keys WHERE ${baseWhere}`
        ).get(...params).count;
      }
    } else if (textQuery) {
      const like = `%${textQuery}%`;
      rows = db.prepare(
        'SELECT k.*, u.email as user_email, u.name as user_name FROM api_keys k LEFT JOIN users u ON k.user_id = u.id WHERE k.owner LIKE ? OR k.key LIKE ? OR u.email LIKE ? ORDER BY k.id LIMIT ? OFFSET ?'
      ).all(like, like, like, limit, offset);
      total = db.prepare(
        'SELECT COUNT(*) as count FROM api_keys k LEFT JOIN users u ON k.user_id = u.id WHERE k.owner LIKE ? OR k.key LIKE ? OR u.email LIKE ?'
      ).get(like, like, like).count;
    } else {
      rows = db.prepare(
        'SELECT k.*, u.email as user_email, u.name as user_name FROM api_keys k LEFT JOIN users u ON k.user_id = u.id ORDER BY k.id LIMIT ? OFFSET ?'
      ).all(limit, offset);
      total = db.prepare('SELECT COUNT(*) as count FROM api_keys').get().count;
    }

    res.json({
      projects: rows.map(r => ({
        ...formatKey(r),
        userId: r.user_id || null,
        userEmail: r.user_email || null,
        userName: r.user_name || null,
      })),
      total,
      limit,
      offset,
    });
  });

  /**
   * GET /admin/projects/:key
   * Project detail with features and members.
   */
  router.get('/projects/:key', (req, res) => {
    const row = getKey(db, req.params.key);
    if (!row) return res.status(404).json({ error: 'Project not found' });

    const features = getProjectFeatures(db, req.params.key);
    let members = [];
    try { members = getMembers(db, req.params.key); } catch { /* table may not exist */ }

    // Get user info if linked
    let user = null;
    if (row.user_id) {
      user = getUserById(db, row.user_id);
      if (user) user = { ...user, active: user.active === 1 };
    }

    res.json({
      ...formatKey(row),
      userId: row.user_id || null,
      user,
      features,
      members,
    });
  });

  /**
   * PATCH /admin/projects/:key
   * Update project fields (delegates to updateKey).
   */
  router.patch('/projects/:key', (req, res) => {
    const row = getKey(db, req.params.key);
    if (!row) return res.status(404).json({ error: 'Project not found' });

    const updated = updateKey(db, req.params.key, req.body);
    if (!updated) return res.status(400).json({ error: 'No fields to update' });
    res.json({ ok: true });
  });

  /**
   * PUT /admin/projects/:key/features
   * Batch update project features. Body: { features: { code: bool|{enabled,config} } }
   */
  router.put('/projects/:key/features', (req, res) => {
    const row = getKey(db, req.params.key);
    if (!row) return res.status(404).json({ error: 'Project not found' });

    const { features } = req.body || {};
    if (!features || typeof features !== 'object') {
      return res.status(400).json({ error: 'features object is required' });
    }

    const resolved = applyFeatureDeps(features);
    setProjectFeatures(db, req.params.key, resolved, 'admin');
    const updated = getProjectFeatures(db, req.params.key);
    res.json({ ok: true, features: updated, autoEnabled: resolved._autoEnabled || [] });
  });

  // -----------------------------------------------------------------------
  // Batch operations
  // -----------------------------------------------------------------------

  /**
   * POST /admin/batch/users
   * Body: { ids: number[], action: 'activate'|'deactivate'|'delete' }
   */
  router.post('/batch/users', (req, res) => {
    const { ids, action } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids array is required' });
    }
    if (!['activate', 'deactivate', 'delete'].includes(action)) {
      return res.status(400).json({ error: 'action must be activate, deactivate, or delete' });
    }

    const results = { succeeded: 0, failed: 0, errors: [] };

    db.transaction(() => {
      for (const id of ids) {
        const numId = Number(id);
        if (!Number.isFinite(numId)) {
          results.failed++;
          results.errors.push({ id, error: 'Invalid ID' });
          continue;
        }

        const user = getUserById(db, numId);
        if (!user) {
          results.failed++;
          results.errors.push({ id: numId, error: 'User not found' });
          continue;
        }

        try {
          if (action === 'activate') {
            db.prepare('UPDATE users SET active = 1 WHERE id = ?').run(numId);
          } else if (action === 'deactivate') {
            db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(numId);
          } else if (action === 'delete') {
            db.prepare('UPDATE api_keys SET user_id = NULL WHERE user_id = ?').run(numId);
            try { db.prepare('DELETE FROM user_features WHERE user_id = ?').run(numId); } catch { /* */ }
            try { db.prepare('DELETE FROM project_members WHERE user_id = ?').run(numId); } catch { /* */ }
            db.prepare('DELETE FROM users WHERE id = ?').run(numId);
          }
          results.succeeded++;
        } catch (err) {
          results.failed++;
          results.errors.push({ id: numId, error: err.message });
        }
      }
    })();

    res.json(results);
  });

  /**
   * POST /admin/batch/projects
   * Body: { keys: string[], action?: 'revoke'|'activate'|'delete', features?: { code: bool } }
   */
  router.post('/batch/projects', (req, res) => {
    const { keys, action, features } = req.body || {};
    if (!Array.isArray(keys) || keys.length === 0) {
      return res.status(400).json({ error: 'keys array is required' });
    }
    if (!action && !features) {
      return res.status(400).json({ error: 'action or features is required' });
    }
    if (action && !['revoke', 'activate', 'delete'].includes(action)) {
      return res.status(400).json({ error: 'action must be revoke, activate, or delete' });
    }

    const results = { succeeded: 0, failed: 0, errors: [] };

    const resolvedFeatures = features ? applyFeatureDeps(features) : null;

    db.transaction(() => {
      for (const key of keys) {
        const row = getKey(db, key);
        if (!row) {
          results.failed++;
          results.errors.push({ key, error: 'Project not found' });
          continue;
        }

        try {
          if (action === 'revoke') {
            revokeKey(db, key);
          } else if (action === 'activate') {
            db.prepare("UPDATE api_keys SET active = 1, revoked_at = NULL WHERE key = ?").run(key);
          } else if (action === 'delete') {
            deleteKey(db, key);
          }

          if (resolvedFeatures) {
            setProjectFeatures(db, key, resolvedFeatures, 'admin');
          }

          results.succeeded++;
        } catch (err) {
          results.failed++;
          results.errors.push({ key, error: err.message });
        }
      }
    })();

    res.json(results);
  });

  return router;
}
