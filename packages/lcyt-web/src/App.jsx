import { useState, useRef, useEffect, useCallback } from 'react';
import { AppProviders } from './contexts/AppProviders';
import { useSessionContext } from './contexts/SessionContext';
import { useFileContext } from './contexts/FileContext';
import { useLang } from './contexts/LangContext';
import { StatusBar } from './components/StatusBar';
import { GeneralModal } from './components/GeneralModal';
import { CaptionsModal } from './components/CaptionsModal';
import { TranslationModal } from './components/TranslationModal';
import { StatusPanel } from './components/StatusPanel';
import { ActionsPanel } from './components/ActionsPanel';
import { PrivacyModal } from './components/PrivacyModal';
import { DropZone } from './components/DropZone';
import { FileTabs } from './components/FileTabs';
import { CaptionView } from './components/CaptionView';
import { SentPanel } from './components/SentPanel';
import { InputBar } from './components/InputBar';
import { AudioPanel } from './components/AudioPanel';
import { ToastContainer } from './components/ToastContainer';

// Persistent banner shown when the backend cannot be reached
function NetworkBanner({ privacyPending }) {
  const { healthStatus, checkHealth, connected, getAutoConnect, getPersistedConfig, connect } = useSessionContext();
  const { t } = useLang();

  const retry = useCallback(async () => {
    const cfg = getPersistedConfig();
    const ok = await checkHealth(cfg.backendUrl);
    if (ok && getAutoConnect() && cfg.backendUrl && cfg.apiKey && cfg.streamKey) {
      connect(cfg).catch(() => {});
    }
  }, [checkHealth, getAutoConnect, getPersistedConfig, connect]);

  // Auto-retry every 30 s while unreachable (only after privacy modal is accepted)
  useEffect(() => {
    if (healthStatus !== 'unreachable' || privacyPending) return;
    const id = setInterval(retry, 30_000);
    return () => clearInterval(id);
  }, [healthStatus, retry, privacyPending]);

  if (connected || healthStatus !== 'unreachable') return null;

  return (
    <div className="network-banner" role="alert">
      <span className="network-banner__icon">⚠</span>
      <span className="network-banner__msg">{t('networkBanner.message')}</span>
      <button className="network-banner__btn" onClick={retry}>{t('networkBanner.retry')}</button>
    </div>
  );
}

