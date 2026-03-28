/**
 * dsk-renderer.js
 *
 * Manages a single persistent headless Chromium instance (via Playwright) used
 * to render DSK graphics templates.  A per-API-key capture loop streams frames
 * to ffmpeg, which pushes them to the local nginx-rtmp DSK RTMP endpoint so the
 * existing Method-2B overlay compositing path picks them up without any changes.
 *
 * Lifecycle
 * ---------
 *   startRenderer()   — call once at server startup
 *   stopRenderer()    — call in graceful-shutdown handler
 *
 * Per-key operations (all exported functions below)
 * -------------------------------------------------
 *   updateTemplate(apiKey, templateJson)   — render new template
 *   broadcastData(apiKey, data)            — inject live data without reload
 *   startRtmpStream(apiKey, rtmpBaseUrl)   — begin capture → ffmpeg → RTMP
 *   stopRtmpStream(apiKey)                 — tear down ffmpeg for one key
 *   getStatus(apiKey)                      — { running, template }
 */

import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import logger from 'lcyt/logger';

// ---------------------------------------------------------------------------
// Chromium executable
// ---------------------------------------------------------------------------

// Allow operators to point at a specific Chrome/Chromium binary.
// Falls back to the well-known Playwright cache location used in this repo.
const CHROMIUM_EXEC = process.env.PLAYWRIGHT_DSK_CHROMIUM || null;

// ---------------------------------------------------------------------------
// Module-level browser state
// ---------------------------------------------------------------------------

let _browser = null;

// Per-API-key state: Map<apiKey, { page, templateJson, ffmpeg, capturing }>
const _keys = new Map();

// ---------------------------------------------------------------------------
// HTML template renderer
// ---------------------------------------------------------------------------

/**
 * Convert a template JSON object into a self-contained HTML page.
 *
 * Template JSON shape (all fields optional):
 * {
 *   background: string,          // CSS color, default "transparent"
 *   width: number,               // viewport width reference (px), default 1920
 *   height: number,              // viewport height reference (px), default 1080
 *   layers: [
 *     {
 *       id: string,              // unique id used by broadcastData() selector
 *       type: "text" | "rect" | "image",
 *       x: number, y: number,    // px from top-left
 *       width: number, height: number,
 *       text: string,            // for type=text (static content; overridden by binding)
 *       binding: string,         // for type=text: code key (section, stanza, speaker…)
 *                                //   element gets data-binding attr + auto-updates via SSE
 *       src: string,             // for type=image (URL or data-URI)
 *       style: { ...cssProps },  // arbitrary inline CSS
 *       animation: string,       // CSS animation shorthand
 *     }
 *   ]
 * }
 *
 * @param {object} templateJson
 * @param {{ apiKey?: string, serverUrl?: string }} [opts]
 */
