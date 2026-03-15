import { Router } from 'express';
import { listImages } from '../db/images.js';

/**
 * Factory for the /dsk router.
 *
 * Public endpoints — no authentication required. The API key is in the URL path.
 * These power the green-screen DSK overlay page in lcyt-web.
 *
 * GET /dsk/:apikey/images  — list images available for this API key (for pre-loading in the DSK page)
 * GET /dsk/:apikey/events  — SSE stream; emits 'graphics' events when captions with <!-- graphics:... --> are received
 *
 * @param {import('better-sqlite3').Database} db
 * @param {import('../../../../lcyt-backend/src/store.js').SessionStore} store
 * @returns {Router}
 */
export function createDskRouter(db, store) {
  const router = Router();

  // Validate API key exists and is active — shared by both endpoints
  function resolveKey(apiKey, res) {
    const row = db.prepare('SELECT key, active FROM api_keys WHERE key = ?').get(apiKey);
    if (!row || row.active !== 1) {
      res.status(404).json({ error: 'API key not found' });
      return null;
    }
    return row;
  }

  // GET /dsk/:apikey/images — list images for pre-loading (public)
  router.get('/:apikey/images', (req, res) => {
    const { apikey } = req.params;
    if (!resolveKey(apikey, res)) return;

    const rows = listImages(db, apikey);
    const images = rows.map(r => ({
      id: r.id,
      shorthand: r.shorthand,
      mimeType: r.mime_type,
      // The DSK page fetches image bytes from /images/:id (public endpoint)
      url: `/images/${r.id}`,
    }));
    res.set('Cache-Control', 'no-store');
    res.json({ images });
  });

  // GET /dsk/:apikey/events — SSE stream (public)
  router.get('/:apikey/events', (req, res) => {
    const { apikey } = req.params;
    if (!resolveKey(apikey, res)) return;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
    res.flushHeaders();

    // Send initial connected event
    res.write(`event: connected\ndata: ${JSON.stringify({ apiKey: apikey })}\n\n`);

    store.addDskSubscriber(apikey, res);

    // Heartbeat every 25 s to keep connection alive through proxies
    const heartbeat = setInterval(() => {
      try { res.write(': heartbeat\n\n'); } catch { cleanup(); }
    }, 25000);

    function cleanup() {
      clearInterval(heartbeat);
      store.removeDskSubscriber(apikey, res);
    }

    req.on('close', cleanup);
    req.on('error', cleanup);
  });

  return router;
}