// Inner app that has access to all contexts
function AppLayout() {
  const session = useSessionContext();
  const fileStore = useFileContext();

  const [generalOpen, setGeneralOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [captionOpen, setCaptionOpen] = useState(false);
  const [translationOpen, setTranslationOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [privacyRequireAcceptance, setPrivacyRequireAcceptance] = useState(false);
  const [dropZoneVisible, setDropZoneVisible] = useState(true);
  const [micListening, setMicListening] = useState(false);
  const [micHolding, setMicHolding] = useState(false);
  const [leftPanelH, setLeftPanelH] = useState(null);
  const [utteranceActive, setUtteranceActive] = useState(false);
  const [utteranceTimerRunning, setUtteranceTimerRunning] = useState(false);
  const [utteranceTimerSec, setUtteranceTimerSec] = useState(0);
  const [mobileUtteranceEndEnabled, setMobileUtteranceEndEnabled] = useState(
    () => { try { return localStorage.getItem('lcyt:utterance-end-button') === '1'; } catch { return false; } }
  );

  const inputBarRef = useRef(null);
  const audioPanelRef = useRef(null);
  const mobileBarMeterRef = useRef(null);

  // Global keyboard shortcuts
  useEffect(() => {
    function onKeyDown(e) {
      // Ctrl+, / Cmd+, — toggle settings
      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault();
        setGeneralOpen(v => !v);
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

  // Auto-open privacy modal on first visit (before user has accepted)
  useEffect(() => {
    try {
      if (!localStorage.getItem('lcyt:privacyAccepted')) {
        setPrivacyOpen(true);
        setPrivacyRequireAcceptance(true);
      }
    } catch {}
  }, []);

  // Health check on startup; auto-connect only if backend is reachable
  useEffect(() => {
    const cfg = session.getPersistedConfig();
    if (!cfg.backendUrl) return;
    session.checkHealth(cfg.backendUrl).then(ok => {
      if (ok && session.getAutoConnect() && cfg.apiKey && cfg.streamKey) {
        session.connect(cfg).catch(() => {});
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-collapse drop zone on mobile after first file loads
  useEffect(() => {
    if (fileStore.files.length > 0 && window.matchMedia('(max-width: 768px)').matches) {
      setDropZoneVisible(false);
    }
  }, [fileStore.files.length]);

  // Sync mobile utterance-end button setting when settings change
  useEffect(() => {
    function onCfgChange() {
      try { setMobileUtteranceEndEnabled(localStorage.getItem('lcyt:utterance-end-button') === '1'); } catch {}
    }
    window.addEventListener('lcyt:stt-config-changed', onCfgChange);
    return () => window.removeEventListener('lcyt:stt-config-changed', onCfgChange);
  }, []);

  function handlePrivacyOpen() {
    setPrivacyRequireAcceptance(false);
    setPrivacyOpen(true);
  }

  function handlePrivacyAccept() {
    try { localStorage.setItem('lcyt:privacyAccepted', '1'); } catch {}
    setPrivacyRequireAcceptance(false);
    setPrivacyOpen(false);
  }

  function handleLineSend(text, fileId, lineIndex) {
    inputBarRef.current?.sendText(text, fileId, lineIndex);
  }

  function handleUtteranceChange(active, timerRunning, timerSec) {
    setUtteranceActive(active);
    setUtteranceTimerRunning(timerRunning);
    setUtteranceTimerSec(timerSec);
  }

  function onResizePointerDown(e) {
    e.preventDefault();
    const startY = e.clientY;
    const startH = document.getElementById('left-panel')?.getBoundingClientRect().height || 0;
    function onMove(me) { setLeftPanelH(Math.max(80, startH + (me.clientY - startY))); }
    function onUp() {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    }
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  return (
    <div id="app">
      <StatusBar
        onGeneralOpen={() => setGeneralOpen(true)}
        onStatusOpen={() => setStatusOpen(true)}
        onActionsOpen={() => setActionsOpen(true)}
        onCaptionOpen={() => setCaptionOpen(true)}
        onTranslationOpen={() => setTranslationOpen(true)}
        onPrivacyOpen={handlePrivacyOpen}
      />
      <NetworkBanner privacyPending={privacyOpen && privacyRequireAcceptance} />

      <main id="main">
        {/* Left panel */}
        <div id="left-panel" className="panel panel--left" style={leftPanelH != null ? { height: leftPanelH } : undefined}>
          <DropZone visible={dropZoneVisible} />
          <FileTabs
            dropZoneVisible={dropZoneVisible}
            onToggleDropZone={() => setDropZoneVisible(v => !v)}
          />
          <CaptionView onLineSend={handleLineSend} />
          {/* Desktop: always visible. Mobile: hidden via CSS, kept in DOM for STT logic. */}
          <AudioPanel
            ref={audioPanelRef}
            visible={true}
            onListeningChange={setMicListening}
            onHoldingChange={setMicHolding}
            onUtteranceChange={handleUtteranceChange}
            extraMeterCanvasRef={mobileBarMeterRef}
          />
        </div>

        {/* Drag-resize handle — visible only on mobile (CSS hides on desktop) */}
        <div
          className="panel-resize-handle"
          onPointerDown={onResizePointerDown}
          aria-hidden="true"
        />

        {/* Right panel — always visible in scroll flow */}
        <div
          id="right-panel"
          className="panel panel--right"
        >
          <SentPanel />
        </div>
      </main>

      {/* Desktop footer — input bar only */}
      <footer id="footer">
        <InputBar ref={inputBarRef} />
      </footer>

      {/* Mobile fixed bottom bar — meter | mic | prev | send | next */}
      {(() => {
        const file = fileStore.activeFile;
        const hasFile = !!file;
        const canGoPrev = hasFile && file.pointer > 0;
        const canGoNext = hasFile && file.pointer < file.lines.length - 1;
        const otherHasMic = session.micHolder !== null && session.micHolder !== session.clientId;
        return (
          <div id="mobile-audio-bar">
            <div className="mobile-bar__meter-wrap">
              <canvas
                ref={mobileBarMeterRef}
                className="mobile-bar__meter"
                aria-hidden="true"
              />
              {micListening && mobileUtteranceEndEnabled && (
                <button
                  className={[
                    'audio-meter-end-btn',
                    utteranceActive ? 'audio-meter-end-btn--active' : 'audio-meter-end-btn--idle',
                  ].join(' ')}
                  onClick={utteranceActive ? () => audioPanelRef.current?.utteranceEndClick() : undefined}
                  title={utteranceActive ? 'Force end utterance' : 'Utterance detection active'}
                >🗣</button>
              )}
              {micListening && utteranceTimerRunning && (
                <div
                  className="audio-meter-timer-border"
                  style={{ animationDuration: `${utteranceTimerSec}s` }}
                />
              )}
            </div>
            {otherHasMic ? (
              <button
                className={`mobile-bar__mic-btn mobile-bar__mic-btn--locked${micHolding ? ' mobile-bar__mic-btn--holding' : ''}`}
                onPointerDown={(e) => audioPanelRef.current?.holdStart(e)}
                onPointerUp={() => audioPanelRef.current?.holdEnd()}
                onPointerLeave={() => audioPanelRef.current?.holdEnd()}
                onPointerCancel={() => audioPanelRef.current?.holdEnd()}
                title="Hold to steal the microphone"
              >{micHolding ? '🎙 Hold…' : '🔒 Locked'}</button>
            ) : (
              <button
                className={`mobile-bar__mic-btn${micListening ? ' mobile-bar__mic-btn--active' : ''}`}
                onClick={() => audioPanelRef.current?.toggle()}
                title={micListening ? 'Stop microphone' : 'Start microphone'}
              >{micListening ? '⏹' : '🎙'}</button>
            )}
            <button
              className="mobile-bar__nav-btn"
              onClick={() => fileStore.setPointer(file.id, file.pointer - 1)}
              disabled={!canGoPrev}
              title="Previous line"
            >−</button>
            <button
              className="mobile-bar__send-btn"
              onClick={() => inputBarRef.current?.triggerSend()}
              disabled={!hasFile}
              title="Send current line"
            >►</button>
            <button
              className="mobile-bar__nav-btn"
              onClick={() => fileStore.advancePointer(file.id)}
              disabled={!canGoNext}
              title="Next line"
            >+</button>
          </div>
        );
      })()}

      <GeneralModal isOpen={generalOpen} onClose={() => setGeneralOpen(false)} />
      {captionOpen && <CaptionsModal isOpen={captionOpen} onClose={() => setCaptionOpen(false)} />}
      {translationOpen && <TranslationModal isOpen={translationOpen} onClose={() => setTranslationOpen(false)} />}
      {statusOpen && <StatusPanel onClose={() => setStatusOpen(false)} />}
      {actionsOpen && <ActionsPanel onClose={() => setActionsOpen(false)} />}
      <PrivacyModal
        isOpen={privacyOpen}
        onClose={() => setPrivacyOpen(false)}
        requireAcceptance={privacyRequireAcceptance}
        onAccept={handlePrivacyAccept}
      />
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
