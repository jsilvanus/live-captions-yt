import { useState, useEffect } from 'react';
import { getAdminKey, setAdminKey } from '../lib/admin.js';

/**
 * Gate component that allows access when the logged-in user is an admin.
 *
 * If the user is logged in and has `isAdmin: true` (from the user JWT / /auth/me),
 * the children are rendered immediately.
 *
 * Falls back to prompting for the legacy X-Admin-Key for servers that still use
 * the ADMIN_KEY environment variable without user-based logins.
 */
export function AdminKeyGate({ backendUrl, userIsAdmin = false, children }) {
  const [key, setKey] = useState(getAdminKey);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [valid, setValid] = useState(false);

  // Hooks must run unconditionally on every render (rules of hooks) — the
  // user-based-admin early return below happens after this, not before.
  // `userIsAdmin` starts false and flips to true once useUserAuth's async
  // /auth/me check resolves, so an early return placed before this useEffect
  // would make this component call a different number of hooks across
  // renders of the same instance, crashing with "Rendered fewer hooks than
  // expected" the moment a real (non-legacy-key) admin logs in.
  useEffect(() => {
    if (!userIsAdmin && key) verify(key);
  }, []);

  // User-based admin: skip the key gate entirely
  if (userIsAdmin) return children;

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
