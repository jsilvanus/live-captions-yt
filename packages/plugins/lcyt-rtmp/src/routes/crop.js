/**
 * Factory for the /crop router (plan_vertical_crop.md §3).
 *
 * Session-Bearer routes managing the vertical-crop rendition:
 *
 *   GET    /crop/config                — config + { running, repositionMode, ... }
 *   PUT    /crop/config                — update config; starts/stops the renderer on enable flips while publishing
 *   GET    /crop/status                — renderer state + active position
 *   POST   /crop/position              — { xNorm, yNorm, transitionMs? } free positioning
 *   GET/POST/PUT/DELETE /crop/presets[/:id]     — preset CRUD (?setId= filter; default = active set)
 *   POST   /crop/presets/:id/activate  — { transitionMs? } apply a preset live
 *   GET/POST/PUT/DELETE /crop/sets[/:id]        — preset-set (bank) CRUD; POST supports { cloneFromSetId }
 *   POST   /crop/sets/:id/activate     — switch the active set; re-applies the current position from it
 *   GET/POST/DELETE /crop/source-map[/:id]      — production-follow mapping CRUD
 *
 * Feature-gated on the `crop` project feature when FEATURE_GATE_ENFORCE=1
 * (same inline pattern as routes/ingestion.js — plugins query core tables
 * directly instead of importing lcyt-backend middleware).
 */
import { Router } from 'express';
import {
  getCropConfig, setCropConfig,
  listCropPresets, getCropPreset, createCropPreset, updateCropPreset, deleteCropPreset,
  listCropSets, createCropSet, updateCropSet, deleteCropSet,
  listCropSourceMap, createCropSourceMapEntry, deleteCropSourceMapEntry,
} from '../db.js';
import logger from 'lcyt/logger';

function isFeatureGateEnforced() {
  const v = process.env.FEATURE_GATE_ENFORCE;
  return v === '1' || v === 'true';
}

async function hasCropFeature(db, apiKey) {
  const row = await db.project_features.findUnique({
    where: { api_key_feature_code: { api_key: apiKey, feature_code: 'crop' } },
    select: { enabled: true },
  });
  return row?.enabled === 1;
}

/**
 * @param {object} db  Prisma client
 * @param {import('express').RequestHandler} auth  Project-access Bearer middleware
 * @param {import('../crop-manager.js').CropManager} cropManager
 * @param {import('../rtmp-manager.js').RtmpRelayManager} [relayManager]  For isPublishing()
 * @param {import('express').RequestHandler} [requireSetup]  Setup-tier write gate (plan_project_roles.md); no-op passthrough when omitted (e.g. tests constructing this router directly)
 * @returns {Router}
 */
