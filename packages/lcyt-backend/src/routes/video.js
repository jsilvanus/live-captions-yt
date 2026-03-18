import { Router } from 'express';
import { createReadStream, existsSync } from 'node:fs';
import { join, resolve as resolvePath, basename, sep } from 'node:path';
import rateLimit from 'express-rate-limit';
import { langName } from 'lcyt-rtmp/src/hls-subs-manager.js';

// Key validation: same rules as viewer / HLS video keys
const VIDEO_KEY_RE = /^[a-zA-Z0-9_-]{3,}$/;
// Language tag validation for use in file paths
const LANG_RE = /^[a-zA-Z0-9_-]{1,30}$/;
// Segment filename validation
const SEGMENT_RE = /^seg\d{6}\.vtt$/;

// Rate limit shared with video + subtitle endpoints.
// Subtitle playlists are polled every ~segmentDuration seconds per language per viewer.
const videoRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 240,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Accept, Range');
}

// ---------------------------------------------------------------------------
// Player HTML template
// ---------------------------------------------------------------------------

/**
 * Build the HLS.js player HTML page for a given viewer key.
 * @param {string} key
 * @param {string} backendOrigin  e.g. 'https://api.lcyt.fi'
 * @param {string} theme  'dark' | 'light'
 * @returns {string}
 */
function buildPlayerHtml(key, backendOrigin, theme) {
  const masterUrl  = `${backendOrigin}/video/${encodeURIComponent(key)}/master.m3u8`;
  const isDark     = theme !== 'light';

  const bg       = isDark ? '#111'  : '#f5f5f5';
  const fg       = isDark ? '#eee'  : '#111';
  const overlayBg = isDark ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.85)';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Live video</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; background: ${bg}; color: ${fg}; font-family: system-ui, sans-serif; }
  body { display: flex; align-items: center; justify-content: center; }
  .wrap { width: 100%; max-width: 960px; padding: 0; }
  video { width: 100%; display: block; background: #000; aspect-ratio: 16/9; }
  #overlay {
    display: none; position: absolute; inset: 0;
    align-items: center; justify-content: center;
    background: ${overlayBg}; font-size: 1.1rem; text-align: center; padding: 1rem;
  }
  .wrap { position: relative; }
  #overlay.visible { display: flex; }
</style>
</head>
<body>
<div class="wrap">
  <video id="v" controls playsinline></video>
  <div id="overlay"><span id="overlay-msg">Loading stream…</span></div>
</div>
<script src="https://cdn.jsdelivr.net/npm/hls.js@1.5.15/dist/hls.min.js"></script>
<script>
(function () {
  'use strict';
  var masterUrl = ${JSON.stringify(masterUrl)};
  var video     = document.getElementById('v');
  var overlay   = document.getElementById('overlay');
  var overlayMsg = document.getElementById('overlay-msg');

  function showOverlay(msg) {
    overlayMsg.textContent = msg;
    overlay.classList.add('visible');
  }

  function hideOverlay() {
    overlay.classList.remove('visible');
  }

  function attachHls(HlsClass) {
    if (!HlsClass || !HlsClass.isSupported()) {
      showOverlay('HLS playback is not supported in this browser.');
      return;
    }
    var hls = new HlsClass({
      lowLatencyMode: false,
      // Enable subtitle rendering via the native text track API
      subtitleDisplay: true,
    });

    hls.loadSource(masterUrl);
    hls.attachMedia(video);

    hls.on(HlsClass.Events.MANIFEST_PARSED, function () {
      hideOverlay();
      // Select the first subtitle track by default so the browser shows the CC button
      if (hls.subtitleTracks && hls.subtitleTracks.length > 0) {
        hls.subtitleTrack = 0;
      }
    });

    hls.on(HlsClass.Events.ERROR, function (event, data) {
      if (data.fatal) {
        if (data.type === HlsClass.ErrorTypes.NETWORK_ERROR) {
          showOverlay('Stream not live or unavailable. Retrying…');
          setTimeout(function () {
            hls.startLoad();
          }, 5000);
        } else {
          showOverlay('Playback error. Please reload the page.');
        }
      }
    });
  }

  // Native HLS (Safari / iOS) — subtitles from the manifest are handled natively
  if (video.canPlayType('application/vnd.apple.mpegurl')) {
    hideOverlay();
    video.src = masterUrl;
    video.addEventListener('error', function () {
      showOverlay('Stream not live or unavailable.');
    });
  } else {
    attachHls(window.Hls);
  }
})();
</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Master manifest builder
// ---------------------------------------------------------------------------

/**
 * Build the HLS master manifest that combines the video stream with all
 * active subtitle language tracks.
 *
 * @param {string} key               Viewer / HLS key
 * @param {string} backendOrigin     Absolute origin for the video stream URL
 * @param {string[]} langs           Active subtitle language tags
 * @returns {string}
 */
