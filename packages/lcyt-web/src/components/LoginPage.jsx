import { useState, useEffect } from 'react';
import { useUserAuth } from '../hooks/useUserAuth';
import { KEYS } from '../lib/storageKeys.js';

// ---------------------------------------------------------------------------
// Backend presets — user-selectable in phase 1
// ---------------------------------------------------------------------------

const PRESETS = [
  { id: 'normal',  label: 'Normal',  url: 'https://api.lcyt.fi' },
  { id: 'minimal', label: 'Minimal', url: 'https://minimal.lcyt.fi' },
  { id: 'custom',  label: 'Custom',  url: '' },
];

function getInitialPreset() {
  try {
    const saved = localStorage.getItem(KEYS.backend.preset);
    if (saved && PRESETS.some(p => p.id === saved)) return saved;
  } catch { /* ignore */ }
  return 'normal';
}

function getInitialBackendUrl() {
  const params = new URLSearchParams(window.location.search);
  const urlParam = params.get('server');
  if (urlParam) return urlParam;
  try {
    const cfg = JSON.parse(localStorage.getItem(KEYS.session.config) || '{}');
    if (cfg.backendUrl) return cfg.backendUrl;
  } catch { /* ignore */ }
  const preset = getInitialPreset();
  const match = PRESETS.find(p => p.id === preset);
  return match?.url || '';
}

/** Persist backend features to localStorage so AuthGate and sidebar can read them. */
export function saveBackendFeatures(features) {
  try { localStorage.setItem(KEYS.backend.features, JSON.stringify(features)); } catch { /* ignore */ }
}