export function createCropRouter(db, auth, cropManager, relayManager = null, requireSetup = (req, res, next) => next()) {
  const router = Router();
  router.use(auth);
  router.use(requireSetup);

  router.use(async (req, res, next) => {
    if (isFeatureGateEnforced() && !(await hasCropFeature(db, req.session.apiKey))) {
      return res.status(403).json({ error: "Feature 'crop' is not enabled for this project", feature: 'crop' });
    }
    next();
  });

  // ── config ────────────────────────────────────────────────────────────────

  router.get('/config', async (req, res) => {
    const apiKey = req.session.apiKey;
    res.json({
      ...(await getCropConfig(db, apiKey)),
      ...cropManager.getStatus(apiKey),
    });
  });

  router.put('/config', async (req, res) => {
    const apiKey = req.session.apiKey;
    const wasEnabled = (await getCropConfig(db, apiKey)).enabled;
    const result = await setCropConfig(db, apiKey, req.body || {});
    if (!result.ok) return res.status(400).json({ error: result.error });

    // Start/stop the renderer to match the new config while the source is live.
    const nowEnabled = result.config.enabled;
    try {
      if (nowEnabled && !cropManager.isRunning(apiKey) && relayManager?.isPublishing(apiKey)) {
        await cropManager.start(apiKey, result.config);
      } else if (!nowEnabled && wasEnabled && cropManager.isRunning(apiKey)) {
        await cropManager.stop(apiKey);
      }
    } catch (err) {
      logger.warn(`[crop] renderer start/stop after config change failed for ${apiKey.slice(0, 8)}: ${err.message}`);
    }

    res.json({ ...result.config, ...cropManager.getStatus(apiKey) });
  });

  router.get('/status', (req, res) => {
    res.json(cropManager.getStatus(req.session.apiKey));
  });

  // ── free positioning ──────────────────────────────────────────────────────

  router.post('/position', async (req, res) => {
    const apiKey = req.session.apiKey;
    const { xNorm, yNorm, transitionMs } = req.body || {};
    if (!Number.isFinite(Number(xNorm)) || !Number.isFinite(Number(yNorm))) {
      return res.status(400).json({ error: 'xNorm and yNorm are required numbers (0-1)' });
    }
    if (!cropManager.isRunning(apiKey)) {
      return res.status(409).json({ error: 'Crop renderer is not running' });
    }
    try {
      const result = await cropManager.applyPosition(apiKey, {
        xNorm: Number(xNorm),
        yNorm: Number(yNorm),
        transitionMs: Number(transitionMs) > 0 ? Number(transitionMs) : 0,
        activePresetId: null, // free move — no longer "on" a preset
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── presets ───────────────────────────────────────────────────────────────

  router.get('/presets', async (req, res) => {
    const setId = req.query.setId !== undefined
      ? (req.query.setId === '' || req.query.setId === 'null' ? null : String(req.query.setId))
      : undefined;
    res.json({ presets: await listCropPresets(db, req.session.apiKey, { setId }) });
  });

  router.post('/presets', async (req, res) => {
    const result = await createCropPreset(db, req.session.apiKey, req.body || {});
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.status(201).json({ ok: true, preset: result.preset });
  });

  router.put('/presets/:id', async (req, res) => {
    const result = await updateCropPreset(db, req.session.apiKey, req.params.id, req.body || {});
    if (!result.ok) return res.status(result.status ?? 400).json({ error: result.error });
    res.json({ ok: true, preset: result.preset });
  });

  router.delete('/presets/:id', async (req, res) => {
    const deleted = await deleteCropPreset(db, req.session.apiKey, req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Preset not found' });
    res.json({ ok: true });
  });

  router.post('/presets/:id/activate', async (req, res) => {
    const apiKey = req.session.apiKey;
    const preset = await getCropPreset(db, apiKey, req.params.id);
    if (!preset) return res.status(404).json({ error: 'Preset not found' });
    if (!cropManager.isRunning(apiKey)) {
      return res.status(409).json({ error: 'Crop renderer is not running' });
    }
    const transitionMs = Number(req.body?.transitionMs) >= 0
      ? Number(req.body.transitionMs)
      : (await getCropConfig(db, apiKey)).transitionMs;
    try {
      const result = await cropManager.applyPosition(apiKey, {
        xNorm: preset.xNorm,
        yNorm: preset.yNorm,
        transitionMs,
        activePresetId: preset.id,
      });
      res.json({ ...result, presetId: preset.id });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── preset sets (banks) ───────────────────────────────────────────────────

  router.get('/sets', async (req, res) => {
    const apiKey = req.session.apiKey;
    res.json({ sets: await listCropSets(db, apiKey), activeSetId: (await getCropConfig(db, apiKey)).activeSetId });
  });

  router.post('/sets', async (req, res) => {
    const result = await createCropSet(db, req.session.apiKey, req.body || {});
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.status(201).json({ ok: true, set: result.set });
  });

  router.put('/sets/:id', async (req, res) => {
    const result = await updateCropSet(db, req.session.apiKey, req.params.id, req.body || {});
    if (!result.ok) return res.status(result.status ?? 400).json({ error: result.error });
    res.json({ ok: true, set: result.set });
  });

  router.delete('/sets/:id', async (req, res) => {
    const deleted = await deleteCropSet(db, req.session.apiKey, req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Set not found' });
    res.json({ ok: true });
  });

  router.post('/sets/:id/activate', async (req, res) => {
    const apiKey = req.session.apiKey;
    const result = await setCropConfig(db, apiKey, { activeSetId: req.params.id });
    if (!result.ok) return res.status(404).json({ error: result.error });

    // Re-apply: if the renderer is running and the previously-active preset has
    // a same-named counterpart in the new set, shift to it live.
    let applied = null;
    const status = cropManager.getStatus(apiKey);
    if (status.running && status.activePresetId) {
      const oldPreset = await getCropPreset(db, apiKey, status.activePresetId);
      if (oldPreset) {
        const counterpart = (await listCropPresets(db, apiKey, { setId: req.params.id }))
          .find(p => p.name === oldPreset.name);
        if (counterpart) {
          try {
            applied = await cropManager.applyPosition(apiKey, {
              xNorm: counterpart.xNorm,
              yNorm: counterpart.yNorm,
              transitionMs: result.config.transitionMs,
              activePresetId: counterpart.id,
            });
          } catch (err) {
            logger.warn(`[crop] set-activate re-apply failed for ${apiKey.slice(0, 8)}: ${err.message}`);
          }
        }
      }
    }
    res.json({ ok: true, activeSetId: req.params.id, applied });
  });

  // ── source map ────────────────────────────────────────────────────────────

  router.get('/source-map', async (req, res) => {
    res.json({ entries: await listCropSourceMap(db, req.session.apiKey) });
  });

  router.post('/source-map', async (req, res) => {
    const result = await createCropSourceMapEntry(db, req.session.apiKey, req.body || {});
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.status(201).json({ ok: true, entry: result.entry });
  });

  router.delete('/source-map/:id', async (req, res) => {
    const deleted = await deleteCropSourceMapEntry(db, req.session.apiKey, req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Mapping not found' });
    res.json({ ok: true });
  });

  return router;
}
