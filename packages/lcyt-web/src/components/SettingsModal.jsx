import { useState, useEffect } from 'react';
import { useSessionContext } from '../contexts/SessionContext';
import { useToastContext } from '../contexts/ToastContext';

function applyTheme(value) {
  const html = document.documentElement;
  if (value === 'dark') {
    html.setAttribute('data-theme', 'dark');
  } else if (value === 'light') {
    html.setAttribute('data-theme', 'light');
  } else {
    html.removeAttribute('data-theme');
  }
  try { localStorage.setItem('lcyt-theme', value); } catch {}
}

export function SettingsModal({ isOpen, onClose }) {
  const session = useSessionContext();
  const { showToast } = useToastContext();

  const [activeTab, setActiveTab] = useState('connection');
  const [backendUrl, setBackendUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [streamKey, setStreamKey] = useState('');
  const [autoConnect, setAutoConnect] = useState(false);
  const [theme, setTheme] = useState('auto');
  const [batchInterval, setBatchInterval] = useState(0);
  const [showApiKey, setShowApiKey] = useState(false);
  const [showStreamKey, setShowStreamKey] = useState(false);
  const [error, setError] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [hbResult, setHbResult] = useState(null);
  const [syncResult, setSyncResult] = useState(null);
  const [lastConnectedTime, setLastConnectedTime] = useState(null);

  // Apply theme on mount and when session connects
  useEffect(() => {
    const savedTheme = localStorage.getItem('lcyt-theme') || 'auto';
    setTheme(savedTheme);
    applyTheme(savedTheme);
  }, []);

  useEffect(() => {
    if (session.connected) setLastConnectedTime(Date.now());
  }, [session.connected]);

  // Load persisted values when modal opens
  useEffect(() => {
    if (!isOpen) return;
    const cfg = session.getPersistedConfig();
    if (cfg.backendUrl) setBackendUrl(cfg.backendUrl);
    if (cfg.apiKey) setApiKey(cfg.apiKey);
    if (cfg.streamKey) setStreamKey(cfg.streamKey);
    setAutoConnect(session.getAutoConnect());
    const savedBatch = parseInt(localStorage.getItem('lcyt-batch-interval') || '0', 10);
    setBatchInterval(savedBatch);
    setError('');
  }, [isOpen]);

  // Keyboard: Esc closes, Ctrl+, toggles
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape' && isOpen) onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  function onThemeChange(value) {
    setTheme(value);
    applyTheme(value);
  }

  function onBatchChange(value) {
    const v = parseInt(value, 10);
    setBatchInterval(v);
    try { localStorage.setItem('lcyt-batch-interval', String(v)); } catch {}
  }

  async function handleConnect() {
    setError('');
    if (!backendUrl) { setError('Backend URL is required'); return; }
    if (!apiKey) { setError('API Key is required'); return; }
    if (!streamKey) { setError('Stream Key is required'); return; }

    setConnecting(true);
    try {
      await session.connect({ backendUrl, apiKey, streamKey });
      session.setAutoConnect(autoConnect);
      showToast('Connected', 'success');
      onClose();
    } catch (err) {
      setError(err.message || 'Connection failed');
    } finally {
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    await session.disconnect();
    showToast('Disconnected', 'info');
    onClose();
  }

  async function handleSync() {
    if (!session.connected) { showToast('Not connected', 'warning'); return; }
    try {
      const data = await session.sync();
      setSyncResult(`${data.syncOffset}ms`);
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function handleHeartbeat() {
    if (!session.connected) { showToast('Not connected', 'warning'); return; }
    try {
      const data = await session.heartbeat();
      setHbResult(`${data.roundTripTime}ms`);
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  function handleClearConfig() {
    session.clearPersistedConfig();
    setBackendUrl('');
    setApiKey('');
    setStreamKey('');
    setAutoConnect(false);
    showToast('Config cleared', 'info');
  }

  return (
    <div className="settings-modal">
      <div className="settings-modal__backdrop" onClick={onClose} />
      <div className="settings-modal__box">
        <div className="settings-modal__header">
          <span className="settings-modal__title">Settings</span>
          <button className="settings-modal__close" onClick={onClose} title="Close (Esc)">✕</button>
        </div>

        <div className="settings-modal__tabs">
          {['connection', 'captions', 'status', 'actions'].map(tab => (
            <button
              key={tab}
              className={`settings-tab${activeTab === tab ? ' settings-tab--active' : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        <div className="settings-modal__body">
          {activeTab === 'connection' && (
            <div className="settings-panel settings-panel--active">
              <div className="settings-field">
                <label className="settings-field__label">Backend URL</label>
                <input
                  className="settings-field__input"
                  type="url"
                  placeholder="http://localhost:3000"
                  autoComplete="off"
                  value={backendUrl}
                  onChange={e => setBackendUrl(e.target.value)}
                />
              </div>
              <div className="settings-field">
                <label className="settings-field__label">API Key</label>
                <div className="settings-field__input-wrap">
                  <input
                    className="settings-field__input settings-field__input--has-eye"
                    type={showApiKey ? 'text' : 'password'}
                    placeholder="••••••••"
                    autoComplete="off"
                    value={apiKey}
                    onChange={e => setApiKey(e.target.value)}
                  />
                  <button className="settings-field__eye" onClick={() => setShowApiKey(v => !v)} title="Toggle visibility">👁</button>
                </div>
              </div>
              <div className="settings-field">
                <label className="settings-field__label">Stream Key</label>
                <div className="settings-field__input-wrap">
                  <input
                    className="settings-field__input settings-field__input--has-eye"
                    type={showStreamKey ? 'text' : 'password'}
                    placeholder="••••••••"
                    autoComplete="off"
                    value={streamKey}
                    onChange={e => setStreamKey(e.target.value)}
                  />
                  <button className="settings-field__eye" onClick={() => setShowStreamKey(v => !v)} title="Toggle visibility">👁</button>
                </div>
              </div>
              <label className="settings-checkbox">
                <input type="checkbox" checked={autoConnect} onChange={e => setAutoConnect(e.target.checked)} />
                Auto-connect on startup
              </label>
              <div className="settings-field">
                <label className="settings-field__label">Theme</label>
                <select
                  className="settings-field__input"
                  style={{ appearance: 'auto' }}
                  value={theme}
                  onChange={e => onThemeChange(e.target.value)}
                >
                  <option value="auto">Auto (system)</option>
                  <option value="dark">Dark</option>
                  <option value="light">Light</option>
                </select>
              </div>
              {error && <div className="settings-error">{error}</div>}
            </div>
          )}

          {activeTab === 'captions' && (
            <div className="settings-panel settings-panel--active">
              <div className="settings-field">
                <label className="settings-field__label">
                  Batch window: <span>{batchInterval === 0 ? 'Off' : `${batchInterval}s`}</span>
                </label>
                <input
                  className="settings-field__input"
                  type="range"
                  min="0" max="20" step="1"
                  value={batchInterval}
                  onChange={e => onBatchChange(e.target.value)}
                  style={{ padding: 0, cursor: 'pointer' }}
                />
              </div>
              <p style={{ fontSize: 12, color: 'var(--color-text-dim)', margin: 0, lineHeight: 1.5 }}>
                0 = send each caption immediately.<br />
                1–20 s = collect captions over the window, then send as a single batch.
              </p>
            </div>
          )}

          {activeTab === 'status' && (
            <div className="settings-panel settings-panel--active">
              <div className="settings-status-row">
                <span className="settings-status-row__label">Connection</span>
                <span
                  className="settings-status-row__value"
                  style={{ color: session.connected ? 'var(--color-success)' : 'var(--color-text-dim)' }}
                >
                  {session.connected ? '● Connected' : '○ Disconnected'}
                </span>
              </div>
              <div className="settings-status-row">
                <span className="settings-status-row__label">Backend URL</span>
                <span className="settings-status-row__value">{session.backendUrl || '—'}</span>
              </div>
              <div className="settings-status-row">
                <span className="settings-status-row__label">Sequence</span>
                <span className="settings-status-row__value">{session.connected ? session.sequence : '—'}</span>
              </div>
              <div className="settings-status-row">
                <span className="settings-status-row__label">Sync Offset</span>
                <span className="settings-status-row__value">{session.connected ? `${session.syncOffset}ms` : '—'}</span>
              </div>
              <div className="settings-status-row">
                <span className="settings-status-row__label">Last connected</span>
                <span className="settings-status-row__value">
                  {lastConnectedTime ? new Date(lastConnectedTime).toLocaleTimeString() : '—'}
                </span>
              </div>
            </div>
          )}

          {activeTab === 'actions' && (
            <div className="settings-panel settings-panel--active">
              <div className="settings-modal__actions">
                <button className="btn btn--secondary btn--sm" onClick={handleSync}>⟳ Sync Now</button>
                <button className="btn btn--secondary btn--sm" onClick={handleHeartbeat}>♥ Heartbeat</button>
              </div>
              {hbResult && (
                <div className="settings-status-row">
                  <span className="settings-status-row__label">Round-trip</span>
                  <span className="settings-status-row__value">{hbResult}</span>
                </div>
              )}
              {syncResult && (
                <div className="settings-status-row">
                  <span className="settings-status-row__label">Sync offset</span>
                  <span className="settings-status-row__value">{syncResult}</span>
                </div>
              )}
              <hr style={{ borderColor: 'var(--color-border)', margin: '8px 0' }} />
              <button className="btn btn--danger btn--sm" onClick={handleClearConfig}>🗑 Clear saved config</button>
            </div>
          )}
        </div>

        <div className="settings-modal__footer">
          <div className="settings-modal__actions">
            <button className="btn btn--primary" onClick={handleConnect} disabled={connecting}>
              {connecting ? 'Connecting…' : 'Connect'}
            </button>
            <button className="btn btn--secondary" onClick={handleDisconnect}>Disconnect</button>
            <button className="btn btn--secondary" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}
