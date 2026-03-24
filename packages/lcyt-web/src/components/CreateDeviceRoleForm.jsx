/**
 * CreateDeviceRoleForm — create a new device role (camera / mic / mixer / custom).
 * Returns the plain-text PIN exactly once after creation.
 */
import { useState } from 'react';

export function CreateDeviceRoleForm({ backendUrl, token, apiKey, onCreated }) {
  const [roleType, setRoleType] = useState('camera');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [createdPin, setCreatedPin] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(`${backendUrl}/keys/${encodeURIComponent(apiKey)}/device-roles`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ roleType, name: name.trim() }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setCreatedPin(data.pin);
      setName('');
      setRoleType('camera');
      onCreated?.(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {createdPin && (
        <div style={{
          background: 'var(--color-bg)',
          border: '1px solid var(--color-primary)',
          borderRadius: 6,
          padding: '10px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text)' }}>
            Device role created. Share this PIN with the operator:
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <code style={{ fontFamily: 'monospace', fontSize: 24, fontWeight: 700, letterSpacing: '0.2em', color: 'var(--color-primary)' }}>
              {createdPin}
            </code>
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Shown once only.</span>
          </div>
          <button className="btn btn--ghost btn--sm" style={{ alignSelf: 'flex-start', fontSize: 11 }} onClick={() => setCreatedPin(null)}>
            Dismiss
          </button>
        </div>
      )}
      <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <select
          className="settings-field__input"
          value={roleType}
          onChange={e => setRoleType(e.target.value)}
          style={{ width: 110 }}
        >
          <option value="camera">Camera</option>
          <option value="mic">Mic</option>
          <option value="mixer">Mixer</option>
          <option value="custom">Custom</option>
        </select>
        <input
          className="settings-field__input"
          placeholder='Name, e.g. "Camera 1"'
          value={name}
          onChange={e => setName(e.target.value)}
          style={{ flex: 1, minWidth: 140 }}
          required
        />
        <button className="btn btn--primary btn--sm" type="submit" disabled={saving}>
          {saving ? '…' : 'Create'}
        </button>
      </form>
      {error && <div style={{ color: 'var(--color-error)', fontSize: 12 }}>{error}</div>}
    </div>
  );
}
