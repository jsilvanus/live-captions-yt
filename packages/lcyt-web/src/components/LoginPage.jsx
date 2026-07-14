import { useState, useEffect } from 'react';
import { useUserAuth } from '../hooks/useUserAuth';
import { KEYS } from '../lib/storageKeys.js';
import { AuthLayout } from './auth/AuthLayout';
import { StepDots } from './auth/StepDots';
import { BackendCard } from './auth/BackendCard';

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

  // Step state (1 = backend selection, 2 = auth, 3 = success)
  const [step, setStep] = useState(1);

  // Phase 1: backend selection
  const [preset, setPreset] = useState(getInitialPreset);
  const [customUrl, setCustomUrl] = useState('');
  const [probing, setProbing] = useState(false);
  const [features, setFeatures] = useState(() => getBackendFeatures() || null);    // null = not probed yet
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
      setStep(2);
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
      try {
        localStorage.removeItem(KEYS.session.config);
        localStorage.removeItem(KEYS.session.autoConnect);
      } catch {
        // Ignore cleanup failures; storage may be unavailable in private browsing.
      }
      window.location.assign('/projects');
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
    setStep(3);
  }

  // ─── Render ─────────────────────────────────────────────

  return (
    <AuthLayout
      cornerPrompt={step <= 2 ? "No account?" : ""}
      cornerLinkLabel={step <= 2 ? "Sign up →" : ""}
      cornerLinkHref={step <= 2 ? `/register${backendUrl ? `?server=${encodeURIComponent(backendUrl)}` : ''}` : '#'}
    >
      {/* ── STEP 1: Backend Selection ────────────────────────── */}
      {step === 1 && (
        <div>
          <StepDots step={1} total={2} />
          <h2 style={{ fontSize: '1.8rem', fontWeight: 700, marginBottom: '1.5rem', color: 'var(--auth-text)', fontFamily: 'var(--auth-ff-serif)' }}>
            Choose your backend
          </h2>
          <p className="auth-explanation">
            Select where your captions will be delivered from. You can change this later.
          </p>

          {/* Cloud preset */}
          <BackendCard
            selected={preset === 'normal'}
            onClick={() => { setPreset('normal'); setCustomUrl(''); }}
            title="LCYT Cloud"
            subtitle={PRESETS[0].url}
            description="Managed, always up-to-date"
          />

          {/* Minimal preset */}
          <BackendCard
            selected={preset === 'minimal'}
            onClick={() => { setPreset('minimal'); setCustomUrl(''); }}
            title="Minimal"
            subtitle={PRESETS[1].url}
            description="Captions only, lightweight"
          />

          {/* Custom preset */}
          <BackendCard
            selected={preset === 'custom'}
            onClick={() => setPreset('custom')}
            title="Self-hosted"
            description={preset === 'custom' ? undefined : "Run your own instance"}
          >
            {preset === 'custom' && (
              <input
                type="text"
                className="auth-card__input"
                inputMode="url"
                value={customUrl}
                onChange={e => setCustomUrl(e.target.value)}
                placeholder="https://your-server.example.com"
                autoComplete="url"
              />
            )}
          </BackendCard>

          {probeError && <div className="auth-error">{probeError}</div>}

          <button
            className="auth-btn-primary"
            onClick={handleProbe}
            disabled={probing || !backendUrl}
            style={{ marginTop: '1.5rem' }}
          >
            {probing ? 'Connecting…' : 'Continue →'}
          </button>
        </div>
      )}

      {/* ── STEP 2: Authentication ─────────────────────────── */}
      {step === 2 && features && (
        <div>
          <div className="auth-steps">
            <StepDots step={2} total={2} />
            <button
              className="auth-back-button"
              onClick={() => { setFeatures(null); setError(null); setStep(1); }}
            >
              ← Back
            </button>
          </div>

          <h2 style={{ fontSize: '1.8rem', fontWeight: 700, marginBottom: '1.5rem', color: 'var(--auth-text)', fontFamily: 'var(--auth-ff-serif)' }}>
            Sign in
          </h2>

          {/* Feature pills */}
          <div className="auth-pills">
            {features.map(f => (
              <span key={f} className={f === 'login' ? undefined : 'auth-pill'}>
                {f}
              </span>
            ))}
            {hasLogin && (
              <span className="auth-pill auth-pill--success">Free sign up</span>
            )}
          </div>

          {/* Login mode */}
          {hasLogin && (
            <>
              {/* OAuth buttons (disabled) */}
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

              {/* Divider */}
              <div className="auth-divider">
                <div className="auth-divider-line"></div>
                <div className="auth-divider-text">or</div>
                <div className="auth-divider-line"></div>
              </div>

              {/* Email/password form */}
              <form onSubmit={handleLogin}>
                <div className="auth-field">
                  <label className="auth-label" htmlFor="login-email">Email</label>
                  <input
                    id="login-email"
                    className="auth-input"
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                    autoComplete="email"
                    autoFocus
                  />
                </div>
                <div className="auth-field">
                  <label className="auth-label" htmlFor="login-password">Password</label>
                  <input
                    id="login-password"
                    className="auth-input"
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    autoComplete="current-password"
                  />
                  <div style={{ marginTop: '0.3rem', textAlign: 'right' }}>
                    <span
                      className="auth-link auth-link-disabled"
                      title="Coming soon"
                    >
                      Forgot password?
                    </span>
                  </div>
                </div>
                {error && <div className="auth-error">{error}</div>}
                <button
                  className="auth-btn-primary"
                  type="submit"
                  disabled={loading}
                  style={{ marginTop: '1.25rem' }}
                >
                  {loading ? 'Signing in…' : 'Sign In'}
                </button>
              </form>
            </>
          )}

          {/* Minimal mode */}
          {!hasLogin && (
            <form onSubmit={handleMinimalContinue}>
              <p className="auth-explanation">
                This backend does not require a user account. Enter an API key (or leave blank for default) and continue.
              </p>
              <div className="auth-field">
                <label className="auth-label" htmlFor="login-apikey">API Key</label>
                <input
                  id="login-apikey"
                  className="auth-input"
                  type="text"
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  placeholder="(optional — defaults to 'default')"
                  autoComplete="off"
                  autoFocus
                />
              </div>
              {error && <div className="auth-error">{error}</div>}
              <button
                className="auth-btn-primary"
                type="submit"
                style={{ marginTop: '1.25rem' }}
              >
                Continue →
              </button>
            </form>
          )}
        </div>
      )}

      {/* ── STEP 3: Success ─────────────────────────────── */}
      {step === 3 && (
        <div className="auth-success">
          <div className="auth-success-icon">✓</div>
          <h2 className="auth-success-headline">You&rsquo;re in.</h2>
          <p className="auth-success-text">
            {hasLogin ? (
              <>
                Signed in as <span className="auth-success-email">{email}</span>
              </>
            ) : (
              <>
                Connected to <span className="auth-success-url">{backendUrl}</span>
              </>
            )}
          </p>
          <button
            className="auth-btn-primary"
            onClick={() => window.location.href = hasLogin ? '/projects' : '/'}
            style={{ marginTop: '2rem' }}
          >
            Open the app →
          </button>
        </div>
      )}
    </AuthLayout>
  );
}
