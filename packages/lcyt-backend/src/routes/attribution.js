/**
 * Feed attribution routes (plan_perception_completion.md §5), mounted at
 * /production/attribution, project-scoped via opts.auth:
 *
 *   GET  /status    — current source tag + visual-loop status
 *   POST /start     — start the visual attribution loop (body: { intervalMs? })
 *   POST /stop
 *   POST /override  — { cameraId } = operator says "this is camera N" (held
 *                     until the next scene cut or mixer signal); { cameraId: null } clears it
 */

import { Router } from 'express';

/**
 * @param {ReturnType<typeof import('../feed-attributor.js').createFeedAttributor>} attributor
 * @param {{ db?: import('better-sqlite3').Database, auth?: import('express').RequestHandler }} [opts]
 */
export function createAttributionRouter(attributor, opts = {}) {
  const { db = null, auth = null } = opts;
  const router = Router();
  if (auth) router.use(auth);

  function apiKeyOf(req, res) {
    const apiKey = req.session?.apiKey;
    if (!apiKey) { res.status(401).json({ error: 'No apiKey in session' }); return null; }
    return apiKey;
  }

  router.get('/status', (req, res) => {
    const apiKey = apiKeyOf(req, res); if (!apiKey) return;
    res.json({ ok: true, status: attributor.status(apiKey) });
  });

  router.post('/start', (req, res) => {
    const apiKey = apiKeyOf(req, res); if (!apiKey) return;
    const intervalMs = req.body?.intervalMs;
    if (intervalMs != null && !(Number.isFinite(intervalMs) && intervalMs >= 250 && intervalMs <= 60000)) {
      return res.status(400).json({ error: 'intervalMs must be between 250 and 60000' });
    }
    res.json({ ok: true, status: attributor.start(apiKey, intervalMs != null ? { intervalMs } : {}) });
  });

  router.post('/stop', (req, res) => {
    const apiKey = apiKeyOf(req, res); if (!apiKey) return;
    res.json({ ok: true, stopped: attributor.stop(apiKey) });
  });

  router.post('/override', (req, res) => {
    const apiKey = apiKeyOf(req, res); if (!apiKey) return;
    const cameraId = req.body?.cameraId ?? null;
    if (cameraId !== null) {
      if (typeof cameraId !== 'string') return res.status(400).json({ error: 'cameraId must be a string or null' });
      if (db) {
        const cam = db.prepare('SELECT owner_api_key FROM prod_cameras WHERE id = ?').get(cameraId);
        if (!cam || (cam.owner_api_key && cam.owner_api_key !== apiKey)) return res.status(404).json({ error: 'Camera not found' });
      }
    }
    res.json({ ok: true, tag: attributor.override(apiKey, cameraId) });
  });

  return router;
}
