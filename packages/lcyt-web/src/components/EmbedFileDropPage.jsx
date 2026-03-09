/**
 * EmbedFileDropPage — minimal file-drop caption sender widget.
 *
 * Rendered when lcyt-web is opened at /embed/file-drop
 *
 * Phase 1 — Drop zone: shows a large drag-and-drop target (or click to browse).
 *            Accepts one .txt caption file at a time.
 * Phase 2 — Player: displays the current line prominently with Prev / Send / Next
 *            controls. Send delivers the line to YouTube via the backend relay and
 *            advances the pointer. Arrow keys and Enter work for hands-free operation.
 *
 * URL params:
 *   ?server=https://api.example.com   Backend URL
 *   &apikey=YOUR_KEY                  LCYT API key
 *   &theme=dark|light                 UI theme (default: dark)
 *
 * Host page usage:
 *   <iframe
 *     src="https://your-lcyt-host/embed/file-drop?server=...&apikey=..."
 *     style="width:100%; height:300px; border:none;">
 *   </iframe>
 */

import { useEffect, useState, useRef } from 'react';
import { AppProviders } from '../contexts/AppProviders';
import { DropZone } from './DropZone';
import { useFileContext } from '../contexts/FileContext';
import { useSessionContext } from '../contexts/SessionContext';

// ─── Inner layout (needs access to contexts) ─────────────────────────────────

