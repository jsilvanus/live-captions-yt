import { useSessionContext } from '../../contexts/SessionContext';
import { KEYS } from '../../lib/storageKeys.js';

function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

export function StatusPopover({ onClose }) {
  const { connected, healthStatus, backendUrl, sequence, syncOffset, startedAt, latencyMs } = useSessionContext();

  const targets = (() => {
    try { return JSON.parse(localStorage.getItem(KEYS.targets.list) || '[]'); } catch { return []; }
  })();
  const batchInterval = (() => {
    try { return parseInt(localStorage.getItem(KEYS.captions.batchInterval) || '0', 10); } catch { return 0; }
  })();
  const translations = (() => {
    try { return JSON.parse(localStorage.getItem(KEYS.translation.list) || '[]'); } catch { return []; }
  })();

  const enabledTargets = targets.filter(t => t.enabled);
  const ytTargets = enabledTargets.filter(t => t.type === 'youtube');
  const viewerTargets = enabledTargets.filter(t => t.type === 'viewer');
  const genericTargets = enabledTargets.filter(t => t.type === 'generic');
  const enabledTranslations = translations.filter(t => t.enabled);

  const uptimeStr = startedAt ? formatUptime(Date.now() - new Date(startedAt).getTime()) : null;

  return (
    <div className="status-popover">
      <div className="status-popover__section">
        <div className="status-popover__label">Backend</div>
        <div className={`status-popover__value status-popover__value--${connected ? 'ok' : healthStatus}`}>
          {connected ? 'Connected' : healthStatus === 'ok' ? 'Reachable' : healthStatus === 'unreachable' ? 'Unreachable' : 'Unknown'}
          {latencyMs != null && <span className="status-popover__latency"> {latencyMs}ms</span>}
        </div>
        {backendUrl && <div className="status-popover__sub">{backendUrl}</div>}
      </div>

      {connected && (
        <div className="status-popover__section">
          <div className="status-popover__label">Session</div>
          <div className="status-popover__value">seq #{sequence}</div>
          {syncOffset !== 0 && <div className="status-popover__sub">offset {syncOffset > 0 ? '+' : ''}{syncOffset}ms</div>}
          {uptimeStr && <div className="status-popover__sub">up {uptimeStr}</div>}
        </div>
      )}

      {enabledTargets.length > 0 && (
        <div className="status-popover__section">
          <div className="status-popover__label">Targets</div>
          {ytTargets.length > 0 && <div className="status-popover__value" aria-label={`YouTube targets: ${ytTargets.length}`}><span aria-hidden="true">▶</span> YouTube ×{ytTargets.length}</div>}
          {viewerTargets.length > 0 && <div className="status-popover__value" aria-label={`Viewer targets: ${viewerTargets.length}`}><span aria-hidden="true">👁</span> Viewer ×{viewerTargets.length}</div>}
          {genericTargets.length > 0 && <div className="status-popover__value" aria-label={`Generic targets: ${genericTargets.length}`}><span aria-hidden="true">⚡</span> Generic ×{genericTargets.length}</div>}
        </div>
      )}

      {batchInterval > 0 && (
        <div className="status-popover__section">
          <div className="status-popover__label">Batch</div>
          <div className="status-popover__value">On · {batchInterval}ms window</div>
        </div>
      )}

      {enabledTranslations.length > 0 && (
        <div className="status-popover__section">
          <div className="status-popover__label">Translations</div>
          <div className="status-popover__value">{enabledTranslations.map(t => t.lang).join(', ')}</div>
        </div>
      )}
    </div>
  );
}
