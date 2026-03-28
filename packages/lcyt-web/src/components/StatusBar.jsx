import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { useSessionContext } from '../contexts/SessionContext';
import { useToastContext } from '../contexts/ToastContext';
import { useLang } from '../contexts/LangContext';
import { MusicChip } from './MusicChip';

const STT_POLL_INTERVAL_MS = 10_000;

export function StatusBar({ onControlsOpen, onPrivacyOpen, onSettingsOpen, onCCOpen }) {
  const [, navigate] = useLocation();
  const session = useSessionContext();
  const { showToast } = useToastContext();
  const { t } = useLang();
  const [connecting, setConnecting] = useState(false);
  const [sttStatus, setSttStatus] = useState(null);

  // Poll /stt/status while connected
  useEffect(() => {
    if (!session.connected) {
      setSttStatus(null);
      return;
    }
    let cancelled = false;
    async function poll() {
      try {
        const s = await session.getSttStatus();
        if (!cancelled) setSttStatus(s);
      } catch {
        if (!cancelled) setSttStatus(null);
      }
    }
    poll();
    const id = setInterval(poll, STT_POLL_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [session.connected, session.getSttStatus]);

  async function handleConnectClick() {
    if (session.connected) {
      await session.disconnect();
      return;
    }
    const cfg = session.getPersistedConfig();
    if (!cfg.backendUrl || !cfg.apiKey) {
      if (onSettingsOpen) onSettingsOpen();
      else navigate('/settings');
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

  const sttChipLabel = sttStatus?.running
    ? `STT: ${sttStatus.provider}${sttStatus.mode ? `/${sttStatus.mode}` : ''} / ${sttStatus.language}`
    : null;

  return (
    <header id="header" className="status-bar">
      <span className="status-bar__brand">lcyt-web</span>
      {sttChipLabel && (
        <button
          className="status-bar__stt-chip status-bar__stt-chip--active"
          title="Server STT active — click to configure"
          onClick={onCCOpen ?? (() => navigate('/settings?tab=cc'))}
        >
          {sttChipLabel}
        </button>
      )}
      <MusicChip onClick={onCCOpen ?? (() => navigate('/settings?tab=cc'))} />
      <span className="status-bar__spacer" />
      <div className="status-bar__actions">
        <button className="status-bar__btn status-bar__btn--icon" onClick={() => navigate('/broadcast')} title="Broadcast">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M21 3H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h5v2h8v-2h5c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 14H3V5h18v12z"/>
          </svg>
        </button>
        <button className={connectBtnClass} onClick={handleConnectClick} disabled={connecting} title={session.connected ? t('statusBar.disconnect') : t('statusBar.connect')}>
          {connecting ? t('settings.footer.connecting') : session.connected ? t('statusBar.disconnect') : t('statusBar.connect')}
        </button>
        <button className="status-bar__btn" onClick={onSettingsOpen ?? (() => navigate('/settings'))} title="Settings">{t('statusBar.settings')}</button>
        <button className="status-bar__btn" onClick={onCCOpen ?? (() => navigate('/settings?tab=cc'))} title="CC">{t('statusBar.cc')}</button>
        <button className="status-bar__btn" onClick={onControlsOpen} title="Controls">{t('statusBar.controls')}</button>
        <button className="status-bar__btn" onClick={onPrivacyOpen} title="Privacy">{t('statusBar.privacy')}</button>
      </div>
    </header>
  );
}
