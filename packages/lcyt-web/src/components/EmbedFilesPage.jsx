/**
 * EmbedFilesPage — full file-management caption widget for iframe embedding.
 *
 * Rendered when lcyt-web is opened at /embed/files
 *
 * Combines the complete file management UI from the main app:
 *   • FileTabs  — tab bar, file picker, drop-zone toggle
 *   • DropZone  — drag-and-drop file loading (collapsible)
 *   • CaptionView — scrollable line list with pointer, raw edit mode
 *   • InputBar  — caption text input, batch mode, keyboard shortcuts
 *   • SentPanel — delivery log (togglable via header button)
 *
 * The session (backend relay connection) is owned by this widget.
 * Session token and caption texts are broadcast via BroadcastChannel ('lcyt-embed')
 * so a sibling EmbedSentLogPage on the same host page can subscribe.
 *
 * Keyboard shortcuts (same as main app):
 *   Enter       — send current caption
 *   ↑ / ↓       — move file pointer up / down
 *   Page Up/Down — jump 10 lines
 *   Home / End  — jump to first / last line
 *   Tab         — cycle to next file tab
 *
 * URL params:
 *   ?server=https://api.example.com   Backend URL
 *   &apikey=YOUR_KEY                  LCYT API key
 *   &theme=dark|light                 UI theme (default: dark)
 *   &sentlog=0                        Hide the sent log panel by default (default: shown)
 *
 * Host page usage:
 *   <iframe
 *     src="https://your-lcyt-host/embed/files?server=...&apikey=..."
 *     style="width:100%; height:600px; border:none;">
 *   </iframe>
 */

import { useEffect, useRef, useState } from 'react';
import { AppProviders } from '../contexts/AppProviders';
import { FileTabs } from './FileTabs';
import { DropZone } from './DropZone';
import { CaptionView } from './CaptionView';
import { InputBar } from './InputBar';
import { SentPanel } from './SentPanel';
import { useFileContext } from '../contexts/FileContext';
import { useSessionContext } from '../contexts/SessionContext';

// ─── Inner layout (needs access to contexts) ─────────────────────────────────

function FilesLayout({ defaultSentLogVisible }) {
  const fileStore = useFileContext();
  const session   = useSessionContext();

  const inputBarRef    = useRef(null);
  const [dropZoneVisible,  setDropZoneVisible]  = useState(true);
  const [sentLogVisible,   setSentLogVisible]   = useState(defaultSentLogVisible);

  // Auto-collapse drop zone once a file is loaded (mirrors main App behaviour)
  useEffect(() => {
    if (fileStore.files.length > 0) setDropZoneVisible(false);
  }, [fileStore.files.length]);

  // Wire CaptionView line double-click → InputBar.sendText
  function handleLineSend(text, fileId, lineIndex) {
    inputBarRef.current?.sendText(text, fileId, lineIndex);
  }

  // Global keyboard shortcuts (mirrors main App shortcuts)
  useEffect(() => {
    function onKey(e) {
      // Don't intercept while a text field or dialog is focused
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const inDialog = document.activeElement?.closest('dialog, .settings-modal__box');
      if (inDialog) return;

      const file = fileStore.activeFile;

      switch (e.key) {
        case 'Enter':
          e.preventDefault();
          inputBarRef.current?.triggerSend();
          inputBarRef.current?.focus();
          break;
        case 'ArrowUp':
          e.preventDefault();
          if (file) fileStore.setPointer(file.id, file.pointer - 1);
          break;
        case 'ArrowDown':
          e.preventDefault();
          if (file) fileStore.advancePointer(file.id);
          break;
        case 'PageUp':
          e.preventDefault();
          if (file) fileStore.setPointer(file.id, file.pointer - 10);
          break;
        case 'PageDown':
          e.preventDefault();
          if (file) fileStore.setPointer(file.id, file.pointer + 10);
          break;
        case 'Home':
          e.preventDefault();
          if (file) fileStore.setPointer(file.id, 0);
          break;
        case 'End':
          e.preventDefault();
          if (file) fileStore.setPointer(file.id, file.lines.length - 1);
          break;
        case 'Tab':
          e.preventDefault();
          fileStore.cycleActive();
          break;
        default:
          break;
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [fileStore]);

  const dotColor = session.connected
    ? 'var(--color-success, #4caf50)'
    : 'var(--color-muted, #666)';

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* Toolbar: connection dot + sent-log toggle */}
      <div style={toolbarStyle}>
        <span style={{ ...connDotStyle, background: dotColor }} title={session.connected ? 'Connected' : 'Disconnected'} />
        <FileTabs
          dropZoneVisible={dropZoneVisible}
          onToggleDropZone={() => setDropZoneVisible(v => !v)}
        />
        <button
          style={{ ...sentLogToggleStyle, opacity: sentLogVisible ? 1 : 0.5 }}
          onClick={() => setSentLogVisible(v => !v)}
          title={sentLogVisible ? 'Hide sent log' : 'Show sent log'}
        >
          ✓✓
        </button>
      </div>

      {/* Drop zone (collapsible) */}
      <DropZone visible={dropZoneVisible} />

      {/* Caption file view — fills remaining space */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <CaptionView onLineSend={handleLineSend} />
      </div>

      {/* Input bar */}
      <InputBar ref={inputBarRef} />

      {/* Sent log (togglable) */}
      {sentLogVisible && (
        <div style={sentLogPanelStyle}>
          <SentPanel />
        </div>
      )}

    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export function EmbedFilesPage() {
  const params     = new URLSearchParams(window.location.search);
  const backendUrl = params.get('server') || '';
  const apiKey     = params.get('apikey') || '';
  const theme      = params.get('theme')  || 'dark';
  const defaultSentLogVisible = params.get('sentlog') !== '0';

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, []);

  return (
    <AppProviders
      initConfig={{ backendUrl, apiKey }}
      autoConnect={!!(backendUrl && apiKey)}
      embed
    >
      <FilesLayout defaultSentLogVisible={defaultSentLogVisible} />
    </AppProviders>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const toolbarStyle = {
  display:    'flex',
  alignItems: 'center',
  gap:        '6px',
  padding:    '0 6px',
  flexShrink: 0,
  borderBottom: '1px solid var(--color-border, #333)',
};

const connDotStyle = {
  width:        8,
  height:       8,
  borderRadius: '50%',
  flexShrink:   0,
};

const sentLogToggleStyle = {
  marginLeft: 'auto',
  background: 'none',
  border:     'none',
  cursor:     'pointer',
  color:      'inherit',
  fontSize:   '0.85em',
  padding:    '4px 6px',
  flexShrink: 0,
};

const sentLogPanelStyle = {
  flexShrink: 0,
  height:     '220px',
  borderTop:  '1px solid var(--color-border, #333)',
  overflow:   'hidden',
  display:    'flex',
  flexDirection: 'column',
};
