import { useState, useEffect, useRef } from 'react';
import { useSessionContext } from '../contexts/SessionContext';
import { useToastContext } from '../contexts/ToastContext';
import {
  COMMON_LANGUAGES, STT_MODELS,
  getSttEngine, setSttEngine,
  getSttLang, setSttLang,
  getSttCloudConfig, patchSttCloudConfig,
} from '../lib/sttConfig';
import {
  getGoogleCredential, setGoogleCredential, clearGoogleCredential,
} from '../lib/googleCredential';

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

  // ── Connection tab ────────────────────────────────────────
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

  // ── STT tab ───────────────────────────────────────────────
  const cloudCfg = getSttCloudConfig();
  const savedLang = getSttLang();
  const savedLangEntry = COMMON_LANGUAGES.find(l => l.code === savedLang);

  const [sttEngine, setSttEngineState] = useState(getSttEngine);
  const [sttLangQuery, setSttLangQuery] = useState(savedLangEntry ? savedLangEntry.label : savedLang);
  const [sttLang, setSttLangState] = useState(savedLang);
  const [sttLangDropdownOpen, setSttLangDropdownOpen] = useState(false);
  const [sttModel, setSttModel] = useState(cloudCfg.model || 'latest_long');
  const [cloudPunctuation, setCloudPunctuation] = useState(cloudCfg.punctuation !== false);
  const [cloudProfanity, setCloudProfanity] = useState(!!cloudCfg.profanity);
  const [cloudConfidence, setCloudConfidence] = useState(cloudCfg.confidence ?? 0.70);
  const [cloudMaxLen, setCloudMaxLen] = useState(cloudCfg.maxLen || 80);
  const [credential, setCredentialState] = useState(getGoogleCredential);
  const [credError, setCredError] = useState('');
  const credFileRef = useRef(null);

  // Apply theme on mount
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
    // Re-sync STT state in case it changed outside
    setSttEngineState(getSttEngine());
    setCredentialState(getGoogleCredential());
    setCredError('');
  }, [isOpen]);

  // Keep credential state in sync with the module (e.g. cleared externally)
  useEffect(() => {
    function onCredChanged() { setCredentialState(getGoogleCredential()); }
    window.addEventListener('lcyt:stt-credential-changed', onCredChanged);
    return () => window.removeEventListener('lcyt:stt-credential-changed', onCredChanged);
  }, []);

  // Keyboard: Esc closes
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape' && isOpen) onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // ── Connection tab handlers ───────────────────────────────

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

  async function handleResetSequence() {
    if (!session.connected) { showToast('Not connected', 'warning'); return; }
    try {
      await session.updateSequence(0);
      showToast('Sequence reset to 0', 'success');
    } catch (err) {
      showToast(err.message || 'Failed to reset sequence', 'error');
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

  // ── STT tab handlers ──────────────────────────────────────

  function onSttEngineChange(engine) {
    setSttEngineState(engine);
    setSttEngine(engine);
  }

  function onSttLangInput(value) {
    setSttLangQuery(value);
    setSttLangDropdownOpen(value.trim().length > 0);
  }

  function selectSttLang(entry) {
    setSttLangQuery(entry.label);
    setSttLangState(entry.code);
    setSttLangDropdownOpen(false);
    setSttLang(entry.code);
  }

  async function handleCredentialFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCredError('');
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      if (!json.client_email || !json.private_key) {
        setCredError('Invalid service account file — missing client_email or private_key.');
        return;
      }
      setGoogleCredential(json);
      setCredentialState(json);
      showToast(`Credential loaded: ${json.client_email}`, 'success');
    } catch {
      setCredError('Could not parse file. Make sure it is a valid JSON service account key.');
    } finally {
      e.target.value = '';
    }
  }

  function handleClearCredential() {
    clearGoogleCredential();
    setCredentialState(null);
  }

  const sttLangMatches = sttLangDropdownOpen
    ? COMMON_LANGUAGES.filter(l =>
        l.label.toLowerCase().includes(sttLangQuery.toLowerCase()) ||
        l.code.toLowerCase().includes(sttLangQuery.toLowerCase())
      )
    : [];

  const TABS = ['connection', 'captions', 'stt', 'status', 'actions'];
  const TAB_LABELS = { connection: 'Connection', captions: 'Captions', stt: 'STT / Audio', status: 'Status', actions: 'Actions' };

  return (
    <div className="settings-modal">
      <div className="settings-modal__backdrop" onClick={onClose} />
      <div className="settings-modal__box">
        <div className="settings-modal__header">
          <span className="settings-modal__title">Settings</span>
          <button className="settings-modal__close" onClick={onClose} title="Close (Esc)">✕</button>
        </div>

        <div className="settings-modal__tabs">
          {TABS.map(tab => (
            <button
              key={tab}
              className={`settings-tab${activeTab === tab ? ' settings-tab--active' : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              {TAB_LABELS[tab]}
            </button>
          ))}
        </div>

        <div className="settings-modal__body">

          {/* ── Connection ── */}
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

          {/* ── Captions ── */}
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

          {/* ── STT / Audio ── */}
          {activeTab === 'stt' && (
            <div className="settings-panel settings-panel--active">

              {/* Engine selector */}
              <div className="settings-field">
                <label className="settings-field__label">Recognition Engine</label>
                <div className="stt-engine-list">
                  {[
                    { value: 'webkit', name: 'Web Speech API',    desc: 'Browser built-in (Chrome / Edge). No account required.' },
                    { value: 'cloud',  name: 'Google Cloud STT',  desc: 'Higher accuracy and more language models. Requires a service account JSON key.' },
                  ].map(opt => (
                    <label
                      key={opt.value}
                      className={`stt-engine-option${sttEngine === opt.value ? ' stt-engine-option--active' : ''}`}
                    >
                      <input
                        type="radio"
                        name="stt-engine"
                        value={opt.value}
                        checked={sttEngine === opt.value}
                        onChange={() => onSttEngineChange(opt.value)}
                        className="stt-engine-option__radio"
                      />
                      <div className="stt-engine-option__body">
                        <span className="stt-engine-option__name">{opt.name}</span>
                        <span className="stt-engine-option__desc">{opt.desc}</span>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* Language (shared by both engines) */}
              <div className="settings-field">
                <label className="settings-field__label">Language</label>
                <div className="audio-lang-wrap">
                  <input
                    className="settings-field__input"
                    type="text"
                    placeholder="Type to filter…"
                    autoComplete="off"
                    spellCheck={false}
                    value={sttLangQuery}
                    onChange={e => onSttLangInput(e.target.value)}
                    onBlur={() => setTimeout(() => setSttLangDropdownOpen(false), 150)}
                  />
                  {sttLangDropdownOpen && sttLangMatches.length > 0 && (
                    <div className="audio-lang-list">
                      {sttLangMatches.map(l => (
                        <button
                          key={l.code}
                          className="audio-lang-option"
                          onMouseDown={() => selectSttLang(l)}
                        >
                          {l.label} <span className="audio-lang-code">{l.code}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <span className="settings-field__hint">{sttLang}</span>
              </div>

              {/* Cloud STT-specific settings */}
              {sttEngine === 'cloud' && (
                <>
                  <div className="settings-field">
                    <label className="settings-field__label">Model</label>
                    <select
                      className="settings-field__input"
                      style={{ appearance: 'auto' }}
                      value={sttModel}
                      onChange={e => { setSttModel(e.target.value); patchSttCloudConfig({ model: e.target.value }); }}
                    >
                      {STT_MODELS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                    </select>
                    <span className="settings-field__hint">
                      latest_long suits most live-speech use cases. telephony is optimised for phone audio.
                    </span>
                  </div>

                  <div className="settings-field">
                    <label className="settings-field__label">Options</label>
                    <label className="settings-checkbox">
                      <input
                        type="checkbox"
                        checked={cloudPunctuation}
                        onChange={e => { setCloudPunctuation(e.target.checked); patchSttCloudConfig({ punctuation: e.target.checked }); }}
                      />
                      Automatic punctuation
                    </label>
                    <label className="settings-checkbox">
                      <input
                        type="checkbox"
                        checked={cloudProfanity}
                        onChange={e => { setCloudProfanity(e.target.checked); patchSttCloudConfig({ profanity: e.target.checked }); }}
                      />
                      Profanity filter
                    </label>
                  </div>

                  <div className="settings-field">
                    <label className="settings-field__label">
                      Confidence threshold: <strong>{Number(cloudConfidence).toFixed(2)}</strong>
                    </label>
                    <input
                      type="range"
                      className="settings-field__input"
                      style={{ padding: 0, cursor: 'pointer' }}
                      min="0" max="1" step="0.05"
                      value={cloudConfidence}
                      onChange={e => {
                        setCloudConfidence(Number(e.target.value));
                        patchSttCloudConfig({ confidence: Number(e.target.value) });
                      }}
                    />
                    <span className="settings-field__hint">
                      Transcripts below this score are dimmed and not auto-sent.
                    </span>
                  </div>

                  <div className="settings-field">
                    <label className="settings-field__label">Max caption length (chars)</label>
                    <input
                      type="number"
                      className="settings-field__input"
                      style={{ width: 100 }}
                      min="20" max="500" step="10"
                      value={cloudMaxLen}
                      onChange={e => {
                        setCloudMaxLen(Number(e.target.value));
                        patchSttCloudConfig({ maxLen: Number(e.target.value) });
                      }}
                    />
                  </div>

                  {/* Google service account credential */}
                  <div className="settings-field">
                    <label className="settings-field__label">Google Service Account</label>
                    {credential ? (
                      <div className="stt-cred-loaded">
                        <span className="stt-cred-loaded__check">✓</span>
                        <span className="stt-cred-loaded__email" title={credential.client_email}>
                          {credential.client_email}
                        </span>
                        <button
                          className="btn btn--secondary btn--sm"
                          onClick={handleClearCredential}
                        >
                          Remove
                        </button>
                      </div>
                    ) : (
                      <button
                        className="btn btn--secondary btn--sm"
                        onClick={() => credFileRef.current?.click()}
                      >
                        Load JSON key file…
                      </button>
                    )}
                    {credError && <div className="settings-error">{credError}</div>}
                    <span className="settings-field__hint">
                      Credentials are kept in memory only and are cleared when the page is closed.
                      Never committed to disk or localStorage.
                    </span>
                    <input
                      ref={credFileRef}
                      type="file"
                      accept="application/json,.json"
                      style={{ display: 'none' }}
                      onChange={handleCredentialFile}
                    />
                  </div>
                </>
              )}

            </div>
          )}

          {/* ── Status ── */}
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

          {/* ── Actions ── */}
          {activeTab === 'actions' && (
            <div className="settings-panel settings-panel--active">
              <div className="settings-modal__actions">
                <button className="btn btn--secondary btn--sm" onClick={handleSync}>⟳ Sync Now</button>
                <button className="btn btn--secondary btn--sm" onClick={handleHeartbeat}>♥ Heartbeat</button>
                <button className="btn btn--secondary btn--sm" onClick={handleResetSequence}>↺ Reset sequence</button>
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
