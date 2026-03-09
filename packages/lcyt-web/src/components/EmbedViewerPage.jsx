/**
 * EmbedViewerPage — embeddable live caption viewer widget.
 *
 * Rendered when lcyt-web is opened at /embed/viewer
 *
 * Connects to the backend SSE endpoint GET /viewer/<key> and displays
 * incoming captions in a compact, iframe-embeddable format — similar to
 * EmbedSentLogPage but receiving captions from the public viewer SSE stream
 * (no authentication required).
 *
 * URL params:
 *   ?key=<viewerKey>              The viewer key configured in CC → Targets (required)
 *   &server=https://api.lcyt.fi   Backend URL (required)
 *   &theme=dark|light             UI theme (default: dark)
 *   &fontsize=1.1                 Caption font size in rem (default: 1.1)
 *   &maxentries=50                Max caption history entries to keep (default: 50)
 *
 * Host page usage:
 *   <iframe
 *     src="https://your-lcyt-host/embed/viewer?key=myevent&server=https://api.example.com&theme=dark"
 *     style="width:100%; height:300px; border:none;">
 *   </iframe>
 */

import { useState, useEffect, useRef } from 'react';

const RECONNECT_DELAY_MS = 3000;
const DEFAULT_MAX_ENTRIES = 50;

function formatTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    });
  } catch { return '—'; }
}

/**
 * Safely render caption text that may contain <br> separators (used for
 * original + translation composition by the backend). Splits on <br> and
 * renders each segment as a plain text node with React <br /> elements —
 * no dangerouslySetInnerHTML and no risk of XSS.
 */
function CaptionText({ text, style }) {
  const parts = text.split(/<br\s*\/?>/i);
  return (
    <span style={style}>
      {parts.map((part, i) => (
        <span key={i}>
          {part}
          {i < parts.length - 1 && <br />}
        </span>
      ))}
    </span>
  );
}

export function EmbedViewerPage() {
  const params      = new URLSearchParams(window.location.search);
  const viewerKey   = params.get('key')        || '';
  const backendUrl  = (params.get('server') || '').replace(/\/$/, '');
  const theme       = params.get('theme')       || 'dark';
  const fontSize    = parseFloat(params.get('fontsize') || '1.1') || 1.1;
  const maxEntries  = parseInt(params.get('maxentries') || String(DEFAULT_MAX_ENTRIES), 10) || DEFAULT_MAX_ENTRIES;

  const [entries,   setEntries]   = useState([]);
  const [connected, setConnected] = useState(false);
  const [error,     setError]     = useState('');

  const esRef        = useRef(null);
  const reconnectRef = useRef(null);
  const listRef      = useRef(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, []);

  // Auto-scroll to bottom when new entries arrive
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [entries]);

  useEffect(() => {
    if (!viewerKey || !backendUrl) {
      setError(!viewerKey ? 'No viewer key. Add ?key=<key> to the URL.' : 'No backend URL. Add ?server=<url> to the URL.');
      return;
    }

    if (!/^[a-zA-Z0-9_-]{3,}$/.test(viewerKey)) {
      setError('Invalid viewer key.');
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
          if (!data.text) return;
          setEntries(prev => [
            ...prev,
            {
              id:        data.sequence ?? Date.now(),
              text:      data.text,
              timestamp: data.timestamp || new Date().toISOString(),
            },
          ].slice(-maxEntries));
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
  }, [viewerKey, backendUrl, maxEntries]);

  return (
    <div style={rootStyle}>
      <div style={headerStyle}>
        <span style={{ ...dotStyle, background: connected ? 'var(--color-success, #4caf50)' : 'var(--color-muted, #666)' }} />
        <span>Live Captions{viewerKey ? ` — ${viewerKey}` : ''}</span>
        {error && <span style={{ color: 'var(--color-error, #e57373)', marginLeft: 8, fontSize: '0.85em' }}>{error}</span>}
      </div>
      <ul ref={listRef} style={listStyle}>
        {entries.map((entry) => (
          <li key={entry.id} style={itemStyle}>
            <span style={timeStyle}>{formatTime(entry.timestamp)}</span>
            <CaptionText
              text={entry.text}
              style={{ ...textStyle, fontSize: `${fontSize}rem` }}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const rootStyle = {
  height:        '100vh',
  display:       'flex',
  flexDirection: 'column',
  fontFamily:    'system-ui, sans-serif',
  overflow:      'hidden',
};

const headerStyle = {
  padding:      '6px 10px',
  borderBottom: '1px solid var(--color-border, #333)',
  display:      'flex',
  alignItems:   'center',
  gap:          '6px',
  flexShrink:   0,
  fontSize:     '13px',
};

const dotStyle = {
  width:        8,
  height:       8,
  borderRadius: '50%',
  flexShrink:   0,
};

const listStyle = {
  flex:      1,
  overflowY: 'auto',
  listStyle: 'none',
  margin:    0,
  padding:   '4px 0',
};

const itemStyle = {
  display:    'flex',
  alignItems: 'baseline',
  gap:        '8px',
  padding:    '4px 10px',
};

const timeStyle = {
  color:      'var(--color-muted, #888)',
  fontSize:   '0.75rem',
  flexShrink: 0,
};

const textStyle = {
  flex:      1,
  margin:    0,
  wordBreak: 'break-word',
};
