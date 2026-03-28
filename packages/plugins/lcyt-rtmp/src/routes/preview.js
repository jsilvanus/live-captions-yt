import express from 'express';
import rateLimit from 'express-rate-limit';
import { coercePreviewResponse } from '../preview/coerce-preview-response.js';
import fs from 'fs';

function isNodeReadable(s) {
  return s && typeof s.pipe === 'function';
}

export function createPreviewRouter(previewManager, opts = {}) {
  const router = express.Router();
  const limiter = rateLimit({ windowMs: 1000, max: 5 });

  async function handleIncoming(req, res) {
    const key = req.params.key;
    try {
      const resp = await previewManager.fetchThumbnail(key);
      if (!resp) return res.status(404).end();
      const coerced = await coercePreviewResponse(resp);
      const contentType = (coerced.headers && coerced.headers['content-type']) || 'application/octet-stream';
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'no-cache');

      const stream = coerced.stream;
      if (isNodeReadable(stream)) {
        // Pipe Node Readable directly to response so destroy propagates
        const original = stream;
        const onClose = () => original.destroy?.();
        res.on('close', onClose);
        original.pipe(res);
        original.on('end', () => res.removeListener('close', onClose));
        return;
      }

      // Fallback: stream may be an async iterable
      const nodeStream = stream[Symbol.asyncIterator] ? (await import('stream')).Readable.from(stream) : null;
      if (nodeStream) return nodeStream.pipe(res);

      res.status(502).end();
    } catch (err) {
      if (err && err.code === 'ENOENT') return res.status(404).end();
      res.status(502).json({ error: err.message });
    }
  }

  router.get('/preview/:key/incoming', limiter, handleIncoming);
  // Keep legacy alias for backwards compatibility
  router.get('/preview/:key/incoming.jpg', limiter, handleIncoming);

  router.options('/preview/:key/incoming', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.sendStatus(204);
  });

  // Minimal JSON /webrtc route kept (delegates to manager)
  router.get('/preview/:key/webrtc', async (req, res) => {
    try {
      const info = await previewManager.fetchWebRtcInfo(req.params.key);
      if (!info) return res.status(404).end();
      res.json(info);
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  return router;
}

export default createPreviewRouter;
