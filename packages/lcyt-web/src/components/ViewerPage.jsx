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
 *   /view/<key>?server=https://api.example.com&theme=dark|light&fontsize=2.5&lang=fi-FI
 *
 * URL params:
 *   server    Backend URL (default: https://api.lcyt.fi)
 *   theme     dark|light (default: dark)
 *   fontsize  Font size in rem (default: 2.5)
 *   lang      Language to display: a BCP-47 code (e.g. fi-FI) shows that translation,
 *             'original' shows the raw original text,
 *             'all' splits the view into one column per language.
 *             Omit (or empty) to show the composed text (original + translation if configured).
 */

import { useState, useEffect, useRef } from 'react';
import { resolveViewerText, collectLangTexts } from '../lib/viewerUtils.js';

const RECONNECT_DELAY_MS = 3000;
const DEFAULT_BACKEND    = 'https://api.lcyt.fi';

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
  const backendUrl = (params.get('server') || DEFAULT_BACKEND).replace(/\/$/, '');
  const theme      = params.get('theme')    || 'dark';
  const fontSize   = parseFloat(params.get('fontsize') || '2.5') || 2.5;
  // lang: '', 'original', 'fi-FI', 'all'
  const lang       = params.get('lang') || '';
  const showAll    = lang === 'all';

  // Single-language display state
  const [text,      setText]      = useState('');
  // Multi-language display state: { original: '...', 'fi-FI': '...', ... }
  const [langTexts, setLangTexts] = useState({});
  // Section badge from codes.section
  const [section,   setSection]   = useState('');
  const [connected, setConnected] = useState(false);
  const [error,     setError]     = useState('');

  const esRef        = useRef(null);
  const reconnectRef = useRef(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.title = viewerKey ? `Live Captions — ${viewerKey}` : 'Live Captions';
  }, [theme, viewerKey]);

  useEffect(() => {
    if (!viewerKey) {
      setError('No viewer key in URL.');
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

          // Update section badge when the code changes
          if (data.codes && 'section' in data.codes) {
            setSection(data.codes.section || '');
          }

          if (showAll) {
            setLangTexts(prev => ({ ...prev, ...collectLangTexts(data) }));
          } else {
            setText(resolveViewerText(data, lang));
          }
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
  }, [viewerKey, backendUrl, lang, showAll]);

  const langEntries = Object.entries(langTexts);

  return (
    <div style={rootStyle(theme)}>
      {/* Section badge — top left */}
      {section && (
        <div style={sectionBadgeStyle}>
          {section}
        </div>
      )}

      {/* Connection status dot — top right */}
      <div style={statusStyle}>
        <span style={{ ...dotStyle, background: connected ? '#4caf50' : '#888' }} />
        {!connected && (
          <span style={{ color: '#888', fontSize: '0.75rem' }}>
            {error || 'Connecting…'}
          </span>
        )}
      </div>

      {showAll ? (
        /* ── Multi-language view: side-by-side columns, one per language ── */
        <div style={multiColContainerStyle}>
          {langEntries.length === 0 && (
            <div style={{ color: '#888', fontSize: '1rem', textAlign: 'center', width: '100%', alignSelf: 'center' }}>
              Waiting for captions…
            </div>
          )}
          {langEntries.map(([l, t]) => (
            <div key={l} style={colStyle(theme, langEntries.length)}>
              <div style={colLabelStyle}>{l === 'original' ? 'Original' : l}</div>
              <div style={colCaptionAreaStyle}>
                {t && <CaptionText text={t} style={{ ...captionTextStyle, fontSize: `${fontSize}rem` }} />}
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* ── Single-caption view ── */
        <div style={captionAreaStyle}>
          {text && (
            <CaptionText
              text={text}
              style={{ ...captionTextStyle, fontSize: `${fontSize}rem` }}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function rootStyle(theme) {
  return {
    height:        '100vh',
    display:       'flex',
    flexDirection: 'column',
    background:    theme === 'light' ? '#fff' : '#000',
    color:         theme === 'light' ? '#111' : '#fff',
    fontFamily:    'system-ui, sans-serif',
    overflow:      'hidden',
    position:      'relative',
  };
}

const sectionBadgeStyle = {
  position:     'absolute',
  top:          8,
  left:         10,
  fontSize:     '0.75rem',
  fontWeight:   600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  opacity:      0.7,
  zIndex:       10,
};

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

const multiColContainerStyle = {
  flex:      1,
  display:   'flex',
  flexDirection: 'row',
  overflow:  'hidden',
};

function colStyle(theme, count) {
  return {
    flex:          1,
    display:       'flex',
    flexDirection: 'column',
    borderRight:   count > 1 ? `1px solid ${theme === 'light' ? '#ddd' : '#333'}` : 'none',
    overflow:      'hidden',
  };
}

const colLabelStyle = {
  padding:    '4px 12px',
  fontSize:   '0.7rem',
  fontWeight: 600,
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  opacity:    0.5,
  flexShrink: 0,
};

const colCaptionAreaStyle = {
  flex:           1,
  display:        'flex',
  alignItems:     'flex-end',
  justifyContent: 'center',
  padding:        '0.5rem 1.5rem 2rem',
  textAlign:      'center',
};
