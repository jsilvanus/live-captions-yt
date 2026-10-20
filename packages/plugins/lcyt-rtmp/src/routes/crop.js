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
 * Every route takes an optional `outputId` (query, or body field): the output whose crop it works on. Without it (or with
 * the id of the project's default crop output) it is the project's own crop, exactly as before outputs existed.
 *
 * Feature-gated on the `crop` project feature when FEATURE_GATE_ENFORCE=1
 * (same inline pattern as routes/ingestion.js — plugins query core tables
 * directly instead of importing lcyt-backend middleware).
 */
import { Router } from 'express';
import { readThrough } from '../ownership.js';
import {
  getCropConfig, setCropConfig,
  listCropPresets, getCropPreset, createCropPreset, updateCropPreset, deleteCropPreset,
  listCropSets, createCropSet, updateCropSet, deleteCropSet,
  listCropSourceMap, createCropSourceMapEntry, deleteCropSourceMapEntry,
  resolveCropScope,
} from '../db.js';
import { cropSessionKey } from '../db/crop.js';
import { cropSpec, checkCropChain } from '../crop-outputs.js';
import { getPrimaryFeedId } from '../db/feeds.js';
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

  // The crop a request works on: req.crop = { scope, key } (key = the CropManager session key).
  router.use(async (req, res, next) => {
    const raw = req.query.outputId ?? req.body?.outputId;
    const scope = await resolveCropScope(db, req.session.apiKey, raw ?? null);
    if (!scope) return res.status(404).json({ error: 'Output not found' });
    req.crop = { scope, key: cropSessionKey(scope) };
    next();
  });

  /** Is the picture this crop reads live right now? (the project's main stream, or a named feed) */
  async function sourceIsLive(apiKey, spec) {
    if (!relayManager) return false;
    const primary = await getPrimaryFeedId(db, apiKey);
    if (!spec.rootFeedId || spec.rootFeedId === primary) return readThrough(relayManager, 'isPublishing', apiKey);
    const feed = await db.prod_feeds.findFirst({ where: { id: spec.rootFeedId, owner_api_key: apiKey }, select: { feed_key: true } });
    return feed ? readThrough(relayManager, 'isFeedPublishing', feed.feed_key) : false;
  }

  // ── config ────────────────────────────────────────────────────────────────

  router.get('/config', async (req, res) => {
    const { scope, key } = req.crop;
    res.json({
      ...(await getCropConfig(db, scope)),
      ...(scope.outputId ? { outputId: scope.outputId } : {}),
      ...(await readThrough(cropManager, 'getStatus', key)),
    });
  });

  router.put('/config', async (req, res) => {
    const apiKey = req.session.apiKey;
    const { scope, key } = req.crop;
    const wasEnabled = (await getCropConfig(db, scope)).enabled;
    const { outputId: _ignored, ...patch } = req.body || {};
    if (scope.outputId && patch.enabled) {
      const chainError = await checkCropChain(db, apiKey, scope.outputId);
      if (chainError) return res.status(400).json({ error: chainError });
    }
    const result = await setCropConfig(db, scope, patch);
    if (!result.ok) return res.status(400).json({ error: result.error });

    // Start/stop the renderer to match the new config while the source is live.
    const nowEnabled = result.config.enabled;
    try {
      if (nowEnabled && !(await readThrough(cropManager, 'isRunning', key))) {
        const { sessionKey: _k, ...spec } = await cropSpec(db, scope);
        if (await sourceIsLive(apiKey, spec)) await cropManager.start(key, result.config, spec);
      } else if (!nowEnabled && wasEnabled && (await readThrough(cropManager, 'isRunning', key))) {
        await cropManager.stop(key);
      }
    } catch (err) {
      logger.warn(`[crop] renderer start/stop after config change failed for ${apiKey.slice(0, 8)}: ${err.message}`);
    }

    res.json({ ...result.config, ...(await readThrough(cropManager, 'getStatus', key)) });
  });

  router.get('/status', async (req, res) => {
    res.json(await readThrough(cropManager, 'getStatus', req.crop.key));
  });

  // ── free positioning ──────────────────────────────────────────────────────

  router.post('/position', async (req, res) => {
    const apiKey = req.crop.key;
    const { xNorm, yNorm, transitionMs } = req.body || {};
    if (!Number.isFinite(Number(xNorm)) || !Number.isFinite(Number(yNorm))) {
      return res.status(400).json({ error: 'xNorm and yNorm are required numbers (0-1)' });
    }
    if (!(await readThrough(cropManager, 'isRunning', apiKey))) {
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
    res.json({ presets: await listCropPresets(db, req.crop.scope, { setId }) });
  });

  router.post('/presets', async (req, res) => {
    const result = await createCropPreset(db, req.crop.scope, req.body || {});
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.status(201).json({ ok: true, preset: result.preset });
  });

  router.put('/presets/:id', async (req, res) => {
    const result = await updateCropPreset(db, req.crop.scope, req.params.id, req.body || {});
    if (!result.ok) return res.status(result.status ?? 400).json({ error: result.error });
    res.json({ ok: true, preset: result.preset });
  });

  router.delete('/presets/:id', async (req, res) => {
    const deleted = await deleteCropPreset(db, req.crop.scope, req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Preset not found' });
    res.json({ ok: true });
  });

  router.post('/presets/:id/activate', async (req, res) => {
    const { scope, key: apiKey } = req.crop;
    const preset = await getCropPreset(db, scope, req.params.id);
    if (!preset) return res.status(404).json({ error: 'Preset not found' });
    if (!(await readThrough(cropManager, 'isRunning', apiKey))) {
      return res.status(409).json({ error: 'Crop renderer is not running' });
    }
    const transitionMs = Number(req.body?.transitionMs) >= 0
      ? Number(req.body.transitionMs)
      : (await getCropConfig(db, scope)).transitionMs;
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
    const { scope } = req.crop;
    res.json({ sets: await listCropSets(db, scope), activeSetId: (await getCropConfig(db, scope)).activeSetId });
  });

  router.post('/sets', async (req, res) => {
    const result = await createCropSet(db, req.crop.scope, req.body || {});
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.status(201).json({ ok: true, set: result.set });
  });

  router.put('/sets/:id', async (req, res) => {
    const result = await updateCropSet(db, req.crop.scope, req.params.id, req.body || {});
    if (!result.ok) return res.status(result.status ?? 400).json({ error: result.error });
    res.json({ ok: true, set: result.set });
  });

  router.delete('/sets/:id', async (req, res) => {
    const deleted = await deleteCropSet(db, req.crop.scope, req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Set not found' });
    res.json({ ok: true });
  });

  router.post('/sets/:id/activate', async (req, res) => {
    const { scope, key: apiKey } = req.crop;
    const result = await setCropConfig(db, scope, { activeSetId: req.params.id });
    if (!result.ok) return res.status(404).json({ error: result.error });

    // Re-apply: if the renderer is running and the previously-active preset has
    // a same-named counterpart in the new set, shift to it live.
    let applied = null;
    const status = await readThrough(cropManager, 'getStatus', apiKey);
    if (status.running && status.activePresetId) {
      const oldPreset = await getCropPreset(db, scope, status.activePresetId);
      if (oldPreset) {
        const counterpart = (await listCropPresets(db, scope, { setId: req.params.id }))
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
    res.json({ entries: await listCropSourceMap(db, req.crop.scope) });
  });

  router.post('/source-map', async (req, res) => {
    const result = await createCropSourceMapEntry(db, req.crop.scope, req.body || {});
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.status(201).json({ ok: true, entry: result.entry });
  });

  router.delete('/source-map/:id', async (req, res) => {
    const deleted = await deleteCropSourceMapEntry(db, req.crop.scope, req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Mapping not found' });
    res.json({ ok: true });
  });

  return router;
}
