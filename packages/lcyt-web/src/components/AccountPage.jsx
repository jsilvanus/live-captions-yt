import { useState } from 'react';
import { Link } from 'wouter';
import { useUserAuth } from '../hooks/useUserAuth';
import { KEYS } from '../lib/storageKeys.js';
import { applyTheme } from '../lib/settings.js';
import { initialsFromName } from '../lib/avatar.js';

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
        <Link href="/login" className="btn btn--primary">Sign in</Link>
        <Link href="/register" className="btn btn--ghost">Create account</Link>
      </div>
    </div>
  );
}

// ─── Segmented pill control (General/Editor/Planner theme) ───────────────────

function SegmentedControl({ options, value, onChange }) {
  return (
    <div style={{ display: 'inline-flex', background: 'var(--color-surface)', border: '1.5px solid var(--color-border)', borderRadius: 8, padding: 3, gap: 2 }}>
      {options.map(o => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            style={{
              padding: '0.3rem 1rem', borderRadius: 5, fontSize: 13, fontWeight: active ? 600 : 400,
              background: active ? 'var(--color-primary)' : 'transparent',
              color: active ? '#fff' : 'var(--color-text-muted)',
              border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ─── Account info (display name + email) ──────────────────────────────────────

function AccountInfoForm({ user, updateProfile }) {
  const [name, setName] = useState(user.name || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  async function handleSave() {
    setSaving(true);
    setError('');
    setSuccess(false);
    try {
      await updateProfile(name.trim());
      setSuccess(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="account-page__section">
      <h3 className="account-page__section-title">Account</h3>
      <div className="settings-field">
        <label className="settings-field__label" htmlFor="acct-display-name">Display name</label>
        <input
          id="acct-display-name"
          className="settings-field__input"
          type="text"
          value={name}
          onChange={e => { setName(e.target.value); setSuccess(false); }}
        />
      </div>
      <div className="settings-field">
        <label className="settings-field__label" htmlFor="acct-email">Email address</label>
        <input id="acct-email" className="settings-field__input" type="email" value={user.email} disabled />
      </div>
      {error && <div className="account-page__error">{error}</div>}
      {success && <div className="account-page__success">Saved.</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn btn--primary" type="button" onClick={handleSave} disabled={saving || name.trim() === (user.name || '')}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
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

  const mismatch = next.length > 0 && confirm.length > 0 && next !== confirm;
  const disabled = loading || !current || next.length < 8 || next !== confirm;

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
      {mismatch && <div className="account-page__error">Passwords do not match.</div>}
      {error && !mismatch && <div className="account-page__error">{error}</div>}
      {success && <div className="account-page__success">Password changed successfully.</div>}
      <button className="btn btn--primary" type="submit" disabled={disabled}>
        {loading ? 'Saving…' : 'Update password'}
      </button>
    </form>
  );
}

// ─── Appearance (theme pickers) ───────────────────────────────────────────────

const THEME_OPTIONS = [
  { value: 'auto',  label: 'Auto' },
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
      <h3 className="account-page__section-title">Settings</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
        <div>
          <p style={{ fontSize: 14, fontWeight: 500, margin: 0 }}>General theme</p>
          <p className="account-page__section-desc" style={{ margin: '2px 0 0' }}>Overall application appearance</p>
        </div>
        <SegmentedControl options={THEME_OPTIONS} value={general} onChange={handleGeneralChange} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
        <div>
          <p style={{ fontSize: 14, fontWeight: 500, margin: 0 }}>Editor theme</p>
          <p className="account-page__section-desc" style={{ margin: '2px 0 0' }}>Graphics Editor appearance</p>
        </div>
        <SegmentedControl options={THEME_OPTIONS} value={editor} onChange={v => handlePageThemeChange(KEYS.ui.editorTheme, v, setEditor)} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div>
          <p style={{ fontSize: 14, fontWeight: 500, margin: 0 }}>Planner theme</p>
          <p className="account-page__section-desc" style={{ margin: '2px 0 0' }}>Run planner appearance</p>
        </div>
        <SegmentedControl options={THEME_OPTIONS} value={planner} onChange={v => handlePageThemeChange(KEYS.ui.plannerTheme, v, setPlanner)} />
      </div>
    </div>
  );
}

// ─── Danger zone ───────────────────────────────────────────────────────────────

function DangerZonePanel({ exportData, removeData, deleteAccount, logout }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  async function handleExport() {
    setError('');
    setBusy('export');
    try {
      const data = await exportData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `lcyt-account-data-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  async function handleRemoveData() {
    if (!window.confirm('Permanently delete your owned projects, files, and history? This cannot be undone.')) return;
    setError('');
    setBusy('remove');
    try {
      await removeData();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  async function handleDeleteAccount() {
    if (!window.confirm('Permanently delete your account? This cannot be undone.')) return;
    setError('');
    setBusy('delete');
    try {
      await deleteAccount();
      window.location.href = '/login';
    } catch (err) {
      setError(err.message);
      setBusy('');
    }
  }

  return (
    <div className="account-page__section account-page__section--danger">
      <h3 className="account-page__section-title account-page__section-title--danger">Danger zone</h3>
      {error && <div className="account-page__error">{error}</div>}

      <div className="account-page__danger-row">
        <div>
          <p className="account-page__danger-row-title">Export my data</p>
          <p className="account-page__section-desc">Download a copy of all your data.</p>
        </div>
        <button className="btn btn--ghost" onClick={handleExport} disabled={busy === 'export'}>
          {busy === 'export' ? 'Exporting…' : 'Export data'}
        </button>
      </div>

      <div className="account-page__danger-row">
        <div>
          <p className="account-page__danger-row-title">Remove all data</p>
          <p className="account-page__section-desc">Permanently delete your projects, files and history.</p>
        </div>
        <button className="btn btn--ghost" onClick={handleRemoveData} disabled={busy === 'remove'}>
          {busy === 'remove' ? 'Removing…' : 'Remove data'}
        </button>
      </div>

      <div className="account-page__danger-row account-page__danger-row--severe">
        <div>
          <p className="account-page__danger-row-title account-page__danger-row-title--danger">Delete account</p>
          <p className="account-page__section-desc">Permanently delete your account. This cannot be undone.</p>
        </div>
        <button className="btn btn--danger" onClick={handleDeleteAccount} disabled={busy === 'delete'}>
          {busy === 'delete' ? 'Deleting…' : 'Delete account'}
        </button>
      </div>
    </div>
  );
}

// ─── Logged-in profile view ───────────────────────────────────────────────────

function ProfilePanel({ user, logout, changePassword, updateProfile, exportData, removeData, deleteAccount }) {
  return (
    <div className="account-page__profile">
      <div className="account-page__header">
        <div className="account-page__avatar">{initialsFromName(user.name, user.email)}</div>
        <div>
          <h1 className="account-page__display-name">{user.name || user.email}</h1>
          <p className="account-page__section-desc">{user.email}</p>
        </div>
      </div>

      <AccountInfoForm user={user} updateProfile={updateProfile} />
      <ChangePasswordForm changePassword={changePassword} />
      <AppearancePanel />
      <DangerZonePanel exportData={exportData} removeData={removeData} deleteAccount={deleteAccount} logout={logout} />

      <div className="account-page__section" style={{ border: 'none', boxShadow: 'none' }}>
        <button
          className="btn btn--ghost"
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
 * a profile view (avatar, display name, email, password change, appearance,
 * danger zone, sign-out) when they are logged in.  Keeps `/login` and
 * `/register` as separate standalone routes for direct-link access.
 */
export function AccountPage() {
  const { user, loading, logout, changePassword, updateProfile, exportData, removeData, deleteAccount } = useUserAuth();

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
        ? <ProfilePanel
            user={user}
            logout={logout}
            changePassword={changePassword}
            updateProfile={updateProfile}
            exportData={exportData}
            removeData={removeData}
            deleteAccount={deleteAccount}
          />
        : <AnonymousPanel />}
    </div>
  );
}
