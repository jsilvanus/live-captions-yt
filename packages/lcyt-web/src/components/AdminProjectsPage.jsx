import { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'wouter';
import { useSessionContext } from '../contexts/SessionContext';
import { useUserAuth } from '../hooks/useUserAuth';
import { adminFetch } from '../lib/admin.js';
import { AdminKeyGate } from './AdminKeyGate.jsx';

// ── Admin Projects Page ─────────────────────────────────────────────────────

export function AdminProjectsPage() {
  const session = useSessionContext();
  const backendUrl = session.backendUrl;
  const { user } = useUserAuth();
  const [, navigate] = useLocation();

  return (
    <AdminKeyGate backendUrl={backendUrl} userIsAdmin={!!user?.isAdmin}>
      <AdminProjectsContent backendUrl={backendUrl} navigate={navigate} />
    </AdminKeyGate>
  );
}

function maskKey(key) {
  if (!key || key.length < 12) return key;
  return key.slice(0, 12) + '••••••••••••••••';
}

function AdminProjectsContent({ backendUrl, navigate }) {
  const [projects, setProjects] = useState([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(new Set());
  const [batchAction, setBatchAction] = useState('');
  // Advanced filters
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const limit = 50;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit, offset });
      if (search) params.set('q', search);
      if (fromDate) params.set('from', fromDate);
      if (toDate) params.set('to', toDate);
      if (statusFilter) params.set('status', statusFilter);
      const res = await adminFetch(backendUrl, `/admin/projects?${params}`);
      if (res.ok) {
        const data = await res.json();
        setProjects(data.projects);
        setTotal(data.total);
      }
    } finally {
      setLoading(false);
    }
  }, [backendUrl, search, offset, fromDate, toDate, statusFilter]);

  useEffect(() => { load(); }, [load]);

  function toggleSelect(key) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === projects.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(projects.map(p => p.key)));
    }
  }

  async function handleBatch() {
    if (!batchAction || selected.size === 0) return;
    if (!confirm(`${batchAction} ${selected.size} project(s)?`)) return;
    const res = await adminFetch(backendUrl, '/admin/batch/projects', {
      method: 'POST',
      body: JSON.stringify({ keys: [...selected], action: batchAction }),
    });
    if (res.ok) {
      setSelected(new Set());
      setBatchAction('');
      load();
    }
  }

  async function handleExport() {
    const res = await adminFetch(backendUrl, '/admin/export/projects');
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lcyt-projects-${new Date().toISOString().slice(0, 10)}.json`;
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
        const importProjects = parsed.projects || (Array.isArray(parsed) ? parsed : null);
        if (!importProjects) { alert('Invalid import file: expected { projects: [...] }'); return; }
        const res = await adminFetch(backendUrl, '/admin/import/projects', {
          method: 'POST',
          body: JSON.stringify({ projects: importProjects }),
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
    <div style={{ padding: 24, maxWidth: 1100 }}>
      <h2 style={{ marginBottom: 16 }}>📁 Projects</h2>

      <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <input
          type="text"
          value={search}
          onChange={e => { setSearch(e.target.value); setOffset(0); }}
          placeholder="Search by name, key, email or user:email…"
          style={{ flex: 1, minWidth: 250, padding: '8px 12px', borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
        />
        <button className="btn btn--ghost btn--sm" onClick={load} disabled={loading}>
          {loading ? '⏳' : '🔄'} Refresh
        </button>
      </div>

      <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 8 }}>
        Tip: use <code>user:alice@example.com</code> to find projects by user email. Multiple <code>user:</code> filters combine results.
      </p>

      {/* Advanced filters */}
      <details style={{ marginBottom: 12 }}>
        <summary style={{ fontSize: 12, color: 'var(--color-text-muted)', cursor: 'pointer', userSelect: 'none' }}>
          🔍 Advanced filters
        </summary>
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
            <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setOffset(0); }}
              style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}>
              <option value="">All</option>
              <option value="active">Active only</option>
              <option value="revoked">Revoked only</option>
            </select>
          </label>
          {(fromDate || toDate || statusFilter) && (
            <button className="btn btn--ghost btn--sm" style={{ alignSelf: 'flex-end' }} onClick={() => { setFromDate(''); setToDate(''); setStatusFilter(''); setOffset(0); }}>
              ✕ Clear filters
            </button>
          )}
        </div>
      </details>

      {/* Export / Import toolbar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <button className="btn btn--ghost btn--sm" onClick={handleExport}>⬇ Export JSON</button>
        <label className="btn btn--ghost btn--sm" style={{ cursor: 'pointer' }}>
          ⬆ Import JSON
          <input type="file" accept=".json" style={{ display: 'none' }} onChange={handleImportFile} />
        </label>
      </div>

      {selected.size > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', padding: '8px 12px', background: 'var(--color-surface)', borderRadius: 6, border: '1px solid var(--color-border)' }}>
          <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{selected.size} selected</span>
          <select value={batchAction} onChange={e => setBatchAction(e.target.value)} style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}>
            <option value="">Batch action…</option>
            <option value="activate">Activate</option>
            <option value="revoke">Revoke</option>
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
              <input type="checkbox" checked={selected.size === projects.length && projects.length > 0} onChange={toggleAll} />
            </th>
            <th style={{ padding: '8px 4px', textAlign: 'left' }}>Name</th>
            <th style={{ padding: '8px 4px', textAlign: 'left' }}>Key</th>
            <th style={{ padding: '8px 4px', textAlign: 'left' }}>Owner</th>
            <th style={{ padding: '8px 4px', textAlign: 'left' }}>Status</th>
            <th style={{ padding: '8px 4px', textAlign: 'left' }}>Expires</th>
            <th style={{ padding: '8px 4px', textAlign: 'right' }}></th>
          </tr>
        </thead>
        <tbody>
          {projects.map(p => (
            <tr key={p.key} style={{ borderBottom: '1px solid var(--color-border)' }}>
              <td style={{ padding: '6px 4px' }}>
                <input type="checkbox" checked={selected.has(p.key)} onChange={() => toggleSelect(p.key)} />
              </td>
              <td style={{ padding: '6px 4px', fontWeight: 500 }}>{p.owner}</td>
              <td style={{ padding: '6px 4px', fontFamily: 'monospace', fontSize: 11 }}>{maskKey(p.key)}</td>
              <td style={{ padding: '6px 4px' }}>
                {p.userEmail ? (
                  <button className="btn btn--ghost" style={{ fontSize: 12, padding: '2px 4px' }} onClick={() => navigate(`/admin/users/${p.userId}`)}>
                    {p.userEmail}
                  </button>
                ) : (
                  <span style={{ color: 'var(--color-text-muted)' }}>—</span>
                )}
              </td>
              <td style={{ padding: '6px 4px' }}>
                <span style={{ padding: '2px 6px', borderRadius: 8, fontSize: 11, background: p.active ? 'var(--color-success-bg, #e6f9e6)' : 'var(--color-error-bg, #fde8e8)', color: p.active ? 'var(--color-success, #2a7)' : 'var(--color-error, #e55)' }}>
                  {p.active ? 'Active' : 'Revoked'}
                </span>
              </td>
              <td style={{ padding: '6px 4px', fontSize: 12, color: 'var(--color-text-muted)' }}>{p.expires || '—'}</td>
              <td style={{ padding: '6px 4px', textAlign: 'right' }}>
                <button className="btn btn--ghost btn--sm" onClick={() => navigate(`/admin/projects/${p.key}`)}>
                  Manage →
                </button>
              </td>
            </tr>
          ))}
          {projects.length === 0 && !loading && (
            <tr><td colSpan={7} style={{ padding: 16, textAlign: 'center', color: 'var(--color-text-muted)' }}>No projects found</td></tr>
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

// ── Admin Projects Page ─────────────────────────────────────────────────────

