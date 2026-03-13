import { useEffect, useRef, useState } from 'react';

/**
 * DSK (downstream keyer) display page.
 *
 * URL: /dsk/:apikey
 * Query params:
 *   server=<backendUrl>   Backend URL (falls back to localStorage lcyt-config)
 *   cc=1                  Also render caption text (CC burn-in mode)
 *   bg=<hex>              Override background colour (default: #00B140 chroma green)
 *
 * The page:
 * 1. Fetches GET <server>/dsk/<apikey>/images — pre-loads all images into hidden <img> elements
 * 2. Opens SSE on GET <server>/dsk/<apikey>/events
 * 3. On 'graphics' event: makes the named images visible (zero-latency — already in browser memory)
 * 4. On 'text' event (cc=1): renders the stripped caption text
 * 5. On 'reload' event: re-fetches the image list to pick up newly uploaded images
 * 6. Reconnects SSE with exponential backoff on disconnect
 */
export function DskPage() {
  // ── URL params ──────────────────────────────────────────
  const pathParts = window.location.pathname.split('/');
  // /dsk/<apikey>  →  pathParts[2]
  const apiKey = pathParts[2] || '';

  const params = new URLSearchParams(window.location.search);
  const ccMode  = params.get('cc') === '1';
  const bgColor = params.get('bg') || '#00B140';

  function resolveServer() {
    const fromUrl = params.get('server');
    if (fromUrl) return fromUrl.replace(/\/$/, '');
    try {
      const cfg = JSON.parse(localStorage.getItem('lcyt-config') || '{}');
      return (cfg.backendUrl || '').replace(/\/$/, '');
    } catch { return ''; }
  }
  const serverUrl = resolveServer();

  // ── State ───────────────────────────────────────────────
  const [images, setImages]         = useState([]); // [{ id, shorthand, mimeType, url }]
  // Ordered array from the last <!-- graphics:... --> metacode.
  // Index 0 = bottom-most layer, index N-1 = top-most layer (matches server-side overlay order).
  const [activeNames, setActiveNames] = useState([]); // string[]
  const [ccText, setCcText]         = useState('');
  const [status, setStatus]         = useState('connecting'); // 'connecting' | 'connected' | 'error'

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
        const { names } = JSON.parse(e.data);
        // Preserve metacode order: index 0 = bottom layer, last = top layer
        setActiveNames(Array.isArray(names) ? names : []);
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

  useEffect(() => {
    mounted.current = true;
    fetchImages();
    connect();
    return () => {
      mounted.current = false;
      esRef.current?.close();
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Render ──────────────────────────────────────────────
  if (!serverUrl || !apiKey) {
    return (
      <div style={{ background: bgColor, width: '100vw', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontFamily: 'sans-serif', fontSize: 18 }}>
        Missing API key or server URL. Add <code>?server=https://your-backend</code> to the URL.
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', background: bgColor, overflow: 'hidden' }}>
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

      {/* Active images rendered in metacode order: first name = lowest z-index (bottom layer), last = highest (top layer) */}
      {activeNames.map((name, layerIdx) => {
        const img = images.find(i => i.shorthand === name);
        if (!img) return null;
        return (
          <img
            key={`active-${img.id}`}
            src={`${serverUrl}/images/${img.id}`}
            alt={img.shorthand}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: 'auto',
              zIndex: layerIdx + 1,
              pointerEvents: 'none',
            }}
            crossOrigin="anonymous"
          />
        );
      })}

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

      {/* Status indicator — only visible when not connected and not on green bg */}
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
