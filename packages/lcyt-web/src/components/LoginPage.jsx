import { useState } from 'react';
import { useUserAuth } from '../hooks/useUserAuth';
import { KEYS } from '../lib/storageKeys.js';

function getBackendUrl() {
  // Read from URL param or localStorage
  const params = new URLSearchParams(window.location.search);
  const urlParam = params.get('server');
  if (urlParam) return urlParam;
  try {
    const cfg = JSON.parse(localStorage.getItem(KEYS.session.config) || '{}');
    return cfg.backendUrl || '';
  } catch {
    return '';
  }
}

export function LoginPage() {
  const { login } = useUserAuth();
  const [backendUrl, setBackendUrl] = useState(getBackendUrl);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!backendUrl.trim() || !email.trim() || !password) return;
    setError(null);
    setLoading(true);
    try {
      await login(backendUrl.trim(), email.trim(), password);
      window.location.href = '/projects';
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--color-bg)',
      padding: 24,
    }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 24, color: 'var(--color-text)' }}>
          Sign in
        </h1>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="settings-field">
            <label className="settings-field__label" htmlFor="login-backend-url">Server URL</label>
            <input
              id="login-backend-url"
              className="settings-field__input"
              type="url"
              value={backendUrl}
              onChange={e => setBackendUrl(e.target.value)}
              placeholder="https://api.lcyt.fi"
              required
              autoComplete="url"
            />
          </div>
          <div className="settings-field">
            <label className="settings-field__label" htmlFor="login-email">Email</label>
            <input
              id="login-email"
              className="settings-field__input"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoComplete="email"
              autoFocus
            />
          </div>
          <div className="settings-field">
            <label className="settings-field__label" htmlFor="login-password">Password</label>
            <input
              id="login-password"
              className="settings-field__input"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              autoComplete="current-password"
            />
          </div>
          {error && (
            <div style={{ color: 'var(--color-error)', fontSize: 13 }}>{error}</div>
          )}
          <button
            className="btn btn--primary"
            type="submit"
            disabled={loading}
            style={{ marginTop: 4 }}
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
        <p style={{ marginTop: 20, fontSize: 13, color: 'var(--color-text-muted)', textAlign: 'center' }}>
          Don&rsquo;t have an account?{' '}
          <a
            href={`/register${backendUrl ? `?server=${encodeURIComponent(backendUrl)}` : ''}`}
            style={{ color: 'var(--color-accent)' }}
          >
            Register
          </a>
        </p>
      </div>
    </div>
  );
}
