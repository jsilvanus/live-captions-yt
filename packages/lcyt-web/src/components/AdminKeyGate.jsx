import { useState, useEffect } from 'react';
import { getAdminKey, setAdminKey } from '../lib/admin.js';

/**
 * Gate component that requires admin key entry before rendering children.
 * Verifies the key by making a test request to the admin API.
 */
export function AdminKeyGate({ backendUrl, children }) {
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
      const res = await fetch(`${backendUrl}/admin/users?limit=1`, {
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
