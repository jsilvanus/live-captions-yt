/**
 * EmbedSentLogPage — standalone sent-captions log widget for iframe embedding.
 *
 * Rendered when lcyt-web is opened at /embed/sentlog
 *
 * This widget does NOT start its own backend session. Instead it subscribes to
 * events from a sibling EmbedAudioPage or EmbedInputPage on the same host page
 * via two channels:
 *
 *   BroadcastChannel ('lcyt-embed'):
 *     lcyt:session  { token, backendUrl }  — received when sibling connects; triggers
 *                                            opening an independent EventSource to /events
 *     lcyt:caption  { requestId, text, timestamp }  — received when a caption is sent;
 *                                            adds a pending entry to the log
 *
 *   EventSource (/events?token=...):
 *     caption_result  — confirms the pending entry and stamps the sequence number
 *     caption_error   — marks the entry as failed
 *
 * The widget also sends lcyt:request_session on mount so it receives the token even
 * if the sibling was already connected before this iframe loaded.
 *
 * URL params:
 *   ?theme=dark|light   UI theme (default: dark)
 *
 * Host page usage:
 *   <iframe
 *     src="https://your-lcyt-host/embed/sentlog?theme=dark"
 *     style="width:100%; height:300px; border:none;">
 *   </iframe>
 */

import { useState, useEffect, useRef } from 'react';
import { formatTime } from '../lib/formatting';

const CHANNEL    = 'lcyt-embed';
const MAX_ENTRIES = 200;

export function EmbedSentLogPage() {
  const params = new URLSearchParams(window.location.search);
  const theme  = params.get('theme') || 'dark';

  const [entries,   setEntries]   = useState([]);
  const [connected, setConnected] = useState(false);
  const esRef = useRef(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, []);

  function openEventSource(backendUrl, token) {
    esRef.current?.close();
    const es = new EventSource(`${backendUrl}/events?token=${encodeURIComponent(token)}`);
    esRef.current = es;

    es.addEventListener('connected', () => setConnected(true));

    es.addEventListener('caption_result', (e) => {
      const data = JSON.parse(e.data);
      setEntries(prev => prev.map(entry =>
        entry.requestId === data.requestId
          ? { ...entry, pending: false, sequence: data.sequence }
          : entry
      ));
    });

    es.addEventListener('caption_error', (e) => {
      const data = JSON.parse(e.data);
      setEntries(prev => prev.map(entry =>
        entry.requestId === data.requestId
          ? { ...entry, pending: false, error: true }
          : entry
      ));
    });

    es.addEventListener('session_closed', () => {
      setConnected(false);
      es.close();
    });

    es.onerror = () => setConnected(false);
  }

  useEffect(() => {
    const ch = new BroadcastChannel(CHANNEL);

    ch.onmessage = (ev) => {
      const { type, ...data } = ev.data || {};

      if (type === 'lcyt:session') {
        setConnected(false);
        setEntries([]);
        openEventSource(data.backendUrl, data.token);
      }

      if (type === 'lcyt:caption') {
        setEntries(prev => [
          {
            requestId: data.requestId,
            text:      data.text,
            timestamp: data.timestamp,
            pending:   true,
            error:     false,
            sequence:  null,
          },
          ...prev,
        ].slice(0, MAX_ENTRIES));
      }
    };

    // Ask any already-connected sibling to re-broadcast its session token.
    ch.postMessage({ type: 'lcyt:request_session' });

    return () => {
      ch.close();
      esRef.current?.close();
    };
  }, []);

  return (
    <div style={rootStyle}>
      <div style={headerStyle}>
        <span style={{ ...dotStyle, background: connected ? 'var(--color-success, #4caf50)' : 'var(--color-muted, #666)' }} />
        <span>Sent Captions</span>
      </div>
      <ul style={listStyle}>
        {entries.map((entry) => (
          <li key={entry.requestId} style={itemStyle(entry)}>
            <span style={seqStyle}>
              {entry.pending ? '?' : entry.error ? '✕' : `#${entry.sequence}`}
            </span>
            <span style={ticksStyle(entry)}>
              {entry.pending ? '✓' : entry.error ? '✗' : '✓✓'}
            </span>
            <span style={timeStyle}>{formatTime(entry.timestamp)}</span>
            <span style={textStyle}>{entry.text}</span>
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
  fontSize:      '13px',
  overflow:      'hidden',
};

const headerStyle = {
  padding:      '6px 10px',
  borderBottom: '1px solid var(--color-border, #333)',
  display:      'flex',
  alignItems:   'center',
  gap:          '6px',
  flexShrink:   0,
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

function itemStyle(entry) {
  return {
    display:    'flex',
    alignItems: 'baseline',
    gap:        '6px',
    padding:    '3px 10px',
    opacity:    entry.pending ? 0.6 : 1,
    color:      entry.error ? 'var(--color-error, #e57373)' : 'var(--color-text, inherit)',
  };
}

const seqStyle = {
  color:      'var(--color-muted, #888)',
  minWidth:   '2.5em',
  textAlign:  'right',
  flexShrink: 0,
};

function ticksStyle(entry) {
  return {
    color: entry.error   ? 'var(--color-error,   #e57373)'
         : entry.pending ? 'var(--color-muted,   #888)'
         :                 'var(--color-success, #4caf50)',
    flexShrink: 0,
  };
}

const timeStyle = {
  color:      'var(--color-muted, #888)',
  flexShrink: 0,
};

const textStyle = {
  flex:         1,
  overflow:     'hidden',
  textOverflow: 'ellipsis',
  whiteSpace:   'nowrap',
};
