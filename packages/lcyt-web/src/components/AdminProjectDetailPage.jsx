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

export function AdminProjectDetailPage() {
  const session = useSessionContext();
  const backendUrl = session.backendUrl;
  const [, params] = useRoute('/admin/projects/:key');
  const [, navigate] = useLocation();
  const projectKey = params?.key;

  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [featureEdits, setFeatureEdits] = useState({});
  const [savingFeatures, setSavingFeatures] = useState(false);
  const [featureMsg, setFeatureMsg] = useState('');

  const load = useCallback(async () => {
    if (!projectKey) return;
    setLoading(true);
    setError('');
    try {
      const res = await adminFetch(backendUrl, `/admin/projects/${projectKey}`);
      if (res.ok) {
        const data = await res.json();
        setProject(data);
        // Build initial feature state from the features array
        const featureState = {};
        for (const f of (data.features || [])) {
          featureState[f.feature_code] = f.enabled === 1;
        }
        setFeatureEdits(featureState);
      } else if (res.status === 404) {
        setError('Project not found');
      } else {
        setError(`Error: ${res.status}`);
      }
    } catch {
      setError('Failed to load project');
    } finally {
      setLoading(false);
    }
  }, [backendUrl, projectKey]);

  useEffect(() => { load(); }, [load]);

  function toggleFeature(code) {
    setFeatureEdits(prev => ({ ...prev, [code]: !prev[code] }));
  }

  async function saveFeatures() {
    setSavingFeatures(true);
    setFeatureMsg('');
    try {
      const res = await adminFetch(backendUrl, `/admin/projects/${projectKey}/features`, {
        method: 'PUT',
        body: JSON.stringify({ features: featureEdits }),
      });
      if (res.ok) {
        const data = await res.json();
        setFeatureMsg(data.autoEnabled?.length > 0
          ? `Saved. Auto-enabled: ${data.autoEnabled.join(', ')}`
          : 'Features saved');
        load(); // Reload
      } else {
        const data = await res.json().catch(() => ({}));
        setFeatureMsg(data.error || 'Failed to save features');
      }
    } finally {
      setSavingFeatures(false);
    }
  }

  async function handleRevoke() {
    if (!confirm('Revoke this project?')) return;
    const res = await adminFetch(backendUrl, `/admin/projects/${projectKey}`, {
      method: 'PATCH',
      body: JSON.stringify({ owner: project.owner }), // no-op for owner, triggers revoke separately
    });
    // Use batch with revoke action
    const revokeRes = await adminFetch(backendUrl, '/admin/batch/projects', {
      method: 'POST',
      body: JSON.stringify({ keys: [projectKey], action: 'revoke' }),
    });
    if (revokeRes.ok) load();
  }

  if (loading) return <div style={{ padding: 24 }}>Loading…</div>;
  if (error) return <div style={{ padding: 24, color: 'var(--color-error, #e55)' }}>{error}</div>;
  if (!project) return null;

  return (
    <div style={{ padding: 24, maxWidth: 900 }}>
      <button className="btn btn--ghost btn--sm" onClick={() => navigate('/admin/projects')} style={{ marginBottom: 12 }}>
        ← Back to Projects
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <h2 style={{ margin: 0 }}>📁 {project.owner}</h2>
        <span style={{
          padding: '2px 8px', borderRadius: 8, fontSize: 12,
          background: project.active ? 'var(--color-success-bg, #e6f9e6)' : 'var(--color-error-bg, #fde8e8)',
          color: project.active ? 'var(--color-success, #2a7)' : 'var(--color-error, #e55)',
        }}>
          {project.active ? 'Active' : 'Revoked'}
        </span>
      </div>

      {/* Project info */}
      <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: '8px 16px', marginBottom: 24, fontSize: 14 }}>
        <span style={{ color: 'var(--color-text-muted)' }}>API Key</span>
        <code style={{ fontSize: 12, wordBreak: 'break-all' }}>{project.key}</code>
        <span style={{ color: 'var(--color-text-muted)' }}>Owner</span>
        <span>
          {project.user ? (
            <button className="btn btn--ghost" style={{ fontSize: 13, padding: '2px 4px' }} onClick={() => navigate(`/admin/users/${project.userId}`)}>
              {project.user.email} ({project.user.name || 'unnamed'})
            </button>
          ) : (
            <span style={{ color: 'var(--color-text-muted)' }}>No linked user</span>
          )}
        </span>
        <span style={{ color: 'var(--color-text-muted)' }}>Expires</span>
        <span>{project.expires || 'Never'}</span>
        <span style={{ color: 'var(--color-text-muted)' }}>Daily Limit</span>
        <span>{project.dailyLimit ?? 'Unlimited'}</span>
        <span style={{ color: 'var(--color-text-muted)' }}>Lifetime Limit</span>
        <span>{project.lifetimeLimit ?? 'Unlimited'} (used: {project.lifetimeUsed})</span>
        <span style={{ color: 'var(--color-text-muted)' }}>Created</span>
        <span>{project.createdAt}</span>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        {project.active ? (
          <button className="btn btn--ghost btn--sm" onClick={handleRevoke} style={{ color: 'var(--color-error, #e55)' }}>
            🚫 Revoke
          </button>
        ) : (
          <button className="btn btn--ghost btn--sm" onClick={async () => {
            await adminFetch(backendUrl, '/admin/batch/projects', { method: 'POST', body: JSON.stringify({ keys: [projectKey], action: 'activate' }) });
            load();
          }}>
            ✅ Activate
          </button>
        )}
      </div>

      {/* Features */}
      <h3 style={{ fontSize: 15, marginBottom: 8 }}>Features</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 6, marginBottom: 12 }}>
        {Object.entries(FEATURE_LABELS).map(([code, label]) => (
          <label key={code} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', padding: '4px 8px', borderRadius: 6, background: featureEdits[code] ? 'var(--color-success-bg, #e6f9e6)' : 'transparent' }}>
            <input
              type="checkbox"
              checked={!!featureEdits[code]}
              onChange={() => toggleFeature(code)}
            />
            {label}
          </label>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 24 }}>
        <button className="btn btn--primary btn--sm" onClick={saveFeatures} disabled={savingFeatures}>
          {savingFeatures ? 'Saving…' : 'Save Features'}
        </button>
        {featureMsg && <span style={{ fontSize: 12, color: featureMsg.includes('Saved') || featureMsg.includes('saved') ? 'var(--color-success, #2a7)' : 'var(--color-error, #e55)' }}>{featureMsg}</span>}
      </div>

      {/* Members */}
      <h3 style={{ fontSize: 15, marginBottom: 8 }}>Members ({(project.members || []).length})</h3>
      {(project.members || []).length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>No members</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--color-border)' }}>
              <th style={{ padding: '8px 4px', textAlign: 'left' }}>Email</th>
              <th style={{ padding: '8px 4px', textAlign: 'left' }}>Name</th>
              <th style={{ padding: '8px 4px', textAlign: 'left' }}>Access</th>
              <th style={{ padding: '8px 4px', textAlign: 'left' }}>Permissions</th>
            </tr>
          </thead>
          <tbody>
            {(project.members || []).map(m => (
              <tr key={m.user_id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                <td style={{ padding: '6px 4px' }}>
                  <button className="btn btn--ghost" style={{ fontSize: 12, padding: '2px 4px' }} onClick={() => navigate(`/admin/users/${m.user_id}`)}>
                    {m.email}
                  </button>
                </td>
                <td style={{ padding: '6px 4px' }}>{m.name || '—'}</td>
                <td style={{ padding: '6px 4px' }}>
                  <span style={{ padding: '2px 6px', borderRadius: 8, fontSize: 11, background: 'var(--color-border)' }}>
                    {m.access_level}
                  </span>
                </td>
                <td style={{ padding: '6px 4px', fontSize: 11, color: 'var(--color-text-muted)' }}>
                  {(m.permissions || []).join(', ') || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