function buildMasterManifest(key, backendOrigin, langs) {
  const videoUrl = `${backendOrigin}/stream-hls/${encodeURIComponent(key)}/index.m3u8`;

  let out = '#EXTM3U\n#EXT-X-VERSION:3\n\n';

  if (langs.length > 0) {
    langs.forEach((lang, i) => {
      const name     = langName(lang);
      const isDefault = i === 0 ? 'YES' : 'NO';
      out += `#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",LANGUAGE="${lang}",NAME="${name}",DEFAULT=${isDefault},AUTOSELECT=YES,FORCED=NO,URI="subs/${encodeURIComponent(lang)}/playlist.m3u8"\n`;
    });
    out += '\n';
    out += `#EXT-X-STREAM-INF:BANDWIDTH=2800000,CODECS="avc1.4d401f,mp4a.40.2",SUBTITLES="subs"\n`;
  } else {
    out += `#EXT-X-STREAM-INF:BANDWIDTH=2800000,CODECS="avc1.4d401f,mp4a.40.2"\n`;
  }
  out += `${videoUrl}\n`;

  return out;
}

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

/**
 * Factory for the /video router.
 *
 * Routes (all public, CORS *):
 *   GET /video/:key                             — HLS.js player page (embeddable)
 *   GET /video/:key/master.m3u8                 — HLS master manifest
 *   GET /video/:key/subs/:lang/playlist.m3u8    — HLS subtitle playlist
 *   GET /video/:key/subs/:lang/:segment         — WebVTT segment file
 *   OPTIONS /video/:key/...                     — CORS preflight
 *
 * @param {import('better-sqlite3').Database} _db          Unused for now; reserved for future per-key auth
 * @param {import('../hls-manager.js').HlsManager} hlsManager
 * @param {import('../hls-subs-manager.js').HlsSubsManager} hlsSubsManager
 * @returns {Router}
 */
export function createVideoRouter(_db, hlsManager, hlsSubsManager) {
  const router = Router();

  // CORS preflight for all /video routes
  router.options('/*', (req, res) => {
    setCors(res);
    res.status(204).end();
  });

  // ── GET /video/:key — player HTML ─────────────────────────────────────────

  router.get('/:key', videoRateLimit, (req, res) => {
    const { key } = req.params;
    if (!VIDEO_KEY_RE.test(key)) {
      return res.status(400).json({ error: 'Invalid key format' });
    }

    const backendOrigin = process.env.BACKEND_URL || `${req.protocol}://${req.get('host')}`;
    const theme = req.query.theme === 'light' ? 'light' : 'dark';

    setCors(res);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store');
    res.send(buildPlayerHtml(key, backendOrigin, theme));
  });

  // ── GET /video/:key/master.m3u8 — master HLS manifest ────────────────────

  router.get('/:key/master.m3u8', videoRateLimit, (req, res) => {
    const { key } = req.params;
    if (!VIDEO_KEY_RE.test(key)) {
      return res.status(400).json({ error: 'Invalid key format' });
    }

    if (!hlsManager.isRunning(key)) {
      return res.status(404).json({ error: 'Video stream not live' });
    }

    const backendOrigin = process.env.BACKEND_URL || `${req.protocol}://${req.get('host')}`;
    const langs = hlsSubsManager.getLanguages(key);
    const manifest = buildMasterManifest(key, backendOrigin, langs);

    setCors(res);
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-cache, no-store');
    res.send(manifest);
  });

  // ── GET /video/:key/subs/:lang/playlist.m3u8 — subtitle playlist ──────────

  router.get('/:key/subs/:lang/playlist.m3u8', videoRateLimit, (req, res) => {
    const { key, lang } = req.params;
    if (!VIDEO_KEY_RE.test(key)) {
      return res.status(400).json({ error: 'Invalid key format' });
    }
    if (!LANG_RE.test(lang)) {
      return res.status(400).json({ error: 'Invalid language tag' });
    }

    const playlist = hlsSubsManager.getPlaylist(key, lang);
    if (!playlist) {
      return res.status(404).json({ error: 'Subtitle track not found or no segments yet' });
    }

    setCors(res);
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-cache, no-store');
    res.send(playlist);
  });

  // ── GET /video/:key/subs/:lang/:segment — WebVTT segment file ─────────────

  router.get('/:key/subs/:lang/:segment', videoRateLimit, (req, res) => {
    const { key, lang, segment } = req.params;

    if (!VIDEO_KEY_RE.test(key)) {
      return res.status(400).json({ error: 'Invalid key format' });
    }
    if (!LANG_RE.test(lang)) {
      return res.status(400).json({ error: 'Invalid language tag' });
    }
    if (!SEGMENT_RE.test(segment)) {
      return res.status(400).json({ error: 'Invalid segment filename' });
    }

    const subsRoot = hlsSubsManager._subsRoot;
    const file     = join(subsRoot, key, lang, basename(segment));

    // Path traversal guard
    if (!resolvePath(file).startsWith(resolvePath(subsRoot) + sep)) {
      return res.status(400).json({ error: 'Invalid path' });
    }

    if (!existsSync(file)) {
      return res.status(404).json({ error: 'Segment not found' });
    }

    setCors(res);
    res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=60');
    createReadStream(file).pipe(res);
  });

  return router;
}
