import { Router } from 'express';
import { listImages } from '../db/images.js';
import { listViewports } from '../db/viewports.js';
import { publicDisplaySettings } from './dsk-viewports.js';

/**
 * Factory for the /dsk router.
 *
 * Public endpoints — no authentication required. The URL path segment is
 * either the project's user-defined public slug (preferred,
 * plan_dsk_viewport_settings Phase 2) or the raw API key (legacy, still
 * supported). These power the green-screen DSK overlay page in lcyt-web.
 *
 * GET /dsk/:slugOrKey/images  — list images available for this project (for pre-loading in the DSK page)
 * GET /dsk/:slugOrKey/events  — SSE stream; emits 'graphics' events when captions with <!-- graphics:... --> are received
 *
 * @param {import('better-sqlite3').Database} db
 * @param {import('../../../../lcyt-backend/src/dsk-bus.js').DskBus} dskBus
 * @returns {Router}
 */
export function createDskRouter(db, dskBus) {
  const router = Router();

  // Resolve a public URL segment to an active api_keys row: user-defined
  // public_slug first, then raw api_key (legacy URLs). Queries the shared
  // api_keys table directly (same precedent as routes/dsk-rtmp.js). Returns
  // the row — callers must use row.key for all downstream DB access, since
  // data tables are keyed by api_key, never by slug.
  function resolveKey(segment, res) {
    let row = null;
    try {
      row = db.prepare('SELECT key, active, public_slug FROM api_keys WHERE public_slug = ?').get(segment)
         ?? db.prepare('SELECT key, active, public_slug FROM api_keys WHERE key = ?').get(segment)
         ?? null;
    } catch {
      // Pre-migration schema without public_slug — legacy apiKey lookup only
      row = db.prepare('SELECT key, active FROM api_keys WHERE key = ?').get(segment) ?? null;
    }
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
    const row = resolveKey(req.params.apikey, res);
    if (!row) return;
    const apikey = row.key;

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
    const row = resolveKey(req.params.apikey, res);
    if (!row) return;
    const apikey = row.key;
    const rows = listViewports(db, apikey);
    res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    res.json({
      // The project's public slug (when set) so authenticated pages can build
      // slug-form display URLs without a separate lookup. Public by design:
      // the slug is already the public URL identifier.
      projectSlug: row.public_slug ?? null,
      viewports: rows.map(r => ({
        name:            r.name,
        label:           r.label ?? null,
        viewportType:    r.viewport_type,
        width:           r.width,
        height:          r.height,
        textLayers:      parseJson(r.text_layers_json, []),
        displaySettings: publicDisplaySettings(parseJson(r.display_settings_json, null)),
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
