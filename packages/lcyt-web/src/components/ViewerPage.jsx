/**
 * ViewerPage — full-page live caption viewer.
 *
 * Rendered when lcyt-web is opened at /view/<key>
 *
 * Connects to the backend SSE endpoint GET /viewer/<key> and displays
 * incoming captions as large overlaid text, suitable for a dedicated
 * viewer screen or browser-source overlay.
 *
 * URL structure:
 *   /view/<key>?server=https://api.example.com&theme=dark|light&fontsize=2.5
 *
 * URL params:
 *   server    Backend URL (required — no captions shown without it)
 *   theme     dark|light (default: dark)
 *   fontsize  Font size in rem (default: 2.5)
 */

import { useState, useEffect, useRef } from 'react';

const RECONNECT_DELAY_MS = 3000;

/**
 * Safely render caption text that may contain <br> separators (used for
 * original + translation composition by the backend). Splits on <br> and
 * renders each segment as a plain text node with React <br /> elements —
 * no dangerouslySetInnerHTML and no risk of XSS.
 */
function CaptionText({ text, style }) {
  const parts = text.split(/<br\s*\/?>/i);
  return (
    <p style={style}>
      {parts.map((part, i) => (
        <span key={i}>
          {part}
          {i < parts.length - 1 && <br />}
        </span>
      ))}
    </p>
  );
}

export function ViewerPage() {
  // Extract viewer key from pathname: /view/<key>
  const segments = window.location.pathname.split('/').filter(Boolean);
  const viewerKey = segments[1] || '';

  const params     = new URLSearchParams(window.location.search);
  const backendUrl = (params.get('server') || '').replace(/\/$/, '');
  const theme      = params.get('theme')    || 'dark';
  const fontSize   = parseFloat(params.get('fontsize') || '2.5') || 2.5;

  const [text,      setText]      = useState('');
  const [connected, setConnected] = useState(false);
  const [error,     setError]     = useState('');

  const esRef        = useRef(null);
  const reconnectRef = useRef(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.title = viewerKey ? `Live Captions — ${viewerKey}` : 'Live Captions';
  }, [theme, viewerKey]);

  useEffect(() => {
    if (!viewerKey || !backendUrl) {
      setError(!viewerKey ? 'No viewer key in URL.' : 'No backend URL. Add ?server=<url> to the address.');
      return;
    }

    if (!/^[a-zA-Z0-9_-]{3,}$/.test(viewerKey)) {
      setError('Invalid viewer key in URL.');
      return;
    }

    let cancelled = false;

    function open() {
      if (cancelled) return;
      const url = `${backendUrl}/viewer/${encodeURIComponent(viewerKey)}`;
      const es = new EventSource(url);
      esRef.current = es;

      es.addEventListener('connected', () => {
        if (cancelled) return;
        setConnected(true);
        setError('');
      });

      es.addEventListener('caption', (e) => {
        if (cancelled) return;
        try {
          const data = JSON.parse(e.data);
          if (data.text) setText(data.text);
        } catch {}
      });

      es.onerror = () => {
        if (cancelled) return;
        setConnected(false);
        es.close();
        reconnectRef.current = setTimeout(open, RECONNECT_DELAY_MS);
      };
    }

    open();

    return () => {
      cancelled = true;
      clearTimeout(reconnectRef.current);
      esRef.current?.close();
    };
  }, [viewerKey, backendUrl]);

  return (
    <div style={rootStyle(theme)}>
      {/* Status dot */}
      <div style={statusStyle}>
        <span style={{ ...dotStyle, background: connected ? '#4caf50' : '#888' }} />
        {!connected && <span style={{ color: '#888', fontSize: '0.75rem' }}>
          {error || 'Connecting…'}
        </span>}
      </div>

      {/* Caption text */}
      <div style={captionAreaStyle}>
        {text && (
          <CaptionText
            text={text}
            style={{ ...captionTextStyle, fontSize: `${fontSize}rem` }}
          />
        )}
      </div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function rootStyle(theme) {
  return {
    height:          '100vh',
    display:         'flex',
    flexDirection:   'column',
    background:      theme === 'light' ? '#fff' : '#000',
    color:           theme === 'light' ? '#111' : '#fff',
    fontFamily:      'system-ui, sans-serif',
    overflow:        'hidden',
    position:        'relative',
  };
}

const statusStyle = {
  position:   'absolute',
  top:        8,
  right:      10,
  display:    'flex',
  alignItems: 'center',
  gap:        6,
  zIndex:     10,
};

const dotStyle = {
  width:        8,
  height:       8,
  borderRadius: '50%',
  flexShrink:   0,
};

const captionAreaStyle = {
  flex:           1,
  display:        'flex',
  alignItems:     'flex-end',
  justifyContent: 'center',
  padding:        '1rem 2rem 2.5rem',
  textAlign:      'center',
};

const captionTextStyle = {
  margin:     0,
  lineHeight: 1.35,
  fontWeight: 600,
  textShadow: '0 2px 8px rgba(0,0,0,0.7)',
  wordBreak:  'break-word',
};
