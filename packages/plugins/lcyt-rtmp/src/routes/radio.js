import { Router } from 'express';
import express from 'express';
import { Readable } from 'node:stream';
import rateLimit from 'express-rate-limit';
import { isRadioEnabled, getEmbedCors, getSttConfig, resolveApiKeyFromIngestStreamKey, getRadioConfig, setRadioConfig } from '../db.js';
import logger from 'lcyt/logger';

// Radio key validation: same rules as viewer keys
const RADIO_KEY_RE = /^[a-zA-Z0-9_-]{3,}$/;

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
 * Return the CORS response headers for public radio endpoints.
 * @param {import('express').Response} res
 * @param {string} [origin='*']  CORS origin value (per-key embed_cors or '*')
 */
function setCorsHeaders(res, origin = '*') {
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Accept, Range');
}

/**
 * Generate a self-contained vanilla-JS player snippet for an audio-only HLS stream.
 * The snippet creates an <audio> element and wires up hls.js (loaded from CDN on
 * browsers that lack native HLS support). Optionally renders a title/cover-image
 * "Now Playing" header above the player when metadata is configured.
 *
 * @param {string} radioKey
 * @param {string} backendOrigin  e.g. "https://api.example.com"
 * @param {import('../radio-manager.js').RadioManager} radioManager
 * @param {{ title?: string|null, coverImageUrl?: string|null, autoplay?: boolean }} [meta]
 * @returns {string} JavaScript source
 */
