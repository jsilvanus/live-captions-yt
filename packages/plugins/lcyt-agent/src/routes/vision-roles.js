/**
 * Vision role routes (Tracker & Describer, plan_ai_roles_framework.md
 * Runtime Shape 1). Events are consumed from the unified `/events/stream`
 * surface (`role.tracker.*`, `role.describer.*`).
 *
 *   POST /roles/:roleCode/start   { cameraId? } — start the loop for the session's api_key;
 *     with cameraId, a camera-scoped session on that camera's own feed (stop/status/captures take ?cameraId=)
 *   GET  /roles/sessions — running sessions of the project, project-scoped and per camera
 *   POST /roles/:roleCode/stop
 *   GET  /roles/:roleCode/status
 *
 * AI Observability (plan_ai_observability.md Stage 1) — capture/replay,
 * dev/admin-only:
 *
 *   GET  /roles/:roleCode/captures                  — browse the ring buffer
 *   GET  /roles/:roleCode/captures/:id/frame         — the captured JPEG
 *   POST /roles/:roleCode/captures/:id/replay        — prompt sandbox re-run
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

  /** Optional camera scope: `cameraId` in the body (start) or the query (everything else). */
  function cameraIdOf(req) {
    const raw = req.body?.cameraId ?? req.query?.cameraId;
    return typeof raw === 'string' && raw ? raw : null;
  }

  router.get('/sessions', (req, res) => {
    const apiKey = req.session?.apiKey;
    if (!apiKey) return res.status(401).json({ error: 'No API key in session' });
    res.json({ ok: true, sessions: manager.listSessions(apiKey) });
  });

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
      cameraId: cameraIdOf(req),
    });
    if (!result.ok) return res.status(result.error === 'Camera not found' ? 404 : (cameraIdOf(req) ? 409 : 503)).json(result);
    res.json(result);
  });

  router.post('/:roleCode/stop', (req, res) => {
    const apiKey = req.session?.apiKey;
    if (!apiKey) return res.status(401).json({ error: 'No API key in session' });
    const { roleCode } = req.params;
    if (!VISION_ROLES.has(roleCode)) return res.status(404).json({ error: 'Unknown role' });
    const stopped = manager.stop(apiKey, roleCode, cameraIdOf(req));
    res.json({ ok: true, wasRunning: stopped });
  });

  router.get('/:roleCode/status', (req, res) => {
    const apiKey = req.session?.apiKey;
    if (!apiKey) return res.status(401).json({ error: 'No API key in session' });
    const { roleCode } = req.params;
    if (!VISION_ROLES.has(roleCode)) return res.status(404).json({ error: 'Unknown role' });
    res.json({ ok: true, ...manager.status(apiKey, roleCode, cameraIdOf(req)) });
  });

  router.get('/:roleCode/captures', (req, res) => {
    const apiKey = req.session?.apiKey;
    if (!apiKey) return res.status(401).json({ error: 'No API key in session' });
    const { roleCode } = req.params;
    if (!VISION_ROLES.has(roleCode)) return res.status(404).json({ error: 'Unknown role' });
    res.json({ ok: true, captures: manager.getCaptures(apiKey, roleCode, cameraIdOf(req)) });
  });

  router.get('/:roleCode/captures/:id/frame', (req, res) => {
    const apiKey = req.session?.apiKey;
    if (!apiKey) return res.status(401).json({ error: 'No API key in session' });
    const { roleCode, id } = req.params;
    if (!VISION_ROLES.has(roleCode)) return res.status(404).json({ error: 'Unknown role' });
    const capture = manager.getCapture(apiKey, roleCode, id, cameraIdOf(req));
    if (!capture || !capture.frame) return res.status(404).json({ error: 'Capture not found' });
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=86400, immutable');
    res.send(capture.frame);
  });

  router.post('/:roleCode/captures/:id/replay', async (req, res) => {
    const loaded = loadConfigOr503(req, res);
    if (!loaded) return;
    const { apiKey, roleCode, config, providerRow } = loaded;
    const apiSettings = resolveRoleProviderSettings(providerRow, config.modelName, { bridgeManager });
    if (!apiSettings) {
      return res.status(503).json({ error: 'AI provider not configured or unsupported' });
    }
    const { promptOverride } = req.body || {};
    const result = await manager.replay(apiKey, roleCode, req.params.id, {
      apiSettings, vendor: providerRow.vendor, promptOverride, cameraId: cameraIdOf(req),
    });
    if (!result.ok) {
      return res.status(result.error === 'Capture not found' ? 404 : 503).json(result);
    }
    res.json(result);
  });

  return router;
}

export { VISION_ROLES };
