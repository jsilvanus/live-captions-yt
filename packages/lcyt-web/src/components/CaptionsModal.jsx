import { useState, useEffect, useRef } from 'react';
import { useSessionContext } from '../contexts/SessionContext';
import { useToastContext } from '../contexts/ToastContext';
import { useLang } from '../contexts/LangContext';
import { getAnyTargetNoBatch } from '../lib/targetConfig';
import { KEYS } from '../lib/storageKeys.js';
import { useEscapeKey } from '../hooks/useEscapeKey';
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
import { applyTextSize } from '../lib/settings';
import { VadPanel } from './panels/VadPanel.jsx';
import { MusicPanel } from './panels/MusicPanel.jsx';
import { useAudioContext } from '../contexts/AudioContext';

export function CaptionsModal({ isOpen, onClose }) {
  const session = useSessionContext();
  const { showToast } = useToastContext();
  const { t } = useLang();

  const [activeTab, setActiveTab] = useState('model');

  // ── Captions (Other) tab ──────────────────────────────────
  const [textSize, setTextSize] = useState(
    () => { try { return parseInt(localStorage.getItem('lcyt:textSize') || '13', 10); } catch { return 13; } }
  );
  const [batchInterval, setBatchInterval] = useState(0);
  const [batchLocked, setBatchLocked] = useState(false);
  const [transcriptionOffset, setTranscriptionOffset] = useState(0);

  // ── STT tab ───────────────────────────────────────────────
  const cloudCfg = getSttCloudConfig();
  const savedLang = getSttLang();
  const savedLangEntry = COMMON_LANGUAGES.find(l => l.code === savedLang);

  const [sttEngine, setSttEngineState] = useState(getSttEngine);
  const [sttLangQuery, setSttLangQuery] = useState(savedLangEntry ? savedLangEntry.label : savedLang);
  const [micDevices, setMicDevices] = useState([]);
  const [selectedMicId, setSelectedMicId] = useState(
    () => { try { return localStorage.getItem(KEYS.audio.deviceId) || ''; } catch { return ''; } }
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

  const [localAvailability, setLocalAvailability] = useState(null);
  const [sttLocal, setSttLocalState] = useState(getSttLocalProcessing);

  const [utteranceEndButton, setUtteranceEndButton] = useState(
    () => { try { return localStorage.getItem(KEYS.audio.utteranceEndButton) === '1'; } catch { return false; } }
  );
  const [utteranceEndTimer, setUtteranceEndTimer] = useState(
    () => { try { return parseInt(localStorage.getItem(KEYS.audio.utteranceEndTimer) || '0', 10); } catch { return 0; } }
  );
  const [holdToSpeak, setHoldToSpeakState] = useState(
    () => { try { return localStorage.getItem(KEYS.audio.holdToSpeak) === '1'; } catch { return false; } }
  );

  // ── VAD tab ───────────────────────────────────────────────
  const [vadEnabled, setVadEnabled] = useState(
    () => { try { return localStorage.getItem(KEYS.audio.clientVad) === '1'; } catch { return false; } }
  );
  const [vadSilenceMs, setVadSilenceMs] = useState(
    () => { try { return parseInt(localStorage.getItem(KEYS.audio.clientVadSilenceMs) || '500', 10); } catch { return 500; } }
  );
  const [vadThreshold, setVadThreshold] = useState(
    () => { try { return parseFloat(localStorage.getItem(KEYS.audio.clientVadThreshold) || '0.01'); } catch { return 0.01; } }
  );

  async function refreshMics() {
    if (!navigator?.mediaDevices?.enumerateDevices) return;
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      setMicDevices(list.filter(d => d.kind === 'audioinput'));
    } catch {}
  }

  useEffect(() => { if (isOpen) refreshMics(); }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const noBatch = getAnyTargetNoBatch();
    setBatchLocked(noBatch);
    let savedBatch = parseInt(localStorage.getItem(KEYS.captions.batchInterval) || '0', 10);
    if (noBatch && savedBatch > 0) {
      // Force batch off because a target doesn't support it
      savedBatch = 0;
      try { localStorage.setItem(KEYS.captions.batchInterval, '0'); } catch {}
    }
    setBatchInterval(savedBatch);
    const savedOffset = parseFloat(localStorage.getItem(KEYS.audio.transcriptionOffset) || '0');
    setTranscriptionOffset(isNaN(savedOffset) ? 0 : savedOffset);
    setSttEngineState(getSttEngine());
    setCredentialState(getGoogleCredential());
    setCredError('');
    setSttLocalState(getSttLocalProcessing());
    if (getSttEngine() === 'webkit') checkLocalAvailability(getSttLang());
    try { setVadEnabled(localStorage.getItem(KEYS.audio.clientVad) === '1'); } catch {}
    try { setVadSilenceMs(parseInt(localStorage.getItem(KEYS.audio.clientVadSilenceMs) || '500', 10)); } catch {}
    try { setVadThreshold(parseFloat(localStorage.getItem(KEYS.audio.clientVadThreshold) || '0.01')); } catch {}
    try { setUtteranceEndButton(localStorage.getItem(KEYS.audio.utteranceEndButton) === '1'); } catch {}
    try { setUtteranceEndTimer(parseInt(localStorage.getItem(KEYS.audio.utteranceEndTimer) || '0', 10)); } catch {}
    try { setHoldToSpeakState(localStorage.getItem(KEYS.audio.holdToSpeak) === '1'); } catch {}
  }, [isOpen]);

  useEffect(() => {
    function onCredChanged() { setCredentialState(getGoogleCredential()); }
    window.addEventListener('lcyt:stt-credential-changed', onCredChanged);
    return () => window.removeEventListener('lcyt:stt-credential-changed', onCredChanged);
  }, []);

  useEscapeKey(onClose, isOpen);

  if (!isOpen) return null;

  function onBatchChange(value) {
    if (batchLocked) {
      showToast(t('settings.captions.batchLockedByTarget'), 'warn');
      return;
    }
    const v = parseInt(value, 10);
    setBatchInterval(v);
    try { localStorage.setItem(KEYS.captions.batchInterval, String(v)); } catch {}
  }

  function onTranscriptionOffsetChange(value) {
    const v = parseFloat(value);
    setTranscriptionOffset(v);
    try { localStorage.setItem(KEYS.audio.transcriptionOffset, String(v)); } catch {}
  }

  function onTextSizeChange(value) {
    const v = parseInt(value, 10);
    setTextSize(v);
    applyTextSize(v);
  }

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
      const result = await speechRecognitionAPI.availabla("en-US", { processLocally: true });
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

  const { music } = useAudioContext();

  const TABS = ['model', 'vad', 'music', 'other'];

  return (
    <div className="settings-modal" role="dialog" aria-modal="true">
      <div className="settings-modal__backdrop" onClick={onClose} />
      <div className="settings-modal__box">
        <div className="settings-modal__header">
          <span className="settings-modal__title">{t('statusBar.caption')}</span>
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

          {/* ── Model (STT) ── */}
          {activeTab === 'model' && (
            <div className="settings-panel settings-panel--active">
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

              <div className="settings-field">
                <label className="settings-field__label">{t('settings.stt.microphone')}</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <select
                    className="settings-field__input"
                    style={{ appearance: 'auto', flex: 1 }}
                    value={selectedMicId}
                    onChange={e => {
                      setSelectedMicId(e.target.value);
                      try { localStorage.setItem(KEYS.audio.deviceId, e.target.value); } catch {}
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

              <div className="settings-field">
                <label className="settings-checkbox">
                  <input
                    type="checkbox"
                    checked={holdToSpeak}
                    onChange={e => {
                      const val = e.target.checked;
                      setHoldToSpeakState(val);
                      try { localStorage.setItem(KEYS.audio.holdToSpeak, val ? '1' : '0'); } catch {}
                      window.dispatchEvent(new Event('lcyt:stt-config-changed'));
                    }}
                  />
                  {t('settings.stt.holdToSpeak')}
                </label>
                <span className="settings-field__hint">{t('settings.stt.holdToSpeakHint')}</span>
              </div>

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

              <div className="settings-field">
                <label className="settings-field__label">{t('settings.stt.utteranceEndButton')}</label>
                <label className="settings-checkbox">
                  <input
                    type="checkbox"
                    checked={utteranceEndButton}
                    onChange={e => {
                      setUtteranceEndButton(e.target.checked);
                      try { localStorage.setItem(KEYS.audio.utteranceEndButton, e.target.checked ? '1' : '0'); } catch {}
                      window.dispatchEvent(new Event('lcyt:stt-config-changed'));
                    }}
                  />
                  {t('settings.stt.utteranceEndButtonCheckbox')}
                </label>
                <span className="settings-field__hint">{t('settings.stt.utteranceEndButtonHint')}</span>
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
                    try { localStorage.setItem(KEYS.audio.utteranceEndTimer, String(v)); } catch {}
                  }}
                />
                <span className="settings-field__hint">{t('settings.stt.utteranceEndTimerHint')}</span>
              </div>

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
                    <span className="settings-field__hint">{t('settings.stt.modelHint')}</span>
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
                    <span className="settings-field__hint">{t('settings.stt.confidenceHint')}</span>
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

                  <div className="settings-field">
                    <label className="settings-field__label">{t('settings.stt.credential')}</label>
                    {credential ? (
                      <div className="stt-cred-loaded">
                        <span className="stt-cred-loaded__check">✓</span>
                        <span className="stt-cred-loaded__email" title={credential.client_email}>
                          {credential.client_email}
                        </span>
                        <button className="btn btn--secondary btn--sm" onClick={handleClearCredential}>
                          {t('settings.stt.credentialRemove')}
                        </button>
                      </div>
                    ) : (
                      <button className="btn btn--secondary btn--sm" onClick={() => credFileRef.current?.click()}>
                        {t('settings.stt.credentialLoad')}
                      </button>
                    )}
                    {credError && <div className="settings-error">{credError}</div>}
                    <span className="settings-field__hint">{t('settings.stt.credentialHint')}</span>
                    <input
                      ref={credFileRef}
                      type="file"
                      accept="application/json,.json"
                      style={{ display: 'none' }}
                      aria-label={t('settings.stt.credentialLoad')}
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
              <VadPanel
                vadEnabled={vadEnabled}
                onVadEnabledChange={v => {
                  setVadEnabled(v);
                  try { localStorage.setItem(KEYS.audio.clientVad, v ? '1' : '0'); } catch {}
                }}
                vadSilenceMs={vadSilenceMs}
                onVadSilenceMsChange={v => {
                  setVadSilenceMs(v);
                  try { localStorage.setItem(KEYS.audio.clientVadSilenceMs, String(v)); } catch {}
                }}
                vadThreshold={vadThreshold}
                onVadThresholdChange={v => {
                  setVadThreshold(v);
                  try { localStorage.setItem(KEYS.audio.clientVadThreshold, String(v)); } catch {}
                }}
              />
            </div>
          )}

          {/* ── Music Detection ── */}
          {activeTab === 'music' && (
            <div className="settings-panel settings-panel--active">
              <MusicPanel
                enabled={music.enabled}
                onEnabledChange={music.setEnabled}
                bpmEnabled={music.bpmEnabled}
                onBpmEnabledChange={music.setBpmEnabled}
                label={music.label}
                bpm={music.bpm}
                available={music.available}
                running={music.running}
              />
            </div>
          )}

          {/* ── Other (Captions) ── */}
          {activeTab === 'other' && (
            <div className="settings-panel settings-panel--active">
              <div className="settings-field">
                <label className="settings-field__label">
                  {t('settings.captions.batchWindow')}: <span>{batchInterval === 0 ? t('settings.captions.batchWindowOff') : `${batchInterval}s`}</span>
                  {batchLocked && <span style={{ marginLeft: 6, fontSize: '0.8em', opacity: 0.7 }}>🔒</span>}
                </label>
                <input
                  className="settings-field__input"
                  type="range"
                  min="0" max="20" step="1"
                  value={batchInterval}
                  onChange={e => onBatchChange(e.target.value)}
                  aria-disabled={batchLocked}
                  style={{ padding: 0, cursor: batchLocked ? 'not-allowed' : 'pointer', opacity: batchLocked ? 0.5 : 1 }}
                />
                {batchLocked && (
                  <span className="settings-field__hint">{t('settings.captions.batchLockedByTargetHint')}</span>
                )}
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

        </div>

        <div className="settings-modal__footer">
          <div className="settings-modal__actions">
            <button className="btn btn--secondary" onClick={onClose} style={{ marginLeft: 'auto' }}>
              {t('settings.footer.close')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
