import { useEffect } from 'react';

function fmt(n) {
  return n == null ? '—' : Number(n).toLocaleString();
}

function fmtDate(s) {
  if (!s) return '—';
  try { return new Date(s).toLocaleString(); } catch { return s; }
}

function fmtDuration(ms) {
  if (ms == null) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}

function UsageBar({ used, limit }) {
  if (limit == null) return null;
  const pct = Math.min(100, Math.round((used / limit) * 100));
  return (
    <div className="stats-bar">
      <div className="stats-bar__fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function StatsModal({ isOpen, onClose, stats }) {
  useEffect(() => {
    if (!isOpen) return;
    function onKeyDown(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const isFreeTier = stats &&
    (stats.usage?.dailyLimit !== null || stats.usage?.lifetimeLimit !== null);

  return (
    <div className="settings-modal stats-modal" role="dialog" aria-modal="true" aria-labelledby="stats-title" style={{ zIndex: 110 }}>
      <div className="settings-modal__backdrop" onClick={onClose} />
      <div className="settings-modal__box stats-modal__box">

        <div className="settings-modal__header">
          <span className="settings-modal__title" id="stats-title">Your Data</span>
          <button className="settings-modal__close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="settings-modal__body privacy-body">

          {/* Account info */}
          {stats && (
            <section className="privacy-section">
              <h3 className="privacy-heading">Account</h3>
              <div className="stats-rows">
                {stats.owner && (
                  <div className="stats-row">
                    <span className="stats-row__label">Name</span>
                    <span className="stats-row__value">{stats.owner}</span>
                  </div>
                )}
                {stats.email && (
                  <div className="stats-row">
                    <span className="stats-row__label">Email</span>
                    <span className="stats-row__value">{stats.email}</span>
                  </div>
                )}
                {stats.expires && (
                  <div className="stats-row">
                    <span className="stats-row__label">Expires</span>
                    <span className="stats-row__value">{new Date(stats.expires).toLocaleDateString()}</span>
                  </div>
                )}
                {isFreeTier && (
                  <div className="stats-row">
                    <span className="stats-row__label">Plan</span>
                    <span className="stats-row__value stats-row__value--badge">Free tier</span>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Usage */}
          {stats?.usage && (
            <section className="privacy-section">
              <h3 className="privacy-heading">Usage</h3>
              <div className="stats-rows">
                <div className="stats-row">
                  <span className="stats-row__label">Lifetime captions</span>
                  <span className="stats-row__value">
                    {fmt(stats.usage.lifetimeUsed)}
                    {stats.usage.lifetimeLimit != null && ` / ${fmt(stats.usage.lifetimeLimit)}`}
                  </span>
                </div>
                {stats.usage.lifetimeLimit != null && (
                  <UsageBar used={stats.usage.lifetimeUsed} limit={stats.usage.lifetimeLimit} />
                )}
                <div className="stats-row">
                  <span className="stats-row__label">Today</span>
                  <span className="stats-row__value">
                    {fmt(stats.usage.dailyUsed)}
                    {stats.usage.dailyLimit != null && ` / ${fmt(stats.usage.dailyLimit)}`}
                  </span>
                </div>
                {stats.usage.dailyLimit != null && (
                  <UsageBar used={stats.usage.dailyUsed} limit={stats.usage.dailyLimit} />
                )}
              </div>
            </section>
          )}

          {/* Sessions */}
          {stats?.sessions != null && (
            <section className="privacy-section">
              <h3 className="privacy-heading">
                Recent sessions
                {stats.sessions.length > 0 && <span className="stats-count">{stats.sessions.length}</span>}
              </h3>
              {stats.sessions.length === 0 ? (
                <p className="stats-empty">No sessions recorded.</p>
              ) : (
                <div className="stats-table-wrap">
                  <table className="stats-table">
                    <thead>
                      <tr>
                        <th>Started</th>
                        <th>Duration</th>
                        <th>Sent</th>
                        <th>Failed</th>
                        <th>Domain</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.sessions.map((s, i) => (
                        <tr key={s.sessionId || i}>
                          <td>{fmtDate(s.startedAt)}</td>
                          <td>{fmtDuration(s.durationMs)}</td>
                          <td>{fmt(s.captionsSent)}</td>
                          <td style={{ color: s.captionsFailed > 0 ? 'var(--color-error)' : undefined }}>
                            {fmt(s.captionsFailed)}
                          </td>
                          <td className="stats-table__domain">{s.domain || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {/* Caption errors */}
          {stats?.captionErrors != null && (
            <section className="privacy-section">
              <h3 className="privacy-heading">
                Caption delivery errors
                {stats.captionErrors.length > 0 && <span className="stats-count stats-count--error">{stats.captionErrors.length}</span>}
              </h3>
              {stats.captionErrors.length === 0 ? (
                <p className="stats-empty">No errors recorded.</p>
              ) : (
                <div className="stats-table-wrap">
                  <table className="stats-table">
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Code</th>
                        <th>Message</th>
                        <th>Batch</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.captionErrors.map((e, i) => (
                        <tr key={i}>
                          <td>{fmtDate(e.timestamp)}</td>
                          <td>{e.errorCode ?? '—'}</td>
                          <td>{e.errorMsg || '—'}</td>
                          <td>{e.batchSize}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {/* Auth events */}
          {stats?.authEvents != null && (
            <section className="privacy-section">
              <h3 className="privacy-heading">
                Auth events
                {stats.authEvents.length > 0 && <span className="stats-count stats-count--warn">{stats.authEvents.length}</span>}
              </h3>
              {stats.authEvents.length === 0 ? (
                <p className="stats-empty">No auth events recorded.</p>
              ) : (
                <div className="stats-table-wrap">
                  <table className="stats-table">
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Event</th>
                        <th>Domain</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.authEvents.map((e, i) => (
                        <tr key={i}>
                          <td>{fmtDate(e.timestamp)}</td>
                          <td>{e.eventType}</td>
                          <td>{e.domain || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {!stats && <p className="stats-empty">No data loaded.</p>}

        </div>

        <div className="settings-modal__footer">
          <div className="settings-modal__actions">
            <button className="btn btn--secondary" onClick={onClose} style={{ marginLeft: 'auto' }}>Close</button>
          </div>
        </div>

      </div>
    </div>
  );
}
