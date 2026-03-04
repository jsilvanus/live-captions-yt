import { useState, useEffect } from 'react';
import { FloatingPanel } from './FloatingPanel';
import { StatsModal } from './StatsModal';
import { useSessionContext } from '../contexts/SessionContext';
import { useToastContext } from '../contexts/ToastContext';
import { useLang } from '../contexts/LangContext';

export function StatusPanel({ onClose }) {
  const session = useSessionContext();
  const { showToast } = useToastContext();
  const { t } = useLang();

  const [lastConnectedTime, setLastConnectedTime] = useState(null);
  const [statsOpen, setStatsOpen] = useState(false);
  const [statsData, setStatsData] = useState(null);
  const [statsLoading, setStatsLoading] = useState(false);

  useEffect(() => {
    if (session.connected) setLastConnectedTime(Date.now());
  }, [session.connected]);

  async function handleGetStats() {
    if (!session.connected) { showToast(t('settings.actions.notConnected'), 'warning'); return; }
    setStatsLoading(true);
    try {
      const data = await session.getStats();
      setStatsData(data);
      setStatsOpen(true);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setStatsLoading(false);
    }
  }

  return (
    <>
      <FloatingPanel title={t('statusBar.status')} onClose={onClose}>
        <div className="settings-status-row">
          <span className="settings-status-row__label">{t('settings.status.connection')}</span>
          <span
            className="settings-status-row__value"
            style={{ color: session.connected ? 'var(--color-success)' : 'var(--color-text-dim)' }}
          >
            {session.connected ? t('settings.status.connected') : t('settings.status.disconnected')}
          </span>
        </div>
        <div className="settings-status-row">
          <span className="settings-status-row__label">{t('settings.status.backendUrl')}</span>
          <span className="settings-status-row__value">{session.backendUrl || '—'}</span>
        </div>
        <div className="settings-status-row">
          <span className="settings-status-row__label">{t('settings.status.sequence')}</span>
          <span className="settings-status-row__value">{session.connected ? session.sequence : '—'}</span>
        </div>
        <div className="settings-status-row">
          <span className="settings-status-row__label">{t('settings.status.syncOffset')}</span>
          <span className="settings-status-row__value">{session.connected ? `${session.syncOffset}ms` : '—'}</span>
        </div>
        <div className="settings-status-row">
          <span className="settings-status-row__label">{t('settings.status.lastConnected')}</span>
          <span className="settings-status-row__value">
            {lastConnectedTime ? new Date(lastConnectedTime).toLocaleTimeString() : '—'}
          </span>
        </div>
        <div style={{ marginTop: 8 }}>
          <button
            className="btn btn--secondary btn--sm"
            onClick={handleGetStats}
            disabled={statsLoading || !session.connected}
          >
            {statsLoading ? '…' : t('settings.status.statsButton')}
          </button>
        </div>
      </FloatingPanel>
      <StatsModal isOpen={statsOpen} onClose={() => setStatsOpen(false)} stats={statsData} />
    </>
  );
}
