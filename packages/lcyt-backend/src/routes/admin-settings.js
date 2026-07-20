/**
 * Server Settings admin routes (plan_env_to_ui_settings.md).
 *
 * Mount: app.use('/admin/server-settings', createAdminMiddleware(db, jwtSecret),
 *                 createAdminSettingsRouter(db, settingsService))
 * — same auth convention as /admin/metrics and /admin/ai-providers (base
 * admin gate applied at the mount call, not inside this router).
 *
 * The generic write-audit middleware skips /admin entirely (routes/admin.js
 * writes richer semantic entries itself — see middleware/write-audit.js's
 * SKIP_PATTERNS) so every mutation here calls writeAuditLog() explicitly.
 * Secret-typed values are never written to the audit log — key name only.
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireFullAdmin } from '../middleware/admin.js';
import { writeAuditLog } from '../db/audit-log.js';
import { REGISTRY_BY_KEY } from '../settings/registry.js';

const settingsRateLimit = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

function resolveActor(req) {
  if (req.adminUser) return `user:${req.adminUser.email}`;
  return 'api-key';
}

function resolveIp(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    null
  );
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {import('../settings/service.js').SettingsService} settings
 * @returns {Router}
 */
export function createAdminSettingsRouter(db, settings) {
  const router = Router();

  /**
   * GET /admin/server-settings
   * Full registry + effective values grouped by category. Secrets masked.
   */
  router.get('/', settingsRateLimit, (req, res) => {
    const snapshot = settings.snapshot();
    const byCategory = {};
    for (const entry of snapshot) {
      (byCategory[entry.category] ??= []).push(entry);
    }
    res.json({ categories: byCategory });
  });

  /**
   * PUT /admin/server-settings
   * Batch update: { values: { key: value, ... } }. All-or-nothing — every
   * key is validated (known, Tier B, not env-locked) before anything is
   * written, so a single bad key in the batch doesn't leave a partial write.
   */
  router.put('/', settingsRateLimit, requireFullAdmin(), (req, res) => {
    const values = req.body?.values;
    if (!values || typeof values !== 'object' || Array.isArray(values)) {
      return res.status(400).json({ error: 'Body must be { values: { key: value, ... } }' });
    }

    const entries = Object.entries(values);
    if (entries.length === 0) {
      return res.status(400).json({ error: 'values must contain at least one key' });
    }

    // Validate every key before writing any of them.
    for (const [key] of entries) {
      const def = REGISTRY_BY_KEY.get(key);
      if (!def) return res.status(404).json({ error: `Unknown setting: ${key}` });
      if (def.tier === 'env') {
        return res.status(409).json({ error: `'${key}' is env-only and cannot be set here.`, key });
      }
      if (def.env && process.env[def.env] !== undefined) {
        return res.status(409).json({ error: `'${key}' is locked by the ${def.env} environment variable.`, key });
      }
      if (def.type === 'enum' && def.enum && !def.enum.includes(values[key])) {
        return res.status(400).json({ error: `'${key}' must be one of: ${def.enum.join(', ')}`, key });
      }
    }

    const actor = resolveActor(req);
    const ip = resolveIp(req);
    const updatedBy = req.adminUser ? `user:${req.adminUser.userId}` : 'admin-key';

    for (const [key, value] of entries) {
      const def = REGISTRY_BY_KEY.get(key);
      settings.set(key, value, { updatedBy });
      writeAuditLog(db, {
        actor,
        action: 'server_settings.update',
        targetType: 'server_setting',
        targetId: key,
        details: def.secret ? { key } : { key, value },
        ip,
        actorId: req.adminUser?.userId ?? null,
      });
    }

    res.json({ ok: true, updated: entries.map(([key]) => key), snapshot: settings.snapshot() });
  });

  /**
   * DELETE /admin/server-settings/:key
   * Revert a key to its env/default value.
   */
  router.delete('/:key', settingsRateLimit, requireFullAdmin(), (req, res) => {
    const { key } = req.params;
    const def = REGISTRY_BY_KEY.get(key);
    if (!def) return res.status(404).json({ error: `Unknown setting: ${key}` });
    if (def.tier === 'env') {
      return res.status(409).json({ error: `'${key}' is env-only and has no DB row to clear.` });
    }

    const updatedBy = req.adminUser ? `user:${req.adminUser.userId}` : 'admin-key';
    settings.clear(key, { updatedBy });
    writeAuditLog(db, {
      actor: resolveActor(req),
      action: 'server_settings.clear',
      targetType: 'server_setting',
      targetId: key,
      ip: resolveIp(req),
      actorId: req.adminUser?.userId ?? null,
    });

    const entry = settings.snapshot().find(s => s.key === key);
    res.json({ ok: true, key, ...entry });
  });

  return router;
}
