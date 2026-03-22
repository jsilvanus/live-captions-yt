import { Router } from 'express';
import { Readable } from 'node:stream';
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
 * Serves stream previews sourced from MediaMTX. Three preview types are
 * available for any active RTMP stream:
 *
 *   GET /preview/:key/incoming.jpg  — JPEG thumbnail snapshot (MediaMTX thumbnail API)
 *   GET /preview/:key/webrtc        — WebRTC preview info JSON { url, live }
 *   (HLS preview is available via /stream-hls/:key/index.m3u8)
 *
 * CORS: all endpoints are public with CORS * (thumbnails contain no private data).
 *
 * @param {import('../preview-manager.js').PreviewManager} previewManager
 * @returns {Router}
 */
export function createPreviewRouter(previewManager) {
  const router = Router();

  // CORS preflight
  router.options('/:key/*', (_req, res) => {
    setCorsHeaders(res);
    res.status(204).end();
  });

  // GET /preview/:key/incoming.jpg — JPEG thumbnail from MediaMTX thumbnail API
  router.get('/:key/incoming.jpg', previewRateLimit, async (req, res) => {
    const { key } = req.params;

    if (!PREVIEW_KEY_RE.test(key)) {
      return res.status(400).json({ error: 'Invalid preview key format' });
    }

    const response = await previewManager.fetchThumbnail(key);

    if (!response) {
      return res.status(404).json({ error: 'Preview not available — stream may not be live' });
    }

    setCorsHeaders(res);
    res.setHeader('Content-Type', response.headers.get('content-type') || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=5, must-revalidate');

    Readable.fromWeb(response.body)
      .on('error', () => { if (!res.writableEnded) res.end(); })
      .pipe(res);
  });

  // GET /preview/:key/webrtc — WebRTC preview info
  // Returns { url, live } where `url` is the MediaMTX WebRTC endpoint.
  // Clients open this URL directly in a WebRTC-capable browser or embed it
  // in a <video> element or custom WebRTC player.
  router.get('/:key/webrtc', previewRateLimit, (req, res) => {
    const { key } = req.params;

    if (!PREVIEW_KEY_RE.test(key)) {
      return res.status(400).json({ error: 'Invalid preview key format' });
    }

    setCorsHeaders(res);
    res.setHeader('Cache-Control', 'no-cache, no-store');
    res.json({
      url:  previewManager.getWebRtcUrl(key),
      live: previewManager.isRunning(key),
    });
  });

  return router;
}
