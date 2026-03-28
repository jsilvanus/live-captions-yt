import { Router } from 'express';
import express from 'express';
import { Readable } from 'node:stream';
import rateLimit from 'express-rate-limit';
import { isHlsEnabled, getEmbedCors } from '../db.js';
import logger from 'lcyt/logger';

// HLS key validation: same rules as radio / viewer keys
const HLS_KEY_RE = /^[a-zA-Z0-9_-]{3,}$/;

// Rate limiter for HLS file serving.
// An HLS player refreshes the playlist and fetches segments every ~4 s,
// so 120 req/min per IP allows ~4 concurrent viewers per upstream IP before limiting.
const hlsRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});

/**
 * Return the CORS response headers for public HLS endpoints.
 * @param {import('express').Response} res
 * @param {string} [origin='*']  CORS origin value (per-key embed_cors or '*')
 */
function setCorsHeaders(res, origin = '*') {
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Accept, Range');
}

/**
 * Generate a self-contained vanilla-JS player snippet for a video+audio HLS stream.
 * The snippet creates a <video> element and wires up hls.js (loaded from CDN on
 * browsers that lack native HLS support).
 *
 * @param {string} hlsKey
 * @param {string} backendOrigin  e.g. "https://api.example.com"
 * @returns {string} JavaScript source
 */
function buildPlayerSnippet(hlsKey, backendOrigin) {
  const streamUrl = `${backendOrigin}/stream-hls/${hlsKey}/index.m3u8`;

  return `/* lcyt HLS player — key: ${hlsKey} */
(function (streamUrl) {
  'use strict';

  var el = document.currentScript || null;

  // Allow callers to pre-create a container with id "hls-${hlsKey}".
  // Otherwise, a <div> is inserted right after the <script> tag.
  var container = document.getElementById('hls-${hlsKey}');
  if (!container) {
    container = document.createElement('div');
    if (el && el.parentNode) {
      el.parentNode.insertBefore(container, el.nextSibling);
    } else {
      document.body.appendChild(container);
    }
  }

  var video = document.createElement('video');
  video.controls = true;
  video.autoplay = false;
  video.style.cssText = 'width:100%;display:block';
  container.appendChild(video);

  function attachHls(HlsClass) {
    if (HlsClass && HlsClass.isSupported()) {
      var hls = new HlsClass({ lowLatencyMode: true });
      hls.loadSource(streamUrl);
      hls.attachMedia(video);
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = streamUrl;
    } else {
      container.textContent = 'HLS playback is not supported in this browser.';
    }
  }

  // Native HLS (Safari, iOS)
  if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = streamUrl;
  } else if (typeof Hls !== 'undefined') {
    // hls.js already loaded on the page
    attachHls(window.Hls);
  } else {
    // Dynamically load hls.js from CDN
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.15/dist/hls.min.js';
    s.onload = function () { attachHls(window.Hls); };
    s.onerror = function () {
      container.textContent = 'Failed to load HLS player library.';
    };
    document.head.appendChild(s);
  }
})(${JSON.stringify(streamUrl)});
`;
}

/**
 * Factory for the /stream-hls router.
 *
 * Handles three concerns:
 *
 *  1. nginx-rtmp / MediaMTX callbacks (no auth — nginx/mediamtx is the caller):
 *       POST /stream-hls               — call=publish → start HLS; call=publish_done → stop
 *       POST /stream-hls/on_publish    — nginx on_publish callback (alternative URL style)
 *       POST /stream-hls/on_publish_done — nginx on_publish_done callback
 *
 *  2. HLS proxy (public, CORS *) — proxies to MediaMTX:
 *       GET /stream-hls/:key/index.m3u8 — proxy to MediaMTX HLS playlist
 *       GET /stream-hls/:key/*.ts       — proxy to MediaMTX HLS segment
 *
 *  3. Embeddable player snippet (public, CORS *):
 *       GET /stream-hls/:key/player.js  — self-contained vanilla-JS video player
 *
 * @param {import('better-sqlite3').Database} db
 * @param {import('../hls-manager.js').HlsManager} hlsManager
 * @returns {Router}
 */
