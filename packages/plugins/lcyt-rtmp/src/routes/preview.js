import { Router } from 'express';
import { Readable } from 'node:stream';
import { readFileSync, existsSync } from 'node:fs';
import rateLimit from 'express-rate-limit';
import { coercePreviewResponse } from '../preview/coerce-preview-response.js';

const PREVIEW_KEY_RE = /^[a-zA-Z0-9_-]{3,}$/;

const previewRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Accept');
}

export function createPreviewRouter(previewManager) {
  const router = Router();

  router.options('/:key/*', (_req, res) => {
    setCorsHeaders(res);
    res.status(204).end();
  });

  async function handleIncoming(req, res) {
    const { key } = req.params;
    if (!PREVIEW_KEY_RE.test(key)) return res.status(400).json({ error: 'Invalid preview key format' });

    let rawResponse;
    try {
      if (typeof previewManager?.fetchThumbnail === 'function') {
        rawResponse = await previewManager.fetchThumbnail(key);
      } else if (typeof previewManager?.previewPath === 'function') {
        const p = previewManager.previewPath(key);
        if (!existsSync(p)) rawResponse = null;
        else {
          const buf = readFileSync(p);
          rawResponse = { headers: { 'content-type': 'image/jpeg', 'content-length': String(buf.length) }, body: buf };
        }
      } else {
        rawResponse = null;
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('preview.fetchThumbnail error for key', key, err && err.message ? err.message : err);
      return res.status(502).json({ error: 'Failed to fetch preview' });
    }

    const coerced = await coercePreviewResponse(rawResponse);
    if (!coerced || !coerced.stream) return res.status(404).json({ error: 'Preview not available — stream may not be live' });

    setCorsHeaders(res);
    const contentType = (coerced.headers && (coerced.headers['content-type'] || coerced.headers['Content-Type'])) || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    if (coerced.headers && coerced.headers['content-length']) res.setHeader('Content-Length', coerced.headers['content-length']);
    res.setHeader('Cache-Control', 'public, max-age=5, must-revalidate');

    const nodeStream = Readable.from(coerced.stream.readable ? coerced.stream : coerced.stream);

    const onClose = () => { try { if (typeof nodeStream.destroy === 'function') nodeStream.destroy(); } catch (e) {} };
    res.on('close', onClose);

    nodeStream.on('error', (err) => {
      // eslint-disable-next-line no-console
      console.warn('preview stream error for key', key, err && err.message ? err.message : err);
      if (!res.writableEnded) res.end();
    }).pipe(res);
  }

  router.get('/:key/incoming', previewRateLimit, handleIncoming);
  router.get('/:key/incoming.jpg', previewRateLimit, handleIncoming);

  router.get('/:key/webrtc', previewRateLimit, (req, res) => {
    const { key } = req.params;
    if (!PREVIEW_KEY_RE.test(key)) return res.status(400).json({ error: 'Invalid preview key format' });
    setCorsHeaders(res);
    res.setHeader('Cache-Control', 'no-cache, no-store');
    res.json({ url: previewManager.getWebRtcUrl?.(key), live: previewManager.isRunning?.(key) });
  });

  return router;
}
