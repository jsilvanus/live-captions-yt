<<<<<<< HEAD
import { Router } from 'express';
import {
  getCropConfig,
  setCropConfig,
  setCropPosition,
  listCropPresetSets,
  createCropPresetSet,
  getCropPresetSetById,
  updateCropPresetSet,
  deleteCropPresetSet,
  activateCropPresetSet,
  listCropPresets,
  createCropPreset,
  getCropPresetById,
  updateCropPreset,
  deleteCropPreset,
  activateCropPreset,
} from '../db/crop.js';
=======
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
>>>>>>> origin/main

function isFeatureGateEnforced() {
  const v = process.env.FEATURE_GATE_ENFORCE;
  return v === '1' || v === 'true';
}

function hasCropFeature(db, apiKey) {
<<<<<<< HEAD
  if (!apiKey) return false;
  const stmt = db.__cropFeatureStmt || (db.__cropFeatureStmt = db.prepare("SELECT enabled FROM project_features WHERE api_key = ? AND feature_code = 'crop'"));
  const row = stmt.get(apiKey);
  return row?.enabled === 1;
}

function buildConfig(db, apiKey, cropManager) {
  const config = getCropConfig(db, apiKey);
  const state = cropManager?.getState?.(apiKey) || {};
  return {
    enabled: Boolean(config.enabled),
    aspectW: config.aspectW,
    aspectH: config.aspectH,
    outW: config.outW,
    outH: config.outH,
    videoBitrate: config.videoBitrate,
    followProgram: Boolean(config.followProgram),
    transitionMs: config.transitionMs,
    activeSetId: config.activeSetId ?? state.activeSetId ?? null,
    activePresetId: config.activePresetId ?? state.activePresetId ?? null,
    xNorm: state.xNorm ?? config.xNorm,
    yNorm: state.yNorm ?? config.yNorm,
    running: Boolean(state.running),
    repositionMode: state.repositionMode || 'restart',
    inW: state.inW ?? null,
    inH: state.inH ?? null,
    cropW: state.cropW ?? null,
    cropH: state.cropH ?? null,
  };
}

