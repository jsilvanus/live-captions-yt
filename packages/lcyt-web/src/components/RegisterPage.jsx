import { useState } from 'react';
import { useUserAuth } from '../hooks/useUserAuth';
import { KEYS } from '../lib/storageKeys.js';

function getBackendUrl() {
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

export function RegisterPage() {
  const { register } = useUserAuth();
  const [backendUrl, setBackendUrl] = useState(getBackendUrl);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!backendUrl.trim() || !email.trim() || !password) return;
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await register(backendUrl.trim(), email.trim(), password, name.trim() || undefined);
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
          Create account
        </h1>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="settings-field">
            <label className="settings-field__label" htmlFor="reg-backend-url">Server URL</label>
            <input
              id="reg-backend-url"
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
            <label className="settings-field__label" htmlFor="reg-name">Name (optional)</label>
            <input
              id="reg-name"
              className="settings-field__input"
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Your name"
              autoComplete="name"
              autoFocus
            />
          </div>
          <div className="settings-field">
            <label className="settings-field__label" htmlFor="reg-email">Email</label>
            <input
              id="reg-email"
              className="settings-field__input"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoComplete="email"
            />
          </div>
          <div className="settings-field">
            <label className="settings-field__label" htmlFor="reg-password">Password</label>
            <input
              id="reg-password"
              className="settings-field__input"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              required
              autoComplete="new-password"
              minLength={8}
            />
          </div>
          <div className="settings-field">
            <label className="settings-field__label" htmlFor="reg-confirm">Confirm password</label>
            <input
              id="reg-confirm"
              className="settings-field__input"
              type="password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              placeholder="Repeat password"
              required
              autoComplete="new-password"
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
            {loading ? 'Creating account…' : 'Create Account'}
          </button>
        </form>
        <p style={{ marginTop: 20, fontSize: 13, color: 'var(--color-text-muted)', textAlign: 'center' }}>
          Already have an account?{' '}
          <a
            href={`/login${backendUrl ? `?server=${encodeURIComponent(backendUrl)}` : ''}`}
            style={{ color: 'var(--color-accent)' }}
          >
            Sign in
          </a>
        </p>
      </div>
    </div>
  );
}
