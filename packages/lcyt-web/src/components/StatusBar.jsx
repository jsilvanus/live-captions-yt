import { useState } from 'react';
import { useSessionContext } from '../contexts/SessionContext';
import { useToastContext } from '../contexts/ToastContext';
import { useLang } from '../contexts/LangContext';

export function StatusBar({ onSettingsOpen, onCCOpen, onControlsOpen, onPrivacyOpen, onBroadcastOpen }) {
  const session = useSessionContext();
  const { showToast } = useToastContext();
  const { t } = useLang();
  const [connecting, setConnecting] = useState(false);

  async function handleConnectClick() {
    if (session.connected) {
      await session.disconnect();
      return;
    }
    const cfg = session.getPersistedConfig();
    if (!cfg.backendUrl || !cfg.apiKey) {
      onSettingsOpen();
      return;
    }
    setConnecting(true);
    try {
      await session.connect(cfg);
    } catch (err) {
      showToast(err?.message || 'Connection failed', 'error');
    } finally {
      setConnecting(false);
    }
  }

  const connectBtnClass = [
    'status-bar__btn',
    session.connected ? 'status-bar__btn--connected' : '',
    connecting ? 'status-bar__btn--connecting' : '',
  ].filter(Boolean).join(' ');

  return (
    <header id="header" className="status-bar">
      <span className="status-bar__brand">lcyt-web</span>
      <span className="status-bar__spacer" />
      <div className="status-bar__actions">
        <button className="status-bar__btn status-bar__btn--icon" onClick={onBroadcastOpen} title="Broadcast">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M21 3H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h5v2h8v-2h5c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 14H3V5h18v12z"/>
          </svg>
        </button>
        <button className={connectBtnClass} onClick={handleConnectClick} disabled={connecting} title={session.connected ? t('statusBar.disconnect') : t('statusBar.connect')}>
          {connecting ? t('settings.footer.connecting') : session.connected ? t('statusBar.disconnect') : t('statusBar.connect')}
        </button>
        <button className="status-bar__btn" onClick={onSettingsOpen} title="Settings">{t('statusBar.settings')}</button>
        <button className="status-bar__btn" onClick={onCCOpen} title="CC">{t('statusBar.cc')}</button>
        <button className="status-bar__btn" onClick={onControlsOpen} title="Controls">{t('statusBar.controls')}</button>
        <button className="status-bar__btn" onClick={onPrivacyOpen} title="Privacy">{t('statusBar.privacy')}</button>
      </div>
    </header>
  );
}