function FileDropLayout() {
  const fileStore = useFileContext();
  const session   = useSessionContext();
  const file      = fileStore.activeFile;

  const [sendState, setSendState] = useState('idle'); // 'idle' | 'sending' | 'sent' | 'error'
  const [errorMsg,  setErrorMsg]  = useState('');
  const sendStateRef = useRef('idle');

  function flashSend(state, msg = '') {
    sendStateRef.current = state;
    setSendState(state);
    setErrorMsg(msg);
    if (state !== 'idle') {
      setTimeout(() => {
        if (sendStateRef.current === state) {
          sendStateRef.current = 'idle';
          setSendState('idle');
          setErrorMsg('');
        }
      }, state === 'error' ? 2500 : 400);
    }
  }

  async function handleSend() {
    if (!file || file.lines.length === 0) return;
    if (!session.connected) { flashSend('error', 'Not connected'); return; }
    if (sendState === 'sending') return;

    const text = file.lines[file.pointer];
    if (!text) { fileStore.advancePointer(file.id); return; }

    flashSend('sending');
    try {
      await session.send(text);
      flashSend('sent');
      fileStore.advancePointer(file.id);
    } catch (err) {
      flashSend('error', err.message || 'Send failed');
    }
  }

  // Keyboard navigation
  useEffect(() => {
    function onKey(e) {
      if (!file || file.lines.length === 0) return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON') return;
      if (e.key === 'ArrowUp')   { e.preventDefault(); fileStore.setPointer(file.id, file.pointer - 1); }
      if (e.key === 'ArrowDown') { e.preventDefault(); fileStore.advancePointer(file.id); }
      if (e.key === 'Enter')     { e.preventDefault(); handleSend(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // no deps — always reads latest file/session from context

  // ── Phase 1: Drop zone ──────────────────────────────────────────────────────

  if (!file || file.lines.length === 0) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <DropZone visible />
      </div>
    );
  }

  // ── Phase 2: Player ─────────────────────────────────────────────────────────

  const currentLine = file.lines[file.pointer] ?? '';
  const isFirst     = file.pointer === 0;
  const isLast      = file.pointer >= file.lines.length - 1;
  const progress    = `${file.pointer + 1} / ${file.lines.length}`;
  const dotColor    = session.connected ? 'var(--color-success, #4caf50)' : 'var(--color-muted, #666)';

  const sendBtnBg =
    sendState === 'sent'    ? 'var(--color-success, #4caf50)' :
    sendState === 'error'   ? 'var(--color-error,   #e57373)' :
    sendState === 'sending' ? 'var(--color-muted,   #555)'    :
                              'var(--color-primary, #1976d2)';

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* Header */}
      <div style={headerStyle}>
        <span style={{ ...connDotStyle, background: dotColor }} />
        <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {file.name}
        </span>
        <span style={{ color: 'var(--color-muted, #888)', fontSize: '0.85em', flexShrink: 0 }}>
          {progress}
        </span>
        <button
          style={resetBtnStyle}
          onClick={() => fileStore.removeFile(file.id)}
          title="Load a different file"
        >
          ✕ reset
        </button>
      </div>

      {/* Current line */}
      <div style={lineAreaStyle}>
        {currentLine
          ? <span style={lineTextStyle}>{currentLine}</span>
          : <span style={{ color: 'var(--color-muted, #888)', fontStyle: 'italic' }}>— empty line —</span>
        }
      </div>

      {/* Error */}
      {errorMsg && (
        <div style={errorBarStyle}>{errorMsg}</div>
      )}

      {/* Controls */}
      <div style={controlsStyle}>
        <button style={navBtnStyle} onClick={() => fileStore.setPointer(file.id, file.pointer - 1)} disabled={isFirst} title="Previous line (↑)">◀</button>
        <button
          style={{ ...sendBtnStyle, background: sendBtnBg }}
          onClick={handleSend}
          disabled={sendState === 'sending'}
          title="Send and advance (Enter)"
        >
          {sendState === 'sending' ? '…'
           : sendState === 'sent'  ? '✓ Sent'
           : sendState === 'error' ? '✗ Error'
           : 'Send'}
        </button>
        <button style={navBtnStyle} onClick={() => fileStore.advancePointer(file.id)} disabled={isLast} title="Next line (↓)">▶</button>
      </div>

    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export function EmbedFileDropPage() {
  const params     = new URLSearchParams(window.location.search);
  const backendUrl = params.get('server') || 'https://api.lcyt.fi';
  const apiKey     = params.get('apikey') || '';
  const theme      = params.get('theme')  || 'dark';

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, []);

  return (
    <AppProviders
      initConfig={{ backendUrl, apiKey }}
      autoConnect={!!apiKey}
      embed
    >
      <div style={{ height: '100vh', overflow: 'hidden' }}>
        <FileDropLayout />
      </div>
    </AppProviders>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const headerStyle = {
  display:    'flex',
  alignItems: 'center',
  gap:        '8px',
  padding:    '8px 12px',
  borderBottom: '1px solid var(--color-border, #333)',
  flexShrink: 0,
  fontSize:   '13px',
  minWidth:   0,
};

const connDotStyle = {
  width:        8,
  height:       8,
  borderRadius: '50%',
  flexShrink:   0,
};

const resetBtnStyle = {
  marginLeft: 'auto',
  background: 'none',
  border:     'none',
  cursor:     'pointer',
  color:      'var(--color-muted, #888)',
  fontSize:   '0.8em',
  padding:    '2px 4px',
  flexShrink: 0,
};

const lineAreaStyle = {
  flex:           1,
  display:        'flex',
  alignItems:     'center',
  justifyContent: 'center',
  padding:        '16px 20px',
  overflowY:      'auto',
};

const lineTextStyle = {
  fontSize:   '1.3em',
  lineHeight: 1.5,
  textAlign:  'center',
  wordBreak:  'break-word',
};

const errorBarStyle = {
  background: 'var(--color-error-bg, rgba(229,115,115,.15))',
  color:      'var(--color-error, #e57373)',
  padding:    '6px 12px',
  fontSize:   '12px',
  flexShrink: 0,
};

const controlsStyle = {
  display:        'flex',
  alignItems:     'center',
  justifyContent: 'center',
  gap:            '8px',
  padding:        '10px 12px',
  borderTop:      '1px solid var(--color-border, #333)',
  flexShrink:     0,
};

const navBtnStyle = {
  padding:      '8px 14px',
  background:   'var(--color-surface2, #2a2a2a)',
  border:       '1px solid var(--color-border, #444)',
  borderRadius: '4px',
  cursor:       'pointer',
  color:        'inherit',
  fontSize:     '1em',
};

const sendBtnStyle = {
  padding:      '8px 28px',
  border:       'none',
  borderRadius: '4px',
  cursor:       'pointer',
  color:        '#fff',
  fontWeight:   600,
  fontSize:     '1em',
  minWidth:     '90px',
  transition:   'background 0.15s',
};
