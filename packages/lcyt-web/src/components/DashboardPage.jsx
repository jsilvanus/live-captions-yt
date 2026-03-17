import { Link } from 'wouter';
import { useSessionContext } from '../contexts/SessionContext';
import { useSentLogContext } from '../contexts/SentLogContext';

// ─── Status card ─────────────────────────────────────────────────────────────

function StatusCard() {
  const { connected, backendUrl, sequence, syncOffset, healthStatus } = useSessionContext();

  const dotClass = connected
    ? 'dashboard-dot dashboard-dot--ok'
    : healthStatus === 'unreachable'
      ? 'dashboard-dot dashboard-dot--error'
      : 'dashboard-dot dashboard-dot--idle';

  return (
    <div className="dashboard-card">
      <div className="dashboard-card__header">
        <span className="dashboard-card__title">Status</span>
      </div>
      <div className="dashboard-card__body">
        <div className="dashboard-stat-row">
          <span className={dotClass} />
          <span className="dashboard-stat-row__value">
            {connected ? 'Connected' : 'Not connected'}
          </span>
        </div>
        {backendUrl && (
          <div className="dashboard-stat-row">
            <span className="dashboard-stat-row__label">Server</span>
            <span className="dashboard-stat-row__value dashboard-stat-row__value--truncated">
              {backendUrl.replace(/^https?:\/\//, '')}
            </span>
          </div>
        )}
        {connected && (
          <>
            <div className="dashboard-stat-row">
              <span className="dashboard-stat-row__label">Sequence</span>
              <span className="dashboard-stat-row__value">#{sequence}</span>
            </div>
            <div className="dashboard-stat-row">
              <span className="dashboard-stat-row__label">Sync offset</span>
              <span className="dashboard-stat-row__value">{syncOffset > 0 ? '+' : ''}{syncOffset} ms</span>
            </div>
          </>
        )}
        {!connected && (
          <div className="dashboard-connect-hint">
            <Link href="/settings" className="dashboard-empty__btn dashboard-empty__btn--primary">
              ⚙ Settings
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Sent log card ────────────────────────────────────────────────────────────

function SentLogCard() {
  const { entries } = useSentLogContext();
  const recent = entries.slice(0, 8);

  return (
    <div className="dashboard-card">
      <div className="dashboard-card__header">
        <span className="dashboard-card__title">Recent Captions</span>
        <Link href="/captions" className="dashboard-card__see-all">
          All →
        </Link>
      </div>
      <div className="dashboard-card__body">
        {recent.length === 0 ? (
          <span className="dashboard-empty-note">No captions sent yet.</span>
        ) : (
          recent.map(entry => (
            <div key={entry.requestId} className="dashboard-sent-entry">
              <span className="dashboard-sent-entry__status">
                {entry.pending ? '⏳' : entry.error ? '✗' : '✓'}
              </span>
              <span className="dashboard-sent-entry__text">{entry.text}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Quick links card ─────────────────────────────────────────────────────────

function QuickLinksCard() {
  const links = [
    { label: '✏️  Captions',        path: '/captions' },
    { label: '🎤  Audio / STT',      path: '/audio' },
    { label: '📡  Broadcast',        path: '/broadcast' },
    { label: '🖼️  DSK Editor',       path: '/graphics/editor' },
    { label: '🎬  Production',       path: '/production' },
    { label: '📁  Projects',         path: '/projects' },
  ];

  return (
    <div className="dashboard-card">
      <div className="dashboard-card__header">
        <span className="dashboard-card__title">Quick Links</span>
      </div>
      <div className="dashboard-card__body dashboard-card__body--links">
        {links.map(({ label, path }) => (
          <Link
            key={path}
            href={path}
            className="dashboard-quick-link"
          >
            {label}
          </Link>
        ))}
      </div>
    </div>
  );
}

// ─── DashboardPage ────────────────────────────────────────────────────────────

export function DashboardPage() {
  return (
    <div className="dashboard-page">
      <div className="dashboard-page__header">
        <h1 className="dashboard-page__title">Dashboard</h1>
      </div>
      <div className="dashboard-grid">
        <StatusCard />
        <SentLogCard />
        <QuickLinksCard />
      </div>
    </div>
  );
}
