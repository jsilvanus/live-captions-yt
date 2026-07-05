import { useState, useEffect, useCallback } from 'react';
import { useSessionContext } from '../../contexts/SessionContext';
import { SetupCard } from './SetupCard.jsx';

const EMPTY = { storage_type: 's3', bucket: '', region: 'auto', endpoint: '', prefix: 'captions', access_key_id: '', secret_access_key: '' };

/**
 * StorageSection — per-key S3/WebDAV storage override, wired to the real
 * `GET/PUT/DELETE /file/storage-config` endpoints (feature-gated server-side
 * by the "files-custom-bucket" / "files-webdav" project features). No prior
 * frontend existed for this; this is a minimal new panel, not a duplicate of
 * an existing one.
 */
export function StorageSection() {
  const session = useSessionContext();
  const connected = session?.connected;
  const backendUrl = session?.backendUrl;

  const [mode, setMode] = useState('default');
  const [form, setForm] = useState(EMPTY);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    if (!connected || !backendUrl) return;
    const token = session.getSessionToken?.();
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${backendUrl}/file/storage-config`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setMode(data.storageMode || 'default');
      if (data.config) setForm(f => ({ ...f, ...data.config, secret_access_key: '' }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [connected, backendUrl, session]);

  useEffect(() => { load(); }, [load]);

  function update(field, value) {
    setForm(f => ({ ...f, [field]: value }));
    setSaved(false);
  }

  async function handleSave() {
    const token = session.getSessionToken?.();
    if (!token) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const r = await fetch(`${backendUrl}/file/storage-config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(form),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setSaved(true);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    const token = session.getSessionToken?.();
    if (!token) return;
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(`${backendUrl}/file/storage-config`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) { const data = await r.json().catch(() => ({})); throw new Error(data.error || `HTTP ${r.status}`); }
      setForm(EMPTY);
      setMode('default');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <SetupCard
      id="storage"
      icon="🪣"
      title="Storage override"
      description="Per-project S3-compatible or WebDAV storage for saved caption files (default falls back to the server-wide bucket)."
      status="partial"
      statusLabel={mode === 'default' ? 'Using default' : 'Custom'}
    >
      {!connected ? (
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: 0 }}>
          Connect to a project to configure storage.
        </p>
      ) : loading ? (
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: 0 }}>Loading…</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="settings-field">
            <label className="settings-field__label">Storage type</label>
            <select className="settings-field__input" value={form.storage_type} onChange={e => update('storage_type', e.target.value)}>
              <option value="s3">S3-compatible</option>
              <option value="webdav">WebDAV</option>
            </select>
          </div>
          {form.storage_type === 's3' ? (
            <>
              <div className="settings-field">
                <label className="settings-field__label">Bucket</label>
                <input className="settings-field__input" value={form.bucket} onChange={e => update('bucket', e.target.value)} placeholder="my-bucket" />
              </div>
              <div className="settings-field">
                <label className="settings-field__label">Region</label>
                <input className="settings-field__input" value={form.region} onChange={e => update('region', e.target.value)} placeholder="auto" />
              </div>
              <div className="settings-field">
                <label className="settings-field__label">Custom endpoint (R2 / MinIO / B2)</label>
                <input className="settings-field__input" value={form.endpoint || ''} onChange={e => update('endpoint', e.target.value)} placeholder="https://…" />
              </div>
              <div className="settings-field">
                <label className="settings-field__label">Access key ID</label>
                <input className="settings-field__input" value={form.access_key_id || ''} onChange={e => update('access_key_id', e.target.value)} />
              </div>
              <div className="settings-field">
                <label className="settings-field__label">Secret access key</label>
                <input className="settings-field__input" type="password" value={form.secret_access_key || ''} onChange={e => update('secret_access_key', e.target.value)} placeholder={mode !== 'default' ? '•••••••• (unchanged)' : ''} />
              </div>
            </>
          ) : (
            <div className="settings-field">
              <label className="settings-field__label">WebDAV server URL</label>
              <input className="settings-field__input" value={form.endpoint || ''} onChange={e => update('endpoint', e.target.value)} placeholder="https://…" />
            </div>
          )}
          <div className="settings-field">
            <label className="settings-field__label">Object key prefix</label>
            <input className="settings-field__input" value={form.prefix} onChange={e => update('prefix', e.target.value)} placeholder="captions" />
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
            {error && <span style={{ fontSize: 12, color: 'var(--color-error)' }}>{error}</span>}
            {saved && <span style={{ fontSize: 12, color: 'var(--color-success, #2e9e5b)' }}>Saved.</span>}
            {mode !== 'default' && (
              <button className="btn btn--ghost btn--sm" onClick={handleReset} disabled={saving}>Revert to default</button>
            )}
            <button className="btn btn--primary btn--sm" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
          <p style={{ fontSize: 11, color: 'var(--color-text-muted)', margin: 0 }}>
            Requires the <code>files-custom-bucket</code> (or <code>files-webdav</code>) project feature to be enabled.
          </p>
        </div>
      )}
    </SetupCard>
  );
}
