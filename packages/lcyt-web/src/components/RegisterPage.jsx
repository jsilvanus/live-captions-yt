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
  const [step, setStep] = useState('form'); // 'form' | 'success'

  const [backendUrl, setBackendUrl] = useState(getBackendUrl);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [org, setOrg] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const canSubmit = Boolean(
    firstName.trim() && lastName.trim() && email.trim() && password && agreed && backendUrl.trim() && !loading
  );

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    try { new URL(backendUrl.trim()); } catch { setError('Please enter a valid server URL (e.g. https://api.lcyt.fi)'); return; }
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const name = `${firstName.trim()} ${lastName.trim()}`.trim();
      // `org` is intentionally never sent to /auth/register — the backend's `users`
      // table has no organization/workspace column yet, so it only seeds the
      // success-step copy below and stays purely client-side for now.
      await register(backendUrl.trim(), email.trim(), password, name);
      setStep('success');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (step === 'success') {
    const trimmedOrg = org.trim();
    return (
      <AuthLayout>
        <div className="auth-success">
          <div className="auth-success-icon">✓</div>
          <h2 className="auth-success-headline">Account created.</h2>
          <p className="auth-success-text">
            Welcome, <span className="auth-success-email">{firstName.trim()}</span>.
          </p>
          <p className="auth-success-text">
            {trimmedOrg ? (
              <>Your workspace <span className="auth-success-email">&quot;{trimmedOrg}&quot;</span> is ready.</>
            ) : (
              'Your workspace is ready.'
            )}
          </p>
          <button
            className="auth-btn-primary"
            onClick={() => { window.location.href = '/projects'; }}
            style={{ marginTop: '2rem' }}
          >
            Open the app →
          </button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      cornerPrompt="Already have an account?"
      cornerLinkLabel="Sign in →"
      cornerLinkHref={`/login${backendUrl ? `?server=${encodeURIComponent(backendUrl)}` : ''}`}
    >
      <div className="auth-eyebrow">Get started</div>
      <h1 style={{ fontSize: '1.8rem', fontWeight: 700, marginBottom: '0.5rem', color: 'var(--auth-text)', fontFamily: 'var(--auth-ff-serif)' }}>
        Create your account
      </h1>
      <p className="auth-explanation" style={{ marginBottom: '1.5rem' }}>
        Free to start — no credit card required.
      </p>

      {/* OAuth buttons (disabled — no signup endpoint server-side yet) */}
      <button
        className="auth-btn-oauth"
        disabled
        title="Coming soon"
        style={{ marginBottom: '0.5rem' }}
      >
        <span>🔵</span> Continue with Google
        <span style={{ fontSize: '0.65rem', color: 'var(--auth-muted)' }}>Coming soon</span>
      </button>
      <button
        className="auth-btn-oauth"
        disabled
        title="Coming soon"
        style={{ marginBottom: '0.5rem' }}
      >
        <span>⬛</span> Continue with GitHub
        <span style={{ fontSize: '0.65rem', color: 'var(--auth-muted)' }}>Coming soon</span>
      </button>

      <div className="auth-divider">
        <div className="auth-divider-line"></div>
        <div className="auth-divider-text">or sign up with email</div>
        <div className="auth-divider-line"></div>
      </div>

      <form onSubmit={handleSubmit}>
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

        <div className="auth-field-row">
          <div className="auth-field">
            <label className="auth-label" htmlFor="reg-first-name">First name</label>
            <input
              id="reg-first-name"
              className="auth-input"
              type="text"
              value={firstName}
              onChange={e => setFirstName(e.target.value)}
              placeholder="Ada"
              required
              autoComplete="given-name"
              autoFocus
            />
          </div>
          <div className="auth-field">
            <label className="auth-label" htmlFor="reg-last-name">Last name</label>
            <input
              id="reg-last-name"
              className="auth-input"
              type="text"
              value={lastName}
              onChange={e => setLastName(e.target.value)}
              placeholder="Lovelace"
              required
              autoComplete="family-name"
            />
          </div>
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
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            required
            autoComplete="new-password"
            minLength={8}
          />
          <div style={{ marginTop: '0.3rem', textAlign: 'right' }}>
            <button
              type="button"
              className="auth-link auth-link-button"
              onClick={() => setShowPassword(v => !v)}
            >
              {showPassword ? 'Hide password' : 'Show password'}
            </button>
          </div>
        </div>

        <div className="auth-field">
          <label className="auth-label" htmlFor="reg-org">Organization (optional)</label>
          <input
            id="reg-org"
            className="auth-input"
            type="text"
            value={org}
            onChange={e => setOrg(e.target.value)}
            placeholder="Acme Broadcasting"
            autoComplete="organization"
          />
          <p className="auth-hint">Used to set up team access — you can add this later.</p>
        </div>

        <div className="auth-checkbox-row">
          <input
            id="reg-terms"
            type="checkbox"
            checked={agreed}
            onChange={e => setAgreed(e.target.checked)}
          />
          <label className="auth-checkbox-label" htmlFor="reg-terms">
            I agree to the <strong>Terms</strong> and <strong>Privacy Policy</strong>.
          </label>
        </div>

        {error && (
          <div className="auth-error">{error}</div>
        )}

        <button
          className="auth-btn-primary"
          type="submit"
          disabled={!canSubmit}
        >
          {loading ? 'Creating account…' : 'Create account'}
        </button>
      </form>
    </AuthLayout>
  );
}
