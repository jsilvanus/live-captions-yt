import { useState, useEffect, useCallback } from 'react';
import { useSessionContext } from '../contexts/SessionContext';
import { useUserAuth } from '../hooks/useUserAuth';
import { adminFetch } from '../lib/admin.js';
import { AdminKeyGate } from './AdminKeyGate.jsx';

// ── Admin Audit Log Page ────────────────────────────────────────────────────

export function AdminAuditLogPage() {
  const session = useSessionContext();
  const backendUrl = session.backendUrl;
  const { user } = useUserAuth();

  return (
    <AdminKeyGate backendUrl={backendUrl} userIsAdmin={!!user?.isAdmin}>
      <AdminAuditLogContent backendUrl={backendUrl} />
    </AdminKeyGate>
  );
}

const ACTION_LABELS = {
  'user.create':             '➕ User created',
  'user.update':             '✏️ User updated',
  'user.set-password':       '🔑 Password reset',
  'user.delete':             '🗑️ User deleted',
  'user.features.update':    '🎯 User features updated',
  'project.update':          '✏️ Project updated',
  'project.features.update': '🎯 Project features updated',
  'batch.users.activate':    '✅ Batch: activate users',
  'batch.users.deactivate':  '🚫 Batch: deactivate users',
  'batch.users.delete':      '🗑️ Batch: delete users',
  'batch.projects.revoke':   '🚫 Batch: revoke projects',
  'batch.projects.activate': '✅ Batch: activate projects',
  'batch.projects.delete':   '🗑️ Batch: delete projects',
  'batch.projects.features': '🎯 Batch: update project features',
  'export.users':            '⬇ Users exported',
  'export.projects':         '⬇ Projects exported',
  'import.users':            '⬆ Users imported',
  'import.projects':         '⬆ Projects imported',
};

function formatTimestamp(ts) {
  if (!ts) return '—';
  try { return new Date(ts.replace(' ', 'T') + 'Z').toLocaleString(); } catch { return ts; }
}

function AdminAuditLogContent({ backendUrl }) {
  const [entries, setEntries] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  // Filters
  const [action, setAction] = useState('');
  const [actor, setActor] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [expanded, setExpanded] = useState(null);

  const limit = 50;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit, offset });
      if (action) params.set('action', action);
      if (actor) params.set('actor', actor);
      if (fromDate) params.set('from', fromDate);
      if (toDate) params.set('to', toDate);
      const res = await adminFetch(backendUrl, `/admin/audit-log?${params}`);
      if (res.ok) {
        const data = await res.json();
        setEntries(data.entries || []);
        setTotal(data.total || 0);
      }
    } finally {
      setLoading(false);
    }
  }, [backendUrl, action, actor, fromDate, toDate, offset]);

  useEffect(() => { load(); }, [load]);

  function clearFilters() {
    setAction('');
    setActor('');
    setFromDate('');
    setToDate('');
    setOffset(0);
  }

  const hasFilters = action || actor || fromDate || toDate;
  const pageCount = Math.ceil(total / limit);
  const currentPage = Math.floor(offset / limit) + 1;

  // Unique action values from current entries for the dropdown
  const actionOptions = [
    ...new Set(Object.keys(ACTION_LABELS)),
  ].sort();

  return (
    <div style={{ padding: 24, maxWidth: 1100 }}>
      <h2 style={{ marginBottom: 16 }}>📋 Audit Log</h2>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, padding: '10px 14px', background: 'var(--color-surface)', borderRadius: 6, border: '1px solid var(--color-border)' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12, flex: 1, minWidth: 160 }}>
          Action
          <select value={action} onChange={e => { setAction(e.target.value); setOffset(0); }}
            style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}>
            <option value="">All actions</option>
            {actionOptions.map(a => (
              <option key={a} value={a}>{ACTION_LABELS[a] || a}</option>
            ))}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12, flex: 1, minWidth: 160 }}>
          Actor (email/label)
          <input type="text" value={actor} onChange={e => { setActor(e.target.value); setOffset(0); }}
            placeholder="e.g. alice@example.com"
            style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12 }}>
          From
          <input type="date" value={fromDate} onChange={e => { setFromDate(e.target.value); setOffset(0); }}
            style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12 }}>
          To
          <input type="date" value={toDate} onChange={e => { setToDate(e.target.value); setOffset(0); }}
            style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }} />
        </label>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6 }}>
          <button className="btn btn--ghost btn--sm" onClick={load} disabled={loading}>
            {loading ? '⏳' : '🔄'}
          </button>
          {hasFilters && (
            <button className="btn btn--ghost btn--sm" onClick={clearFilters}>
              ✕ Clear
            </button>
          )}
        </div>
      </div>

      <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 12 }}>
        {total} entr{total === 1 ? 'y' : 'ies'} total
      </p>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: '2px solid var(--color-border)' }}>
            <th style={{ padding: '8px 4px', textAlign: 'left' }}>When</th>
            <th style={{ padding: '8px 4px', textAlign: 'left' }}>Actor</th>
            <th style={{ padding: '8px 4px', textAlign: 'left' }}>Action</th>
            <th style={{ padding: '8px 4px', textAlign: 'left' }}>Target</th>
            <th style={{ padding: '8px 4px', textAlign: 'left' }}>Details</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(e => (
            <>
              <tr key={e.id} style={{ borderBottom: '1px solid var(--color-border)', cursor: e.details ? 'pointer' : 'default' }}
                onClick={() => setExpanded(expanded === e.id ? null : e.id)}>
                <td style={{ padding: '6px 4px', fontSize: 11, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                  {formatTimestamp(e.created_at)}
                </td>
                <td style={{ padding: '6px 4px', fontFamily: 'monospace', fontSize: 12, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {e.actor}
                </td>
                <td style={{ padding: '6px 4px', fontWeight: 500 }}>
                  {ACTION_LABELS[e.action] || e.action}
                </td>
                <td style={{ padding: '6px 4px', fontSize: 12 }}>
                  <span style={{ color: 'var(--color-text-muted)' }}>{e.target_type}</span>
                  {e.target_id && <> / <code style={{ fontSize: 11 }}>{e.target_id}</code></>}
                </td>
                <td style={{ padding: '6px 4px', fontSize: 11, color: 'var(--color-text-muted)' }}>
                  {e.details && <span style={{ opacity: 0.7 }}>{expanded === e.id ? '▲ hide' : '▼ show'}</span>}
                </td>
              </tr>
              {expanded === e.id && e.details && (
                <tr key={`${e.id}-detail`} style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
                  <td colSpan={5} style={{ padding: '6px 12px' }}>
                    <pre style={{ margin: 0, fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: 'var(--color-text-muted)' }}>
                      {JSON.stringify(e.details, null, 2)}
                    </pre>
                  </td>
                </tr>
              )}
            </>
          ))}
          {entries.length === 0 && !loading && (
            <tr><td colSpan={5} style={{ padding: 16, textAlign: 'center', color: 'var(--color-text-muted)' }}>No audit log entries</td></tr>
          )}
        </tbody>
      </table>

      {pageCount > 1 && (
        <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'center', alignItems: 'center' }}>
          <button className="btn btn--ghost btn--sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>← Prev</button>
          <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Page {currentPage} of {pageCount}</span>
          <button className="btn btn--ghost btn--sm" disabled={offset + limit >= total} onClick={() => setOffset(offset + limit)}>Next →</button>
        </div>
      )}
    </div>
  );
}