export function renderTemplateToHtml(templateJson, opts = {}) {
  const t = templateJson || {};
  const bg = t.background ?? 'transparent';
  const w  = t.width  ?? 1920;
  const h  = t.height ?? 1080;
  const layers = Array.isArray(t.layers) ? t.layers.filter(l => l.visible !== false) : [];

  const layerHtml = layers.map((layer) => {
    const id        = layer.id ? ` id="${escHtml(layer.id)}"` : '';
    const baseStyle = [
      'position:absolute',
      `left:${Number(layer.x) || 0}px`,
      `top:${Number(layer.y) || 0}px`,
      layer.width  != null ? `width:${Number(layer.width)}px`  : '',
      layer.height != null ? `height:${Number(layer.height)}px` : '',
      layer.animation ? `animation:${escHtml(layer.animation)}` : '',
    ].filter(Boolean).join(';');

    const extraStyle = layer.style ? Object.entries(layer.style).map(([k, v]) => {
      if (!/^[a-zA-Z-]+$/.test(k)) return '';
      return `${k}:${escHtml(String(v))}`;
    }).filter(Boolean).join(';') : '';

    const style = [baseStyle, extraStyle].filter(Boolean).join(';');

    if (layer.type === 'text') {
      // When binding is set, add data-binding attr so the SSE subscriber can update the text.
      const bindingAttr = layer.binding ? ` data-binding="${escHtml(layer.binding)}"` : '';
      const content = layer.binding ? '' : escHtml(layer.text ?? '');
      return `<div${id}${bindingAttr} style="${style}">${content}</div>`;
    } else if (layer.type === 'rect') {
      return `<div${id} style="${style}"></div>`;
    } else if (layer.type === 'ellipse') {
      // Render as a rectangle with border-radius:50% — extra style appended last so it wins.
      const ellipseStyle = [style, 'border-radius:50%'].filter(Boolean).join(';');
      return `<div${id} style="${ellipseStyle}"></div>`;
    } else if (layer.type === 'image') {
      return `<img${id} src="${escHtml(layer.src ?? '')}" style="${style}" alt="">`;
    }
    return '';
  }).join('\n    ');

  // Inject SSE bindings subscriber when apiKey is provided and at least one bound text layer exists.
  const hasBoundLayers = layers.some(l => l.type === 'text' && l.binding);
  const { apiKey, serverUrl } = opts;
  const sseScript = (hasBoundLayers && apiKey && serverUrl)
    ? buildSseBindingsScript(serverUrl, apiKey)
    : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body {
    width:${w}px; height:${h}px;
    overflow:hidden;
    background:${bg};
  }
  #root { position:relative; width:${w}px; height:${h}px; overflow:hidden; }

  /* LCYT built-in animation keyframes */
  @keyframes lcyt-fadeIn      { from { opacity: 0 } to { opacity: 1 } }
  @keyframes lcyt-fadeOut     { from { opacity: 1 } to { opacity: 0 } }
  @keyframes lcyt-slideInLeft  { from { transform: translateX(-100%) } to { transform: translateX(0) } }
  @keyframes lcyt-slideInRight { from { transform: translateX(100%)  } to { transform: translateX(0) } }
  @keyframes lcyt-slideInUp    { from { transform: translateY(100%)  } to { transform: translateY(0) } }
  @keyframes lcyt-slideInDown  { from { transform: translateY(-100%) } to { transform: translateY(0) } }
  @keyframes lcyt-slideOutLeft  { from { transform: translateX(0) } to { transform: translateX(-100%) } }
  @keyframes lcyt-slideOutRight { from { transform: translateX(0) } to { transform: translateX(100%)  } }
  @keyframes lcyt-zoomIn  { from { transform: scale(0);   opacity: 0 } to { transform: scale(1);   opacity: 1 } }
  @keyframes lcyt-zoomOut { from { transform: scale(1);   opacity: 1 } to { transform: scale(0);   opacity: 0 } }
  @keyframes lcyt-pulse   { 0%, 100% { transform: scale(1) } 50% { transform: scale(1.05) } }
  @keyframes lcyt-blink   { 0%, 100% { opacity: 1 } 50% { opacity: 0 } }
  @keyframes lcyt-typewriter { from { clip-path: inset(0 100% 0 0) } to { clip-path: inset(0 0% 0 0) } }
</style>
</head>
<body>
<div id="root">
  ${layerHtml}
</div>
${sseScript}
</body>
</html>`;
}

/**
 * Build an inline SSE subscriber <script> that listens for 'bindings' events
 * from GET {serverUrl}/dsk/{apiKey}/events and updates [data-binding] elements.
 * Includes exponential-backoff reconnect (1 s → 30 s).
 */
function buildSseBindingsScript(serverUrl, apiKey) {
  const url = `${serverUrl}/dsk/${encodeURIComponent(apiKey)}/events`;
  return `<script>
(function() {
  var url = ${JSON.stringify(url)};
  var delay = 1000;
  function connect() {
    var es = new EventSource(url);
    es.addEventListener('bindings', function(e) {
      try {
        var codes = JSON.parse(e.data).codes;
        if (!codes) return;
        for (var key in codes) {
          var els = document.querySelectorAll('[data-binding="' + key + '"]');
          for (var i = 0; i < els.length; i++) {
            els[i].textContent = codes[key] != null ? codes[key] : '';
          }
        }
      } catch(ex) {}
    });
    es.onerror = function() {
      es.close();
      setTimeout(connect, delay);
      delay = Math.min(delay * 2, 30000);
    };
    es.addEventListener('connected', function() { delay = 1000; });
  }
  connect();
})();
</script>`;
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Browser lifecycle
// ---------------------------------------------------------------------------

// Whether a graceful shutdown is in progress (prevents crash-recovery restarts).
let _stopping = false;

async function _launchBrowser() {
  if (!CHROMIUM_EXEC) throw new Error('PLAYWRIGHT_DSK_CHROMIUM is not set or no accessible Chromium binary found');
  _browser = await chromium.launch({
    headless: true,
    executablePath: CHROMIUM_EXEC,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  });

  // Crash recovery: if Chromium exits unexpectedly, restart it and reload
  // the last active template for each key that had an active capture loop.
  _browser.on('disconnected', async () => {
    if (_stopping) return;
    logger.warn('[dsk-renderer] Chromium disconnected — attempting restart in 2s...');
    _browser = null;

    // Snapshot the state we need to restore (pages are gone after crash).
    const toRestore = [];
    for (const [apiKey, state] of _keys) {
      toRestore.push({
        apiKey,
        templateJson: state.templateJson,
        wasCapturing: state.capturing,
        rtmpBase:     state._rtmpBase,
        rtmpApp:      state._rtmpApp,
      });
      // Mark as not running so stop logic in the capture loop exits cleanly.
      state.capturing = false;
      state.page      = null;
      state.ffmpeg    = null;
    }
    _keys.clear();

    await new Promise((r) => setTimeout(r, 2000));
    if (_stopping) return;

    try {
      await _launchBrowser();
      logger.info('[dsk-renderer] Chromium restarted.');

      for (const { apiKey, templateJson, wasCapturing, rtmpBase, rtmpApp } of toRestore) {
        try {
          if (templateJson) await updateTemplate(apiKey, templateJson);
          if (wasCapturing && rtmpBase) await startRtmpStream(apiKey, rtmpBase, rtmpApp || 'dsk');
        } catch (err) {
          logger.error(`[dsk-renderer] Recovery failed for ${apiKey}: ${err.message}`);
        }
      }
    } catch (err) {
      logger.error(`[dsk-renderer] Restart failed: ${err.message}`);
    }
  });
}

export async function startRenderer() {
  if (_browser) return; // already running
  _stopping = false;
  try {
    await _launchBrowser();
    logger.info('[dsk-renderer] Chromium started.');
  } catch (err) {
    logger.error(`[dsk-renderer] Failed to launch Chromium: ${err.message}`);
    logger.error('[dsk-renderer] Set PLAYWRIGHT_DSK_CHROMIUM to a valid Chromium binary path.');
    _browser = null;
  }
}

export async function stopRenderer() {
  _stopping = true;
  // Stop all per-key capture loops and ffmpeg processes first.
  for (const [apiKey] of _keys) {
    await stopRtmpStream(apiKey);
  }
  if (_browser) {
    try { await _browser.close(); } catch {}
    _browser = null;
    logger.info('[dsk-renderer] Chromium stopped.');
  }
}

// ---------------------------------------------------------------------------
// Per-key helpers
// ---------------------------------------------------------------------------

function _ensureBrowser() {
  if (!_browser) throw new Error('DSK renderer not started (call startRenderer first)');
}

async function _getOrCreatePage(apiKey) {
  let state = _keys.get(apiKey);
  if (!state) {
    _ensureBrowser();
    const page = await _browser.newPage();
    await page.setViewportSize({ width: 1920, height: 1080 });
    state = { page, templateJson: null, ffmpeg: null, capturing: false, _rtmpBase: null, _rtmpApp: null };
    _keys.set(apiKey, state);
  }
  return state;
}

// ---------------------------------------------------------------------------
// Template management
// ---------------------------------------------------------------------------

// Local backend server URL for SSE bindings subscriber injected into Playwright pages.
// Defaults to http://localhost:<PORT> so the headless page can reach the DSK events endpoint.
const DSK_LOCAL_SERVER = process.env.DSK_LOCAL_SERVER
  || `http://localhost:${process.env.PORT || 3000}`;

/**
 * Render a new template for an API key.  Replaces the page content fully.
 * Any ongoing capture loop will pick up the new visuals automatically.
 */
export async function updateTemplate(apiKey, templateJson) {
  _ensureBrowser();
  const state = await _getOrCreatePage(apiKey);
  state.templateJson = templateJson;
  const html = renderTemplateToHtml(templateJson, { apiKey, serverUrl: DSK_LOCAL_SERVER });
  await state.page.setContent(html, { waitUntil: 'load' });
}

/**
 * Inject live data into the running page without a full reload.
 * Preserves CSS animations.
 *
 * data: Array of { selector: string, text: string } objects
 *   or a single { selector, text } object.
 */
export async function broadcastData(apiKey, data) {
  const state = _keys.get(apiKey);
  if (!state) throw new Error(`No active renderer for key: ${apiKey}`);

  const updates = Array.isArray(data) ? data : [data];
  await state.page.evaluate((items) => {
    for (const { selector, text } of items) {
      const el = document.querySelector(selector);
      if (el) el.textContent = text;
    }
  }, updates);
}

// ---------------------------------------------------------------------------
// RTMP capture loop
// ---------------------------------------------------------------------------

const FRAME_RATE = 25;
const FRAME_INTERVAL_MS = Math.floor(1000 / FRAME_RATE);

/**
 * Start screenshotting the Playwright page and piping frames to ffmpeg,
 * which pushes to the local RTMP DSK endpoint.
 *
 * @param {string} apiKey
 * @param {string} rtmpBaseUrl  e.g. "rtmp://127.0.0.1:1935"
 * @param {string} rtmpApp      nginx-rtmp application name, e.g. "dsk"
 */
export async function startRtmpStream(apiKey, rtmpBaseUrl, rtmpApp = 'dsk') {
  _ensureBrowser();
  const state = await _getOrCreatePage(apiKey);

  if (state.capturing) return; // already streaming

  const rtmpUrl = `${rtmpBaseUrl}/${rtmpApp}/${apiKey}`;

  const ffmpeg = spawn('ffmpeg', [
    '-y',
    '-f', 'image2pipe',
    '-framerate', String(FRAME_RATE),
    '-i', 'pipe:0',
    '-vf', 'format=yuv420p',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-tune', 'zerolatency',
    '-g', String(FRAME_RATE * 2),  // keyframe every 2 s
    '-f', 'flv',
    rtmpUrl,
  ], { stdio: ['pipe', 'ignore', 'pipe'] });

  ffmpeg.stderr.on('data', (buf) => {
    const msg = buf.toString().trim();
    // Only log ffmpeg errors, not the regular encoding chatter
    if (/error|warning/i.test(msg)) {
      logger.error(`[dsk-renderer:${apiKey}] ffmpeg: ${msg}`);
    }
  });

  ffmpeg.on('exit', (code, signal) => {
    if (state.capturing) {
      logger.warn(`[dsk-renderer:${apiKey}] ffmpeg exited unexpectedly (code=${code}, signal=${signal})`);
    }
    if (_keys.get(apiKey)?.ffmpeg === ffmpeg) {
      const s = _keys.get(apiKey);
      if (s) { s.ffmpeg = null; s.capturing = false; }
    }
  });

  state.ffmpeg    = ffmpeg;
  state.capturing = true;
  state._rtmpBase = rtmpBaseUrl;
  state._rtmpApp  = rtmpApp;

  // Capture loop — runs until state.capturing is set to false
  const loop = async () => {
    while (state.capturing) {
      const start = Date.now();
      try {
        const frame = await state.page.screenshot({ type: 'png' });
        if (!state.capturing) break;
        const ok = ffmpeg.stdin.write(frame);
        if (!ok) {
          // Back-pressure: wait for drain before next frame
          await new Promise((resolve) => ffmpeg.stdin.once('drain', resolve));
        }
      } catch (err) {
        if (state.capturing) {
          logger.error(`[dsk-renderer:${apiKey}] capture error: ${err.message}`);
        }
        break;
      }
      // Maintain target frame rate
      const elapsed = Date.now() - start;
      const wait    = FRAME_INTERVAL_MS - elapsed;
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
    // Close ffmpeg stdin so it flushes and exits cleanly
    try { ffmpeg.stdin.end(); } catch {}
  };

  loop().catch((err) => {
    if (state.capturing) logger.error(`[dsk-renderer:${apiKey}] loop error: ${err.message}`);
  });

  logger.info(`[dsk-renderer:${apiKey}] RTMP stream started → ${rtmpUrl}`);
}

/**
 * Stop the capture loop and ffmpeg process for one API key.
 */
export async function stopRtmpStream(apiKey) {
  const state = _keys.get(apiKey);
  if (!state) return;

  state.capturing = false;

  if (state.ffmpeg) {
    try { state.ffmpeg.stdin.end(); } catch {}
    try { state.ffmpeg.kill('SIGTERM'); } catch {}
    state.ffmpeg = null;
  }

  if (state.page) {
    try { await state.page.close(); } catch {}
    state.page = null;
  }

  _keys.delete(apiKey);
  logger.info(`[dsk-renderer:${apiKey}] RTMP stream stopped.`);
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export function getStatus(apiKey) {
  const state = _keys.get(apiKey);
  if (!state) return { running: false, template: null };
  return {
    running:       state.capturing,
    template:      state.templateJson,
    browserAlive:  !!_browser,
  };
}