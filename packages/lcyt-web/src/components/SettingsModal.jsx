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
import {
  getTranslationEnabled, setTranslationEnabled,
  getTranslationTarget, setTranslationTarget,
  getTranslationVendor, setTranslationVendor,
  getDeepLKey, setDeepLKey,
  getLibreTranslateUrl, setLibreTranslateUrl,
  getLibreTranslateKey, setLibreTranslateKey,
} from '../lib/translationConfig';

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

function applyTextSize(px) {
  document.documentElement.style.setProperty('--caption-text-size', px + 'px');
  try { localStorage.setItem('lcyt:textSize', String(px)); } catch {}
}

export function SettingsModal({ isOpen, onClose }) {
  const session = useSessionContext();
  const { showToast } = useToastContext();

  const [activeTab, setActiveTab] = useState('connection');

  // ── Connection tab ────────────────────────────────────────
  const [backendUrl, setBackendUrl] = useState('https://api.lcyt.fi');
  const [apiKey, setApiKey] = useState('');
  const [streamKey, setStreamKey] = useState('');
  const [autoConnect, setAutoConnect] = useState(false);
  const [theme, setTheme] = useState('auto');
  const [textSize, setTextSize] = useState(
    () => { try { return parseInt(localStorage.getItem('lcyt:textSize') || '13', 10); } catch { return 13; } }
  );
  const [batchInterval, setBatchInterval] = useState(0);
  const [transcriptionOffset, setTranscriptionOffset] = useState(0);
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
  const [micDevices, setMicDevices] = useState([]);
  const [selectedMicId, setSelectedMicId] = useState(
    () => { try { return localStorage.getItem('lcyt:audioDeviceId') || ''; } catch { return ''; } }
  );
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

  // ── STT utterance controls ────────────────────────────────
  const [utteranceEndButton, setUtteranceEndButton] = useState(
    () => { try { return localStorage.getItem('lcyt:utterance-end-button') === '1'; } catch { return false; } }
  );
  const [utteranceEndTimer, setUtteranceEndTimer] = useState(
    () => { try { return parseInt(localStorage.getItem('lcyt:utterance-end-timer') || '0', 10); } catch { return 0; } }
  );

  // ── VAD tab ───────────────────────────────────────────────
  const [vadEnabled, setVadEnabled] = useState(
    () => { try { return localStorage.getItem('lcyt:client-vad') === '1'; } catch { return false; } }
  );
  const [vadSilenceMs, setVadSilenceMs] = useState(
    () => { try { return parseInt(localStorage.getItem('lcyt:client-vad-silence-ms') || '500', 10); } catch { return 500; } }
  );
  const [vadThreshold, setVadThreshold] = useState(
    () => { try { return parseFloat(localStorage.getItem('lcyt:client-vad-threshold') || '0.01'); } catch { return 0.01; } }
  );

  // ── Translation tab ───────────────────────────────────────
  const savedTransTarget = getTranslationTarget();
  const savedTransTargetEntry = COMMON_LANGUAGES.find(l => l.code === savedTransTarget);

  const [translationEnabled, setTranslationEnabledState] = useState(getTranslationEnabled);
  const [translationVendor, setTranslationVendorState] = useState(getTranslationVendor);
  const [transTargetQuery, setTransTargetQuery] = useState(savedTransTargetEntry ? savedTransTargetEntry.label : savedTransTarget);
  const [transTarget, setTransTarget] = useState(savedTransTarget);
  const [transTargetDropdownOpen, setTransTargetDropdownOpen] = useState(false);
  const [deepLKey, setDeepLKeyState] = useState(getDeepLKey);
  const [libreUrl, setLibreUrlState] = useState(getLibreTranslateUrl);
  const [libreKey, setLibreKeyState] = useState(getLibreTranslateKey);
  const [showDeepLKey, setShowDeepLKey] = useState(false);

  // Apply theme and text size on mount
  useEffect(() => {
    const savedTheme = localStorage.getItem('lcyt-theme') || 'auto';
    setTheme(savedTheme);
    applyTheme(savedTheme);
    const savedSize = parseInt(localStorage.getItem('lcyt:textSize') || '13', 10);
    setTextSize(savedSize);
    applyTextSize(savedSize);
  }, []);

  useEffect(() => {
    if (session.connected) setLastConnectedTime(Date.now());
  }, [session.connected]);

  async function refreshMics() {
    if (!navigator?.mediaDevices?.enumerateDevices) return;
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      setMicDevices(list.filter(d => d.kind === 'audioinput'));
    } catch {}
  }

  // Enumerate on open
  useEffect(() => { if (isOpen) refreshMics(); }, [isOpen]);

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
    const savedOffset = parseFloat(localStorage.getItem('lcyt:transcription-offset') || '0');
    setTranscriptionOffset(isNaN(savedOffset) ? 0 : savedOffset);
    setError('');
    // Re-sync STT state in case it changed outside
    setSttEngineState(getSttEngine());
    setCredentialState(getGoogleCredential());
    setCredError('');
    // Re-sync VAD state
    try { setVadEnabled(localStorage.getItem('lcyt:client-vad') === '1'); } catch {}
    try { setVadSilenceMs(parseInt(localStorage.getItem('lcyt:client-vad-silence-ms') || '500', 10)); } catch {}
    try { setVadThreshold(parseFloat(localStorage.getItem('lcyt:client-vad-threshold') || '0.01')); } catch {}
    // Re-sync utterance control state
    try { setUtteranceEndButton(localStorage.getItem('lcyt:utterance-end-button') === '1'); } catch {}
    try { setUtteranceEndTimer(parseInt(localStorage.getItem('lcyt:utterance-end-timer') || '0', 10)); } catch {}
    // Re-sync translation state
    setTranslationEnabledState(getTranslationEnabled());
    setTranslationVendorState(getTranslationVendor());
    const tgt = getTranslationTarget();
    setTransTarget(tgt);
    const tgtEntry = COMMON_LANGUAGES.find(l => l.code === tgt);
    setTransTargetQuery(tgtEntry ? tgtEntry.label : tgt);
    setDeepLKeyState(getDeepLKey());
    setLibreUrlState(getLibreTranslateUrl());
    setLibreKeyState(getLibreTranslateKey());
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

  function onTranscriptionOffsetChange(value) {
    const v = parseFloat(value);
    setTranscriptionOffset(v);
    try { localStorage.setItem('lcyt:transcription-offset', String(v)); } catch {}
  }

  function onTextSizeChange(value) {
    const v = parseInt(value, 10);
    setTextSize(v);
    applyTextSize(v);
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

  const transTargetMatches = transTargetDropdownOpen
    ? COMMON_LANGUAGES.filter(l =>
        l.label.toLowerCase().includes(transTargetQuery.toLowerCase()) ||
        l.code.toLowerCase().includes(transTargetQuery.toLowerCase())
      )
    : [];

  const TABS = ['connection', 'captions', 'stt', 'vad', 'translation', 'status', 'actions'];
  const TAB_LABELS = { connection: 'Connection', captions: 'Captions', stt: 'STT / Audio', vad: 'VAD', translation: 'Translation', status: 'Status', actions: 'Actions' };

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
                  placeholder="https://api.lcyt.fi"
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
              <div className="settings-field" style={{ marginTop: 16 }}>
                <label className="settings-field__label">
                  Transcription offset: <span>{transcriptionOffset === 0 ? '0 s (none)' : `${transcriptionOffset > 0 ? '+' : ''}${Number(transcriptionOffset).toFixed(1)} s`}</span>
                </label>
                <input
                  className="settings-field__input"
                  type="range"
                  min="-30" max="10" step="0.1"
                  value={transcriptionOffset}
                  onChange={e => onTranscriptionOffsetChange(e.target.value)}
                  onDoubleClick={() => onTranscriptionOffsetChange('0')}
                  style={{ padding: 0, cursor: 'pointer' }}
                />
              </div>
              <p style={{ fontSize: 12, color: 'var(--color-text-dim)', margin: 0, lineHeight: 1.5 }}>
                Shifts the caption timestamp relative to when the transcription arrives.<br />
                Use a <strong>negative</strong> value (e.g. −5 s) to compensate for transcription processing delay,
                so captions line up with the moment the speaker started talking in the YouTube stream.
              </p>
              <div className="settings-field" style={{ marginTop: 16 }}>
                <label className="settings-field__label">
                  Text size: <span>{textSize}px</span>
                </label>
                <input
                  className="settings-field__input"
                  type="range"
                  min="10" max="24" step="1"
                  value={textSize}
                  onChange={e => onTextSizeChange(e.target.value)}
                  style={{ padding: 0, cursor: 'pointer' }}
                />
              </div>
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

              {/* Microphone device */}
              <div className="settings-field">
                <label className="settings-field__label">Microphone</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <select
                    className="settings-field__input"
                    style={{ appearance: 'auto', flex: 1 }}
                    value={selectedMicId}
                    onChange={e => {
                      setSelectedMicId(e.target.value);
                      try { localStorage.setItem('lcyt:audioDeviceId', e.target.value); } catch {}
                      window.dispatchEvent(new Event('lcyt:stt-config-changed'));
                    }}
                  >
                    <option value="">Default device</option>
                    {micDevices.map(d => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label || d.deviceId}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="btn" onClick={refreshMics}>Refresh</button>
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

              {/* Utterance end controls */}
              <div className="settings-field">
                <label className="settings-field__label">Utterance end button</label>
                <label className="settings-checkbox">
                  <input
                    type="checkbox"
                    checked={utteranceEndButton}
                    onChange={e => {
                      setUtteranceEndButton(e.target.checked);
                      try { localStorage.setItem('lcyt:utterance-end-button', e.target.checked ? '1' : '0'); } catch {}
                      window.dispatchEvent(new Event('lcyt:stt-config-changed'));
                    }}
                  />
                  Show 🗣 on meter during utterance — click to force end
                </label>
                <span className="settings-field__hint">
                  While speech is being recognized, a speak icon appears on the audio meter.
                  Clicking it stops the recognizer and forces a final result immediately.
                </span>
              </div>

              <div className="settings-field">
                <label className="settings-field__label">
                  Utterance end timer: <strong>{utteranceEndTimer === 0 ? 'off' : `${utteranceEndTimer} s`}</strong>
                </label>
                <input
                  type="range"
                  className="settings-field__input"
                  style={{ padding: 0, cursor: 'pointer' }}
                  min="0" max="20" step="1"
                  value={utteranceEndTimer}
                  onChange={e => {
                    const v = parseInt(e.target.value, 10);
                    setUtteranceEndTimer(v);
                    try { localStorage.setItem('lcyt:utterance-end-timer', String(v)); } catch {}
                  }}
                />
                <span className="settings-field__hint">
                  Automatically force end the utterance after this many seconds (0 = disabled).
                  Useful for segmenting long speeches into shorter captions.
                </span>
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

          {/* ── VAD ── */}
          {activeTab === 'vad' && (
            <div className="settings-panel settings-panel--active">

              <div className="settings-field">
                <label className="settings-field__label">Client-side VAD</label>
                <label className="settings-checkbox">
                  <input
                    type="checkbox"
                    checked={vadEnabled}
                    onChange={e => {
                      setVadEnabled(e.target.checked);
                      try { localStorage.setItem('lcyt:client-vad', e.target.checked ? '1' : '0'); } catch {}
                    }}
                  />
                  Enable silence detection (WebKit engine only)
                </label>
                <span className="settings-field__hint">
                  When enabled, the browser monitors microphone energy and forces the recognizer
                  to finalize when silence is detected. Helps segment long unbroken speech on
                  mobile Chrome.
                </span>
              </div>

              <div className="settings-field">
                <label className="settings-field__label">
                  Silence duration: <strong>{vadSilenceMs} ms</strong>
                </label>
                <input
                  type="range"
                  className="settings-field__input"
                  style={{ padding: 0, cursor: 'pointer' }}
                  min="100" max="2000" step="100"
                  value={vadSilenceMs}
                  disabled={!vadEnabled}
                  onChange={e => {
                    const v = parseInt(e.target.value, 10);
                    setVadSilenceMs(v);
                    try { localStorage.setItem('lcyt:client-vad-silence-ms', String(v)); } catch {}
                  }}
                />
                <span className="settings-field__hint">
                  How long (ms) energy must stay below the threshold before the recognizer is
                  stopped to force a final result. Default: 500 ms.
                </span>
              </div>

              <div className="settings-field">
                <label className="settings-field__label">
                  Energy threshold: <strong>{Number(vadThreshold).toFixed(3)}</strong>
                </label>
                <input
                  type="range"
                  className="settings-field__input"
                  style={{ padding: 0, cursor: 'pointer' }}
                  min="0.001" max="0.1" step="0.001"
                  value={vadThreshold}
                  disabled={!vadEnabled}
                  onChange={e => {
                    const v = parseFloat(e.target.value);
                    setVadThreshold(v);
                    try { localStorage.setItem('lcyt:client-vad-threshold', String(v)); } catch {}
                  }}
                />
                <span className="settings-field__hint">
                  RMS amplitude threshold below which audio is considered silent. Lower values
                  are more sensitive. Default: 0.01.
                </span>
              </div>

            </div>
          )}

          {/* ── Translation ── */}
          {activeTab === 'translation' && (
            <div className="settings-panel settings-panel--active">

              <div className="settings-field">
                <label className="settings-field__label">Automatic translation</label>
                <label className="settings-checkbox">
                  <input
                    type="checkbox"
                    checked={translationEnabled}
                    onChange={e => {
                      setTranslationEnabledState(e.target.checked);
                      setTranslationEnabled(e.target.checked);
                    }}
                  />
                  Enable automatic translation of captions
                </label>
                <span className="settings-field__hint">
                  When enabled, captions are translated to the selected target language before
                  being sent to YouTube. Translation is skipped if the audio language matches
                  the target language.
                </span>
              </div>

              {/* Target language */}
              <div className="settings-field">
                <label className="settings-field__label">Target language</label>
                <div className="audio-lang-wrap">
                  <input
                    className="settings-field__input"
                    type="text"
                    placeholder="Type to filter…"
                    autoComplete="off"
                    spellCheck={false}
                    disabled={!translationEnabled}
                    value={transTargetQuery}
                    onChange={e => {
                      setTransTargetQuery(e.target.value);
                      setTransTargetDropdownOpen(true);
                    }}
                    onFocus={() => setTransTargetDropdownOpen(true)}
                    onBlur={() => setTimeout(() => setTransTargetDropdownOpen(false), 150)}
                  />
                  {transTargetDropdownOpen && transTargetMatches.length > 0 && (
                    <div className="audio-lang-list">
                      {transTargetMatches.map(l => (
                        <button
                          key={l.code}
                          className="audio-lang-option"
                          onMouseDown={() => {
                            setTransTarget(l.code);
                            setTransTargetQuery(l.label);
                            setTransTargetDropdownOpen(false);
                            setTranslationTarget(l.code);
                          }}
                        >
                          {l.label} <span className="audio-lang-code">{l.code}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <span className="settings-field__hint">{transTarget}</span>
              </div>

              {/* Vendor selection */}
              <div className="settings-field">
                <label className="settings-field__label">Translation vendor</label>
                <div className="stt-engine-list">
                  {[
                    { value: 'google',        name: 'Google Cloud Translation', desc: 'Uses your Google Cloud service account credential (shared with Cloud STT if configured). Requires Cloud Translation API to be enabled.' },
                    { value: 'deepl',         name: 'DeepL',                    desc: 'High-quality neural machine translation. Requires a DeepL API key (free or Pro).' },
                    { value: 'libretranslate', name: 'LibreTranslate',          desc: 'Open-source, self-hostable translation. Provide the URL of your LibreTranslate instance.' },
                  ].map(opt => (
                    <label
                      key={opt.value}
                      className={`stt-engine-option${translationVendor === opt.value ? ' stt-engine-option--active' : ''}${!translationEnabled ? ' stt-engine-option--disabled' : ''}`}
                    >
                      <input
                        type="radio"
                        name="translation-vendor"
                        value={opt.value}
                        checked={translationVendor === opt.value}
                        disabled={!translationEnabled}
                        onChange={() => {
                          setTranslationVendorState(opt.value);
                          setTranslationVendor(opt.value);
                        }}
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

              {/* DeepL API key */}
              {translationVendor === 'deepl' && translationEnabled && (
                <div className="settings-field">
                  <label className="settings-field__label">DeepL API key</label>
                  <div className="settings-field__input-wrap">
                    <input
                      className="settings-field__input settings-field__input--has-eye"
                      type={showDeepLKey ? 'text' : 'password'}
                      placeholder="••••••••"
                      autoComplete="off"
                      value={deepLKey}
                      onChange={e => {
                        setDeepLKeyState(e.target.value);
                        setDeepLKey(e.target.value);
                      }}
                    />
                    <button className="settings-field__eye" onClick={() => setShowDeepLKey(v => !v)} title="Toggle visibility">👁</button>
                  </div>
                  <span className="settings-field__hint">
                    Find your key at <strong>deepl.com/account/summary</strong>. Free-tier keys end with <code>:fx</code>.
                  </span>
                </div>
              )}

              {/* LibreTranslate settings */}
              {translationVendor === 'libretranslate' && translationEnabled && (
                <>
                  <div className="settings-field">
                    <label className="settings-field__label">LibreTranslate URL</label>
                    <input
                      className="settings-field__input"
                      type="url"
                      placeholder="https://libretranslate.com"
                      autoComplete="off"
                      value={libreUrl}
                      onChange={e => {
                        setLibreUrlState(e.target.value);
                        setLibreTranslateUrl(e.target.value);
                      }}
                    />
                    <span className="settings-field__hint">
                      Base URL of your LibreTranslate instance (e.g. <code>https://libretranslate.com</code>).
                    </span>
                  </div>
                  <div className="settings-field">
                    <label className="settings-field__label">API key (optional)</label>
                    <input
                      className="settings-field__input"
                      type="password"
                      placeholder="••••••••"
                      autoComplete="off"
                      value={libreKey}
                      onChange={e => {
                        setLibreKeyState(e.target.value);
                        setLibreTranslateKey(e.target.value);
                      }}
                    />
                    <span className="settings-field__hint">
                      Leave empty if your instance does not require authentication.
                    </span>
                  </div>
                </>
              )}

              {/* Google note */}
              {translationVendor === 'google' && translationEnabled && (
                <p style={{ fontSize: 12, color: 'var(--color-text-dim)', margin: 0, lineHeight: 1.5 }}>
                  Google Cloud Translation uses the same service account credential loaded in the
                  STT / Audio tab. Ensure the <strong>Cloud Translation API</strong> is enabled in
                  your Google Cloud project.
                </p>
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