/** Read saved backend features list (or null). */
export function getBackendFeatures() {
  try {
    const raw = localStorage.getItem(KEYS.backend.features);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// LoginPage — two-phase backend selection + auth
// ---------------------------------------------------------------------------

export function LoginPage() {
  const { login } = useUserAuth();

  // Phase 1: backend selection
  const [preset, setPreset] = useState(getInitialPreset);
  const [customUrl, setCustomUrl] = useState('');
  const [probing, setProbing] = useState(false);
  const [features, setFeatures] = useState(() => getBackendFeatures() || ['login']);    // null = not probed yet
  const [probeError, setProbeError] = useState(null);

  // Phase 2: authentication (depends on features)
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  // Derive the effective backend URL
  const backendUrl = preset === 'custom' ? customUrl.trim() : (PRESETS.find(p => p.id === preset)?.url || '');

  // Has login feature?
  const hasLogin = features && features.includes('login');

  // Reset probe when backend changes
  useEffect(() => {
    setFeatures(null);
    setProbeError(null);
    setError(null);
  }, [backendUrl]);

  // ─── Phase 1: Probe backend ─────────────────────────────

  async function handleProbe() {
    if (!backendUrl) { setProbeError('Please enter a server URL'); return; }
    let url;
    try { url = new URL(backendUrl); } catch { setProbeError('Please enter a valid URL (e.g. https://api.lcyt.fi)'); return; }
    setProbing(true);
    setProbeError(null);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 8000);
    try {
      const res = await fetch(`${url.origin}${url.pathname.replace(/\/$/, '')}/health`, {
        signal: ac.signal,
        cache: 'no-store',
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data = await res.json();
      if (!data.ok || !Array.isArray(data.features)) throw new Error('Invalid health response');
      setFeatures(data.features);
      saveBackendFeatures(data.features);
      try { localStorage.setItem(KEYS.backend.preset, preset); } catch { /* ignore */ }
    } catch (err) {
      clearTimeout(timer);
      setProbeError(err.name === 'AbortError' ? 'Connection timed out' : (err.message || 'Could not reach server'));
      setFeatures(null);
    } finally {
      setProbing(false);
    }
  }

  // ─── Phase 2A: User login (backend has login) ───────────

  async function handleLogin(e) {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setError(null);
    setLoading(true);
    try {
      await login(backendUrl, email.trim(), password);
      window.location.href = '/projects';
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // ─── Phase 2B: Minimal mode (no login — API key only) ──

  async function handleMinimalContinue(e) {
    e.preventDefault();
    const key = apiKey.trim() || 'default';
    // Save session config + features, then enter the app
    try {
      localStorage.setItem(KEYS.session.config, JSON.stringify({ backendUrl, apiKey: key }));
      // Mark minimal mode — AuthGate checks this
      localStorage.setItem(KEYS.backend.features, JSON.stringify(features));
    } catch { /* ignore */ }
    window.location.href = '/';
  }

  // ─── Render ─────────────────────────────────────────────

  const boxStyle = {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--color-bg)',
    padding: 24,
  };

  return (
    <div style={boxStyle}>
      <div style={{ width: '100%', maxWidth: 420 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 8, color: 'var(--color-text)' }}>
          LCYT
        </h1>
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 24 }}>
          Live Captions for YouTube
        </p>

        {/* ── Phase 1: Backend selection ───────────────────── */}
        <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
          <div className="settings-field">
            <label className="settings-field__label" htmlFor="login-preset">Backend</label>
            <select
              id="login-preset"
              className="settings-field__input"
              value={preset}
              onChange={e => { setPreset(e.target.value); }}
            >
              {PRESETS.map(p => (
                <option key={p.id} value={p.id}>{p.label}{p.url ? ` (${p.url})` : ''}</option>
              ))}
            </select>
          </div>

          {preset === 'custom' && (
            <div className="settings-field" style={{ marginTop: 8 }}>
              <label className="settings-field__label" htmlFor="login-custom-url">Server URL</label>
              <input
                id="login-custom-url"
                className="settings-field__input"
                type="text"
                inputMode="url"
                value={customUrl}
                onChange={e => setCustomUrl(e.target.value)}
                placeholder="https://your-server.example.com"
                autoComplete="url"
              />
            </div>
          )}

          {!features && (
            <button
              className="btn btn--primary"
              style={{ marginTop: 12, width: '100%' }}
              onClick={handleProbe}
              disabled={probing || !backendUrl}
            >
              {probing ? 'Connecting…' : 'Connect'}
            </button>
          )}

          {probeError && (
            <div style={{ color: 'var(--color-error)', fontSize: 13, marginTop: 8 }}>{probeError}</div>
          )}
        </fieldset>

        {/* ── Feature badge row ──────────────────────────── */}
        {features && (
          <div style={{ marginTop: 16, marginBottom: 16 }}>
            <div style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 6,
              fontSize: 11,
            }}>
              {features.map(f => (
                <span
                  key={f}
                  style={{
                    background: 'var(--color-bg-alt, #2a2a2a)',
                    color: 'var(--color-text-muted)',
                    padding: '2px 8px',
                    borderRadius: 4,
                  }}
                >
                  {f}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* ── Phase 2A: User login (has login feature) ──── */}
        {features && hasLogin && (
          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
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
            >
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)', textAlign: 'center' }}>
              Don&rsquo;t have an account?{' '}
              <a
                href={`/register${backendUrl ? `?server=${encodeURIComponent(backendUrl)}` : ''}`}
                style={{ color: 'var(--color-accent)' }}
              >
                Register
              </a>
            </p>
          </form>
        )}

        {/* ── Phase 2B: Minimal mode (no login) ────────── */}
        {features && !hasLogin && (
          <form onSubmit={handleMinimalContinue} style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
              This backend does not require a user account. Enter an API key (or leave blank for default) and continue.
            </p>
            <div className="settings-field">
              <label className="settings-field__label" htmlFor="login-apikey">API Key</label>
              <input
                id="login-apikey"
                className="settings-field__input"
                type="text"
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder="(optional — defaults to 'default')"
                autoComplete="off"
                autoFocus
              />
            </div>
            {error && (
              <div style={{ color: 'var(--color-error)', fontSize: 13 }}>{error}</div>
            )}
            <button
              className="btn btn--primary"
              type="submit"
            >
              Continue
            </button>
          </form>
        )}

        {/* ── Change backend link (after probe) ──────────── */}
        {features && (
          <p style={{ marginTop: 12, fontSize: 12, color: 'var(--color-text-muted)', textAlign: 'center' }}>
            <button
              type="button"
              onClick={() => { setFeatures(null); setError(null); }}
              style={{ background: 'none', border: 'none', color: 'var(--color-accent)', cursor: 'pointer', fontSize: 12, padding: 0 }}
            >
              ← Change backend
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
