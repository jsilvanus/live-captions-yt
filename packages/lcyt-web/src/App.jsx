import { useState, useRef, useEffect } from 'react';
import { AppProviders } from './contexts/AppProviders';
import { useSessionContext } from './contexts/SessionContext';
import { useFileContext } from './contexts/FileContext';
import { StatusBar } from './components/StatusBar';
import { SettingsModal } from './components/SettingsModal';
import { PrivacyModal } from './components/PrivacyModal';
import { DropZone } from './components/DropZone';
import { FileTabs } from './components/FileTabs';
import { CaptionView } from './components/CaptionView';
import { SentPanel } from './components/SentPanel';
import { InputBar } from './components/InputBar';
import { AudioPanel } from './components/AudioPanel';
import { ToastContainer } from './components/ToastContainer';

// Floating action button — sends current caption line on mobile
function SendLineFAB({ inputBarRef }) {
  const { activeFile } = useFileContext();
  const [side, setSide] = useState(
    () => { try { return localStorage.getItem('lcyt:fabSide') || 'right'; } catch { return 'right'; } }
  );
  useEffect(() => {
    function onCfg() { setSide(localStorage.getItem('lcyt:fabSide') || 'right'); }
    window.addEventListener('lcyt:stt-config-changed', onCfg);
    return () => window.removeEventListener('lcyt:stt-config-changed', onCfg);
  }, []);
  if (!activeFile) return null;
  return (
    <button
      className={`send-fab send-fab--${side}`}
      onClick={() => inputBarRef.current?.triggerSend()}
      title="Send current line"
    >►</button>
  );
}

// Inner app that has access to all contexts
function AppLayout() {
  const session = useSessionContext();
  const fileStore = useFileContext();

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [audioOpen, setAudioOpen] = useState(false);
  const [dropZoneVisible, setDropZoneVisible] = useState(true);

  const inputBarRef = useRef(null);

  // Global keyboard shortcuts
  useEffect(() => {
    function onKeyDown(e) {
      // Ctrl+, / Cmd+, — toggle settings
      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault();
        setSettingsOpen(v => !v);
        return;
      }

      // Don't intercept when a text input or dialog is focused
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
          return;
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
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [fileStore]);

  // Auto-connect on startup
  useEffect(() => {
    if (session.getAutoConnect()) {
      const cfg = session.getPersistedConfig();
      if (cfg.backendUrl && cfg.apiKey && cfg.streamKey) {
        session.connect(cfg).catch(() => {});
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleLineSend(text, fileId, lineIndex) {
    inputBarRef.current?.sendText(text, fileId, lineIndex);
  }

  return (
    <div id="app">
      <StatusBar
        onSettingsOpen={() => setSettingsOpen(true)}
        onPrivacyOpen={() => setPrivacyOpen(true)}
      />

      <main id="main">
        {/* Left panel */}
        <div id="left-panel" className="panel panel--left">
          <DropZone visible={dropZoneVisible} />
          <FileTabs
            dropZoneVisible={dropZoneVisible}
            onToggleDropZone={() => setDropZoneVisible(v => !v)}
          />
          <CaptionView onLineSend={handleLineSend} />
          <AudioPanel visible={audioOpen} />
        </div>

        {/* Right panel — always visible in scroll flow */}
        <div id="right-panel" className="panel panel--right">
          <SentPanel />
        </div>
      </main>

      {/* Desktop footer */}
      <footer id="footer">
        <InputBar ref={inputBarRef} />
        <button
          className={`footer__audio-btn${audioOpen ? ' footer__audio-btn--active' : ''}`}
          onClick={() => setAudioOpen(v => !v)}
          title="Toggle microphone / STT"
        >🎵</button>
      </footer>

      {/* Mobile fixed bottom bar */}
      <div id="mobile-audio-bar">
        <button
          className={`footer__audio-btn${audioOpen ? ' footer__audio-btn--active' : ''}`}
          onClick={() => setAudioOpen(v => !v)}
          title="Toggle microphone / STT"
        >🎵 Audio</button>
      </div>

      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <PrivacyModal isOpen={privacyOpen} onClose={() => setPrivacyOpen(false)} />
      <ToastContainer />
      <SendLineFAB inputBarRef={inputBarRef} />
    </div>
  );
}

export function App() {
  return (
    <AppProviders>
      <AppLayout />
    </AppProviders>
  );
}