export function createStreamHlsRouter(db, hlsManager) {
  const router = Router();

  // nginx-rtmp callbacks are application/x-www-form-urlencoded
  router.use(express.urlencoded({ extended: false, limit: '4kb' }));

  // ── nginx-rtmp / MediaMTX callbacks ──────────────────────────────────────

  /**
   * Shared handler for nginx-rtmp publish/publish_done events.
   * @param {string} call   "publish" | "publish_done"
   * @param {string} name   Stream name (= HLS key / API key)
   * @param {import('express').Response} res
   */
  async function handleNginxCallback(call, name, res) {
    const hlsKey = name;

    if (!hlsKey) {
      return res.status(400).send('missing name');
    }

    if (call === 'publish') {
      if (!isHlsEnabled(db, hlsKey)) {
        return res.status(403).send('HLS not enabled for this key');
      }
      try {
        await hlsManager.start(hlsKey);
      } catch (err) {
        logger.error(`[stream-hls] Failed to start HLS for ${hlsKey.slice(0, 8)}…: ${err.message}`);
        // Still return 200 so nginx allows the publish (HLS is best-effort)
      }
      return res.status(200).send('ok');
    }

    if (call === 'publish_done') {
      try {
        await hlsManager.stop(hlsKey);
      } catch (err) {
        logger.error(`[stream-hls] Failed to stop HLS for ${hlsKey.slice(0, 8)}…: ${err.message}`);
      }
      return res.status(200).send('ok');
    }

    return res.status(400).send('unknown call type');
  }

  // POST /stream-hls — single-URL style (call=publish or call=publish_done in body)
  router.post('/', async (req, res) => {
    const { name, call } = req.body || {};
    return handleNginxCallback(call, name, res);
  });

  // POST /stream-hls/on_publish — separate-URL style (nginx on_publish)
  router.post('/on_publish', async (req, res) => {
    const { name } = req.body || {};
    return handleNginxCallback('publish', name, res);
  });

  // POST /stream-hls/on_publish_done — separate-URL style (nginx on_publish_done)
  router.post('/on_publish_done', async (req, res) => {
    const { name } = req.body || {};
    return handleNginxCallback('publish_done', name, res);
  });

  // ── HLS proxy and player snippet ─────────────────────────────────────────

  // CORS preflight for HLS/player routes
  router.options('/:key/*', (req, res) => {
    const cors = HLS_KEY_RE.test(req.params.key) ? getEmbedCors(db, req.params.key) : '*';
    setCorsHeaders(res, cors);
    res.status(204).end();
  });

  // GET /stream-hls/:key/player.js — vanilla-JS video player snippet
  // Registered BEFORE /:key/:file so it takes precedence for "player.js".
  router.get('/:key/player.js', hlsRateLimit, (req, res) => {
    const { key } = req.params;
    if (!HLS_KEY_RE.test(key)) {
      return res.status(400).json({ error: 'Invalid HLS key format' });
    }

    const backendOrigin = process.env.BACKEND_URL
      || `${req.protocol}://${req.get('host')}`;

    setCorsHeaders(res, getEmbedCors(db, key));
    res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(buildPlayerSnippet(key, backendOrigin));
  });

  // GET /stream-hls/:key/:file — proxy HLS playlist and segments to MediaMTX.
  // Supports:
  //   index.m3u8  — HLS playlist
  //   *.ts        — MPEG-TS segment
  router.get('/:key/:file', hlsRateLimit, async (req, res) => {
    const { key, file } = req.params;

    if (!HLS_KEY_RE.test(key)) {
      return res.status(400).json({ error: 'Invalid HLS key format' });
    }

    // Accept playlist and TS segment filenames only
    if (file !== 'index.m3u8' && !/^[a-zA-Z0-9_-]+\.ts$/.test(file)) {
      return res.status(400).json({ error: 'Invalid file name' });
    }

    const upstreamUrl = `${hlsManager.getInternalHlsUrl(key)}/${file}`;

    let upstream;
    try {
      upstream = await fetch(upstreamUrl);
    } catch (err) {
      logger.error(`[stream-hls] MediaMTX proxy error for ${key.slice(0, 8)}: ${err.message}`);
      return res.status(502).json({ error: 'Stream backend unavailable' });
    }

    if (!upstream.ok) {
      return res.status(upstream.status === 404 ? 404 : 502).json({
        error: upstream.status === 404 ? 'Stream not found or not currently live' : 'Stream backend error',
      });
    }

    const cors = getEmbedCors(db, key);
    setCorsHeaders(res, cors);
    res.setHeader('Cache-Control', file.endsWith('.m3u8') ? 'no-cache, no-store' : 'public, max-age=60');
    res.setHeader('Content-Type', file.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t');

    Readable.fromWeb(upstream.body)
      .on('error', () => { if (!res.writableEnded) res.end(); })
      .pipe(res);
  });

  return router;
}