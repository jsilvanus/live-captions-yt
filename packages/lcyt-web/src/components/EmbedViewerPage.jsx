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
 *   &server=https://api.lcyt.fi   Backend URL (default: https://api.lcyt.fi)
 *   &theme=dark|light             UI theme (default: dark)
 *   &fontsize=1.1                 Caption font size in rem (default: 1.1)
 *   &maxentries=50                Max caption history entries to keep (default: 50)
 *   &lang=fi-FI                   Show specific translation; 'original' for raw text;
 *                                 'all' to show every language in each entry (default: composed text)
 *
 * Host page usage:
 *   <iframe
 *     src="https://your-lcyt-host/embed/viewer?key=myevent&theme=dark"
 *     style="width:100%; height:300px; border:none;">
 *   </iframe>
 */

import { useState, useEffect, useRef } from 'react';
import { resolveViewerText, collectLangTexts } from '../lib/viewerUtils.js';
import { formatTime } from '../lib/formatting';

const RECONNECT_DELAY_MS = 3000;
const DEFAULT_MAX_ENTRIES = 50;
const DEFAULT_BACKEND     = 'https://api.lcyt.fi';

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
  const params     = new URLSearchParams(window.location.search);
  const viewerKey  = params.get('key')        || '';
  const backendUrl = (params.get('server') || DEFAULT_BACKEND).replace(/\/$/, '');
  const theme      = params.get('theme')       || 'dark';
  const fontSize   = parseFloat(params.get('fontsize') || '1.1') || 1.1;
  const maxEntries = parseInt(params.get('maxentries') || String(DEFAULT_MAX_ENTRIES), 10) || DEFAULT_MAX_ENTRIES;
  // lang: '', 'original', 'fi-FI', 'all'
  const lang       = params.get('lang') || '';
  const showAll    = lang === 'all';

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
    if (!viewerKey) {
      setError('No viewer key. Add ?key=<key> to the URL.');
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

          // Build the entry object
          const section = data.codes?.section || '';

          const entry = {
            id:        data.sequence ?? Date.now(),
            text:      showAll ? null : resolveViewerText(data, lang),
            langTexts: showAll ? collectLangTexts(data) : null,
            section,
            timestamp: data.timestamp || new Date().toISOString(),
          };

          // Skip blank entries
          if (!showAll && !entry.text) return;

          setEntries(prev => [...prev, entry].slice(-maxEntries));
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
  }, [viewerKey, backendUrl, lang, showAll, maxEntries]);

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
            <div style={metaStyle}>
              <span style={timeStyle}>{formatTime(entry.timestamp)}</span>
              {entry.section && <span style={sectionStyle}>{entry.section}</span>}
            </div>
            {showAll && entry.langTexts ? (
              /* Multi-language: one row per language */
              <div style={{ flex: 1 }}>
                {Object.entries(entry.langTexts).map(([l, t]) => (
                  t ? (
                    <div key={l} style={langRowStyle}>
                      <span style={langLabelStyle}>{l === 'original' ? 'orig' : l}</span>
                      <CaptionText text={t} style={{ ...textStyle, fontSize: `${fontSize}rem` }} />
                    </div>
                  ) : null
                ))}
              </div>
            ) : (
              <CaptionText
                text={entry.text || ''}
                style={{ ...textStyle, fontSize: `${fontSize}rem` }}
              />
            )}
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
  alignItems: 'flex-start',
  gap:        '8px',
  padding:    '4px 10px',
};

const metaStyle = {
  display:    'flex',
  flexDirection: 'column',
  alignItems: 'flex-end',
  flexShrink: 0,
  gap:        2,
};

const timeStyle = {
  color:    'var(--color-muted, #888)',
  fontSize: '0.75rem',
};

const sectionStyle = {
  color:         'var(--color-muted, #888)',
  fontSize:      '0.65rem',
  fontWeight:    600,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  maxWidth:      '6em',
  overflow:      'hidden',
  textOverflow:  'ellipsis',
  whiteSpace:    'nowrap',
};

const textStyle = {
  flex:      1,
  margin:    0,
  wordBreak: 'break-word',
};

const langRowStyle = {
  display:    'flex',
  alignItems: 'baseline',
  gap:        6,
  marginBottom: 2,
};

const langLabelStyle = {
  color:         'var(--color-muted, #888)',
  fontSize:      '0.65rem',
  fontWeight:    600,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  flexShrink:    0,
  minWidth:      '3.5em',
};
