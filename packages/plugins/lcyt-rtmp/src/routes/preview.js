import express from 'express';
import rateLimit from 'express-rate-limit';
import { coercePreviewResponse } from '../preview/coerce-preview-response.js';
import fs from 'fs';
import { createHash } from 'node:crypto';

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

      // Buffer the full thumbnail so we can compute an ETag for conditional GETs.
      // Thumbnails are small (50–200 KB) so buffering is acceptable.
      const stream = coerced.stream;
      let buffer;
      if (isNodeReadable(stream)) {
        buffer = await new Promise((resolve, reject) => {
          const chunks = [];
          stream.on('data', c => chunks.push(c));
          stream.on('end', () => resolve(Buffer.concat(chunks)));
          stream.on('error', reject);
        });
      } else if (stream && stream[Symbol.asyncIterator]) {
        const readable = (await import('stream')).Readable.from(stream);
        buffer = await new Promise((resolve, reject) => {
          const chunks = [];
          readable.on('data', c => chunks.push(c));
          readable.on('end', () => resolve(Buffer.concat(chunks)));
          readable.on('error', reject);
        });
      } else {
        return res.status(502).end();
      }

      const etag = `W/"${createHash('md5').update(buffer).digest('hex')}"`;
      res.setHeader('ETag', etag);
      res.setHeader('Cache-Control', 'public, max-age=2');
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', buffer.length);

      if (req.headers['if-none-match'] === etag) {
        return res.status(304).end();
      }

      res.send(buffer);
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
