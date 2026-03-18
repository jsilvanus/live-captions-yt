import { useEffect, useRef, useState } from 'react';
import { KEYS } from '../lib/storageKeys.js';

/**
 * DSK (downstream keyer) display page.
 *
 * URL: /dsk/:apikey
 * Query params:
 *   server=<backendUrl>   Backend URL (falls back to localStorage lcyt-config)
 *   cc=1                  Also render caption text (CC burn-in mode)
 *   bg=<hex>              Override background colour (default: #00B140 chroma green)
 *   viewport=<name>       Named viewport — applies per-viewport image settings and dimensions.
 *                         If omitted, landscape defaults are used (unchanged behaviour).
 *
 * The page:
 * 1. Fetches GET <server>/dsk/<apikey>/images — pre-loads images and their settingsJson
 * 2. If viewport param is set, fetches GET <server>/dsk/<apikey>/viewports/public for dimensions
 * 3. Opens SSE on GET <server>/dsk/<apikey>/events
 * 4. On 'graphics' event: selects active names for this viewport (viewport-specific or default)
 * 5. On 'text' event (cc=1): renders the stripped caption text
 * 6. On 'reload' event: re-fetches the image list
 * 7. Reconnects SSE with exponential backoff on disconnect
 *
 * Per-viewport image settings (from image.settingsJson.viewports[viewportName]):
 *   visible:   boolean — hide this image on this viewport even when active (default: true)
 *   x:         number  — absolute left position in px (default: 0, full-width)
 *   y:         number  — absolute top position in px (default: 0)
 *   width:     number  — width in px (default: 100% of container)
 *   height:    number  — height in px (default: auto)
 *   animation: string  — CSS animation shorthand, e.g. "lcyt-fadeIn 0.5s" (default: none)
 */
