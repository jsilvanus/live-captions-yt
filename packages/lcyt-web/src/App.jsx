import { useState, useRef, useEffect } from 'react';
import { AppProviders } from './contexts/AppProviders';
import { useSessionContext } from './contexts/SessionContext';
import { useFileContext } from './contexts/FileContext';
import { StatusBar } from './components/StatusBar';
import { SettingsModal } from './components/SettingsModal';
import { DropZone } from './components/DropZone';
import { FileTabs } from './components/FileTabs';
import { CaptionView } from './components/CaptionView';
import { SentPanel } from './components/SentPanel';
import { InputBar } from './components/InputBar';
import { AudioPanel } from './components/AudioPanel';
import { ToastContainer } from './components/ToastContainer';

// Inner app that has access to all contexts
function AppLayout() {
  const session = useSessionContext();
  const fileStore = useFileContext();

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [currentView, setCurrentView] = useState('captions');
  const [dropZoneVisible, setDropZoneVisible] = useState(true);
  const [rightPanelVisible, setRightPanelVisible] = useState(false);

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
        onToggleRightPanel={() => setRightPanelVisible(v => !v)}
      />

      <main id="main">
        {/* Left panel */}
        <div id="left-panel" className="panel panel--left">
          {currentView !== 'audio' && (
            <DropZone visible={dropZoneVisible} />
          )}
          <FileTabs
            currentView={currentView}
            onViewChange={setCurrentView}
            dropZoneVisible={dropZoneVisible}
            onToggleDropZone={() => setDropZoneVisible(v => !v)}
          />
          <CaptionView
            onLineSend={handleLineSend}
            style={{ display: currentView === 'captions' ? '' : 'none' }}
          />
          <AudioPanel visible={currentView === 'audio'} />
        </div>

        {/* Right panel */}
        <div id="right-panel" className={`panel panel--right${rightPanelVisible ? ' panel--right-visible' : ''}`}>
          <SentPanel />
        </div>
      </main>

      <footer id="footer">
        <InputBar ref={inputBarRef} />
      </footer>

      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <ToastContainer />
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
