import { useState, useEffect, useRef } from 'react';
import { useSessionContext } from '../contexts/SessionContext';
import { useToastContext } from '../contexts/ToastContext';
import { useLang } from '../contexts/LangContext';
import {
  COMMON_LANGUAGES, STT_MODELS,
  getSttEngine, setSttEngine,
  getSttLang, setSttLang,
  getSttCloudConfig, patchSttCloudConfig,
  getSttLocalProcessing, setSttLocalProcessing,
} from '../lib/sttConfig';
import {
  getGoogleCredential, setGoogleCredential, clearGoogleCredential,
} from '../lib/googleCredential';
import {
  TRANSLATION_VENDORS,
  getTranslationEnabled, setTranslationEnabled,
  getTranslationTargetLang, setTranslationTargetLang,
  getTranslationVendor, setTranslationVendor,
  getTranslationApiKey, setTranslationApiKey,
  getTranslationLibreUrl, setTranslationLibreUrl,
  getTranslationLibreKey, setTranslationLibreKey,
  getTranslationShowOriginal, setTranslationShowOriginal,
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
  const { lang, setLang, t, LOCALE_CODES } = useLang();

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

  // ── Actions tab ────────────────────────────────────────────
  const [customSequence, setCustomSequence] = useState(0);
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

  // ── On-device (local) speech recognition ─────────────────
  // Possible values: null (API unsupported/unchecked), 'readily', 'downloadable', 'no'
  const [localAvailability, setLocalAvailability] = useState(null);
  const [sttLocal, setSttLocalState] = useState(getSttLocalProcessing);

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

  // ── Translation tab ────────────────────────────────────────
  const savedTargetLang = getTranslationTargetLang();
  const savedTargetEntry = COMMON_LANGUAGES.find(l => l.code === savedTargetLang);
  const [translationEnabled, setTranslationEnabledState] = useState(getTranslationEnabled);
  const [translationVendor, setTranslationVendorState] = useState(getTranslationVendor);
  const [translationApiKey, setTranslationApiKeyState] = useState(getTranslationApiKey);
  const [translationLibreUrl, setTranslationLibreUrlState] = useState(getTranslationLibreUrl);
  const [translationLibreKey, setTranslationLibreKeyState] = useState(getTranslationLibreKey);
  const [translationTargetLang, setTranslationTargetLangState] = useState(savedTargetLang);
  const [translationTargetQuery, setTranslationTargetQuery] = useState(
    savedTargetEntry ? savedTargetEntry.label : savedTargetLang
  );
  const [translationTargetDropdownOpen, setTranslationTargetDropdownOpen] = useState(false);
  const [translationShowOriginal, setTranslationShowOriginalState] = useState(getTranslationShowOriginal);

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
    setSttLocalState(getSttLocalProcessing());
    if (getSttEngine() === 'webkit') checkLocalAvailability(getSttLang());
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
    setTranslationApiKeyState(getTranslationApiKey());
    setTranslationLibreUrlState(getTranslationLibreUrl());
    setTranslationLibreKeyState(getTranslationLibreKey());
    setTranslationShowOriginalState(getTranslationShowOriginal());
    const tgtLang = getTranslationTargetLang();
    setTranslationTargetLangState(tgtLang);
    const tgtEntry = COMMON_LANGUAGES.find(l => l.code === tgtLang);
    setTranslationTargetQuery(tgtEntry ? tgtEntry.label : tgtLang);
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
    if (!backendUrl) { setError(t('settings.connection.errorBackendUrl')); return; }
    if (!apiKey) { setError(t('settings.connection.errorApiKey')); return; }
    if (!streamKey) { setError(t('settings.connection.errorStreamKey')); return; }

    setConnecting(true);
    try {
      await session.connect({ backendUrl, apiKey, streamKey });
      session.setAutoConnect(autoConnect);
      showToast(t('settings.connection.connected'), 'success');
      onClose();
    } catch (err) {
      setError(err.message || 'Connection failed');
    } finally {
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    await session.disconnect();
    showToast(t('settings.connection.disconnected'), 'info');
    onClose();
  }

  async function handleSync() {
    if (!session.connected) { showToast(t('settings.actions.notConnected'), 'warning'); return; }
    try {
      const data = await session.sync();
      setSyncResult(`${data.syncOffset}ms`);
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function handleHeartbeat() {
    if (!session.connected) { showToast(t('settings.actions.notConnected'), 'warning'); return; }
    try {
      const data = await session.heartbeat();
      setHbResult(`${data.roundTripTime}ms`);
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function handleResetSequence() {
    if (!session.connected) { showToast(t('settings.actions.notConnected'), 'warning'); return; }
    try {
      await session.updateSequence(0);
      showToast(t('settings.actions.sequenceReset'), 'success');
    } catch (err) {
      showToast(err.message || t('settings.actions.sequenceSetError'), 'error');
    }
  }

  async function handleSetSequence() {
    if (!session.connected) { showToast(t('settings.actions.notConnected'), 'warning'); return; }
    try {
      await session.updateSequence(customSequence);
      showToast(`${t('settings.actions.setSequence')}: ${customSequence}`, 'success');
    } catch (err) {
      showToast(err.message || t('settings.actions.sequenceSetError'), 'error');
    }
  }

  function handleClearConfig() {
    session.clearPersistedConfig();
    setBackendUrl('');
    setApiKey('');
    setStreamKey('');
    setAutoConnect(false);
    showToast(t('settings.connection.configCleared'), 'info');
  }

  // ── STT tab handlers ──────────────────────────────────────

  function onSttEngineChange(engine) {
    setSttEngineState(engine);
    setSttEngine(engine);
    if (engine === 'webkit') checkLocalAvailability(sttLang);
    else setLocalAvailability(null);
  }

  async function checkLocalAvailability(langCode) {
    const speechRecognitionAPI = window.SpeechRecognition;
    if (!speechRecognitionAPI || typeof speechRecognitionAPI.available !== 'function') { setLocalAvailability(null); return; }
    try {
      const result = await speechRecognitionAPI.available(langCode);
      setLocalAvailability(result);
    } catch { setLocalAvailability(null); }
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
    if (sttEngine === 'webkit') checkLocalAvailability(entry.code);
  }

  async function handleLocalToggle(enabled, langCode) {
    setSttLocalState(enabled);
    setSttLocalProcessing(enabled);
    if (enabled && localAvailability === 'downloadable') {
      // SpeechRecognition.available() returned 'downloadable', so the API exists
      showToast(t('settings.stt.onDeviceInstalling'), 'info');
      try {
        await window.SpeechRecognition.install(langCode);
        setLocalAvailability('readily');
        showToast(t('settings.stt.onDeviceInstalled'), 'success');
      } catch {
        showToast(t('settings.stt.onDeviceInstallFailed'), 'error');
      }
    }
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

  const translationTargetMatches = translationTargetDropdownOpen
    ? COMMON_LANGUAGES.filter(l =>
        l.label.toLowerCase().includes(translationTargetQuery.toLowerCase()) ||
        l.code.toLowerCase().includes(translationTargetQuery.toLowerCase())
      )
    : [];

  const TABS = ['connection', 'captions', 'stt', 'vad', 'translation', 'status', 'actions'];

  return (
    <div className="settings-modal">
      <div className="settings-modal__backdrop" onClick={onClose} />
      <div className="settings-modal__box">
        <div className="settings-modal__header">
          <span className="settings-modal__title">{t('settings.title')}</span>
          <button className="settings-modal__close" onClick={onClose} title="Close (Esc)">✕</button>
        </div>

        <div className="settings-modal__tabs">
          {TABS.map(tab => (
            <button
              key={tab}
              className={`settings-tab${activeTab === tab ? ' settings-tab--active' : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              {t(`settings.tabs.${tab}`)}
            </button>
          ))}
        </div>

        <div className="settings-modal__body">

          {/* ── Connection ── */}
          {activeTab === 'connection' && (
            <div className="settings-panel settings-panel--active">
              <div className="settings-field">
                <label className="settings-field__label">{t('settings.language')}</label>
                <div className="lang-switcher">
                  {LOCALE_CODES.map(code => (
                    <button
                      key={code}
                      className={`lang-btn${lang === code ? ' lang-btn--active' : ''}`}
                      onClick={() => setLang(code)}
                      title={code.toUpperCase()}
                    >
                      🌐 {code.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
              <div className="settings-field">
                <label className="settings-field__label">{t('settings.connection.backendUrl')}</label>
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
                <label className="settings-field__label">{t('settings.connection.apiKey')}</label>
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
                <label className="settings-field__label">{t('settings.connection.streamKey')}</label>
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
                {t('settings.connection.autoConnect')}
              </label>
              <div className="settings-field">
                <label className="settings-field__label">{t('settings.connection.theme')}</label>
                <select
                  className="settings-field__input"
                  style={{ appearance: 'auto' }}
                  value={theme}
                  onChange={e => onThemeChange(e.target.value)}
                >
                  <option value="auto">{t('settings.connection.themeAuto')}</option>
                  <option value="dark">{t('settings.connection.themeDark')}</option>
                  <option value="light">{t('settings.connection.themeLight')}</option>
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
                  {t('settings.captions.batchWindow')}: <span>{batchInterval === 0 ? t('settings.captions.batchWindowOff') : `${batchInterval}s`}</span>
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
                {t('settings.captions.batchWindowHint')}
              </p>
              <div className="settings-field" style={{ marginTop: 16 }}>
                <label className="settings-field__label">
                  {t('settings.captions.transcriptionOffset')}: <span>{transcriptionOffset === 0 ? t('settings.captions.transcriptionOffsetNone') : `${transcriptionOffset > 0 ? '+' : ''}${Number(transcriptionOffset).toFixed(1)} s`}</span>
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
                {t('settings.captions.transcriptionOffsetHint')}
              </p>
              <div className="settings-field" style={{ marginTop: 16 }}>
                <label className="settings-field__label">
                  {t('settings.captions.textSize')}: <span>{textSize}px</span>
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
                <label className="settings-field__label">{t('settings.stt.engineLabel')}</label>
                <div className="stt-engine-list">
                  {[
                    { value: 'webkit', name: t('settings.stt.engineWebkitName'), desc: t('settings.stt.engineWebkitDesc') },
                    { value: 'cloud',  name: t('settings.stt.engineCloudName'),  desc: t('settings.stt.engineCloudDesc') },
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
                <label className="settings-field__label">{t('settings.stt.microphone')}</label>
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
                    <option value="">{t('settings.stt.microphoneDefault')}</option>
                    {micDevices.map(d => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label || d.deviceId}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="btn" onClick={refreshMics}>{t('settings.stt.microphoneRefresh')}</button>
                </div>
              </div>

              {/* Language (shared by both engines) */}
              <div className="settings-field">
                <label className="settings-field__label">{t('settings.stt.language')}</label>
                <div className="audio-lang-wrap">
                  <input
                    className="settings-field__input"
                    type="text"
                    placeholder={t('settings.stt.languagePlaceholder')}
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

              {/* On-device (local) processing — shown only for Web Speech API when supported */}
              {sttEngine === 'webkit' && localAvailability !== null && localAvailability !== 'no' && (
                <div className="settings-field">
                  <label className="settings-field__label">{t('settings.stt.onDevice')}</label>
                  <label className="settings-checkbox">
                    <input
                      type="checkbox"
                      checked={sttLocal}
                      onChange={e => handleLocalToggle(e.target.checked, sttLang)}
                    />
                    {t('settings.stt.onDeviceCheckbox')}
                  </label>
                  <span className="settings-field__hint">
                    {localAvailability === 'readily'
                      ? t('settings.stt.onDeviceReady')
                      : t('settings.stt.onDeviceNotInstalled')}
                  </span>
                </div>
              )}

              {/* Utterance end controls */}
              <div className="settings-field">
                <label className="settings-field__label">{t('settings.stt.utteranceEndButton')}</label>
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
                  {t('settings.stt.utteranceEndButtonCheckbox')}
                </label>
                <span className="settings-field__hint">
                  {t('settings.stt.utteranceEndButtonHint')}
                </span>
              </div>

              <div className="settings-field">
                <label className="settings-field__label">
                  {t('settings.stt.utteranceEndTimer')}: <strong>{utteranceEndTimer === 0 ? t('settings.stt.utteranceEndTimerOff') : `${utteranceEndTimer} s`}</strong>
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
                  {t('settings.stt.utteranceEndTimerHint')}
                </span>
              </div>

              {/* Cloud STT-specific settings */}
              {sttEngine === 'cloud' && (
                <>
                  <div className="settings-field">
                    <label className="settings-field__label">{t('settings.stt.model')}</label>
                    <select
                      className="settings-field__input"
                      style={{ appearance: 'auto' }}
                      value={sttModel}
                      onChange={e => { setSttModel(e.target.value); patchSttCloudConfig({ model: e.target.value }); }}
                    >
                      {STT_MODELS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                    </select>
                    <span className="settings-field__hint">
                      {t('settings.stt.modelHint')}
                    </span>
                  </div>

                  <div className="settings-field">
                    <label className="settings-field__label">{t('settings.stt.options')}</label>
                    <label className="settings-checkbox">
                      <input
                        type="checkbox"
                        checked={cloudPunctuation}
                        onChange={e => { setCloudPunctuation(e.target.checked); patchSttCloudConfig({ punctuation: e.target.checked }); }}
                      />
                      {t('settings.stt.punctuation')}
                    </label>
                    <label className="settings-checkbox">
                      <input
                        type="checkbox"
                        checked={cloudProfanity}
                        onChange={e => { setCloudProfanity(e.target.checked); patchSttCloudConfig({ profanity: e.target.checked }); }}
                      />
                      {t('settings.stt.profanity')}
                    </label>
                  </div>

                  <div className="settings-field">
                    <label className="settings-field__label">
                      {t('settings.stt.confidence')}: <strong>{Number(cloudConfidence).toFixed(2)}</strong>
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
                      {t('settings.stt.confidenceHint')}
                    </span>
                  </div>

                  <div className="settings-field">
                    <label className="settings-field__label">{t('settings.stt.maxLen')}</label>
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
                    <label className="settings-field__label">{t('settings.stt.credential')}</label>
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
                          {t('settings.stt.credentialRemove')}
                        </button>
                      </div>
                    ) : (
                      <button
                        className="btn btn--secondary btn--sm"
                        onClick={() => credFileRef.current?.click()}
                      >
                        {t('settings.stt.credentialLoad')}
                      </button>
                    )}
                    {credError && <div className="settings-error">{credError}</div>}
                    <span className="settings-field__hint">
                      {t('settings.stt.credentialHint')}
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
                <label className="settings-field__label">{t('settings.vad.clientVad')}</label>
                <label className="settings-checkbox">
                  <input
                    type="checkbox"
                    checked={vadEnabled}
                    onChange={e => {
                      setVadEnabled(e.target.checked);
                      try { localStorage.setItem('lcyt:client-vad', e.target.checked ? '1' : '0'); } catch {}
                    }}
                  />
                  {t('settings.vad.enableCheckbox')}
                </label>
                <span className="settings-field__hint">
                  {t('settings.vad.enableHint')}
                </span>
              </div>

              <div className="settings-field">
                <label className="settings-field__label">
                  {t('settings.vad.silenceDuration')}: <strong>{vadSilenceMs} ms</strong>
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
                  {t('settings.vad.silenceDurationHint')}
                </span>
              </div>

              <div className="settings-field">
                <label className="settings-field__label">
                  {t('settings.vad.energyThreshold')}: <strong>{Number(vadThreshold).toFixed(3)}</strong>
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
                  {t('settings.vad.energyThresholdHint')}
                </span>
              </div>

            </div>
          )}

          {/* ── Translation ── */}
          {activeTab === 'translation' && (
            <div className="settings-panel settings-panel--active">

              <label className="settings-checkbox">
                <input
                  type="checkbox"
                  checked={translationEnabled}
                  onChange={e => {
                    setTranslationEnabledState(e.target.checked);
                    setTranslationEnabled(e.target.checked);
                  }}
                />
                {t('settings.translation.enable')}
              </label>
              <span className="settings-field__hint" style={{ display: 'block', marginTop: 4, marginBottom: 12 }}>
                {t('settings.translation.enableHint')}
              </span>

              {translationEnabled && (
                <>
                  {/* Target language */}
                  <div className="settings-field">
                    <label className="settings-field__label">{t('settings.translation.targetLang')}</label>
                    <div className="audio-lang-wrap">
                      <input
                        className="settings-field__input"
                        type="text"
                        placeholder={t('settings.translation.targetLangPlaceholder')}
                        autoComplete="off"
                        spellCheck={false}
                        value={translationTargetQuery}
                        onChange={e => {
                          setTranslationTargetQuery(e.target.value);
                          setTranslationTargetDropdownOpen(e.target.value.trim().length > 0);
                        }}
                        onBlur={() => setTimeout(() => setTranslationTargetDropdownOpen(false), 150)}
                      />
                      {translationTargetDropdownOpen && translationTargetMatches.length > 0 && (
                        <div className="audio-lang-list">
                          {translationTargetMatches.map(l => (
                            <button
                              key={l.code}
                              className="audio-lang-option"
                              onMouseDown={() => {
                                setTranslationTargetQuery(l.label);
                                setTranslationTargetLangState(l.code);
                                setTranslationTargetDropdownOpen(false);
                                setTranslationTargetLang(l.code);
                              }}
                            >
                              {l.label} <span className="audio-lang-code">{l.code}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <span className="settings-field__hint">
                      {translationTargetLang}
                      {' — '}
                      {t('settings.translation.sameLanguageNote')}
                    </span>
                  </div>

                  {/* Vendor */}
                  <div className="settings-field">
                    <label className="settings-field__label">{t('settings.translation.vendor')}</label>
                    <select
                      className="settings-field__input"
                      style={{ appearance: 'auto' }}
                      value={translationVendor}
                      onChange={e => {
                        setTranslationVendorState(e.target.value);
                        setTranslationVendor(e.target.value);
                      }}
                    >
                      {TRANSLATION_VENDORS.map(v => (
                        <option key={v.value} value={v.value}>{t(v.labelKey)}</option>
                      ))}
                    </select>
                  </div>

                  {/* Show original toggle */}
                  <div className="settings-field">
                    <label className="settings-checkbox">
                      <input
                        type="checkbox"
                        checked={translationShowOriginal}
                        onChange={e => {
                          setTranslationShowOriginalState(e.target.checked);
                          setTranslationShowOriginal(e.target.checked);
                        }}
                      />
                      {t('settings.translation.showOriginal')}
                    </label>
                    <span className="settings-field__hint">{t('settings.translation.showOriginalHint')}</span>
                  </div>

                  {/* API key — shown for Google and DeepL */}
                  {(translationVendor === 'google' || translationVendor === 'deepl') && (
                    <div className="settings-field">
                      <label className="settings-field__label">{t('settings.translation.vendorKey')}</label>
                      <input
                        className="settings-field__input"
                        type="password"
                        autoComplete="off"
                        value={translationApiKey}
                        onChange={e => {
                          setTranslationApiKeyState(e.target.value);
                          setTranslationApiKey(e.target.value);
                        }}
                      />
                      <span className="settings-field__hint">{t('settings.translation.vendorKeyHint')}</span>
                    </div>
                  )}

                  {/* LibreTranslate-specific settings */}
                  {translationVendor === 'libretranslate' && (
                    <>
                      <div className="settings-field">
                        <label className="settings-field__label">{t('settings.translation.libreUrl')}</label>
                        <input
                          className="settings-field__input"
                          type="url"
                          placeholder={t('settings.translation.libreUrlPlaceholder')}
                          autoComplete="off"
                          value={translationLibreUrl}
                          onChange={e => {
                            setTranslationLibreUrlState(e.target.value);
                            setTranslationLibreUrl(e.target.value);
                          }}
                        />
                        <span className="settings-field__hint">{t('settings.translation.libreUrlHint')}</span>
                      </div>
                      <div className="settings-field">
                        <label className="settings-field__label">{t('settings.translation.libreKey')}</label>
                        <input
                          className="settings-field__input"
                          type="password"
                          autoComplete="off"
                          value={translationLibreKey}
                          onChange={e => {
                            setTranslationLibreKeyState(e.target.value);
                            setTranslationLibreKey(e.target.value);
                          }}
                        />
                        <span className="settings-field__hint">{t('settings.translation.libreKeyHint')}</span>
                      </div>
                    </>
                  )}
                </>
              )}

            </div>
          )}

          {/* ── Status ── */}
          {activeTab === 'status' && (
            <div className="settings-panel settings-panel--active">
              <div className="settings-status-row">
                <span className="settings-status-row__label">{t('settings.status.connection')}</span>
                <span
                  className="settings-status-row__value"
                  style={{ color: session.connected ? 'var(--color-success)' : 'var(--color-text-dim)' }}
                >
                  {session.connected ? t('settings.status.connected') : t('settings.status.disconnected')}
                </span>
              </div>
              <div className="settings-status-row">
                <span className="settings-status-row__label">{t('settings.status.backendUrl')}</span>
                <span className="settings-status-row__value">{session.backendUrl || '—'}</span>
              </div>
              <div className="settings-status-row">
                <span className="settings-status-row__label">{t('settings.status.sequence')}</span>
                <span className="settings-status-row__value">{session.connected ? session.sequence : '—'}</span>
              </div>
              <div className="settings-status-row">
                <span className="settings-status-row__label">{t('settings.status.syncOffset')}</span>
                <span className="settings-status-row__value">{session.connected ? `${session.syncOffset}ms` : '—'}</span>
              </div>
              <div className="settings-status-row">
                <span className="settings-status-row__label">{t('settings.status.lastConnected')}</span>
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
                <button className="btn btn--secondary btn--sm" onClick={handleSync}>{t('settings.actions.syncNow')}</button>
                <button className="btn btn--secondary btn--sm" onClick={handleHeartbeat}>{t('settings.actions.heartbeat')}</button>
                <button className="btn btn--secondary btn--sm" onClick={handleResetSequence}>{t('settings.actions.resetSequence')}</button>
              </div>
              {hbResult && (
                <div className="settings-status-row">
                  <span className="settings-status-row__label">{t('settings.actions.roundTrip')}</span>
                  <span className="settings-status-row__value">{hbResult}</span>
                </div>
              )}
              {syncResult && (
                <div className="settings-status-row">
                  <span className="settings-status-row__label">{t('settings.actions.syncOffset')}</span>
                  <span className="settings-status-row__value">{syncResult}</span>
                </div>
              )}
              <div className="settings-field">
                <label className="settings-field__label">{t('settings.actions.setSequence')}</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    type="number"
                    className="settings-field__input"
                    style={{ width: 90 }}
                    min="0"
                    value={customSequence}
                    onChange={e => setCustomSequence(Math.max(0, parseInt(e.target.value, 10) || 0))}
                  />
                  <button className="btn btn--secondary btn--sm" onClick={handleSetSequence}>{t('settings.actions.setSequenceBtn')}</button>
                </div>
              </div>
              <hr style={{ borderColor: 'var(--color-border)', margin: '8px 0' }} />
              <button className="btn btn--danger btn--sm" onClick={handleClearConfig}>{t('settings.actions.clearConfig')}</button>
            </div>
          )}

        </div>

        <div className="settings-modal__footer">
          <div className="settings-modal__actions">
            <button className="btn btn--primary" onClick={handleConnect} disabled={connecting}>
              {connecting ? t('settings.footer.connecting') : t('settings.footer.connect')}
            </button>
            <button className="btn btn--secondary" onClick={handleDisconnect}>{t('settings.footer.disconnect')}</button>
            <button className="btn btn--secondary" onClick={onClose}>{t('settings.footer.close')}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
