import { useState, useRef, useEffect, useCallback } from 'react';
import { AppProviders } from './contexts/AppProviders';
import { useSessionContext } from './contexts/SessionContext';
import { useFileContext } from './contexts/FileContext';
import { useLang } from './contexts/LangContext';
import { StatusBar } from './components/StatusBar';
import { ControlsPanel } from './components/ControlsPanel';
import { PrivacyModal } from './components/PrivacyModal';
import { DropZone } from './components/DropZone';
import { FileTabs } from './components/FileTabs';
import { CaptionView } from './components/CaptionView';
import { SentPanel } from './components/SentPanel';
import { InputBar } from './components/InputBar';
import { AudioPanel } from './components/AudioPanel';
import { ToastContainer } from './components/ToastContainer';
import { MobileAudioBar } from './components/MobileAudioBar';

// Persistent banner shown when the backend cannot be reached
function NetworkBanner({ privacyPending }) {
  const { healthStatus, checkHealth, connected, getAutoConnect, getPersistedConfig, connect } = useSessionContext();
  const { t } = useLang();

  const retry = useCallback(async () => {
    const cfg = getPersistedConfig();
    const ok = await checkHealth(cfg.backendUrl);
    if (ok && getAutoConnect() && cfg.backendUrl && cfg.apiKey) {
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
const DEFAULT_RIGHT_PANEL_W = 400; // px — initial right-panel width on first load
const MIN_PANEL_W = 200;           // px — minimum width for either panel

export function AppLayout() {
  const session = useSessionContext();
  const fileStore = useFileContext();

  const [controlsOpen, setControlsOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [privacyRequireAcceptance, setPrivacyRequireAcceptance] = useState(false);
  const [dropZoneVisible, setDropZoneVisible] = useState(true);
  const [micListening, setMicListening] = useState(false);
  const [micHolding, setMicHolding] = useState(false);
  const [leftPanelH, setLeftPanelH] = useState(null);
  const [rightPanelW, setRightPanelW] = useState(() => {
    try {
      const v = parseInt(localStorage.getItem('lcyt:sent-panel-w'), 10);
      return v > 0 ? v : null;
    } catch { return null; }
  });
  const rightPanelWRef = useRef(rightPanelW);
  const [utteranceActive, setUtteranceActive] = useState(false);
  const [utteranceTimerRunning, setUtteranceTimerRunning] = useState(false);
  const [utteranceTimerSec, setUtteranceTimerSec] = useState(0);
  const [mobileInterimText, setMobileInterimText] = useState('');
  const [mobileUtteranceEndEnabled, setMobileUtteranceEndEnabled] = useState(
    () => { try { return localStorage.getItem('lcyt:utterance-end-button') === '1'; } catch { return false; } }
  );
  const [micHoldToSpeak, setMicHoldToSpeak] = useState(
    () => { try { return localStorage.getItem('lcyt:hold-to-speak') === '1'; } catch { return false; } }
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
        setSettingsOpen(v => !v);
        return;
      }

      // Ctrl+1..9 / Cmd+1..9 — switch to file tab by index
      if ((e.ctrlKey || e.metaKey) && e.key >= '1' && e.key <= '9') {
        const idx = parseInt(e.key, 10) - 1;
        const targetFile = fileStore.files[idx];
        if (targetFile) {
          e.preventDefault();
          fileStore.setActive(targetFile.id);
        }
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
      if (ok && session.getAutoConnect() && cfg.apiKey) {
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
      try { setMicHoldToSpeak(localStorage.getItem('lcyt:hold-to-speak') === '1'); } catch {}
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

  function handleInterimChange(text) {
    setMobileInterimText(text);
  }

  // Keep ref in sync so resize closures always read the latest value
  useEffect(() => { rightPanelWRef.current = rightPanelW; }, [rightPanelW]);

  function onResizePointerDown(e) {
    e.preventDefault();
    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);

    if (isMobile) {
      // Vertical resize of left panel
      const startY = e.clientY;
      const startH = document.getElementById('left-panel')?.getBoundingClientRect().height || 0;
      function onMoveV(me) { setLeftPanelH(Math.max(80, startH + (me.clientY - startY))); }
      function onUpV() {
        window.removeEventListener('pointermove', onMoveV);
        window.removeEventListener('pointerup', onUpV);
        window.removeEventListener('pointercancel', onUpV);
      }
      window.addEventListener('pointermove', onMoveV);
      window.addEventListener('pointerup', onUpV);
      window.addEventListener('pointercancel', onUpV);
    } else {
      // Horizontal resize of right panel
      const startX = e.clientX;
      const startW = rightPanelWRef.current
        ?? document.getElementById('right-panel')?.getBoundingClientRect().width
        ?? DEFAULT_RIGHT_PANEL_W;
      function onMoveH(me) {
        const delta = startX - me.clientX;
        const newW = Math.max(MIN_PANEL_W, Math.min(window.innerWidth - MIN_PANEL_W, startW + delta));
        setRightPanelW(newW);
        try { localStorage.setItem('lcyt:sent-panel-w', String(Math.round(newW))); } catch {}
      }
      function onUpH() {
        window.removeEventListener('pointermove', onMoveH);
        window.removeEventListener('pointerup', onUpH);
        window.removeEventListener('pointercancel', onUpH);
      }
      window.addEventListener('pointermove', onMoveH);
      window.addEventListener('pointerup', onUpH);
      window.addEventListener('pointercancel', onUpH);
    }
  }

  return (
    <div className="captions-page">
      <StatusBar
        onControlsOpen={() => setControlsOpen(true)}
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
            onInterimChange={handleInterimChange}
            extraMeterCanvasRef={mobileBarMeterRef}
          />
        </div>

        {/* Drag-resize handle — ew-resize on desktop, ns-resize on mobile */}
        <div
          className="panel-resize-handle"
          onPointerDown={onResizePointerDown}
          aria-hidden="true"
        />

        {/* Right panel — always visible in scroll flow */}
        <div
          id="right-panel"
          className="panel panel--right"
          style={rightPanelW != null ? { width: rightPanelW, flexShrink: 0 } : undefined}
        >
          <SentPanel />
        </div>
      </main>

      {/* Desktop footer — input bar only */}
      <footer id="footer">
        <InputBar ref={inputBarRef} />
      </footer>

      {/* Mobile fixed bottom bar — meter | mic | prev | send | next */}
      <MobileAudioBar
        fileStore={fileStore}
        session={session}
        micListening={micListening}
        micHolding={micHolding}
        micHoldToSpeak={micHoldToSpeak}
        mobileInterimText={mobileInterimText}
        mobileUtteranceEndEnabled={mobileUtteranceEndEnabled}
        utteranceActive={utteranceActive}
        utteranceTimerRunning={utteranceTimerRunning}
        utteranceTimerSec={utteranceTimerSec}
        mobileBarMeterRef={mobileBarMeterRef}
        audioPanelRef={audioPanelRef}
        inputBarRef={inputBarRef}
      />

      {controlsOpen && <ControlsPanel onClose={() => setControlsOpen(false)} />}
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
