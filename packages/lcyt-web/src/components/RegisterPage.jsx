import { useState } from 'react';
import { useUserAuth } from '../hooks/useUserAuth';
import { KEYS } from '../lib/storageKeys.js';
import { AuthLayout } from './auth/AuthLayout';

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
    try { new URL(backendUrl.trim()); } catch { setError('Please enter a valid server URL (e.g. https://api.lcyt.fi)'); return; }
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
    <AuthLayout
      cornerPrompt="Already have an account?"
      cornerLinkLabel="Sign in →"
      cornerLinkHref={`/login${backendUrl ? `?server=${encodeURIComponent(backendUrl)}` : ''}`}
    >
      <h1 style={{ fontSize: '1.8rem', fontWeight: 700, marginBottom: '1.5rem', color: 'var(--auth-text)', fontFamily: 'var(--auth-ff-serif)' }}>
        Create account
      </h1>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column' }}>
        <div className="auth-field">
          <label className="auth-label" htmlFor="reg-backend-url">Server URL</label>
          <input
            id="reg-backend-url"
            className="auth-input"
            type="text"
            inputMode="url"
            value={backendUrl}
            onChange={e => setBackendUrl(e.target.value)}
            placeholder="https://api.lcyt.fi"
            required
            autoComplete="url"
          />
        </div>
        <div className="auth-field">
          <label className="auth-label" htmlFor="reg-name">Name (optional)</label>
          <input
            id="reg-name"
            className="auth-input"
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Your name"
            autoComplete="name"
            autoFocus
          />
        </div>
        <div className="auth-field">
          <label className="auth-label" htmlFor="reg-email">Email</label>
          <input
            id="reg-email"
            className="auth-input"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            autoComplete="email"
          />
        </div>
        <div className="auth-field">
          <label className="auth-label" htmlFor="reg-password">Password</label>
          <input
            id="reg-password"
            className="auth-input"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            required
            autoComplete="new-password"
            minLength={8}
          />
        </div>
        <div className="auth-field">
          <label className="auth-label" htmlFor="reg-confirm">Confirm password</label>
          <input
            id="reg-confirm"
            className="auth-input"
            type="password"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            placeholder="Repeat password"
            required
            autoComplete="new-password"
          />
        </div>
        {error && (
          <div className="auth-error">{error}</div>
        )}
        <button
          className="auth-btn-primary"
          type="submit"
          disabled={loading}
          style={{ marginTop: '1.5rem' }}
        >
          {loading ? 'Creating account…' : 'Create Account'}
        </button>
      </form>
    </AuthLayout>
  );
}
