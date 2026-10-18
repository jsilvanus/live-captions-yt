/**
 * Tally light CRUD and status (mounted at /tally under the API prefix, so /api/v1/tally).
 *
 *   GET    /lights            — this project's lights, each with its live status
 *   POST   /lights            — create { name, kind, source, output, runner?, bridgeInstanceId?, look?, enabled? }
 *   PUT    /lights/:id        — replace the light's config
 *   DELETE /lights/:id        — remove
 *   POST   /lights/:id/test   — show { state } on the lamp for a few seconds
 *   GET    /status            — live status only
 *
 * Writes need the project's setup tier (a lamp address is configuration).
 */
import { Router } from 'express';
import crypto from 'node:crypto';
import { isState } from '../../vendor/stream-light/core/states.js';
import { listLights, listLightsForBridge, getLight, createLight, updateLight, deleteLight, rowToConfig } from '../db.js';
import { resolveRunner } from '../manager.js';
import { validateConfig, clashError } from '../validate.js';

function apiKeyOf(req, res) {
  const apiKey = req.auth?.projectId || req.session?.apiKey || req.project?.projectId;
  if (!apiKey) { res.status(400).json({ error: 'project is required' }); return null; }
  return apiKey;
}

/** The status shape plus the stored config. */
function present(row, statusById) {
  const cfg = rowToConfig(row);
  return { ...cfg, status: statusById.get(cfg.id) ?? null };
}

/**
 * @param {import('lcyt-backend/db').Db} db
 * @param {import('express').RequestHandler} auth
 * @param {{ manager: object, bridgeBelongsToProject?: (apiKey: string, instanceId: string) => Promise<boolean>, localMode?: boolean }} deps
 */
export function createTallyRouter(db, auth, { manager, bridgeBelongsToProject = null } = {}) {
  const router = Router();

  const statusMap = (apiKey) => new Map(manager.status(apiKey).map((s) => [s.id, s]));

  async function checkBridge(apiKey, cfg) {
    if (!cfg.bridgeInstanceId) return null;
    if (!bridgeBelongsToProject) return null;
    return (await bridgeBelongsToProject(apiKey, cfg.bridgeInstanceId)) ? null : 'Unknown bridge for this project';
  }

  router.get('/lights', auth, async (req, res) => {
    const apiKey = apiKeyOf(req, res); if (!apiKey) return;
    const map = statusMap(apiKey);
    res.json({ lights: (await listLights(db, apiKey)).map((r) => present(r, map)) });
  });

  router.get('/status', auth, (req, res) => {
    const apiKey = apiKeyOf(req, res); if (!apiKey) return;
    res.json({ lights: manager.status(apiKey) });
  });

  async function save(req, res, id) {
    const apiKey = apiKeyOf(req, res); if (!apiKey) return;
    const parsed = validateConfig(req.body || {});
    if (!parsed.ok) return res.status(400).json({ error: parsed.errors.join('; '), errors: parsed.errors });
    const cfg = { ...parsed.value, id };
    const bridgeError = await checkBridge(apiKey, cfg);
    if (bridgeError) return res.status(400).json({ error: bridgeError });
    const others = (await listLights(db, apiKey)).map(rowToConfig);
    const clash = clashError(others, cfg);
    if (clash) return res.status(409).json({ error: clash });

    const existing = await getLight(db, apiKey, id);
    const row = existing ? await updateLight(db, apiKey, id, cfg) : await createLight(db, apiKey, id, cfg);
    await manager.sync(apiKey, id);
    return res.status(existing ? 200 : 201).json(present(row, statusMap(apiKey)));
  }

  router.post('/lights', auth, (req, res) => save(req, res, crypto.randomUUID()));

  router.put('/lights/:id', auth, async (req, res) => {
    const apiKey = apiKeyOf(req, res); if (!apiKey) return;
    if (!(await getLight(db, apiKey, req.params.id))) return res.status(404).json({ error: 'Light not found' });
    return save(req, res, req.params.id);
  });

  router.delete('/lights/:id', auth, async (req, res) => {
    const apiKey = apiKeyOf(req, res); if (!apiKey) return;
    if (!(await deleteLight(db, apiKey, req.params.id))) return res.status(404).json({ error: 'Light not found' });
    await manager.remove(req.params.id);
    res.json({ ok: true });
  });

  router.post('/lights/:id/test', auth, async (req, res) => {
    const apiKey = apiKeyOf(req, res); if (!apiKey) return;
    const row = await getLight(db, apiKey, req.params.id);
    if (!row) return res.status(404).json({ error: 'Light not found' });
    const state = req.body?.state;
    if (!isState(row.kind, state)) return res.status(400).json({ error: `state must be a ${row.kind} state` });
    const out = await manager.test(apiKey, row.id, state);
    if (!out.ok) return res.status(409).json({ error: out.error });
    res.json({ ok: true, state });
  });

  return router;
}

/**
 * The camera lights a bridge runs itself. Authenticated by the bridge token (the bridge has no
 * user login), so mount it before the project-scoped /tally router.
 *
 *   GET /bridge/lights?token=...  → { lights: [light config] }
 */
export function createTallyBridgeRouter(db, { bridgeManager, localMode = false } = {}) {
  const router = Router();
  router.get('/bridge/lights', async (req, res) => {
    const token = String(req.query.token || req.headers['x-bridge-token'] || '');
    const instance = await bridgeManager.authenticate(token);
    if (!instance) return res.status(401).json({ error: 'Invalid bridge token' });
    const rows = await listLightsForBridge(db, instance.id);
    const lights = rows.map(rowToConfig).filter((cfg) => cfg.kind === 'camera' && cfg.source.type !== 'lcyt' && resolveRunner(cfg, { localMode }).runner === 'bridge');
    res.json({ lights });
  });
  return router;
}
