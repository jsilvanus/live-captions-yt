import { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'wouter';
import { useSessionContext } from '../contexts/SessionContext';

const ADMIN_KEY_STORAGE = 'lcyt.admin.key';

function getAdminKey() {
  try { return sessionStorage.getItem(ADMIN_KEY_STORAGE) || ''; } catch { return ''; }
}

function setAdminKey(key) {
  try { sessionStorage.setItem(ADMIN_KEY_STORAGE, key); } catch { /* */ }
}

function adminFetch(backendUrl, path, opts = {}) {
  const key = getAdminKey();
  return fetch(`${backendUrl}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Key': key,
      ...opts.headers,
    },
  });
}

function AdminKeyGate({ backendUrl, children }) {
  const [key, setKey] = useState(getAdminKey);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [valid, setValid] = useState(false);

  useEffect(() => {
    if (key) verify(key);
  }, []);

  async function verify(k) {
    setChecking(true);
    setError('');
    try {
      const res = await fetch(`${backendUrl}/admin/projects?limit=1`, {
        headers: { 'X-Admin-Key': k },
      });
      if (res.ok) {
        setAdminKey(k);
        setValid(true);
      } else if (res.status === 403) {
        setError('Invalid admin key');
        setValid(false);
      } else if (res.status === 503) {
        setError('Admin API not configured on this server');
        setValid(false);
      } else {
        setError(`Unexpected response: ${res.status}`);
        setValid(false);
      }
    } catch {
      setError('Could not connect to server');
    } finally {
      setChecking(false);
    }
  }

  if (valid) return children;

  return (
    <div style={{ maxWidth: 400, margin: '60px auto', padding: 24 }}>
      <h2 style={{ marginBottom: 12 }}>🛡️ Admin Access</h2>
      <p style={{ color: 'var(--color-text-muted)', marginBottom: 16, fontSize: 13 }}>
        Enter the server admin key to access admin features.
      </p>
      <form onSubmit={(e) => { e.preventDefault(); verify(key); }}>
        <input
          type="password"
          value={key}
          onChange={e => setKey(e.target.value)}
          placeholder="Admin key"
          style={{ width: '100%', padding: '8px 12px', marginBottom: 8, borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
          autoFocus
        />
        {error && <div style={{ color: 'var(--color-error, #e55)', fontSize: 13, marginBottom: 8 }}>{error}</div>}
        <button type="submit" className="btn btn--primary" disabled={checking || !key}>
          {checking ? 'Verifying…' : 'Unlock Admin'}
        </button>
      </form>
    </div>
  );
}

// ── Admin Projects Page ─────────────────────────────────────────────────────

export function AdminProjectsPage() {
  const session = useSessionContext();
  const backendUrl = session.backendUrl;
  const [, navigate] = useLocation();

  return (
    <AdminKeyGate backendUrl={backendUrl}>
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

  const limit = 50;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit, offset });
      if (search) params.set('q', search);
      const res = await adminFetch(backendUrl, `/admin/projects?${params}`);
      if (res.ok) {
        const data = await res.json();
        setProjects(data.projects);
        setTotal(data.total);
      }
    } finally {
      setLoading(false);
    }
  }, [backendUrl, search, offset]);

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

      <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 12 }}>
        Tip: use <code>user:alice@example.com</code> to find projects by user email. Multiple <code>user:</code> filters combine results.
      </p>

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
