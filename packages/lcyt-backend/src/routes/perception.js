/**
 * Perception routes (plan_video_perception.md Phase 2/3), mounted at
 * /production/perception:
 *
 *   POST /ingest              — an fffleet perception job POSTs one
 *     camera's detection here. Internal, not project-JWT gated — the caller
 *     is a compute worker, not a user session — so it's protected by
 *     BACKEND_INTERNAL_TOKEN or a per-job token.
 *     A per-job token (HMAC of the job's project, camera, feed kind and id, see
 *     lcyt-compute/perception/ingest-token) is accepted as well, and is what new jobs carry.
 *     Detections whose job plan carries feedKind: 'shared' (cameraId null —
 *     the runner doesn't know which camera the shared feed currently shows)
 *     are re-tagged via the shared-feed resolver before reaching the
 *     aggregator (Phase 3).
 *
 *   GET  /overview — per-camera job/auto/on-program/detector state, shared-feed job and attribution (status panel).
 *   POST /shared/auto { enabled } — switch the automatic start/stop of the shared-feed job.
 *   POST /shared/start|stop, GET /shared/status — project-scoped (opts.auth),
 *     dispatch/inspect the one shared-feed perception job for this project
 *     (mixer-input-only cameras, Phase 3) — the camera-scoped equivalent for
 *     dedicated-feed cameras lives in lcyt-production's
 *     /production/cameras/:id/perception/* routes instead.
 */

import { Router } from 'express';

/**
 * @param {{ ingest: (apiKey: string, detection: object) => void }} aggregator
 * @param {{ tagSharedDetection: (apiKey: string, detection: object) => object|null }} [resolver]
 * @param {{ perceptionManager?: object, internalToken?: string|null, auth?: import('express').RequestHandler }} [opts]
 */
export function createPerceptionRouter(aggregator, resolver, opts = {}) {
  const { perceptionManager = null, internalToken = null, auth = null, sharedAutostart = null, overview = null } = opts;
  const router = Router();

  router.post('/ingest', (req, res) => {
    const { apiKey, cameraId, feedKind, jobId, ts, capturedAt, objects, framing, visible } = req.body || {};
    // Accepted: a per-job token minted for exactly this (project, camera, feed kind, job), or the shared
    // internal token (older jobs). With neither configured the route is open, as before.
    const provided = req.headers['x-internal-auth'];
    const jobTokenOk = !!provided && perceptionManager?.verifyIngest?.({ apiKey, cameraId: cameraId ?? null, feedKind: feedKind ?? null, jobId }, provided);
    const sharedTokenOk = !!internalToken && provided === internalToken;
    const strict = !!internalToken || !!opts.jobTokensEnabled;
    if (strict && !jobTokenOk && !sharedTokenOk) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    if (!apiKey) {
      return res.status(400).json({ error: 'apiKey is required' });
    }
    if (feedKind !== 'shared' && !cameraId) {
      return res.status(400).json({ error: 'cameraId is required for a non-shared detection' });
    }

    let detection = { cameraId, ts, capturedAt, objects, framing, visible };
    if (feedKind === 'shared') {
      detection = resolver?.tagSharedDetection?.(apiKey, detection) ?? null;
      if (!detection) return res.json({ ok: true, dropped: 'no active camera resolved for this project yet' });
    }

    aggregator.ingest(apiKey, detection);
    res.json({ ok: true });
  });

  const sharedRouter = Router();
  if (auth) sharedRouter.use(auth);

  sharedRouter.post('/shared/start', async (req, res) => {
    if (!perceptionManager) return res.status(503).json({ error: 'Perception dispatch not configured' });
    const apiKey = req.session?.apiKey;
    if (!apiKey) return res.status(401).json({ error: 'No apiKey in session' });
    try {
      const result = await perceptionManager.startSharedFeed(apiKey, { emitIntervalMs: req.body?.emitIntervalMs });
      res.json({ ok: true, ...result });
    } catch (err) {
      if (err.code === 'NOT_CONFIGURED') return res.status(503).json({ error: err.message });
      res.status(502).json({ error: 'Failed to start shared-feed perception job', message: err.message });
    }
  });

  sharedRouter.post('/shared/stop', async (req, res) => {
    if (!perceptionManager) return res.status(503).json({ error: 'Perception dispatch not configured' });
    const apiKey = req.session?.apiKey;
    if (!apiKey) return res.status(401).json({ error: 'No apiKey in session' });
    const stopped = await perceptionManager.stopSharedFeed(apiKey);
    res.json({ ok: true, stopped });
  });

  sharedRouter.get('/shared/status', (req, res) => {
    if (!perceptionManager) return res.status(503).json({ error: 'Perception dispatch not configured' });
    const apiKey = req.session?.apiKey;
    if (!apiKey) return res.status(401).json({ error: 'No apiKey in session' });
    res.json({ ok: true, status: perceptionManager.sharedFeedStatus(apiKey), auto: sharedAutostart ? sharedAutostart.get(apiKey) : false });
  });

  // GET /overview — cameras, shared-feed job and feed attribution in one read (camera status panel)
  sharedRouter.get('/overview', (req, res) => {
    if (!overview) return res.status(503).json({ error: 'Perception overview not configured' });
    const apiKey = req.session?.apiKey;
    if (!apiKey) return res.status(401).json({ error: 'No apiKey in session' });
    res.json({ ok: true, ...overview(apiKey) });
  });

  // POST /shared/auto { enabled } — run the shared-feed job automatically while the program feed is live
  sharedRouter.post('/shared/auto', (req, res) => {
    if (!sharedAutostart) return res.status(503).json({ error: 'Perception auto-start not configured' });
    const apiKey = req.session?.apiKey;
    if (!apiKey) return res.status(401).json({ error: 'No apiKey in session' });
    if (typeof req.body?.enabled !== 'boolean') return res.status(400).json({ error: 'enabled must be a boolean' });
    sharedAutostart.set(apiKey, req.body.enabled);
    res.json({ ok: true, auto: req.body.enabled });
  });

  router.use(sharedRouter);

  return router;
}
