import { Router } from 'express';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join, resolve as resolvePath, sep } from 'node:path';
import rateLimit from 'express-rate-limit';

// Preview key validation: same rules as radio / viewer keys
const PREVIEW_KEY_RE = /^[a-zA-Z0-9_-]{3,}$/;

// Rate limiter for preview requests.
// A UI polling every 5 s from one IP = 12 req/min; allow 60 for a few concurrent tabs.
const previewRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});

/**
 * Return the CORS response headers for public preview endpoints.
 * @param {import('express').Response} res
 */
function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Accept');
}

/**
 * Factory for the /preview router.
 *
 * Serves JPEG thumbnail previews of live RTMP streams.  Thumbnails are generated
 * by the PreviewManager (one ffmpeg process per key writing a continuously-updated
 * JPEG) and served here with appropriate caching headers.
 *
 * Endpoints:
 *   GET /preview/:key/incoming.jpg — latest thumbnail of the incoming RTMP stream.
 *       Returns 404 if no preview is currently running for the key.
 *       Cache-Control: public, max-age=5 (safe to cache for one polling interval)
 *       Last-Modified: file mtime
 *
 * CORS: all endpoints are public with CORS * (thumbnails contain no private data).
 *
 * @param {import('../preview-manager.js').PreviewManager} previewManager
 * @returns {Router}
 */
export function createPreviewRouter(previewManager) {
  const router = Router();

  // CORS preflight
  router.options('/:key/*', (req, res) => {
    setCorsHeaders(res);
    res.status(204).end();
  });

  // GET /preview/:key/incoming.jpg — latest incoming stream thumbnail
  router.get('/:key/incoming.jpg', previewRateLimit, (req, res) => {
    const { key } = req.params;

    if (!PREVIEW_KEY_RE.test(key)) {
      return res.status(400).json({ error: 'Invalid preview key format' });
    }

    const previewRoot = previewManager._root;
    const file = previewManager.previewPath(key);

    // Path-traversal guard: ensure the resolved path is inside the preview root.
    // The key regex already blocks '..' and '/', but this is defence-in-depth.
    if (!resolvePath(file).startsWith(resolvePath(previewRoot) + sep)) {
      return res.status(400).json({ error: 'Invalid path' });
    }

    if (!existsSync(file)) {
      return res.status(404).json({ error: 'Preview not available — stream may not be live' });
    }

    let mtime;
    try {
      mtime = statSync(file).mtime;
    } catch {
      return res.status(404).json({ error: 'Preview not available' });
    }

    setCorsHeaders(res);
    res.setHeader('Content-Type', 'image/jpeg');
    // Allow clients (browsers, <img> tags) to cache for one polling interval.
    // must-revalidate ensures they check mtime before using a cached copy.
    res.setHeader('Cache-Control', 'public, max-age=5, must-revalidate');
    res.setHeader('Last-Modified', mtime.toUTCString());

    // Support If-Modified-Since conditional requests so browser <img> polling
    // gets a 304 when the thumbnail hasn't changed (saves bandwidth).
    const ifModSince = req.headers['if-modified-since'];
    if (ifModSince && new Date(ifModSince) >= mtime) {
      return res.status(304).end();
    }

    createReadStream(file).pipe(res);
  });

  return router;
}
