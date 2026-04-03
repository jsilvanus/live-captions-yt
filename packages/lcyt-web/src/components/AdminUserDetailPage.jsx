import { useState, useEffect, useCallback } from 'react';
import { useRoute, useLocation } from 'wouter';
import { useSessionContext } from '../contexts/SessionContext';
import { adminFetch } from '../lib/admin.js';

const FEATURE_LABELS = {
  captions:              'Captions',
  'viewer-target':       'Viewer Target',
  'mic-lock':            'Mic Lock',
  stats:                 'Stats',
  collaboration:         'Collaboration',
  'file-saving':         'File Saving',
  'files-local':         'Files (Local)',
  'files-managed-bucket':'Files (Managed S3)',
  'files-custom-bucket': 'Files (Custom S3)',
  'files-webdav':        'Files (WebDAV)',
  'files-browser-local': 'Files (Browser)',
  translations:          'Translations',
  'graphics-client':     'Graphics (Client)',
  'graphics-server':     'Graphics (Server)',
  ingest:                'RTMP Ingest',
  radio:                 'Radio',
  'hls-stream':          'HLS Stream',
  preview:               'Preview',
  restream:              'Restream',
  'cea-captions':        'CEA Captions',
  'stt-server':          'STT (Server)',
  'device-control':      'Device Control',
  embed:                 'Embed',
};

