/**
 * DeviceLoginPage — /device-login
 *
 * Pin-code login for physical production devices (cameras, mics, mixers).
 * Two-step: enter 6-digit project code → enter 6-digit role PIN → auto-connect.
 *
 * Stores device JWT in sessionStorage (not localStorage) so the session ends when
 * the tab/browser closes. The JWT has no expiry; revoke by deactivating the device role.
 *
 * URL params: ?server=https://api.example.com  (pre-fills the backend URL field)
 */
import { useState, useRef } from 'react';
import { KEYS } from '../lib/storageKeys.js';

const ROLE_TYPE_ICONS = {
  camera: '📷',
  mic:    '🎤',
  mixer:  '🎛',
  custom: '⚙',
};

function getServerFromStorage() {
  try {
    const raw = localStorage.getItem('lcyt-user');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.backendUrl) return parsed.backendUrl;
    }
  } catch {}
  const params = new URLSearchParams(window.location.search);
  return params.get('server') || '';
}

export function DeviceLoginPage() {
  const [step, setStep] = useState('server'); // 'server' | 'code' | 'pin' | 'done'
  const [server, setServer] = useState(getServerFromStorage);
  const [deviceCode, setDeviceCode] = useState('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [connectedRole, setConnectedRole] = useState(null);
  const pinRef = useRef(null);

  async function handleCodeSubmit(e) {
    e.preventDefault();
    if (deviceCode.length !== 6) return;
    setStep('pin');
    setTimeout(() => pinRef.current?.focus(), 50);
  }

  async function handlePinSubmit(e) {
    e.preventDefault();
    if (pin.length !== 6) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${server.replace(/\/$/, '')}/auth/device-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceCode, pin }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);

      // Store device token + backend URL
      sessionStorage.setItem('lcyt-device', JSON.stringify({
        token:    data.token,
        apiKey:   data.apiKey,
        roleType: data.roleType,
        roleId:   data.roleId,
        name:     data.name,
        permissions: data.permissions,
        backendUrl: server.replace(/\/$/, ''),
      }));

      setConnectedRole(data);
      setStep('done');
    } catch (err) {
      setError(err.message);
      setPin('');
    } finally {
      setLoading(false);
    }
  }

  function handleNavigate() {
    if (!connectedRole) return;
    const base = server.replace(/\/$/, '');
    switch (connectedRole.roleType) {
      case 'camera':
        window.location.href = `/production/camera/${connectedRole.apiKey}`;
        break;
      case 'mixer':
        window.location.href = `/production/lcyt-mixer/${connectedRole.apiKey}`;
        break;
      default:
        // For mic and custom: go to the main captioning UI pre-loaded with this project
        try {
          const existing = JSON.parse(localStorage.getItem(KEYS.session?.config || 'lcyt-session-config') || '{}');
          localStorage.setItem(KEYS.session?.config || 'lcyt-session-config', JSON.stringify({
            ...existing,
            backendUrl: base,
            apiKey: connectedRole.apiKey,
          }));
        } catch {}
        window.location.href = '/';
    }
  }

  const container = {
    minHeight: '100vh',
    background: 'var(--color-bg)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  };

  const card = {
    background: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    borderRadius: 12,
    padding: '32px 28px',
    width: '100%',
    maxWidth: 360,
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
  };

  const pinInput = {
    fontFamily: 'monospace',
    fontSize: 32,
    fontWeight: 700,
    letterSpacing: '0.3em',
    textAlign: 'center',
    width: '100%',
    padding: '10px',
    borderRadius: 8,
    border: '2px solid var(--color-border)',
    background: 'var(--color-bg)',
    color: 'var(--color-text)',
    outline: 'none',
  };

  if (step === 'done' && connectedRole) {
    return (
      <div style={container}>
        <div style={{ ...card, alignItems: 'center', textAlign: 'center' }}>
          <div style={{ fontSize: 48 }}>{ROLE_TYPE_ICONS[connectedRole.roleType] || '⚙'}</div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-text)' }}>
              {connectedRole.name}
            </div>
            <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 4 }}>
              Connected as {connectedRole.roleType}
            </div>
          </div>
          <button
            className="btn btn--primary"
            onClick={handleNavigate}
            style={{ width: '100%', padding: '12px', fontSize: 15 }}
          >
            Go to {connectedRole.roleType === 'camera' ? 'camera view' : connectedRole.roleType === 'mixer' ? 'mixer' : 'captioning'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={container}>
      <div style={card}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 28, marginBottom: 4 }}>📡</div>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-text)', margin: 0 }}>
            Device login
          </h1>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: '6px 0 0' }}>
            Enter the codes provided by your operator.
          </p>
        </div>

        {/* Server field (shown if not auto-detected) */}
        {step === 'server' && (
          <form onSubmit={e => { e.preventDefault(); if (server.trim()) setStep('code'); }} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="settings-field">
              <label className="settings-field__label">Server URL</label>
              <input
                className="settings-field__input"
                type="url"
                placeholder="https://api.example.com"
                value={server}
                onChange={e => setServer(e.target.value)}
                autoFocus
                required
              />
            </div>
            <button className="btn btn--primary" type="submit" style={{ width: '100%' }}>
              Continue
            </button>
          </form>
        )}

        {step === 'code' && (
          <form onSubmit={handleCodeSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 13, color: 'var(--color-text-muted)', textAlign: 'center' }}>
              Step 1 of 2 — Project code
            </div>
            <input
              style={pinInput}
              type="tel"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              placeholder="000000"
              value={deviceCode}
              onChange={e => setDeviceCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              autoFocus
              required
            />
            <button
              className="btn btn--primary"
              type="submit"
              disabled={deviceCode.length !== 6}
              style={{ width: '100%' }}
            >
              Continue
            </button>
            <button
              className="btn btn--ghost btn--sm"
              type="button"
              onClick={() => { setStep('server'); setDeviceCode(''); }}
              style={{ alignSelf: 'center' }}
            >
              ← Change server
            </button>
          </form>
        )}

        {step === 'pin' && (
          <form onSubmit={handlePinSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 13, color: 'var(--color-text-muted)', textAlign: 'center' }}>
              Step 2 of 2 — Role PIN
            </div>
            <input
              ref={pinRef}
              style={pinInput}
              type="tel"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              placeholder="000000"
              value={pin}
              onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              autoFocus
              required
            />
            {error && (
              <div style={{ color: 'var(--color-error)', fontSize: 12, textAlign: 'center' }}>{error}</div>
            )}
            <button
              className="btn btn--primary"
              type="submit"
              disabled={pin.length !== 6 || loading}
              style={{ width: '100%' }}
            >
              {loading ? 'Connecting…' : 'Connect'}
            </button>
            <button
              className="btn btn--ghost btn--sm"
              type="button"
              onClick={() => { setStep('code'); setPin(''); setError(null); }}
              style={{ alignSelf: 'center' }}
            >
              ← Back
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
