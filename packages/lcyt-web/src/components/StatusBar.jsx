import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { useSessionContext } from '../contexts/SessionContext';
import { useToastContext } from '../contexts/ToastContext';
import { useLang } from '../contexts/LangContext';
import { MusicChip } from './MusicChip';
import { readPersistedSessionConfig, savePersistedSessionConfig } from '../lib/projectSession.js';

const STT_POLL_INTERVAL_MS = 10_000;

export function StatusBar({ onControlsOpen, onSettingsOpen, onCCOpen }) {
  const [, navigate] = useLocation();
  const session = useSessionContext();
  const { showToast } = useToastContext();
  const { t } = useLang();
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

  async function handleLeaveProject() {
    await session.disconnect();
    const cfg = readPersistedSessionConfig();
    const next = { ...cfg };
    delete next.projectAccessToken;
    delete next.projectId;
    delete next.apiKey;
    savePersistedSessionConfig(next);
    showToast('Left project', 'info');
    navigate('/');
  }

  async function handleLogOut() {
    await session.disconnect();
    session.clearPersistedConfig();
    showToast('Logged out', 'info');
    navigate('/');
  }

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
        <button className="status-bar__btn" onClick={handleLeaveProject} title="Leave project">Leave</button>
        <button className="status-bar__btn" onClick={handleLogOut} title="Log out">Log out</button>
      </div>
    </header>
  );
}
