import { useState } from 'react';
import { Link } from 'wouter';
import { useUserAuth } from '../hooks/useUserAuth';
import { KEYS } from '../lib/storageKeys.js';
import { applyTheme } from '../lib/settings.js';

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

// ─── Appearance (theme pickers) ───────────────────────────────────────────────

const THEME_OPTIONS = [
  { value: 'auto',  label: 'Auto (system)' },
  { value: 'dark',  label: 'Dark' },
  { value: 'light', label: 'Light' },
];

function getStoredTheme(key, fallback = 'auto') {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}

/**
 * AppearancePanel — General/Editor/Planner theme pickers. General is wired
 * to the same global `applyTheme()` mechanism used elsewhere in the app (it
 * takes effect immediately, everywhere). Editor and Planner are per-page
 * overrides (see usePageThemeOverride) that only apply while you're on the
 * Graphics → Editor / Planner page respectively — client-only, no backend.
 */
function AppearancePanel() {
  const [general, setGeneral] = useState(() => getStoredTheme(KEYS.ui.theme));
  const [editor, setEditor]   = useState(() => getStoredTheme(KEYS.ui.editorTheme));
  const [planner, setPlanner] = useState(() => getStoredTheme(KEYS.ui.plannerTheme));

  function handleGeneralChange(value) {
    setGeneral(value);
    applyTheme(value);
  }

  function handlePageThemeChange(key, value, setter) {
    setter(value);
    try { localStorage.setItem(key, value); } catch { /* ignore */ }
  }

  return (
    <div className="account-page__section">
      <h3 className="account-page__section-title">Appearance</h3>
      <div className="settings-field">
        <label className="settings-field__label" htmlFor="acct-theme-general">General theme</label>
        <select
          id="acct-theme-general"
          className="settings-field__input"
          value={general}
          onChange={e => handleGeneralChange(e.target.value)}
        >
          {THEME_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      <div className="settings-field">
        <label className="settings-field__label" htmlFor="acct-theme-editor">Graphics editor theme</label>
        <select
          id="acct-theme-editor"
          className="settings-field__input"
          value={editor}
          onChange={e => handlePageThemeChange(KEYS.ui.editorTheme, e.target.value, setEditor)}
        >
          {THEME_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <p className="account-page__section-desc">Applies only while you're on the Graphics → Editor page.</p>
      </div>
      <div className="settings-field">
        <label className="settings-field__label" htmlFor="acct-theme-planner">Planner theme</label>
        <select
          id="acct-theme-planner"
          className="settings-field__input"
          value={planner}
          onChange={e => handlePageThemeChange(KEYS.ui.plannerTheme, e.target.value, setPlanner)}
        >
          {THEME_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <p className="account-page__section-desc">Applies only while you're on the Planner page.</p>
      </div>
    </div>
  );
}

// ─── Danger zone (stub — no backend endpoints exist yet) ─────────────────────

function DangerZonePanel() {
  return (
    <div className="account-page__section">
      <h3 className="account-page__section-title">Danger zone</h3>
      <p className="account-page__section-desc">
        These actions require backend endpoints that don't exist yet — shown
        here so the plan is visible, not hidden.
      </p>
      <div className="account-page__row-disabled">
        <button className="btn btn--ghost" disabled title="Coming soon">Export my data</button>
        <span className="account-page__soon-badge">Coming soon</span>
      </div>
      <div className="account-page__row-disabled">
        <button className="btn btn--ghost" disabled title="Coming soon">Remove my data</button>
        <span className="account-page__soon-badge">Coming soon</span>
      </div>
      <div className="account-page__row-disabled">
        <button className="btn btn--danger" disabled title="Coming soon">Delete account</button>
        <span className="account-page__soon-badge">Coming soon</span>
      </div>
    </div>
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
        <div className="account-page__row-disabled">
          <button className="btn btn--ghost btn--sm" disabled title="Coming soon">Edit name</button>
          <span className="account-page__soon-badge">Coming soon</span>
        </div>
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

      {/* Appearance */}
      <AppearancePanel />

      {/* Change password */}
      <ChangePasswordForm changePassword={changePassword} />

      {/* Danger zone */}
      <DangerZonePanel />

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
