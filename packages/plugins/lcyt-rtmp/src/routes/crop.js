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

function isFeatureGateEnforced() {
  const v = process.env.FEATURE_GATE_ENFORCE;
  return v === '1' || v === 'true';
}

function hasCropFeature(db, apiKey) {
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
  });

  router.put('/config', async (req, res) => {
    const apiKey = req.session.apiKey;
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
    res.json({ presets: listCropPresets(db, req.session.apiKey, { setId }) });
  });

  router.post('/presets', (req, res) => {
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
  });

  return router;
}