export function DskPage() {
  // ── URL params ──────────────────────────────────────────
  const pathParts = window.location.pathname.split('/');
  // /dsk/<apikey>  →  pathParts[2]
  const apiKey = pathParts[2] || '';

  const params = new URLSearchParams(window.location.search);
  const ccMode      = params.get('cc') === '1';
  const bgColor     = params.get('bg') || '#00B140';
  const viewportName = params.get('viewport') || null;

  function resolveServer() {
    const fromUrl = params.get('server');
    if (fromUrl) return fromUrl.replace(/\/$/, '');
    try {
      const cfg = JSON.parse(localStorage.getItem(KEYS.session.config) || '{}');
      return (cfg.backendUrl || '').replace(/\/$/, '');
    } catch { return ''; }
  }
  const serverUrl = resolveServer();

  // ── State ───────────────────────────────────────────────
  const [images, setImages]           = useState([]); // [{ id, shorthand, mimeType, url, settingsJson }]
  const [activeNames, setActiveNames] = useState([]); // string[]
  const [ccText, setCcText]           = useState('');
  const [status, setStatus]           = useState('connecting');
  // viewport dimensions (null = use 100vw/100vh)
  const [vpDimensions, setVpDimensions] = useState(null); // { width, height } | null
  // text layers from viewport config: [{ id, binding, x, y, width, height, fontSize, ... }]
  const [textLayers, setTextLayers]   = useState([]);
  // live bindings from caption codes: { section: 'Gospel', stanza: '...', ... }
  const [bindings, setBindings]       = useState({});
  // active templates from server-side broadcast: array of template JSON objects
  const [activeTemplates, setActiveTemplates] = useState([]);
  // live text overrides from broadcast: { layerId: text }
  const [layerOverrides, setLayerOverrides] = useState({});

  // CSS scale to fit viewport dimensions into the window
  const [scale, setScale] = useState(1);

  const esRef       = useRef(null);
  const retryDelay  = useRef(1000);
  const retryTimer  = useRef(null);
  const mounted     = useRef(true);

  // ── Image pre-loading ───────────────────────────────────
  async function fetchImages() {
    if (!serverUrl || !apiKey) return;
    try {
      const res = await fetch(`${serverUrl}/dsk/${encodeURIComponent(apiKey)}/images`);
      if (!res.ok) return;
      const data = await res.json();
      setImages(data.images || []);
    } catch { /* non-fatal */ }
  }

  // ── Viewport dimensions + text layers ───────────────────
  async function fetchViewportDimensions() {
    if (!serverUrl || !apiKey || !viewportName) return;
    try {
      const res = await fetch(`${serverUrl}/dsk/${encodeURIComponent(apiKey)}/viewports/public`);
      if (!res.ok) return;
      const data = await res.json();
      const vp = (data.viewports || []).find(v => v.name === viewportName);
      if (vp) {
        setVpDimensions({ width: vp.width, height: vp.height });
        setTextLayers(Array.isArray(vp.textLayers) ? vp.textLayers : []);
      }
    } catch { /* non-fatal */ }
  }

  // ── SSE connection ──────────────────────────────────────
  function connect() {
    if (!mounted.current || !serverUrl || !apiKey) {
      setStatus('error');
      return;
    }

    const es = new EventSource(`${serverUrl}/dsk/${encodeURIComponent(apiKey)}/events`);
    esRef.current = es;

    es.addEventListener('connected', () => {
      if (!mounted.current) return;
      setStatus('connected');
      retryDelay.current = 1000;
    });

    es.addEventListener('graphics', (e) => {
      if (!mounted.current) return;
      try {
        const payload = JSON.parse(e.data);
        setActiveNames(resolveActiveNames(payload, viewportName));
      } catch {}
    });

    es.addEventListener('bindings', (e) => {
      if (!mounted.current) return;
      try {
        const { codes } = JSON.parse(e.data);
        if (codes && typeof codes === 'object') {
          setBindings(prev => ({ ...prev, ...codes }));
        }
      } catch {}
    });

    es.addEventListener('text', (e) => {
      if (!mounted.current || !ccMode) return;
      try {
        const { text } = JSON.parse(e.data);
        setCcText(text || '');
      } catch {}
    });

    es.addEventListener('reload', () => {
      if (!mounted.current) return;
      fetchImages();
    });

    // templates event (multi-select broadcast) — render all selected templates simultaneously
    es.addEventListener('templates', (e) => {
      if (!mounted.current) return;
      try {
        const { templates: tmpls } = JSON.parse(e.data);
        if (Array.isArray(tmpls) && tmpls.length > 0) {
          setActiveTemplates(tmpls);
          setLayerOverrides({});
          const first = tmpls[0];
          setVpDimensions({ width: first.width || 1920, height: first.height || 1080 });
        }
      } catch {}
    });

    // template event (legacy single-template, e.g. from activate endpoint) — backward compat
    es.addEventListener('template', (e) => {
      if (!mounted.current) return;
      try {
        const { template: tmpl } = JSON.parse(e.data);
        setActiveTemplates(tmpl ? [tmpl] : []);
        setLayerOverrides({});
        if (tmpl) {
          setVpDimensions({ width: tmpl.width || 1920, height: tmpl.height || 1080 });
        }
      } catch {}
    });

    // Live text update from Broadcast button — update text layers without reload
    es.addEventListener('layer_update', (e) => {
      if (!mounted.current) return;
      try {
        const { updates } = JSON.parse(e.data);
        if (Array.isArray(updates)) {
          setLayerOverrides(prev => {
            const next = { ...prev };
            for (const { id, text } of updates) next[id] = text;
            return next;
          });
        }
      } catch {}
    });

    es.onerror = () => {
      es.close();
      esRef.current = null;
      if (!mounted.current) return;
      setStatus('connecting');
      const delay = Math.min(retryDelay.current, 30000);
      retryDelay.current = Math.min(delay * 2, 30000);
      retryTimer.current = setTimeout(connect, delay);
    };
  }

  // Recalculate scale whenever vpDimensions or window size changes
  useEffect(() => {
    if (!vpDimensions) return;
    function updateScale() {
      const sx = window.innerWidth  / vpDimensions.width;
      const sy = window.innerHeight / vpDimensions.height;
      setScale(Math.min(sx, sy));
    }
    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, [vpDimensions]);

  useEffect(() => {
    mounted.current = true;
    fetchImages();
    fetchViewportDimensions();
    connect();
    return () => {
      mounted.current = false;
      esRef.current?.close();
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Container sizing ────────────────────────────────────
  // When a viewport with specific dimensions is set, scale the fixed-size container to fit
  // the window (same approach as DskEditorPage canvas scaling).
  const firstTemplate = activeTemplates[0];
  const activeBg = (firstTemplate?.background && firstTemplate.background !== 'transparent')
    ? firstTemplate.background
    : bgColor;
  const containerStyle = buildContainerStyle(vpDimensions, scale, activeBg);

  // ── Render ──────────────────────────────────────────────
  if (!serverUrl || !apiKey) {
    return (
      <div style={{ background: bgColor, width: '100vw', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontFamily: 'sans-serif', fontSize: 18 }}>
        Missing API key or server URL. Add <code>?server=https://your-backend</code> to the URL.
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      {/* CSS keyframes for template layer animations */}
      {activeTemplates.length > 0 && <style>{LCYT_KEYFRAMES}</style>}

      {/* All images pre-loaded (hidden) for zero-latency visibility toggle */}
      {images.map(img => (
        <img
          key={`preload-${img.id}`}
          src={`${serverUrl}/images/${img.id}`}
          alt=""
          style={{ display: 'none' }}
          crossOrigin="anonymous"
        />
      ))}

      {/* Active images rendered in metacode order: first name = lowest z-index (bottom layer), last = highest */}
      {activeNames.map((name, layerIdx) => {
        const img = images.find(i => i.shorthand === name);
        if (!img) return null;

        // Per-viewport settings
        const vpSettings = getViewportSettings(img.settingsJson, viewportName);
        if (vpSettings.visible === false) return null;

        return (
          <img
            key={`active-${img.id}`}
            src={`${serverUrl}/images/${img.id}`}
            alt=""
            aria-hidden="true"
            style={buildImageStyle(layerIdx, vpSettings, vpDimensions)}
            crossOrigin="anonymous"
          />
        );
      })}

      {/* Text layers bound to caption codes (section, stanza, speaker, etc.) */}
      {textLayers.map((layer, idx) => {
        const value = layer.binding ? (bindings[layer.binding] ?? '') : (layer.text ?? '');
        if (!value) return null;
        return (
          <div
            key={layer.id || idx}
            style={buildTextLayerStyle(layer, activeNames.length + idx + 1)}
          >
            {value}
          </div>
        );
      })}

      {/* Template layers — all selected templates rendered in selection order */}
      {activeTemplates.flatMap((tmpl, tmplIdx) =>
        (tmpl.layers || []).map((layer, layerIdx) =>
          renderTemplateLayer(layer, 100 + tmplIdx * 100 + layerIdx, serverUrl, layerOverrides, bindings)
        )
      )}

      {/* CC burn-in text (cc=1 mode only) */}
      {ccMode && ccText && (
        <div style={{
          position: 'absolute',
          bottom: '8%',
          left: '5%',
          right: '5%',
          textAlign: 'center',
          color: '#ffffff',
          fontSize: 'clamp(20px, 3vw, 48px)',
          fontFamily: 'sans-serif',
          fontWeight: 'bold',
          textShadow: '0 2px 8px rgba(0,0,0,0.9)',
          pointerEvents: 'none',
          zIndex: activeNames.length + 2,
        }}>
          {ccText}
        </div>
      )}

      {/* Status indicator — only visible when not connected */}
      {status !== 'connected' && (
        <div style={{
          position: 'absolute',
          top: 8,
          right: 8,
          background: 'rgba(0,0,0,0.5)',
          color: '#fff',
          fontSize: 12,
          padding: '2px 8px',
          borderRadius: 4,
          fontFamily: 'monospace',
        }}>
          {status}
        </div>
      )}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Resolve which image names to show for this viewport given the SSE payload.
 *
 * Supports both the new format { default, viewports, ts } and the legacy format { names, ts }.
 *
 * Landscape aliases: when no viewportName is set (default landscape display),
 * check viewports.landscape / .default / .main before falling back to payload.default.
 * This allows metacodes like <!-- graphics[landscape]:logo --> to target this display.
 */
const LANDSCAPE_ALIASES_DISPLAY = ['landscape', 'default', 'main'];

function resolveActiveNames(payload, viewportName) {
  // Legacy format: { names: [...] }
  if (Array.isArray(payload.names)) return payload.names;

  // New format: { default: [...], viewports: { name: [...] } }
  const { default: defaultNames, viewports } = payload;

  if (viewportName) {
    if (viewports && viewports[viewportName] !== undefined) {
      return viewports[viewportName];
    }
    return Array.isArray(defaultNames) ? defaultNames : [];
  }

  // No viewportName — this is the landscape default display page.
  // Check landscape alias slots before falling back to defaultNames.
  if (viewports) {
    for (const alias of LANDSCAPE_ALIASES_DISPLAY) {
      if (viewports[alias] !== undefined) return viewports[alias];
    }
  }
  return Array.isArray(defaultNames) ? defaultNames : [];
}

/**
 * Get per-viewport settings for an image.
 * Falls back to empty object (use all defaults) when no settings are defined.
 */
function getViewportSettings(settingsJson, viewportName) {
  if (!viewportName || !settingsJson?.viewports) return {};
  return settingsJson.viewports[viewportName] ?? {};
}

/**
 * Build CSS style for a text layer container.
 */
function buildTextLayerStyle(layer, zIndex) {
  return {
    position:   'absolute',
    zIndex,
    pointerEvents: 'none',
    left:       layer.x      != null ? layer.x      : 0,
    top:        layer.y      != null ? layer.y      : 0,
    width:      layer.width  != null ? layer.width  : 'auto',
    height:     layer.height != null ? layer.height : 'auto',
    fontSize:   layer.fontSize   != null ? layer.fontSize   : 48,
    fontWeight: layer.fontWeight != null ? layer.fontWeight : 'bold',
    color:      layer.color      || '#ffffff',
    textAlign:  layer.textAlign  || 'left',
    textShadow: layer.textShadow || 'none',
    fontFamily: layer.fontFamily || 'sans-serif',
    whiteSpace: 'pre-wrap',
    lineHeight: layer.lineHeight || 1.3,
    overflow:   'hidden',
  };
}

/**
 * Build CSS style for the outer container.
 * When vpDimensions is set: fixed pixel size + CSS scale to fit window (preserves aspect ratio).
 * Otherwise: 100vw × 100vh (original behaviour for the landscape default).
 */
function buildContainerStyle(vpDimensions, scale, bgColor) {
  if (!vpDimensions) {
    return { position: 'relative', width: '100vw', height: '100vh', background: bgColor, overflow: 'hidden' };
  }
  const { width, height } = vpDimensions;
  return {
    position:        'relative',
    width:           width,
    height:          height,
    background:      bgColor,
    overflow:        'hidden',
    transformOrigin: 'top left',
    transform:       `scale(${scale})`,
  };
}

/**
 * Build CSS style for an active image element.
 * Uses absolute positioning when viewport-specific x/y/width/height are set,
 * otherwise falls back to full-width behaviour.
 */
function buildImageStyle(layerIdx, vpSettings, vpDimensions) {
  const hasPosition = vpSettings.x != null || vpSettings.y != null;
  const base = {
    position:      'absolute',
    zIndex:        layerIdx + 1,
    pointerEvents: 'none',
  };

  if (vpSettings.animation) base.animation = vpSettings.animation;

  if (hasPosition || vpSettings.width != null || vpSettings.height != null) {
    return {
      ...base,
      left:   vpSettings.x      != null ? vpSettings.x      : 0,
      top:    vpSettings.y      != null ? vpSettings.y      : 0,
      width:  vpSettings.width  != null ? vpSettings.width  : (vpDimensions ? vpDimensions.width : '100%'),
      height: vpSettings.height != null ? vpSettings.height : 'auto',
    };
  }

  // Default: full-width (original landscape behaviour)
  return { ...base, top: 0, left: 0, width: '100%', height: 'auto' };
}

/**
 * Render a single template layer as a positioned React element.
 * Mirrors the server-side renderer's HTML output so the same template JSON
 * looks identical whether viewed through Playwright (RTMP) or the browser overlay.
 */
function renderTemplateLayer(layer, zIndex, serverUrl, layerOverrides, bindings) {
  if (layer.visible === false) return null;

  const base = {
    position: 'absolute',
    left:     layer.x ?? 0,
    top:      layer.y ?? 0,
    width:    layer.width  ?? undefined,
    height:   layer.height ?? undefined,
    zIndex,
    pointerEvents: 'none',
    ...(layer.animation ? { animation: layer.animation } : {}),
    ...(layer.style ? kebabToCamel(layer.style) : {}),
  };

  if (layer.type === 'text') {
    const content = layer.binding
      ? (bindings[layer.binding] ?? '')
      : (layerOverrides[layer.id] ?? layer.text ?? '');
    return <div key={layer.id} id={layer.id} style={base}>{content}</div>;
  }

  if (layer.type === 'rect') {
    return <div key={layer.id} id={layer.id} style={base} />;
  }

  if (layer.type === 'ellipse') {
    return <div key={layer.id} id={layer.id} style={{ ...base, borderRadius: '50%' }} />;
  }

  if (layer.type === 'image') {
    const src = layer.src
      ? (layer.src.startsWith('http') || layer.src.startsWith('data:') || layer.src.startsWith('/')
          ? layer.src
          : `${serverUrl}${layer.src}`)
      : '';
    if (!src) return null;
    return <img key={layer.id} id={layer.id} src={src} alt="" style={base} crossOrigin="anonymous" />;
  }

  return null;
}

/** Convert an object with kebab-case CSS keys to React camelCase style keys. */
function kebabToCamel(styleObj) {
  const result = {};
  for (const [key, value] of Object.entries(styleObj)) {
    const camel = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    result[camel] = value;
  }
  return result;
}

/** Built-in animation keyframes injected by the editor and renderer — included here so
 *  client-side template rendering has the same named animations available. */
const LCYT_KEYFRAMES = `
@keyframes lcyt-fadeIn    { from { opacity:0 } to { opacity:1 } }
@keyframes lcyt-fadeOut   { from { opacity:1 } to { opacity:0 } }
@keyframes lcyt-slideInLeft  { from { transform:translateX(-100%) } to { transform:translateX(0) } }
@keyframes lcyt-slideInRight { from { transform:translateX(100%)  } to { transform:translateX(0) } }
@keyframes lcyt-slideInUp    { from { transform:translateY(100%)  } to { transform:translateY(0) } }
@keyframes lcyt-slideInDown  { from { transform:translateY(-100%) } to { transform:translateY(0) } }
@keyframes lcyt-slideOutLeft  { from { transform:translateX(0) } to { transform:translateX(-100%) } }
@keyframes lcyt-slideOutRight { from { transform:translateX(0) } to { transform:translateX(100%) } }
@keyframes lcyt-zoomIn  { from { transform:scale(0);   opacity:0 } to { transform:scale(1);   opacity:1 } }
@keyframes lcyt-zoomOut { from { transform:scale(1);   opacity:1 } to { transform:scale(0);   opacity:0 } }
@keyframes lcyt-pulse   { 0%,100% { transform:scale(1) } 50% { transform:scale(1.05) } }
@keyframes lcyt-blink   { 0%,100% { opacity:1 } 50% { opacity:0 } }
@keyframes lcyt-typewriter { from { clip-path:inset(0 100% 0 0) } to { clip-path:inset(0 0% 0 0) } }
`;
