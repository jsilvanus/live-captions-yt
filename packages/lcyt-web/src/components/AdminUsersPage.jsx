import { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'wouter';
import { useSessionContext } from '../contexts/SessionContext';
import { useUserAuth } from '../hooks/useUserAuth';
import { adminFetch } from '../lib/admin.js';
import { AdminKeyGate } from './AdminKeyGate.jsx';

// ── Admin Users Page ────────────────────────────────────────────────────────

export function AdminUsersPage() {
  const session = useSessionContext();
  const backendUrl = session.backendUrl;
  const { user } = useUserAuth();
  const [, navigate] = useLocation();

  return (
    <AdminKeyGate backendUrl={backendUrl} userIsAdmin={!!user?.isAdmin}>
      <AdminUsersContent backendUrl={backendUrl} navigate={navigate} />
    </AdminKeyGate>
  );
}

function AdminUsersContent({ backendUrl, navigate }) {
  const [users, setUsers] = useState([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(new Set());
  const [batchAction, setBatchAction] = useState('');

  const limit = 50;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit, offset });
      if (search) params.set('q', search);
      const res = await adminFetch(backendUrl, `/admin/users?${params}`);
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users);
        setTotal(data.total);
      }
    } finally {
      setLoading(false);
    }
  }, [backendUrl, search, offset]);

  useEffect(() => { load(); }, [load]);

  function toggleSelect(id) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === users.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(users.map(u => u.id)));
    }
  }

  async function handleBatch() {
    if (!batchAction || selected.size === 0) return;
    if (!confirm(`${batchAction} ${selected.size} user(s)?`)) return;
    const res = await adminFetch(backendUrl, '/admin/batch/users', {
      method: 'POST',
      body: JSON.stringify({ ids: [...selected], action: batchAction }),
    });
    if (res.ok) {
      setSelected(new Set());
      setBatchAction('');
      load();
    }
  }

  const pageCount = Math.ceil(total / limit);
  const currentPage = Math.floor(offset / limit) + 1;

  return (
    <div style={{ padding: 24, maxWidth: 1000 }}>
      <h2 style={{ marginBottom: 16 }}>👥 Users</h2>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <input
          type="text"
          value={search}
          onChange={e => { setSearch(e.target.value); setOffset(0); }}
          placeholder="Search by email, name or ID…"
          style={{ flex: 1, minWidth: 200, padding: '8px 12px', borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
        />
        <button className="btn btn--ghost btn--sm" onClick={load} disabled={loading}>
          {loading ? '⏳' : '🔄'} Refresh
        </button>
      </div>

      {selected.size > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', padding: '8px 12px', background: 'var(--color-surface)', borderRadius: 6, border: '1px solid var(--color-border)' }}>
          <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{selected.size} selected</span>
          <select value={batchAction} onChange={e => setBatchAction(e.target.value)} style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}>
            <option value="">Batch action…</option>
            <option value="activate">Activate</option>
            <option value="deactivate">Deactivate</option>
            <option value="delete">Delete</option>
          </select>
          <button className="btn btn--ghost btn--sm" onClick={handleBatch} disabled={!batchAction}>
            Apply
          </button>
        </div>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: '2px solid var(--color-border)' }}>
            <th style={{ padding: '8px 4px', textAlign: 'left' }}>
              <input type="checkbox" checked={selected.size === users.length && users.length > 0} onChange={toggleAll} />
            </th>
            <th style={{ padding: '8px 4px', textAlign: 'left' }}>ID</th>
            <th style={{ padding: '8px 4px', textAlign: 'left' }}>Email</th>
            <th style={{ padding: '8px 4px', textAlign: 'left' }}>Name</th>
            <th style={{ padding: '8px 4px', textAlign: 'left' }}>Status</th>
            <th style={{ padding: '8px 4px', textAlign: 'left' }}>Created</th>
            <th style={{ padding: '8px 4px', textAlign: 'right' }}></th>
          </tr>
        </thead>
        <tbody>
          {users.map(u => (
            <tr key={u.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
              <td style={{ padding: '6px 4px' }}>
                <input type="checkbox" checked={selected.has(u.id)} onChange={() => toggleSelect(u.id)} />
              </td>
              <td style={{ padding: '6px 4px', fontFamily: 'monospace' }}>{u.id}</td>
              <td style={{ padding: '6px 4px' }}>{u.email}</td>
              <td style={{ padding: '6px 4px', color: u.name ? 'inherit' : 'var(--color-text-muted)' }}>{u.name || '—'}</td>
              <td style={{ padding: '6px 4px' }}>
                <span style={{ padding: '2px 6px', borderRadius: 8, fontSize: 11, background: u.active ? 'var(--color-success-bg, #e6f9e6)' : 'var(--color-error-bg, #fde8e8)', color: u.active ? 'var(--color-success, #2a7)' : 'var(--color-error, #e55)' }}>
                  {u.active ? 'Active' : 'Inactive'}
                </span>
              </td>
              <td style={{ padding: '6px 4px', fontSize: 12, color: 'var(--color-text-muted)' }}>{u.created_at?.slice(0, 10)}</td>
              <td style={{ padding: '6px 4px', textAlign: 'right' }}>
                <button className="btn btn--ghost btn--sm" onClick={() => navigate(`/admin/users/${u.id}`)}>
                  View →
                </button>
              </td>
            </tr>
          ))}
          {users.length === 0 && !loading && (
            <tr><td colSpan={7} style={{ padding: 16, textAlign: 'center', color: 'var(--color-text-muted)' }}>No users found</td></tr>
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
