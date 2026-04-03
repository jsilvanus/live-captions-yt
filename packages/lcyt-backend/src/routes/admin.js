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
  createKey,
} from '../db/keys.js';
import {
  getProjectFeatures,
  setProjectFeatures,
  applyFeatureDeps,
  getUserFeatures,
  setUserFeature,
} from '../db/project-features.js';
import { getMembers } from '../db/project-members.js';
import { writeAuditLog, queryAuditLog } from '../db/audit-log.js';

const BCRYPT_ROUNDS = 12;

/** Return the actor label for audit log entries based on the request. */
function resolveActor(req) {
  if (req.adminUser) return `user:${req.adminUser.email}`;
  return 'api-key';
}

/** Extract client IP for audit log. */
function resolveIp(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    null
  );
}

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
   * GET /admin/users?q=&limit=&offset=&from=&to=&active=
   * List users with optional search and date-range / status filters.
   */
  router.get('/users', (req, res) => {
    const q = (req.query.q || '').trim();
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const from = (req.query.from || '').trim();    // ISO date e.g. 2024-01-01
    const to   = (req.query.to   || '').trim();    // ISO date e.g. 2024-12-31
    const active = req.query.active;               // '1'|'0'|undefined

    const conditions = [];
    const params = [];

    if (q) {
      conditions.push('(email LIKE ? OR name LIKE ? OR CAST(id AS TEXT) = ?)');
      const like = `%${q}%`;
      params.push(like, like, q);
    }
    if (from) { conditions.push('created_at >= ?'); params.push(from); }
    if (to)   { conditions.push('created_at <= ?'); params.push(to + 'T23:59:59'); }
    if (active === '1') { conditions.push('active = 1'); }
    else if (active === '0') { conditions.push('active = 0'); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const rows = db.prepare(
      `SELECT id, email, name, created_at, active FROM users ${where} ORDER BY id LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);
    const { count: total } = db.prepare(
      `SELECT COUNT(*) as count FROM users ${where}`
    ).get(...params);

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
      writeAuditLog(db, { actor: resolveActor(req), action: 'user.create', targetType: 'user', targetId: String(user.id), details: { email: user.email }, ip: resolveIp(req) });
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
    writeAuditLog(db, { actor: resolveActor(req), action: 'user.update', targetType: 'user', targetId: String(id), details: req.body, ip: resolveIp(req) });
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
      writeAuditLog(db, { actor: resolveActor(req), action: 'user.set-password', targetType: 'user', targetId: String(id), ip: resolveIp(req) });
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

    writeAuditLog(db, { actor: resolveActor(req), action: 'user.delete', targetType: 'user', targetId: String(id), details: { email: user.email, force: req.query.force === 'true' }, ip: resolveIp(req) });
    res.json({ ok: true, deleted: true });
  });

  /**
   * GET /admin/users/:id/features
   * List user feature entitlements (user_features rows).
   * Phase 3 of plan_userprojects.
   */
  router.get('/users/:id/features', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid user ID' });

    const user = getUserById(db, id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const rows = getUserFeatures(db, id);
    return res.json({
      userId: id,
      features: rows.map(r => {
        let config = null;
        try { if (r.config) config = JSON.parse(r.config); } catch {}
        return { code: r.feature_code, enabled: r.enabled === 1, config, grantedAt: r.granted_at };
      }),
    });
  });

  /**
   * PATCH /admin/users/:id/features
   * Grant or revoke user feature entitlements.
   * Body: { features: { 'radio': true, 'stt-server': false } }
   * Phase 3 of plan_userprojects.
   */
  router.patch('/users/:id/features', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid user ID' });

    const user = getUserById(db, id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { features } = req.body || {};
    if (!features || typeof features !== 'object' || Array.isArray(features)) {
      return res.status(400).json({ error: 'features must be an object mapping code → boolean' });
    }

    const tx = db.transaction(() => {
      for (const [code, val] of Object.entries(features)) {
        const enabled = typeof val === 'boolean' ? val : !!val;
        setUserFeature(db, id, code, enabled, null /* grantedBy = admin action */);
      }
    });
    tx();

    writeAuditLog(db, { actor: resolveActor(req), action: 'user.features.update', targetType: 'user', targetId: String(id), details: features, ip: resolveIp(req) });

    const rows = getUserFeatures(db, id);
    return res.json({
      userId: id,
      features: rows.map(r => {
        let config = null;
        try { if (r.config) config = JSON.parse(r.config); } catch {}
        return { code: r.feature_code, enabled: r.enabled === 1, config, grantedAt: r.granted_at };
      }),
    });
  });

  // -----------------------------------------------------------------------
  // Projects (API keys)
  // -----------------------------------------------------------------------

  /**
   * GET /admin/projects?q=&limit=&offset=&from=&to=&status=
   * List projects with search. Supports user:email syntax for cross-entity search.
   * Additional filters: from/to (ISO date, based on created_at), status (active|revoked).
   */
  router.get('/projects', (req, res) => {
    const q = (req.query.q || '').trim();
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const from   = (req.query.from || '').trim();
    const to     = (req.query.to   || '').trim();
    const status = req.query.status; // 'active'|'revoked'|undefined

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

    // Build extra conditions (date range + status)
    const extraConditions = [];
    const extraParams = [];
    if (from)            { extraConditions.push('k.created_at >= ?'); extraParams.push(from); }
    if (to)              { extraConditions.push('k.created_at <= ?'); extraParams.push(to + 'T23:59:59'); }
    if (status === 'active')  { extraConditions.push('k.active = 1'); }
    if (status === 'revoked') { extraConditions.push('k.active = 0'); }

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
      const baseWhere = `k.user_id IN (${placeholders})`;
      const baseParams = [...userIds];

      const extraClause = extraConditions.length > 0 ? ' AND ' + extraConditions.join(' AND ') : '';

      if (textQuery) {
        const like = `%${textQuery}%`;
        rows = db.prepare(
          `SELECT k.*, u.email as user_email, u.name as user_name FROM api_keys k LEFT JOIN users u ON k.user_id = u.id WHERE ${baseWhere} AND (k.owner LIKE ? OR k.key LIKE ?)${extraClause} ORDER BY k.id LIMIT ? OFFSET ?`
        ).all(...baseParams, like, like, ...extraParams, limit, offset);
        total = db.prepare(
          `SELECT COUNT(*) as count FROM api_keys k LEFT JOIN users u ON k.user_id = u.id WHERE ${baseWhere} AND (k.owner LIKE ? OR k.key LIKE ?)${extraClause}`
        ).get(...baseParams, like, like, ...extraParams).count;
      } else {
        rows = db.prepare(
          `SELECT k.*, u.email as user_email, u.name as user_name FROM api_keys k LEFT JOIN users u ON k.user_id = u.id WHERE ${baseWhere}${extraClause} ORDER BY k.id LIMIT ? OFFSET ?`
        ).all(...baseParams, ...extraParams, limit, offset);
        total = db.prepare(
          `SELECT COUNT(*) as count FROM api_keys k LEFT JOIN users u ON k.user_id = u.id WHERE ${baseWhere}${extraClause}`
        ).get(...baseParams, ...extraParams).count;
      }
    } else if (textQuery) {
      const like = `%${textQuery}%`;
      const extraClause = extraConditions.length > 0 ? ' AND ' + extraConditions.join(' AND ') : '';
      rows = db.prepare(
        `SELECT k.*, u.email as user_email, u.name as user_name FROM api_keys k LEFT JOIN users u ON k.user_id = u.id WHERE (k.owner LIKE ? OR k.key LIKE ? OR u.email LIKE ?)${extraClause} ORDER BY k.id LIMIT ? OFFSET ?`
      ).all(like, like, like, ...extraParams, limit, offset);
      total = db.prepare(
        `SELECT COUNT(*) as count FROM api_keys k LEFT JOIN users u ON k.user_id = u.id WHERE (k.owner LIKE ? OR k.key LIKE ? OR u.email LIKE ?)${extraClause}`
      ).get(like, like, like, ...extraParams).count;
    } else if (extraConditions.length > 0) {
      const extraClause = extraConditions.join(' AND ');
      rows = db.prepare(
        `SELECT k.*, u.email as user_email, u.name as user_name FROM api_keys k LEFT JOIN users u ON k.user_id = u.id WHERE ${extraClause} ORDER BY k.id LIMIT ? OFFSET ?`
      ).all(...extraParams, limit, offset);
      total = db.prepare(
        `SELECT COUNT(*) as count FROM api_keys k LEFT JOIN users u ON k.user_id = u.id WHERE ${extraClause}`
      ).get(...extraParams).count;
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
    writeAuditLog(db, { actor: resolveActor(req), action: 'project.update', targetType: 'project', targetId: req.params.key, details: req.body, ip: resolveIp(req) });
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
    writeAuditLog(db, { actor: resolveActor(req), action: 'project.features.update', targetType: 'project', targetId: req.params.key, details: features, ip: resolveIp(req) });
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

    writeAuditLog(db, { actor: resolveActor(req), action: `batch.users.${action}`, targetType: 'user', details: { ids, succeeded: results.succeeded, failed: results.failed }, ip: resolveIp(req) });
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

    const auditAction = action ? `batch.projects.${action}` : 'batch.projects.features';
    writeAuditLog(db, { actor: resolveActor(req), action: auditAction, targetType: 'project', details: { keys, action, features, succeeded: results.succeeded, failed: results.failed }, ip: resolveIp(req) });
    res.json(results);
  });

  // -----------------------------------------------------------------------
  // Audit Log
  // -----------------------------------------------------------------------

  /**
   * GET /admin/audit-log?q=&action=&targetType=&actor=&from=&to=&limit=&offset=
   * Query the admin audit log.
   */
  router.get('/audit-log', (req, res) => {
    const limit  = Math.min(Math.max(Number(req.query.limit)  || 50, 1), 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const { rows, total } = queryAuditLog(db, {
      q:          (req.query.q          || '').trim(),
      action:     (req.query.action     || '').trim(),
      targetType: (req.query.targetType || '').trim(),
      actor:      (req.query.actor      || '').trim(),
      from:       (req.query.from       || '').trim(),
      to:         (req.query.to         || '').trim(),
      limit,
      offset,
    });

    const entries = rows.map(r => {
      let details = null;
      try { if (r.details) details = JSON.parse(r.details); } catch {}
      return { ...r, details };
    });

    res.json({ entries, total, limit, offset });
  });

  // -----------------------------------------------------------------------
  // Export / Import
  // -----------------------------------------------------------------------

  /**
   * GET /admin/export/users?format=json
   * Export all users (and their feature entitlements) as JSON.
   */
  router.get('/export/users', (req, res) => {
    const users = db.prepare(
      'SELECT id, email, name, created_at, active, is_admin FROM users ORDER BY id'
    ).all();

    const userFeatures = db.prepare(
      'SELECT user_id, feature_code, enabled, granted_at FROM user_features ORDER BY user_id, feature_code'
    ).all();

    // Group features by user_id
    const featuresByUser = {};
    for (const f of userFeatures) {
      if (!featuresByUser[f.user_id]) featuresByUser[f.user_id] = [];
      featuresByUser[f.user_id].push({ code: f.feature_code, enabled: f.enabled === 1, grantedAt: f.granted_at });
    }

    const payload = users.map(u => ({
      id: u.id,
      email: u.email,
      name: u.name || null,
      createdAt: u.created_at,
      active: u.active === 1,
      isAdmin: u.is_admin === 1,
      features: featuresByUser[u.id] || [],
    }));

    writeAuditLog(db, { actor: resolveActor(req), action: 'export.users', targetType: 'system', details: { count: payload.length }, ip: resolveIp(req) });

    res.set('Content-Type', 'application/json');
    res.set('Content-Disposition', `attachment; filename="lcyt-users-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json({ exportedAt: new Date().toISOString(), count: payload.length, users: payload });
  });

  /**
   * GET /admin/export/projects?format=json
   * Export all projects (and their features) as JSON.
   */
  router.get('/export/projects', (req, res) => {
    const projects = db.prepare(
      `SELECT k.*, u.email as user_email FROM api_keys k LEFT JOIN users u ON k.user_id = u.id ORDER BY k.id`
    ).all();

    const allFeatures = db.prepare(
      'SELECT api_key, feature_code, enabled, granted_at FROM project_features ORDER BY api_key, feature_code'
    ).all();

    // Group features by api_key
    const featuresByKey = {};
    for (const f of allFeatures) {
      if (!featuresByKey[f.api_key]) featuresByKey[f.api_key] = [];
      featuresByKey[f.api_key].push({ code: f.feature_code, enabled: f.enabled === 1, grantedAt: f.granted_at });
    }

    const payload = projects.map(r => ({
      ...formatKey(r),
      userId: r.user_id || null,
      userEmail: r.user_email || null,
      features: featuresByKey[r.key] || [],
    }));

    writeAuditLog(db, { actor: resolveActor(req), action: 'export.projects', targetType: 'system', details: { count: payload.length }, ip: resolveIp(req) });

    res.set('Content-Type', 'application/json');
    res.set('Content-Disposition', `attachment; filename="lcyt-projects-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json({ exportedAt: new Date().toISOString(), count: payload.length, projects: payload });
  });

  /**
   * POST /admin/import/users
   * Import users from a JSON export. Body: { users: [...], options?: { skipExisting?: bool } }
   * Skips records that would conflict (email already taken) unless options.skipExisting = false.
   */
  router.post('/import/users', async (req, res) => {
    const { users: importUsers, options = {} } = req.body || {};
    if (!Array.isArray(importUsers) || importUsers.length === 0) {
      return res.status(400).json({ error: 'users array is required' });
    }
    const skipExisting = options.skipExisting !== false; // default: skip

    const results = { imported: 0, skipped: 0, failed: 0, errors: [] };

    for (const u of importUsers) {
      if (!u.email) {
        results.failed++;
        results.errors.push({ email: u.email, error: 'email is required' });
        continue;
      }
      const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(String(u.email).toLowerCase().trim());
      if (existing) {
        if (skipExisting) {
          results.skipped++;
        } else {
          results.failed++;
          results.errors.push({ email: u.email, error: 'User already exists' });
        }
        continue;
      }
      try {
        // Use a placeholder hash so the account exists but requires a password reset.
        const passwordHash = await bcrypt.hash(`import-${Date.now()}`, 4);
        const created = createUser(db, { email: u.email, passwordHash, name: u.name || null });
        if (u.active === false) {
          db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(created.id);
        }
        if (u.isAdmin) {
          db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(created.id);
        }
        // Import feature entitlements
        if (Array.isArray(u.features)) {
          for (const f of u.features) {
            if (f.code) {
              setUserFeature(db, created.id, f.code, f.enabled !== false, null);
            }
          }
        }
        results.imported++;
      } catch (err) {
        results.failed++;
        results.errors.push({ email: u.email, error: err.message });
      }
    }

    writeAuditLog(db, { actor: resolveActor(req), action: 'import.users', targetType: 'system', details: { imported: results.imported, skipped: results.skipped, failed: results.failed }, ip: resolveIp(req) });
    res.json(results);
  });

  /**
   * POST /admin/import/projects
   * Import projects from a JSON export. Body: { projects: [...], options?: { skipExisting?: bool } }
   */
  router.post('/import/projects', (req, res) => {
    const { projects: importProjects, options = {} } = req.body || {};
    if (!Array.isArray(importProjects) || importProjects.length === 0) {
      return res.status(400).json({ error: 'projects array is required' });
    }
    const skipExisting = options.skipExisting !== false;

    const results = { imported: 0, skipped: 0, failed: 0, errors: [] };

    for (const p of importProjects) {
      if (!p.key || !p.owner) {
        results.failed++;
        results.errors.push({ key: p.key, error: 'key and owner are required' });
        continue;
      }
      const existing = db.prepare('SELECT key FROM api_keys WHERE key = ?').get(p.key);
      if (existing) {
        if (skipExisting) {
          results.skipped++;
        } else {
          results.failed++;
          results.errors.push({ key: p.key, error: 'Project already exists' });
        }
        continue;
      }
      try {
        db.prepare(`
          INSERT INTO api_keys (key, owner, active, email, daily_limit, lifetime_limit)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          p.key,
          p.owner,
          p.active !== false ? 1 : 0,
          p.email || null,
          p.dailyLimit || null,
          p.lifetimeLimit || null,
        );
        // Import feature flags
        if (Array.isArray(p.features)) {
          for (const f of p.features) {
            if (f.code) {
              db.prepare(`
                INSERT INTO project_features (api_key, feature_code, enabled)
                VALUES (?, ?, ?)
                ON CONFLICT (api_key, feature_code) DO NOTHING
              `).run(p.key, f.code, f.enabled !== false ? 1 : 0);
            }
          }
        }
        results.imported++;
      } catch (err) {
        results.failed++;
        results.errors.push({ key: p.key, error: err.message });
      }
    }

    writeAuditLog(db, { actor: resolveActor(req), action: 'import.projects', targetType: 'system', details: { imported: results.imported, skipped: results.skipped, failed: results.failed }, ip: resolveIp(req) });
    res.json(results);
  });

  return router;
}

