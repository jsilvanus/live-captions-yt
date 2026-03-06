import { useState, useEffect, useMemo } from 'react';
import { FloatingPanel } from './FloatingPanel';
import { StatsModal } from './StatsModal';
import { FilesModal } from './FilesModal';
import { useSessionContext } from '../contexts/SessionContext';
import { useToastContext } from '../contexts/ToastContext';
import { useLang } from '../contexts/LangContext';
import { getEnabledTargets } from '../lib/targetConfig';
import { getEnabledTranslations } from '../lib/translationConfig';

export function StatusPanel({ onClose }) {
  const session = useSessionContext();
  const { showToast } = useToastContext();
  const { t } = useLang();

  const [lastConnectedTime, setLastConnectedTime] = useState(null);
  const [statsOpen, setStatsOpen] = useState(false);
  const [statsData, setStatsData] = useState(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const [relayExpanded, setRelayExpanded] = useState(false);
  const [targetsExpanded, setTargetsExpanded] = useState(false);
  const [relayStatus, setRelayStatus] = useState(null);

  useEffect(() => {
    if (session.connected) setLastConnectedTime(Date.now());
  }, [session.connected]);

  // Load relay status when connected
  useEffect(() => {
    if (!session.connected) { setRelayStatus(null); return; }
    let cancelled = false;
    session.getRelayStatus()
      .then(s => { if (!cancelled) setRelayStatus(s); })
      .catch(err => {
        if (!cancelled) {
          setRelayStatus(null);
          console.debug('[StatusPanel] Could not fetch relay status:', err?.message);
        }
      });
    return () => { cancelled = true; };
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

  const enabledTargets = useMemo(() => getEnabledTargets(), []);
  const enabledTranslations = useMemo(() => getEnabledTranslations(), []);
  const runningRelays = useMemo(
    () => relayStatus?.relays?.filter(r => relayStatus.runningSlots?.includes(r.slot)) ?? [],
    [relayStatus]
  );

  return (
    <>
      <FloatingPanel title={t('statusBar.status')} onClose={onClose}>
        {/* ── Connection ── */}
        <div className="settings-status-row">
          <span className="settings-status-row__label">{t('settings.status.connection')}</span>
          <span
            className="settings-status-row__value"
            style={{ color: session.connected ? 'var(--color-success)' : 'var(--color-text-dim)' }}
          >
            {session.connected ? t('settings.status.connected') : t('settings.status.disconnected')}
          </span>
        </div>

        {session.connected && (
          <>
            <div className="settings-status-row">
              <span className="settings-status-row__label">{t('settings.status.sequence')}</span>
              <span className="settings-status-row__value">{session.sequence}</span>
            </div>
            {session.syncOffset !== 0 && (
              <div className="settings-status-row">
                <span className="settings-status-row__label">{t('settings.status.syncOffset')}</span>
                <span className="settings-status-row__value">{session.syncOffset}ms</span>
              </div>
            )}
          </>
        )}

        {!session.connected && lastConnectedTime && (
          <div className="settings-status-row">
            <span className="settings-status-row__label">{t('settings.status.lastConnected')}</span>
            <span className="settings-status-row__value">
              {new Date(lastConnectedTime).toLocaleTimeString()}
            </span>
          </div>
        )}

        {/* ── Caption targets (collapsible) ── */}
        {enabledTargets.length > 0 && (
          <div style={{ marginTop: 6 }}>
            <button
              className="status-collapsible-btn"
              onClick={() => setTargetsExpanded(v => !v)}
            >
              {targetsExpanded ? '▾' : '▸'} {t('settings.status.captionTargets')} ({enabledTargets.length})
            </button>
            {targetsExpanded && (
              <div className="status-collapsible-body">
                {enabledTargets.map(tgt => (
                  <div key={tgt.id} className="status-collapsible-item">
                    <span className="status-collapsible-item__type">{tgt.type === 'youtube' ? '▶ YT' : '⬡'}</span>
                    <span className="status-collapsible-item__label">
                      {tgt.type === 'youtube' ? (tgt.streamKey?.slice(0, 8) + '…') : (tgt.url || '—')}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── RTMP relay targets (collapsible) ── */}
        {session.connected && relayStatus?.active && runningRelays.length > 0 && (
          <div style={{ marginTop: 6 }}>
            <button
              className="status-collapsible-btn"
              onClick={() => setRelayExpanded(v => !v)}
            >
              {relayExpanded ? '▾' : '▸'} {t('settings.status.rtmpRelays')} ({runningRelays.length})
            </button>
            {relayExpanded && (
              <div className="status-collapsible-body">
                {runningRelays.map(r => (
                  <div key={r.slot} className="status-collapsible-item">
                    <span className="status-collapsible-item__type">📡 {r.slot}</span>
                    <span className="status-collapsible-item__label">
                      {r.targetName ? `${r.targetUrl}/${r.targetName}` : r.targetUrl}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Translations active ── */}
        {enabledTranslations.length > 0 && (
          <div className="settings-status-row" style={{ marginTop: 4 }}>
            <span className="settings-status-row__label">{t('settings.status.translations')}</span>
            <span className="settings-status-row__value" style={{ color: 'var(--color-accent)' }}>
              {enabledTranslations.map(tr => tr.lang).join(', ')}
            </span>
          </div>
        )}

        <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
          <button
            className="btn btn--secondary btn--sm"
            onClick={handleGetStats}
            disabled={statsLoading || !session.connected}
          >
            {statsLoading ? '…' : t('settings.status.statsButton')}
          </button>
          <button
            className="btn btn--secondary btn--sm"
            onClick={() => setFilesOpen(true)}
            disabled={!session.connected}
          >
            {t('settings.status.filesButton')}
          </button>
        </div>
      </FloatingPanel>
      <StatsModal isOpen={statsOpen} onClose={() => setStatsOpen(false)} stats={statsData} />
      <FilesModal isOpen={filesOpen} onClose={() => setFilesOpen(false)} />
    </>
  );
}
