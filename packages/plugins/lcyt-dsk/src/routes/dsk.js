import { Router } from 'express';
import { listImages } from '../db/images.js';
import { listViewports } from '../db/viewports.js';

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
 * @param {import('../../../../lcyt-backend/src/dsk-bus.js').DskBus} dskBus
 * @returns {Router}
 */
export function createDskRouter(db, dskBus) {
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
  // Includes settingsJson (per-viewport visibility/position/animation) so the
  // display page has everything it needs in a single fetch.
  router.get('/:apikey/images', (req, res) => {
    const { apikey } = req.params;
    if (!resolveKey(apikey, res)) return;

    const rows = listImages(db, apikey);
    const images = rows.map(r => ({
      id:           r.id,
      shorthand:    r.shorthand,
      mimeType:     r.mime_type,
      settingsJson: parseJson(r.settings_json),
      // The DSK page fetches image bytes from /images/:id (public endpoint)
      url: `/images/${r.id}`,
    }));
    res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
    res.json({ images });
  });

  // GET /dsk/:apikey/viewports/public — list user-defined viewports without auth (public)
  // Used by display pages to fetch viewport dimensions on load.
  // NOTE: this route must be declared before the /:apikey/events route so Express
  // doesn't interpret "viewports" as an apikey.
  router.get('/:apikey/viewports/public', (req, res) => {
    const { apikey } = req.params;
    if (!resolveKey(apikey, res)) return;
    const rows = listViewports(db, apikey);
    res.set('Cache-Control', 'public, max-age=3600, stale-while-revalidate=3600');
    res.json({
      viewports: rows.map(r => ({
        name:         r.name,
        label:        r.label ?? null,
        viewportType: r.viewport_type,
        width:        r.width,
        height:       r.height,
        textLayers:   parseJson(r.text_layers_json, []),
      })),
    });
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

    dskBus.addDskSubscriber(apikey, res);

    // Heartbeat every 25 s to keep connection alive through proxies
    const heartbeat = setInterval(() => {
      try { res.write(': heartbeat\n\n'); } catch { cleanup(); }
    }, 25000);

    function cleanup() {
      clearInterval(heartbeat);
      dskBus.removeDskSubscriber(apikey, res);
    }

    req.on('close', cleanup);
    req.on('error', cleanup);
  });

  return router;
}

function parseJson(str, fallback = {}) {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}
