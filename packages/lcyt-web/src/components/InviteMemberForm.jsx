/**
 * InviteMemberForm — invite a user by email to a project.
 */
import { useState } from 'react';

export function InviteMemberForm({ backendUrl, token, apiKey, onInvited }) {
  const [email, setEmail] = useState('');
  const [accessLevel, setAccessLevel] = useState('member');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!email.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(`${backendUrl}/keys/${encodeURIComponent(apiKey)}/members`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ email: email.trim(), accessLevel }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setEmail('');
      setAccessLevel('member');
      onInvited?.(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <input
          className="settings-field__input"
          type="email"
          placeholder="user@example.com"
          value={email}
          onChange={e => setEmail(e.target.value)}
          style={{ flex: 1, minWidth: 160 }}
          required
        />
        <select
          className="settings-field__input"
          value={accessLevel}
          onChange={e => setAccessLevel(e.target.value)}
          style={{ width: 110 }}
        >
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        </select>
        <button className="btn btn--primary btn--sm" type="submit" disabled={saving}>
          {saving ? '…' : 'Invite'}
        </button>
      </div>
      {error && <div style={{ color: 'var(--color-error)', fontSize: 12 }}>{error}</div>}
    </form>
  );
}
