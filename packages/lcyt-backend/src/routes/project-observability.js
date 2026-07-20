/**
 * Project-scoped audit + usage routes (plan_metering_audit §5.5, §6.1).
 * Mounted at /keys/:key (mergeParams), same auth pattern as
 * /keys/:key/features:
 *
 *   GET /keys/:key/audit  — project owner/admin (or X-Admin-Key)
 *   GET /keys/:key/usage  — any project member (or X-Admin-Key)
 */
import { Router } from 'express';
import { getKey } from '../db/keys.js';
import { getEffectiveProjectAccessLevel } from '../db/project-members.js';
import { adminMiddleware } from '../middleware/admin.js';
import { extractAndVerifyUserToken } from '../middleware/user-auth.js';
import { queryAuditLog } from '../db/audit-log.js';
import { queryRollupSeries } from '../db/usage-rollups.js';

function requireProjectAccess(db, { loginEnabled, jwtSecret, minLevel }, req, res, handler) {
  const hasAdmin = !!req.headers['x-admin-key'];
  if (hasAdmin) {
    return adminMiddleware(req, res, () => handler());
  }
  if (!loginEnabled) return res.status(404).json({ error: 'Not found' });
  const user = extractAndVerifyUserToken(jwtSecret, req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const row = getKey(db, req.params.key);
  if (!row) return res.status(404).json({ error: 'Project not found' });

  // The key's owning user always has access (same shortcut as the features
  // routes); everyone else needs a membership row.
  if (row.user_id !== user.userId) {
    const level = getEffectiveProjectAccessLevel(db, req.params.key, user.userId);
    if (!level) return res.status(403).json({ error: 'Not a project member' });
    if (minLevel === 'admin' && level !== 'owner' && level !== 'admin') {
      return res.status(403).json({ error: 'owner or admin required' });
    }
  }
  return handler();
}

export function createProjectObservabilityRouter(db, { loginEnabled = false, jwtSecret = null } = {}) {
  const router = Router({ mergeParams: true });

  router.get('/audit', (req, res) => {
    requireProjectAccess(db, { loginEnabled, jwtSecret, minLevel: 'admin' }, req, res, () => {
      const limit  = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
      const offset = Math.max(Number(req.query.offset) || 0, 0);
      const { rows, total } = queryAuditLog(db, {
        apiKey: req.params.key,
        q:      (req.query.q      || '').trim(),
        action: (req.query.action || '').trim(),
        from:   (req.query.from   || '').trim(),
        to:     (req.query.to     || '').trim(),
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
  });

  router.get('/usage', (req, res) => {
    requireProjectAccess(db, { loginEnabled, jwtSecret, minLevel: 'member' }, req, res, () => {
      const grain = req.query.grain === 'day' ? 'day' : 'hour';
      const metricsFilter = (req.query.metrics || '').split(',').map(s => s.trim()).filter(Boolean);
      const series = queryRollupSeries(db, {
        from: (req.query.from || '').trim(),
        to: (req.query.to || '').trim(),
        grain,
        metrics: metricsFilter,
        apiKeys: [req.params.key],
        groupBy: 'metric',
      });
      res.json({ series });
    });
  });

  return router;
}
