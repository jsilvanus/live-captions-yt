/**
 * Vision role routes (Tracker & Describer, plan_ai_roles_framework.md
 * Runtime Shape 1). Events are consumed from the unified `/events/stream`
 * surface (`role.tracker.*`, `role.describer.*`).
 *
 *   POST /roles/:roleCode/start   { } — start the loop for the session's api_key
 *   POST /roles/:roleCode/stop
 *   GET  /roles/:roleCode/status
 */

import { Router } from 'express';
import { getRole, getRoleConfig } from '../ai-roles.js';
import { getProvider } from '../provider-registry.js';
import { resolveRoleProviderSettings } from '../agentic-turn.js';

const VISION_ROLES = new Set(['tracker', 'describer']);

/**
 * @param {import('better-sqlite3').Database} db
 * @param {import('express').RequestHandler} auth
 * @param {import('../vision-role-manager.js').VisionRoleManager} manager
 * @returns {import('express').Router}
 */
export function createVisionRolesRouter(db, auth, manager, bridgeManager = null) {
  const router = Router();
  router.use(auth);

  function loadConfigOr503(req, res) {
    const apiKey = req.session?.apiKey;
    if (!apiKey) { res.status(401).json({ error: 'No API key in session' }); return null; }
    const { roleCode } = req.params;
    if (!VISION_ROLES.has(roleCode) || !getRole(db, roleCode)) { res.status(404).json({ error: 'Unknown role' }); return null; }
    const config = getRoleConfig(db, apiKey, roleCode);
    if (!config.enabled) { res.status(503).json({ error: 'Role is not enabled for this project' }); return null; }
    const providerRow = config.providerId ? getProvider(db, config.providerId) : null;
    if (!providerRow || !providerRow.enabled || providerRow.kind === 'deer') {
      res.status(503).json({ error: 'AI provider not configured or unsupported' });
      return null;
    }
    return { apiKey, roleCode, config, providerRow };
  }

  router.post('/:roleCode/start', (req, res) => {
    const loaded = loadConfigOr503(req, res);
    if (!loaded) return;
    const { apiKey, roleCode, config, providerRow } = loaded;
    const apiSettings = resolveRoleProviderSettings(providerRow, config.modelName, { bridgeManager });
    if (!apiSettings) {
      return res.status(503).json({ error: 'AI provider not configured or unsupported' });
    }
    const result = manager.start(apiKey, roleCode, {
      apiSettings,
      vendor: providerRow.vendor,
      harnessConfig: config.harnessConfig,
    });
    if (!result.ok) return res.status(503).json(result);
    res.json(result);
  });

  router.post('/:roleCode/stop', (req, res) => {
    const apiKey = req.session?.apiKey;
    if (!apiKey) return res.status(401).json({ error: 'No API key in session' });
    const { roleCode } = req.params;
    if (!VISION_ROLES.has(roleCode)) return res.status(404).json({ error: 'Unknown role' });
    const stopped = manager.stop(apiKey, roleCode);
    res.json({ ok: true, wasRunning: stopped });
  });

  router.get('/:roleCode/status', (req, res) => {
    const apiKey = req.session?.apiKey;
    if (!apiKey) return res.status(401).json({ error: 'No API key in session' });
    const { roleCode } = req.params;
    if (!VISION_ROLES.has(roleCode)) return res.status(404).json({ error: 'Unknown role' });
    res.json({ ok: true, ...manager.status(apiKey, roleCode) });
  });

  return router;
}

export { VISION_ROLES };
