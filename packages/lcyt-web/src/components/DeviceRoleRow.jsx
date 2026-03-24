/**
 * DeviceRoleRow — one row in the Device Roles tab of ProjectDetailModal.
 */
import { useState } from 'react';

const ROLE_TYPE_LABELS = {
  camera: { label: 'Camera', color: '#2196f3' },
  mic:    { label: 'Mic',    color: '#4caf50' },
  mixer:  { label: 'Mixer',  color: '#ff9800' },
  custom: { label: 'Custom', color: 'var(--color-text-muted)' },
};

export function DeviceRoleRow({ role, backendUrl, token, apiKey, onDeleted, onPinReset }) {
  const [resetting, setResetting] = useState(false);
  const [newPin, setNewPin] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(null);

  const typeInfo = ROLE_TYPE_LABELS[role.roleType] || ROLE_TYPE_LABELS.custom;

  async function handleResetPin() {
    setResetting(true);
    setError(null);
    try {
      const r = await fetch(
        `${backendUrl}/keys/${encodeURIComponent(apiKey)}/device-roles/${role.id}/reset-pin`,
        { method: 'POST', headers: { Authorization: `Bearer ${token}` } },
      );
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setNewPin(data.pin);
      onPinReset?.(role.id, data.pin);
    } catch (err) {
      setError(err.message);
    } finally {
      setResetting(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`Remove device role "${role.name}"? Any devices using this PIN will lose access.`)) return;
    setDeleting(true);
    setError(null);
    try {
      const r = await fetch(
        `${backendUrl}/keys/${encodeURIComponent(apiKey)}/device-roles/${role.id}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
      );
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      onDeleted?.(role.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div style={{
      padding: '10px 12px',
      borderRadius: 6,
      border: '1px solid var(--color-border)',
      background: 'var(--color-surface)',
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          fontSize: 11,
          fontWeight: 600,
          padding: '2px 7px',
          borderRadius: 10,
          background: `color-mix(in srgb, ${typeInfo.color} 15%, transparent)`,
          color: typeInfo.color,
          border: `1px solid color-mix(in srgb, ${typeInfo.color} 30%, transparent)`,
          whiteSpace: 'nowrap',
        }}>
          {typeInfo.label}
        </span>
        <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: 'var(--color-text)' }}>
          {role.name}
        </span>
        <button
          className="btn btn--ghost btn--sm"
          onClick={handleResetPin}
          disabled={resetting}
          title="Reset PIN"
          style={{ fontSize: 11 }}
        >
          {resetting ? '…' : 'New PIN'}
        </button>
        <button
          className="btn btn--ghost btn--sm"
          onClick={handleDelete}
          disabled={deleting}
          style={{ color: 'var(--color-error)', fontSize: 11 }}
        >
          Remove
        </button>
      </div>
      {newPin && (
        <div style={{
          background: 'var(--color-bg)',
          border: '1px solid var(--color-border)',
          borderRadius: 4,
          padding: '6px 10px',
          fontSize: 12,
          color: 'var(--color-text)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}>
          <span>New PIN: </span>
          <code style={{ fontFamily: 'monospace', fontSize: 16, fontWeight: 700, letterSpacing: '0.15em' }}>
            {newPin}
          </code>
          <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>(shown once)</span>
          <button className="btn btn--ghost btn--sm" style={{ fontSize: 10, marginLeft: 'auto' }} onClick={() => setNewPin(null)}>
            Dismiss
          </button>
        </div>
      )}
      {error && <div style={{ color: 'var(--color-error)', fontSize: 12 }}>{error}</div>}
    </div>
  );
}