export function createCropRouter(db, auth, cropManager) {
  const router = Router();
  router.use(auth);

  function requireCropFeature(req, res, next) {
    if (!isFeatureGateEnforced()) return next();
    if (hasCropFeature(db, req.session?.apiKey)) return next();
    return res.status(403).json({ error: "Feature 'crop' is not enabled for this project", feature: 'crop' });
  }

  router.use(requireCropFeature);

  router.get('/config', (req, res) => {
    res.json(buildConfig(db, req.session.apiKey, cropManager));
=======
  const row = db.prepare(
    "SELECT enabled FROM project_features WHERE api_key = ? AND feature_code = 'crop'"
  ).get(apiKey);
  return row?.enabled === 1;
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {import('express').RequestHandler} auth  Session JWT Bearer middleware
 * @param {import('../crop-manager.js').CropManager} cropManager
 * @param {import('../rtmp-manager.js').RtmpRelayManager} [relayManager]  For isPublishing()
 * @returns {Router}
 */
export function createCropRouter(db, auth, cropManager, relayManager = null) {
  const router = Router();
  router.use(auth);

  router.use((req, res, next) => {
    if (isFeatureGateEnforced() && !hasCropFeature(db, req.session.apiKey)) {
      return res.status(403).json({ error: "Feature 'crop' is not enabled for this project", feature: 'crop' });
    }
    next();
  });

  // ── config ────────────────────────────────────────────────────────────────

  router.get('/config', (req, res) => {
    const apiKey = req.session.apiKey;
    res.json({
      ...getCropConfig(db, apiKey),
      ...cropManager.getStatus(apiKey),
    });
>>>>>>> origin/main
  });

  router.put('/config', async (req, res) => {
    const apiKey = req.session.apiKey;
<<<<<<< HEAD
    const patch = {};
    if (req.body?.enabled !== undefined) patch.enabled = req.body.enabled;
    if (req.body?.aspectW !== undefined) patch.aspectW = req.body.aspectW;
    if (req.body?.aspectH !== undefined) patch.aspectH = req.body.aspectH;
    if (req.body?.outW !== undefined) patch.outW = req.body.outW;
    if (req.body?.outH !== undefined) patch.outH = req.body.outH;
    if (req.body?.videoBitrate !== undefined) patch.videoBitrate = req.body.videoBitrate;
    if (req.body?.followProgram !== undefined) patch.followProgram = req.body.followProgram;
    if (req.body?.transitionMs !== undefined) patch.transitionMs = req.body.transitionMs;

    setCropConfig(db, apiKey, patch);
    await cropManager?.applyConfig?.(apiKey, patch);
    res.json(buildConfig(db, apiKey, cropManager));
  });

  router.get('/presets', (req, res) => {
    const setId = req.query?.setId ?? null;
=======
    const wasEnabled = getCropConfig(db, apiKey).enabled;
    const result = setCropConfig(db, apiKey, req.body || {});
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

  router.get('/presets', (req, res) => {
    const setId = req.query.setId !== undefined
      ? (req.query.setId === '' || req.query.setId === 'null' ? null : String(req.query.setId))
      : undefined;
>>>>>>> origin/main
    res.json({ presets: listCropPresets(db, req.session.apiKey, { setId }) });
  });

  router.post('/presets', (req, res) => {
<<<<<<< HEAD
    const preset = createCropPreset(db, req.session.apiKey, {
      name: req.body?.name,
      xNorm: req.body?.xNorm,
      yNorm: req.body?.yNorm,
      setId: req.body?.setId,
      sortOrder: req.body?.sortOrder,
    });
    res.status(201).json({ preset });
  });

  router.put('/presets/:id', (req, res) => {
    const preset = updateCropPreset(db, req.params.id, {
      name: req.body?.name,
      xNorm: req.body?.xNorm,
      yNorm: req.body?.yNorm,
      setId: req.body?.setId,
      sortOrder: req.body?.sortOrder,
    });
    if (!preset) return res.status(404).json({ error: 'preset not found' });
    res.json({ preset });
  });

  router.delete('/presets/:id', (req, res) => {
    const deleted = deleteCropPreset(db, req.params.id);
    res.json({ ok: true, deleted });
  });

  router.post('/presets/:id/activate', async (req, res) => {
    const preset = getCropPresetById(db, req.params.id);
    if (!preset) return res.status(404).json({ error: 'preset not found' });
    await cropManager?.activatePreset?.(req.session.apiKey, preset, req.body?.transitionMs);
    res.json({ ok: true, preset, config: buildConfig(db, req.session.apiKey, cropManager) });
  });

  router.post('/position', async (req, res) => {
    setCropPosition(db, req.session.apiKey, {
      xNorm: req.body?.xNorm,
      yNorm: req.body?.yNorm,
    });
    await cropManager?.applyPosition?.(req.session.apiKey, {
      xNorm: req.body?.xNorm,
      yNorm: req.body?.yNorm,
      transitionMs: req.body?.transitionMs,
    });
    res.json(buildConfig(db, req.session.apiKey, cropManager));
  });

  router.get('/sets', (req, res) => {
    res.json({ sets: listCropPresetSets(db, req.session.apiKey) });
  });

  router.post('/sets', (req, res) => {
    const set = createCropPresetSet(db, req.session.apiKey, { name: req.body?.name, sortOrder: req.body?.sortOrder });
    res.status(201).json({ set });
  });

  router.put('/sets/:id', (req, res) => {
    const set = updateCropPresetSet(db, req.params.id, { name: req.body?.name, sortOrder: req.body?.sortOrder });
    if (!set) return res.status(404).json({ error: 'set not found' });
    res.json({ set });
  });

  router.delete('/sets/:id', (req, res) => {
    const deleted = deleteCropPresetSet(db, req.params.id);
    res.json({ ok: true, deleted });
  });

  router.post('/sets/:id/activate', (req, res) => {
    const cfg = activateCropPresetSet(db, req.session.apiKey, req.params.id);
    if (!cfg) return res.status(404).json({ error: 'set not found' });
    res.json({ ok: true, config: buildConfig(db, req.session.apiKey, cropManager) });
  });

  router.get('/status', (req, res) => {
    res.json(buildConfig(db, req.session.apiKey, cropManager));
=======
    const result = createCropPreset(db, req.session.apiKey, req.body || {});
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.status(201).json({ ok: true, preset: result.preset });
  });

  router.put('/presets/:id', (req, res) => {
    const result = updateCropPreset(db, req.session.apiKey, req.params.id, req.body || {});
    if (!result.ok) return res.status(result.status ?? 400).json({ error: result.error });
    res.json({ ok: true, preset: result.preset });
  });

  router.delete('/presets/:id', (req, res) => {
    const deleted = deleteCropPreset(db, req.session.apiKey, req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Preset not found' });
    res.json({ ok: true });
  });

  router.post('/presets/:id/activate', async (req, res) => {
    const apiKey = req.session.apiKey;
    const preset = getCropPreset(db, apiKey, req.params.id);
    if (!preset) return res.status(404).json({ error: 'Preset not found' });
    if (!cropManager.isRunning(apiKey)) {
      return res.status(409).json({ error: 'Crop renderer is not running' });
    }
    const transitionMs = Number(req.body?.transitionMs) >= 0
      ? Number(req.body.transitionMs)
      : getCropConfig(db, apiKey).transitionMs;
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

  router.get('/sets', (req, res) => {
    const apiKey = req.session.apiKey;
    res.json({ sets: listCropSets(db, apiKey), activeSetId: getCropConfig(db, apiKey).activeSetId });
  });

  router.post('/sets', (req, res) => {
    const result = createCropSet(db, req.session.apiKey, req.body || {});
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.status(201).json({ ok: true, set: result.set });
  });

  router.put('/sets/:id', (req, res) => {
    const result = updateCropSet(db, req.session.apiKey, req.params.id, req.body || {});
    if (!result.ok) return res.status(result.status ?? 400).json({ error: result.error });
    res.json({ ok: true, set: result.set });
  });

  router.delete('/sets/:id', (req, res) => {
    const deleted = deleteCropSet(db, req.session.apiKey, req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Set not found' });
    res.json({ ok: true });
  });

  router.post('/sets/:id/activate', async (req, res) => {
    const apiKey = req.session.apiKey;
    const result = setCropConfig(db, apiKey, { activeSetId: req.params.id });
    if (!result.ok) return res.status(404).json({ error: result.error });

    // Re-apply: if the renderer is running and the previously-active preset has
    // a same-named counterpart in the new set, shift to it live.
    let applied = null;
    const status = cropManager.getStatus(apiKey);
    if (status.running && status.activePresetId) {
      const oldPreset = getCropPreset(db, apiKey, status.activePresetId);
      if (oldPreset) {
        const counterpart = listCropPresets(db, apiKey, { setId: req.params.id })
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

  router.get('/source-map', (req, res) => {
    res.json({ entries: listCropSourceMap(db, req.session.apiKey) });
  });

  router.post('/source-map', (req, res) => {
    const result = createCropSourceMapEntry(db, req.session.apiKey, req.body || {});
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.status(201).json({ ok: true, entry: result.entry });
  });

  router.delete('/source-map/:id', (req, res) => {
    const deleted = deleteCropSourceMapEntry(db, req.session.apiKey, req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Mapping not found' });
    res.json({ ok: true });
>>>>>>> origin/main
  });

  return router;
}