function buildPlayerSnippet(radioKey, backendOrigin, radioManager, meta = {}) {
  const streamUrl = radioManager
    ? radioManager.getPublicHlsUrl(radioKey, backendOrigin)
    : `${backendOrigin}/radio/${radioKey}/index.m3u8`;
  const { title = null, coverImageUrl = null, autoplay = false } = meta;

  return `/* lcyt radio player — key: ${radioKey} */
(function (streamUrl) {
  'use strict';

  var el = document.currentScript || null;

  // Allow callers to pre-create a container with id "radio-${radioKey}".
  // Otherwise, a <div> is inserted right after the <script> tag.
  var container = document.getElementById('radio-${radioKey}');
  if (!container) {
    container = document.createElement('div');
    if (el && el.parentNode) {
      el.parentNode.insertBefore(container, el.nextSibling);
    } else {
      document.body.appendChild(container);
    }
  }

  var meta = ${JSON.stringify({ title, coverImageUrl, autoplay: Boolean(autoplay) })};

  if (meta.title || meta.coverImageUrl) {
    var header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px';
    if (meta.coverImageUrl) {
      var cover = document.createElement('img');
      cover.src = meta.coverImageUrl;
      cover.alt = '';
      cover.style.cssText = 'width:40px;height:40px;object-fit:cover;border-radius:4px';
      header.appendChild(cover);
    }
    if (meta.title) {
      var titleEl = document.createElement('span');
      titleEl.textContent = meta.title;
      titleEl.style.cssText = 'font-weight:600';
      header.appendChild(titleEl);
    }
    container.appendChild(header);
  }

  var audio = document.createElement('audio');
  audio.controls = true;
  audio.style.cssText = 'width:100%;display:block';
  if (meta.autoplay) {
    // Unmuted autoplay is blocked by browser policy without a user gesture
    // regardless of what this setting requests — muting is required to
    // honor autoplay at all.
    audio.autoplay = true;
    audio.muted = true;
  }
  container.appendChild(audio);

  function attachHls(HlsClass) {
    if (HlsClass && HlsClass.isSupported()) {
      var hls = new HlsClass({ lowLatencyMode: true });
      hls.loadSource(streamUrl);
      hls.attachMedia(audio);
    } else if (audio.canPlayType('application/vnd.apple.mpegurl')) {
      audio.src = streamUrl;
    } else {
      container.textContent = 'HLS playback is not supported in this browser.';
    }
  }

  // Native HLS (Safari, iOS)
  if (audio.canPlayType('application/vnd.apple.mpegurl')) {
    audio.src = streamUrl;
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
 * Factory for the /radio router.
 *
 * Handles four concerns:
 *
 *  1. Self-service config (session Bearer, plan/selfservice_config_backend §3):
 *       GET /radio/config — { title, description, coverImageUrl, autoplay, enabled, live }
 *       PUT /radio/config — update title/description/coverImageUrl/autoplay
 *
 *  2. nginx-rtmp / MediaMTX callbacks (no auth — nginx/mediamtx is the caller):
 *       POST /radio               — call=publish → start HLS; call=publish_done → stop
 *       POST /radio/on_publish    — nginx on_publish callback (alternative URL style)
 *       POST /radio/on_publish_done — nginx on_publish_done callback
 *
 *  3. HLS proxy (public, CORS *) — proxies to MediaMTX when nginx is not active:
 *       GET /radio/:key/index.m3u8 — proxy to MediaMTX HLS playlist
 *       GET /radio/:key/*.ts       — proxy to MediaMTX HLS segment
 *
 *  4. Embeddable player snippet (public, CORS *):
 *       GET /radio/:key/player.js  — self-contained vanilla-JS audio player
 *       GET /radio/:key/info       — JSON: { live, hlsUrl, title, description, coverImageUrl, autoplay, slug? } (no secrets exposed)
 *
 *  When NginxManager is active, clients use the slug URL directly and the
 *  proxy routes serve as a fallback for clients that hit the backend.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {import('../radio-manager.js').RadioManager} radioManager
 * @param {import('../stt-manager.js').SttManager} [sttManager]
 * @param {import('express').RequestHandler} [auth]  Session JWT Bearer middleware — required for GET/PUT /config
 * @returns {Router}
 */
export function createRadioRouter(db, radioManager, sttManager = null, auth = null, metrics = null) {
  const router = Router();

  // ── GET/PUT /radio/config — self-service Web Radio metadata (session Bearer) ──
  // Registered before the urlencoded parser below since these are JSON routes.
  // Not gated by RADIO_KEY_RE / public CORS — these are the authenticated,
  // per-project counterpart to the public GET /radio/:key/info.
  function requireAuthConfigured(req, res, next) {
    if (!auth) return res.status(501).json({ error: 'Radio config is not available on this deployment' });
    return auth(req, res, next);
  }

  router.get('/config', requireAuthConfigured, (req, res) => {
    const apiKey = req.session.apiKey;
    const config = getRadioConfig(db, apiKey);
    res.json({ ...config, live: radioManager.isRunning(apiKey) });
  });

  router.put('/config', requireAuthConfigured, (req, res) => {
    const apiKey = req.session.apiKey;
    const { title, description, coverImageUrl, autoplay } = req.body || {};
    const result = setRadioConfig(db, apiKey, { title, description, coverImageUrl, autoplay });
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ ...result.config, live: radioManager.isRunning(apiKey) });
  });

  // nginx-rtmp callbacks are application/x-www-form-urlencoded
  router.use(express.urlencoded({ extended: false, limit: '4kb' }));

  // ── nginx-rtmp / MediaMTX callbacks ──────────────────────────────────────

  /**
   * Shared handler for nginx-rtmp publish/publish_done events.
   * @param {string} call   "publish" | "publish_done"
   * @param {string} name   Stream name (= radio key / API key)
   * @param {import('express').Response} res
   */
  async function handleNginxCallback(call, name, res) {
    if (!name) {
      return res.status(400).send('missing name');
    }

    // Resolve the stream name to the project's api_key — a no-op unless the
    // project has rotated its ingest stream key via POST /ingestion/config/rotate.
    const radioKey = resolveApiKeyFromIngestStreamKey(db, name);

    if (call === 'publish') {
      if (!isRadioEnabled(db, radioKey)) {
        return res.status(403).send('radio not enabled for this key');
      }
      try {
        await radioManager.start(radioKey);
      } catch (err) {
        logger.error(`[radio] Failed to start HLS for ${radioKey.slice(0, 8)}…: ${err.message}`);
        // Still return 200 so nginx allows the publish (HLS is best-effort)
      }

      // Auto-start STT if configured
      if (sttManager) {
        try {
          const cfg = getSttConfig(db, radioKey);
          if (cfg?.autoStart) {
            sttManager.start(radioKey, {
              provider:    cfg.provider,
              language:    cfg.language,
              audioSource: cfg.audioSource,
              streamKey:   cfg.streamKey,
            }).catch(err => {
              logger.error(`[radio] STT auto-start failed for ${radioKey.slice(0, 8)}…: ${err.message}`);
            });
          }
        } catch (err) {
          logger.error(`[radio] STT auto-start lookup failed for ${radioKey.slice(0, 8)}…: ${err.message}`);
        }
      }

      return res.status(200).send('ok');
    }

    if (call === 'publish_done') {
      try {
        await radioManager.stop(radioKey);
      } catch (err) {
        logger.error(`[radio] Failed to stop HLS for ${radioKey.slice(0, 8)}…: ${err.message}`);
      }

      // Stop STT when stream ends
      if (sttManager && sttManager.isRunning(radioKey)) {
        sttManager.stop(radioKey).catch(err => {
          logger.error(`[radio] STT stop failed for ${radioKey.slice(0, 8)}…: ${err.message}`);
        });
      }

      return res.status(200).send('ok');
    }

    return res.status(400).send('unknown call type');
  }

  // POST /radio — single-URL style (call=publish or call=publish_done in body)
  router.post('/', async (req, res) => {
    const { name, call } = req.body || {};
    return handleNginxCallback(call, name, res);
  });

  // POST /radio/on_publish — separate-URL style (nginx on_publish)
  router.post('/on_publish', async (req, res) => {
    const { name } = req.body || {};
    return handleNginxCallback('publish', name, res);
  });

  // POST /radio/on_publish_done — separate-URL style (nginx on_publish_done)
  router.post('/on_publish_done', async (req, res) => {
    const { name } = req.body || {};
    return handleNginxCallback('publish_done', name, res);
  });

  // ── HLS proxy, player snippet, info ──────────────────────────────────────

  // CORS preflight for HLS/player routes
  router.options('/:key/*', (req, res) => {
    const cors = RADIO_KEY_RE.test(req.params.key) ? getEmbedCors(db, req.params.key) : '*';
    setCorsHeaders(res, cors);
    res.status(204).end();
  });

  // GET /radio/:key/player.js — vanilla-JS player snippet
  // Registered BEFORE /:key/:file so it takes precedence for "player.js".
  router.get('/:key/player.js', hlsRateLimit, (req, res) => {
    const { key } = req.params;
    if (!RADIO_KEY_RE.test(key)) {
      return res.status(400).json({ error: 'Invalid radio key format' });
    }

    // Derive the backend origin from the incoming request or env override
    const backendOrigin = process.env.BACKEND_URL
      || `${req.protocol}://${req.get('host')}`;

    const { title, coverImageUrl, autoplay } = getRadioConfig(db, key);

    setCorsHeaders(res, getEmbedCors(db, key));
    res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(buildPlayerSnippet(key, backendOrigin, radioManager, { title, coverImageUrl, autoplay }));
  });

  // GET /radio/:key/info — JSON stream info (public)
  // Returns the public HLS URL and live status without exposing the API key in the URL.
  // When NginxManager is active, hlsUrl uses the slug-based nginx proxy URL.
  // Respects radio_enabled flag: when disabled, live is always false and hlsUrl is omitted.
  router.get('/:key/info', hlsRateLimit, (req, res) => {
    const { key } = req.params;
    if (!RADIO_KEY_RE.test(key)) {
      return res.status(400).json({ error: 'Invalid radio key format' });
    }

    const backendOrigin = process.env.BACKEND_URL
      || `${req.protocol}://${req.get('host')}`;

    // Check if radio is enabled for this key. If not, report as not live and omit hlsUrl.
    const enabled = isRadioEnabled(db, key);
    const live    = enabled && radioManager.isRunning(key);

    // Metadata has no secrets in it (title/description/cover/autoplay), so it's
    // safe to expose alongside the stream info for embeddable "Now Playing" UIs.
    const { title, description, coverImageUrl, autoplay } = getRadioConfig(db, key);

    setCorsHeaders(res, getEmbedCors(db, key));
    res.setHeader('Cache-Control', 'no-cache, no-store');

    const response = { live, title, description, coverImageUrl, autoplay };

    // Only include hlsUrl if the feature is enabled
    if (enabled) {
      response.hlsUrl = radioManager.getPublicHlsUrl(key, backendOrigin);
      // Only expose the slug when nginx is actually proxying it; otherwise the slug
      // would be meaningless (no nginx location exists for it).
      if (radioManager.isNginxEnabled) {
        response.slug = radioManager.getSlug(key);
      }
    }

    res.json(response);
  });

  // GET /radio/:key/:file — proxy HLS playlist and segments to MediaMTX.
  // Used as fallback when nginx is not active. Supports:
  //   *.m3u8         — HLS playlist
  //   *.ts           — MPEG-TS segment (hlsVariant: mpegts)
  //   *.mp4 / *.m4s  — fMP4 init + media segments (hlsVariant: fmp4 / lowLatency,
  //                    which is what docker/mediamtx.yml ships)
  router.get('/:key/:file', hlsRateLimit, async (req, res) => {
    const { key, file } = req.params;

    if (!RADIO_KEY_RE.test(key)) {
      return res.status(400).json({ error: 'Invalid radio key format' });
    }

    if (!/^[a-zA-Z0-9_-]+\.(m3u8|ts|mp4|m4s)$/.test(file)) {
      return res.status(400).json({ error: 'Invalid file name' });
    }

    // Preserve the query string — LL-HLS playlist reloads use _HLS_msn/_HLS_part.
    const qIdx = req.originalUrl.indexOf('?');
    const query = qIdx === -1 ? '' : req.originalUrl.slice(qIdx);
    const upstreamUrl = `${radioManager.getInternalHlsUrl(key)}/${file}${query}`;

    let upstream;
    try {
      upstream = await fetch(upstreamUrl);
    } catch (err) {
      logger.error(`[radio] MediaMTX proxy error for ${key.slice(0, 8)}: ${err.message}`);
      return res.status(502).json({ error: 'Stream backend unavailable' });
    }

    if (!upstream.ok) {
      return res.status(upstream.status === 404 ? 404 : 502).json({
        error: upstream.status === 404 ? 'Stream not found or not currently live' : 'Stream backend error',
      });
    }

    const cors = getEmbedCors(db, key);
    setCorsHeaders(res, cors);
    const isPlaylist = file.endsWith('.m3u8');
    // init.mp4 changes when the publisher restarts with different codec params,
    // so only media segments get the immutable cache treatment.
    const cacheable = !isPlaylist && !file.startsWith('init');
    res.setHeader('Cache-Control', cacheable ? 'public, max-age=86400, immutable' : 'no-cache, no-store');
    res.setHeader('Content-Type', isPlaylist ? 'application/vnd.apple.mpegurl'
      : file.endsWith('.ts') ? 'video/mp2t' : 'video/mp4');

    // egress.node_hls_bytes (plan_metering_audit §4.2): count proxied bytes
    // per key; reported once when the response finishes. The nginx-fronted
    // radio path (NGINX_RADIO_CONFIG_PATH) bypasses this proxy entirely and is
    // measured at MediaMTX only.
    let bytesSent = 0;
    res.once('close', () => {
      if (bytesSent > 0) metrics?.count('egress.node_hls_bytes', bytesSent, { project: key });
    });
    Readable.fromWeb(upstream.body)
      .on('data', (chunk) => { bytesSent += chunk.length; })
      .on('error', () => { if (!res.writableEnded) res.end(); })
      .pipe(res);
  });

  return router;
}