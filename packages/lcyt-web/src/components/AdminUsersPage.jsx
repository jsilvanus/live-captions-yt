import { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'wouter';
import { useUserAuth } from '../hooks/useUserAuth';
import { adminFetch } from '../lib/admin.js';
import { AdminKeyGate } from './AdminKeyGate.jsx';
import { AdminTabShell } from './AdminTabShell.jsx';
import { Avatar, RoleBadge } from './PersonBadge.jsx';

// ── Admin Users Page ────────────────────────────────────────────────────────

export function AdminUsersPage() {
  const { user, backendUrl } = useUserAuth();
  const [, navigate] = useLocation();

  return (
    <AdminKeyGate backendUrl={backendUrl} userIsAdmin={!!user?.isAdmin}>
      <AdminTabShell active="users">
        <AdminUsersContent backendUrl={backendUrl} navigate={navigate} />
      </AdminTabShell>
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
  const [teams, setTeams] = useState([]);
  const [teamFilter, setTeamFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  // Advanced filters
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [activeFilter, setActiveFilter] = useState('');

  const limit = 50;

  useEffect(() => {
    adminFetch(backendUrl, '/admin/orgs').then(res => res.ok ? res.json() : { orgs: [] }).then(data => setTeams(data.orgs || [])).catch(() => setTeams([]));
  }, [backendUrl]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit, offset });
      if (search) params.set('q', search);
      if (fromDate) params.set('from', fromDate);
      if (toDate) params.set('to', toDate);
      if (activeFilter) params.set('active', activeFilter);
      if (teamFilter) params.set('orgId', teamFilter);
      const res = await adminFetch(backendUrl, `/admin/users?${params}`);
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users);
        setTotal(data.total);
      }
    } finally {
      setLoading(false);
    }
  }, [backendUrl, search, offset, fromDate, toDate, activeFilter, teamFilter]);

  useEffect(() => { load(); }, [load]);

  const visibleUsers = roleFilter ? users.filter(u => u.role === roleFilter) : users;

  function toggleSelect(id) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === visibleUsers.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(visibleUsers.map(u => u.id)));
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

  async function handleExport() {
    const res = await adminFetch(backendUrl, '/admin/export/users');
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lcyt-users-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleImportFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result);
        const users = parsed.users || (Array.isArray(parsed) ? parsed : null);
        if (!users) { alert('Invalid import file: expected { users: [...] }'); return; }
        const res = await adminFetch(backendUrl, '/admin/import/users', {
          method: 'POST',
          body: JSON.stringify({ users }),
        });
        const data = await res.json();
        alert(`Import complete: ${data.imported} imported, ${data.skipped} skipped, ${data.failed} failed`);
        load();
      } catch {
        alert('Failed to parse import file');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  const pageCount = Math.ceil(total / limit);
  const currentPage = Math.floor(offset / limit) + 1;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '10px 28px', borderBottom: '1px solid var(--color-border)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          type="text"
          value={search}
          onChange={e => { setSearch(e.target.value); setOffset(0); }}
          placeholder="Search name or email…"
          style={{ flex: '1 1 200px', maxWidth: 260, padding: '0.38rem 0.75rem', borderRadius: 7, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: 13 }}
        />
        <select value={teamFilter} onChange={e => { setTeamFilter(e.target.value); setOffset(0); }}
          style={{ padding: '0.38rem 0.65rem', borderRadius: 7, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: 13 }}>
          <option value="">All teams</option>
          {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)}
          style={{ padding: '0.38rem 0.65rem', borderRadius: 7, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: 13 }}>
          <option value="">All roles</option>
          {['owner', 'admin', 'editor', 'operator', 'viewer'].map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <button className="btn btn--ghost btn--sm" onClick={load} disabled={loading}>
          {loading ? '…' : 'Refresh'}
        </button>
      </div>

      <details style={{ padding: '8px 28px 0' }}>
        <summary style={{ fontSize: 12, color: 'var(--color-text-muted)', cursor: 'pointer', userSelect: 'none' }}>Advanced filters</summary>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8, padding: '8px 12px', background: 'var(--color-surface)', borderRadius: 6, border: '1px solid var(--color-border)' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12 }}>
            Created from
            <input type="date" value={fromDate} onChange={e => { setFromDate(e.target.value); setOffset(0); }}
              style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12 }}>
            Created to
            <input type="date" value={toDate} onChange={e => { setToDate(e.target.value); setOffset(0); }}
              style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12 }}>
            Status
            <select value={activeFilter} onChange={e => { setActiveFilter(e.target.value); setOffset(0); }}
              style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}>
              <option value="">All</option>
              <option value="1">Active only</option>
              <option value="0">Inactive only</option>
            </select>
          </label>
          {(fromDate || toDate || activeFilter) && (
            <button className="btn btn--ghost btn--sm" style={{ alignSelf: 'flex-end' }} onClick={() => { setFromDate(''); setToDate(''); setActiveFilter(''); setOffset(0); }}>
              Clear filters
            </button>
          )}
        </div>
      </details>

      <div style={{ padding: '8px 28px 0', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn btn--ghost btn--sm" onClick={handleExport}>Export JSON</button>
        <label className="btn btn--ghost btn--sm" style={{ cursor: 'pointer' }}>
          Import JSON
          <input type="file" accept=".json" style={{ display: 'none' }} onChange={handleImportFile} />
        </label>
        {selected.size > 0 && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginLeft: 'auto' }}>
            <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{selected.size} selected</span>
            <select value={batchAction} onChange={e => setBatchAction(e.target.value)} style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}>
              <option value="">Batch action…</option>
              <option value="activate">Activate</option>
              <option value="deactivate">Deactivate</option>
              <option value="delete">Delete</option>
            </select>
            <button className="btn btn--ghost btn--sm" onClick={handleBatch} disabled={!batchAction}>Apply</button>
          </div>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 28px' }}>
        <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 14 }}>All Users</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--color-text-muted)' }}>
            <input type="checkbox" checked={selected.size === visibleUsers.length && visibleUsers.length > 0} onChange={toggleAll} />
            Select all
          </label>
          {visibleUsers.map(u => (
            <div
              key={u.id}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', background: 'var(--color-surface)', border: '1.5px solid var(--color-border)', borderRadius: 10 }}
            >
              <input type="checkbox" checked={selected.has(u.id)} onChange={() => toggleSelect(u.id)} />
              <Avatar name={u.name} email={u.email} size={32} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.name || u.email}</div>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.email}</div>
              </div>
              {!u.active && (
                <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: 'var(--color-error-bg, #fde8e8)', color: 'var(--color-error, #e55)' }}>Inactive</span>
              )}
              {u.role && <RoleBadge role={u.role} />}
              {u.orgName && <span style={{ fontSize: 12, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>{u.orgName}</span>}
              <button className="btn btn--ghost btn--sm" onClick={() => navigate(`/admin/users/${u.id}`)}>View →</button>
            </div>
          ))}
          {visibleUsers.length === 0 && !loading && (
            <div style={{ padding: 16, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>No users found</div>
          )}
        </div>

        {pageCount > 1 && (
          <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'center', alignItems: 'center' }}>
            <button className="btn btn--ghost btn--sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>← Prev</button>
            <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Page {currentPage} of {pageCount}</span>
            <button className="btn btn--ghost btn--sm" disabled={offset + limit >= total} onClick={() => setOffset(offset + limit)}>Next →</button>
          </div>
        )}
      </div>
    </div>
  );
}
