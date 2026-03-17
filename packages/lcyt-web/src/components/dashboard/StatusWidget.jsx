import { useSessionContext } from '../../contexts/SessionContext';
import { getEnabledTargets } from '../../lib/targetConfig';
import { useState, useEffect } from 'react';

export function StatusWidget({ size }) {
  const { connected, backendUrl, sequence, syncOffset, healthStatus, latencyMs, startedAt } = useSessionContext();
  const [targetCount, setTargetCount] = useState(0);

  useEffect(() => {
    setTargetCount(getEnabledTargets().length);
    function onImport() { setTargetCount(getEnabledTargets().length); }
    window.addEventListener('lcyt:settings-imported', onImport);
    return () => window.removeEventListener('lcyt:settings-imported', onImport);
  }, []);

  const dotClass = `db-dot ${connected ? 'db-dot--ok' : healthStatus === 'unreachable' ? 'db-dot--error' : 'db-dot--idle'}`;

  if (size === 'small') {
    return (
      <div className="db-widget db-widget--status-sm">
        <span className={dotClass} />
        <span className="db-widget__value">{connected ? 'Connected' : 'Offline'}</span>
        {connected && latencyMs != null && <span className="db-widget__muted">{latencyMs}ms</span>}
      </div>
    );
  }

  const uptime = startedAt ? formatUptime(Date.now() - new Date(startedAt).getTime()) : null;

  return (
    <div className="db-widget">
      <div className="db-row">
        <span className={dotClass} />
        <span className="db-widget__value">{connected ? 'Connected' : 'Not connected'}</span>
        {latencyMs != null && <span className="db-widget__muted">{latencyMs}ms</span>}
      </div>
      {backendUrl && (
        <div className="db-row">
          <span className="db-widget__label">Server</span>
          <span className="db-widget__value db-widget__value--trunc">{backendUrl.replace(/^https?:\/\//, '')}</span>
        </div>
      )}
      {connected && (
        <>
          <div className="db-row">
            <span className="db-widget__label">Seq</span>
            <span className="db-widget__value">#{sequence}</span>
          </div>
          {syncOffset !== 0 && (
            <div className="db-row">
              <span className="db-widget__label">Offset</span>
              <span className="db-widget__value">{syncOffset > 0 ? '+' : ''}{syncOffset}ms</span>
            </div>
          )}
          {uptime && (
            <div className="db-row">
              <span className="db-widget__label">Uptime</span>
              <span className="db-widget__value">{uptime}</span>
            </div>
          )}
          <div className="db-row">
            <span className="db-widget__label">Targets</span>
            <span className="db-widget__value">{targetCount}</span>
          </div>
        </>
      )}
    </div>
  );
}

function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