export function AdminUserDetailPage() {
  const session = useSessionContext();
  const backendUrl = session.backendUrl;
  const [, params] = useRoute('/admin/users/:id');
  const [, navigate] = useLocation();
  const userId = params?.id;

  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [pwMsg, setPwMsg] = useState('');
  // Feature entitlements state
  const [entitlements, setEntitlements] = useState({});
  const [savingEntitlements, setSavingEntitlements] = useState(false);
  const [entitlementMsg, setEntitlementMsg] = useState('');

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError('');
    try {
      const [userRes, featRes] = await Promise.all([
        adminFetch(backendUrl, `/admin/users/${userId}`),
        adminFetch(backendUrl, `/admin/users/${userId}/features`),
      ]);
      if (userRes.ok) {
        setUser(await userRes.json());
      } else if (userRes.status === 404) {
        setError('User not found');
      } else {
        setError(`Error: ${userRes.status}`);
      }
      if (featRes.ok) {
        const featData = await featRes.json();
        const state = {};
        for (const f of (featData.features || [])) {
          state[f.code] = f.enabled;
        }
        setEntitlements(state);
      }
    } catch {
      setError('Failed to load user');
    } finally {
      setLoading(false);
    }
  }, [backendUrl, userId]);

  useEffect(() => { load(); }, [load]);

  async function handleToggleActive() {
    if (!user) return;
    const newActive = !user.active;
    const res = await adminFetch(backendUrl, `/admin/users/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify({ active: newActive }),
    });
    if (res.ok) load();
  }

  async function handleSetPassword(e) {
    e.preventDefault();
    if (!newPassword) return;
    setPwMsg('');
    const res = await adminFetch(backendUrl, `/admin/users/${userId}/set-password`, {
      method: 'POST',
      body: JSON.stringify({ password: newPassword }),
    });
    if (res.ok) {
      setPwMsg('Password updated');
      setNewPassword('');
    } else {
      const data = await res.json().catch(() => ({}));
      setPwMsg(data.error || 'Failed to update password');
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete user ${user?.email}? This will unlink their projects.`)) return;
    const res = await adminFetch(backendUrl, `/admin/users/${userId}?force=true`, {
      method: 'DELETE',
    });
    if (res.ok) {
      navigate('/admin/users');
    }
  }

  function toggleEntitlement(code) {
    setEntitlements(prev => ({ ...prev, [code]: !prev[code] }));
  }

  async function saveEntitlements() {
    setSavingEntitlements(true);
    setEntitlementMsg('');
    try {
      const res = await adminFetch(backendUrl, `/admin/users/${userId}/features`, {
        method: 'PATCH',
        body: JSON.stringify({ features: entitlements }),
      });
      if (res.ok) {
        setEntitlementMsg('Entitlements saved');
        const data = await res.json();
        const state = {};
        for (const f of (data.features || [])) { state[f.code] = f.enabled; }
        setEntitlements(state);
      } else {
        const data = await res.json().catch(() => ({}));
        setEntitlementMsg(data.error || 'Failed to save entitlements');
      }
    } finally {
      setSavingEntitlements(false);
    }
  }

  if (loading) return <div style={{ padding: 24 }}>Loading…</div>;
  if (error) return <div style={{ padding: 24, color: 'var(--color-error, #e55)' }}>{error}</div>;
  if (!user) return null;

  return (
    <div style={{ padding: 24, maxWidth: 800 }}>
      <button className="btn btn--ghost btn--sm" onClick={() => navigate('/admin/users')} style={{ marginBottom: 12 }}>
        ← Back to Users
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <h2 style={{ margin: 0 }}>👤 {user.email}</h2>
        <span style={{
          padding: '2px 8px', borderRadius: 8, fontSize: 12,
          background: user.active ? 'var(--color-success-bg, #e6f9e6)' : 'var(--color-error-bg, #fde8e8)',
          color: user.active ? 'var(--color-success, #2a7)' : 'var(--color-error, #e55)',
        }}>
          {user.active ? 'Active' : 'Inactive'}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: '8px 16px', marginBottom: 24, fontSize: 14 }}>
        <span style={{ color: 'var(--color-text-muted)' }}>User ID</span>
        <span style={{ fontFamily: 'monospace' }}>{user.id}</span>
        <span style={{ color: 'var(--color-text-muted)' }}>Name</span>
        <span>{user.name || '—'}</span>
        <span style={{ color: 'var(--color-text-muted)' }}>Created</span>
        <span>{user.created_at}</span>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        <button className="btn btn--ghost btn--sm" onClick={handleToggleActive}>
          {user.active ? '🚫 Deactivate' : '✅ Activate'}
        </button>
        <button className="btn btn--ghost btn--sm" onClick={handleDelete} style={{ color: 'var(--color-error, #e55)' }}>
          🗑️ Delete User
        </button>
      </div>

      {/* Password reset */}
      <div style={{ marginBottom: 24 }}>
        <h3 style={{ fontSize: 15, marginBottom: 8 }}>Reset Password</h3>
        <form onSubmit={handleSetPassword} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="password"
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            placeholder="New password"
            style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', width: 200 }}
          />
          <button type="submit" className="btn btn--ghost btn--sm" disabled={!newPassword}>Set</button>
          {pwMsg && <span style={{ fontSize: 12, color: pwMsg.includes('updated') ? 'var(--color-success, #2a7)' : 'var(--color-error, #e55)' }}>{pwMsg}</span>}
        </form>
      </div>

      {/* Feature Entitlements */}
      <div style={{ marginBottom: 24 }}>
        <h3 style={{ fontSize: 15, marginBottom: 4 }}>Feature Entitlements</h3>
        <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 8 }}>
          Control which features this user may enable on their projects.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 6, marginBottom: 10 }}>
          {Object.entries(FEATURE_LABELS).map(([code, label]) => (
            <label key={code} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', padding: '4px 8px', borderRadius: 6, background: entitlements[code] ? 'var(--color-success-bg, #e6f9e6)' : 'transparent' }}>
              <input
                type="checkbox"
                checked={!!entitlements[code]}
                onChange={() => toggleEntitlement(code)}
              />
              {label}
            </label>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn btn--primary btn--sm" onClick={saveEntitlements} disabled={savingEntitlements}>
            {savingEntitlements ? 'Saving…' : 'Save Entitlements'}
          </button>
          {entitlementMsg && (
            <span style={{ fontSize: 12, color: entitlementMsg.includes('saved') ? 'var(--color-success, #2a7)' : 'var(--color-error, #e55)' }}>
              {entitlementMsg}
            </span>
          )}
        </div>
      </div>

      {/* Projects */}
      <h3 style={{ fontSize: 15, marginBottom: 8 }}>Projects ({(user.projects || []).length})</h3>
      {(user.projects || []).length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>No projects</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--color-border)' }}>
              <th style={{ padding: '8px 4px', textAlign: 'left' }}>Name</th>
              <th style={{ padding: '8px 4px', textAlign: 'left' }}>Key</th>
              <th style={{ padding: '8px 4px', textAlign: 'left' }}>Status</th>
              <th style={{ padding: '8px 4px', textAlign: 'left' }}>Expires</th>
              <th style={{ padding: '8px 4px', textAlign: 'right' }}></th>
            </tr>
          </thead>
          <tbody>
            {(user.projects || []).map(p => (
              <tr key={p.key} style={{ borderBottom: '1px solid var(--color-border)' }}>
                <td style={{ padding: '6px 4px' }}>{p.owner}</td>
                <td style={{ padding: '6px 4px', fontFamily: 'monospace', fontSize: 11 }}>{p.key.slice(0, 12)}…</td>
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
          </tbody>
        </table>
      )}
    </div>
  );
}
