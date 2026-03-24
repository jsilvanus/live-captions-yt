import { useState } from 'react';
import { Link } from 'wouter';
import { useUserAuth } from '../hooks/useUserAuth';

// ─── Anonymous state ──────────────────────────────────────────────────────────

function AnonymousPanel() {
  return (
    <div className="account-page__panel">
      <div className="account-page__anon-icon">👤</div>
      <h2 className="account-page__anon-title">Not signed in</h2>
      <p className="account-page__anon-desc">
        Sign in to manage your projects and API keys, or create a new account.
      </p>
      <div className="account-page__anon-actions">
        <Link href="/login">
          <a className="btn btn--primary">Sign in</a>
        </Link>
        <Link href="/register">
          <a className="btn btn--ghost">Create account</a>
        </Link>
      </div>
    </div>
  );
}

// ─── Change password form ─────────────────────────────────────────────────────

function ChangePasswordForm({ changePassword }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    if (next !== confirm) {
      setError('New passwords do not match.');
      return;
    }
    if (next.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setLoading(true);
    try {
      await changePassword(current, next);
      setSuccess(true);
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="account-page__section" onSubmit={handleSubmit}>
      <h3 className="account-page__section-title">Change Password</h3>
      <div className="settings-field">
        <label className="settings-field__label" htmlFor="acct-cur-pw">Current password</label>
        <input
          id="acct-cur-pw"
          className="settings-field__input"
          type="password"
          value={current}
          onChange={e => setCurrent(e.target.value)}
          placeholder="••••••••"
          autoComplete="current-password"
          required
        />
      </div>
      <div className="settings-field">
        <label className="settings-field__label" htmlFor="acct-new-pw">New password</label>
        <input
          id="acct-new-pw"
          className="settings-field__input"
          type="password"
          value={next}
          onChange={e => setNext(e.target.value)}
          placeholder="••••••••"
          autoComplete="new-password"
          required
          minLength={8}
        />
      </div>
      <div className="settings-field">
        <label className="settings-field__label" htmlFor="acct-confirm-pw">Confirm new password</label>
        <input
          id="acct-confirm-pw"
          className="settings-field__input"
          type="password"
          value={confirm}
          onChange={e => setConfirm(e.target.value)}
          placeholder="••••••••"
          autoComplete="new-password"
          required
        />
      </div>
      {error && <div className="account-page__error">{error}</div>}
      {success && <div className="account-page__success">Password changed successfully.</div>}
      <button className="btn btn--primary" type="submit" disabled={loading}>
        {loading ? 'Saving…' : 'Change password'}
      </button>
    </form>
  );
}

// ─── Logged-in profile view ───────────────────────────────────────────────────

function ProfilePanel({ user, backendUrl, logout, changePassword }) {
  return (
    <div className="account-page__profile">
      {/* User info */}
      <div className="account-page__section">
        <h3 className="account-page__section-title">Profile</h3>
        <div className="account-page__info-row">
          <span className="account-page__info-label">Email</span>
          <span className="account-page__info-value">{user.email}</span>
        </div>
        {user.name && (
          <div className="account-page__info-row">
            <span className="account-page__info-label">Name</span>
            <span className="account-page__info-value">{user.name}</span>
          </div>
        )}
        {backendUrl && (
          <div className="account-page__info-row">
            <span className="account-page__info-label">Server</span>
            <span className="account-page__info-value account-page__info-value--muted">{backendUrl}</span>
          </div>
        )}
      </div>

      {/* Projects quick link */}
      <div className="account-page__section">
        <h3 className="account-page__section-title">Projects</h3>
        <p className="account-page__section-desc">
          Manage your API keys and projects.
        </p>
        <Link href="/projects">
          <a className="btn btn--ghost">Go to Projects →</a>
        </Link>
      </div>

      {/* Change password */}
      <ChangePasswordForm changePassword={changePassword} />

      {/* Sign out */}
      <div className="account-page__section">
        <button
          className="btn btn--danger"
          onClick={() => { logout(); window.location.href = '/login'; }}
          type="button"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * AccountPage — `/account`
 *
 * Shows a sign-in / register prompt when the user is not authenticated, or
 * a profile view (email, name, server URL, password change, sign-out) when
 * they are logged in.  Keeps `/login` and `/register` as separate standalone
 * routes for direct-link access (per plan Phase 4).
 */
export function AccountPage() {
  const { user, backendUrl, loading, logout, changePassword } = useUserAuth();

  if (loading) {
    return (
      <div className="account-page account-page--loading">
        Loading…
      </div>
    );
  }

  return (
    <div className="account-page">
      {user
        ? <ProfilePanel user={user} backendUrl={backendUrl} logout={logout} changePassword={changePassword} />
        : <AnonymousPanel />}
    </div>
  );
}
