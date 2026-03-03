import { useState, useEffect } from 'react';
import { useSessionContext } from '../contexts/SessionContext';
import { useToastContext } from '../contexts/ToastContext';
import { useLang } from '../contexts/LangContext';

export function StatusBar({ onSettingsOpen, onPrivacyOpen }) {
  const { connected, sequence, syncOffset, sync } = useSessionContext();
  const { showToast } = useToastContext();
  const { t } = useLang();
  const [error, setError] = useState(null);
  const [errorTimer, setErrorTimer] = useState(null);

  // Clear error when we connect
  useEffect(() => {
    if (connected) setError(null);
  }, [connected]);

  function showError(msg, autoDismiss = true) {
    setError(msg);
    if (errorTimer) clearTimeout(errorTimer);
    if (autoDismiss) {
      const timer = setTimeout(() => setError(null), 5000);
      setErrorTimer(timer);
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
    <header id="header" className="status-bar">
      <span className="status-bar__brand">lcyt-web</span>
      <span className={`status-bar__dot${connected ? ' status-bar__dot--connected' : ''}`} />
      <span className="status-bar__label">{connected ? t('statusBar.connected') : t('statusBar.disconnected')}</span>
      <span className="status-bar__label" style={{ marginLeft: 8 }}>{t('statusBar.seq')}</span>
      <span className="status-bar__value">{connected ? sequence : '—'}</span>
      <span className="status-bar__label" style={{ marginLeft: 8 }}>{t('statusBar.offset')}</span>
      <span className="status-bar__value">{connected ? `${syncOffset}ms` : '—'}</span>
      {error && <span className="status-bar__error">{error}</span>}
      <span className="status-bar__spacer" />

      <div className="status-bar__actions">
        <button className="status-bar__btn" onClick={handleSync} title="Clock sync">{t('statusBar.sync')}</button>
        <button className="status-bar__btn" onClick={onPrivacyOpen} title="Privacy">{t('statusBar.privacy')}</button>
        <button
          className="status-bar__btn status-bar__btn--icon"
          onClick={onSettingsOpen}
          title="Settings (Ctrl+,)"
        >⚙</button>
      </div>
    </header>
  );
}
