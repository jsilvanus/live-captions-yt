import { useState, useEffect } from 'react';
import { useSessionContext } from '../contexts/SessionContext';
import { useToastContext } from '../contexts/ToastContext';

export function StatusBar({ onSettingsOpen, onToggleRightPanel }) {
  const { connected, sequence, syncOffset, sync } = useSessionContext();
  const { showToast } = useToastContext();
  const [error, setError] = useState(null);
  const [errorTimer, setErrorTimer] = useState(null);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  useEffect(() => {
    function checkWidth() { setIsMobile(window.innerWidth <= 768); }
    window.addEventListener('resize', checkWidth);
    return () => window.removeEventListener('resize', checkWidth);
  }, []);

  // Clear error when we connect
  useEffect(() => {
    if (connected) setError(null);
  }, [connected]);

  function showError(msg, autoDismiss = true) {
    setError(msg);
    if (errorTimer) clearTimeout(errorTimer);
    if (autoDismiss) {
      const t = setTimeout(() => setError(null), 5000);
      setErrorTimer(t);
    }
  }

  async function handleSync() {
    if (!connected) return;
    try {
      const data = await sync();
      showToast(`Synced (${data.syncOffset}ms)`, 'success', 2000);
    } catch (err) {
      showError(err.message);
    }
  }

  return (
    <header className="status-bar">
      <span className="status-bar__brand">lcyt-web</span>
      <span className={`status-bar__dot${connected ? ' status-bar__dot--connected' : ''}`} />
      <span className="status-bar__label">{connected ? 'Connected' : 'Disconnected'}</span>
      <span className="status-bar__label" style={{ marginLeft: 8 }}>Seq:</span>
      <span className="status-bar__value">{connected ? sequence : '—'}</span>
      <span className="status-bar__label" style={{ marginLeft: 8 }}>Offset:</span>
      <span className="status-bar__value">{connected ? `${syncOffset}ms` : '—'}</span>
      {error && <span className="status-bar__error">{error}</span>}
      <span className="status-bar__spacer" />
      <button className="status-bar__btn" onClick={handleSync} title="Clock sync">⟳ Sync</button>
      {isMobile && (
        <button
          className="status-bar__btn status-bar__btn--icon"
          onClick={onToggleRightPanel}
          title="Toggle sent panel"
        >▦</button>
      )}
      <button
        className="status-bar__btn status-bar__btn--icon"
        onClick={onSettingsOpen}
        title="Settings (Ctrl+,)"
      >⚙</button>
    </header>
  );
}
