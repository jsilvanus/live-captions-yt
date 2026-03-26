import { useState, useEffect, useRef } from 'react';
import { useToastContext } from '../contexts/ToastContext';
import { useLang } from '../contexts/LangContext';
import { useSessionContext } from '../contexts/SessionContext';
import { getAnyTargetNoBatch } from '../lib/targetConfig';
import { KEYS } from '../lib/storageKeys.js';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { getTargets, setTargets } from '../lib/targetConfig';
import {
  getSttEngine, setSttEngine,
  getSttLang, setSttLang,
  getSttCloudConfig, patchSttCloudConfig,
  getSttLocalProcessing, setSttLocalProcessing,
} from '../lib/sttConfig';
import {
  getGoogleCredential, setGoogleCredential, clearGoogleCredential,
} from '../lib/googleCredential';
import {
  getTranslations, setTranslations,
  getTranslationVendor, setTranslationVendor,
  getTranslationApiKey, setTranslationApiKey,
  getTranslationLibreUrl, setTranslationLibreUrl,
  getTranslationLibreKey, setTranslationLibreKey,
  getTranslationShowOriginal, setTranslationShowOriginal,
} from '../lib/translationConfig';
import { getAdvancedMode } from '../lib/settings';
import { TargetsPanel } from './panels/TargetsPanel.jsx';
import { TranslationPanel } from './panels/TranslationPanel.jsx';
import { ServicePanel } from './panels/ServicePanel.jsx';
import { DetailsPanel } from './panels/DetailsPanel.jsx';

// ── Main CCModal component ────────────────────────────────────

export function CCModal({ isOpen, onClose, connected, inline }) {
  const { showToast } = useToastContext();
  const { t } = useLang();
  const session = useSessionContext();
  const { backendUrl: sessionBackendUrl, getPersistedConfig } = session;
  // Use connected backendUrl, falling back to the persisted config so the
  // viewer URL preview is visible even when not currently connected.
  const backendUrl = sessionBackendUrl || (getPersistedConfig().backendUrl ?? '');

  const [advancedMode, setAdvancedMode] = useState(getAdvancedMode);
  const [activeTab, setActiveTab] = useState('targets');

  // ── Icons (for viewer target icon picker) ─────────────────
  const [icons, setIcons] = useState([]);

  // ── Service tab ───────────────────────────────────────────
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

  // ── Server STT tab (service tab, bottom section) ──────────
  const [serverSttProvider, setServerSttProvider] = useState('google');
  const [serverSttLang, setServerSttLang] = useState('en-US');
  const [serverSttAudioSource, setServerSttAudioSource] = useState('hls');
  const [serverSttAutoStart, setServerSttAutoStart] = useState(false);
  const [serverSttConfidenceThreshold, setServerSttConfidenceThreshold] = useState(0);
  const [serverSttRunning, setServerSttRunning] = useState(false);
  const [serverSttBusy, setServerSttBusy] = useState(false);
  const [serverSttError, setServerSttError] = useState('');
  // null = unknown (backend not yet queried), true/false = backend responded
  const [serverSttWhepAvailable, setServerSttWhepAvailable] = useState(null);

  // ── Receivers tab ─────────────────────────────────────────
  const [targets, setTargetsState] = useState([]);

  // ── Details tab (advanced) ────────────────────────────────
  const [batchInterval, setBatchInterval] = useState(0);
  const [batchLocked, setBatchLocked] = useState(false);
  const [transcriptionOffset, setTranscriptionOffset] = useState(0);
  const [vadEnabled, setVadEnabled] = useState(
    () => { try { return localStorage.getItem(KEYS.audio.clientVad) === '1'; } catch { return false; } }
  );
  const [vadSilenceMs, setVadSilenceMs] = useState(
    () => { try { return parseInt(localStorage.getItem(KEYS.audio.clientVadSilenceMs) || '500', 10); } catch { return 500; } }
  );
  const [vadThreshold, setVadThreshold] = useState(
    () => { try { return parseFloat(localStorage.getItem(KEYS.audio.clientVadThreshold) || '0.01'); } catch { return 0.01; } }
  );

  // ── Translation tab ───────────────────────────────────────
  const [translations, setTranslationsState] = useState([]);
  const [translationVendor, setTranslationVendorState] = useState(getTranslationVendor);
  const [translationApiKey, setTranslationApiKeyState] = useState(getTranslationApiKey);
  const [translationLibreUrl, setTranslationLibreUrlState] = useState(getTranslationLibreUrl);
  const [translationLibreKey, setTranslationLibreKeyState] = useState(getTranslationLibreKey);
  const [translationShowOriginal, setTranslationShowOriginalState] = useState(getTranslationShowOriginal);

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
    setAdvancedMode(getAdvancedMode());
    // Service tab
    setSttEngineState(getSttEngine());
    setCredentialState(getGoogleCredential());
    setCredError('');
    setSttLocalState(getSttLocalProcessing());
    if (getSttEngine() === 'webkit') checkLocalAvailability(getSttLang());
    try { setUtteranceEndButton(localStorage.getItem(KEYS.audio.utteranceEndButton) === '1'); } catch {}
    try { setUtteranceEndTimer(parseInt(localStorage.getItem(KEYS.audio.utteranceEndTimer) || '0', 10)); } catch {}
    // Receivers tab
    setTargetsState(getTargets());
    // Details tab
    const noBatch = getAnyTargetNoBatch();
    setBatchLocked(noBatch);
    let savedBatch = parseInt(localStorage.getItem(KEYS.captions.batchInterval) || '0', 10);
    if (noBatch && savedBatch > 0) {
      savedBatch = 0;
      try { localStorage.setItem(KEYS.captions.batchInterval, '0'); } catch {}
    }
    setBatchInterval(savedBatch);
    const savedOffset = parseFloat(localStorage.getItem(KEYS.audio.transcriptionOffset) || '0');
    setTranscriptionOffset(isNaN(savedOffset) ? 0 : savedOffset);
    try { setVadEnabled(localStorage.getItem(KEYS.audio.clientVad) === '1'); } catch {}
    try { setVadSilenceMs(parseInt(localStorage.getItem(KEYS.audio.clientVadSilenceMs) || '500', 10)); } catch {}
    try { setVadThreshold(parseFloat(localStorage.getItem(KEYS.audio.clientVadThreshold) || '0.01')); } catch {}
    // Translation tab
    setTranslationsState(getTranslations());
    setTranslationVendorState(getTranslationVendor());
    setTranslationApiKeyState(getTranslationApiKey());
    setTranslationLibreUrlState(getTranslationLibreUrl());
    setTranslationLibreKeyState(getTranslationLibreKey());
    setTranslationShowOriginalState(getTranslationShowOriginal());
    // Fetch icons for the viewer icon picker (only when connected)
    if (session.connected) {
      session.listIcons().then(data => setIcons(data.icons || [])).catch(() => setIcons([]));
      // Load server STT config + status
      session.getSttConfig().then(data => {
        if (data.provider)    setServerSttProvider(data.provider);
        if (data.language)    setServerSttLang(data.language);
        if (data.audioSource) setServerSttAudioSource(data.audioSource);
        setServerSttAutoStart(!!data.autoStart);
        setServerSttConfidenceThreshold(data.confidenceThreshold ?? 0);
      }).catch(() => {});
      session.getSttStatus().then(data => {
        setServerSttRunning(!!data.running);
        if (data.whepAvailable !== undefined) setServerSttWhepAvailable(!!data.whepAvailable);
      }).catch(() => {});
    } else {
      setIcons([]);
    }
  }, [isOpen]);

  useEffect(() => {
    function onCredChanged() { setCredentialState(getGoogleCredential()); }
    window.addEventListener('lcyt:stt-credential-changed', onCredChanged);
    return () => window.removeEventListener('lcyt:stt-credential-changed', onCredChanged);
  }, []);

  useEscapeKey(onClose, isOpen);

  if (!isOpen && !inline) return null;

  // ── Service tab handlers ──────────────────────────────────

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
      const result = await speechRecognitionAPI.available(langCode, { processLocally: true });
      setLocalAvailability(result);
    } catch { setLocalAvailability(null); }
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

  // ── Receivers tab handlers ────────────────────────────────
  // (Managed by TargetsPanel)

  // ── Details tab handlers ──────────────────────────────────

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

  // ── Translation tab handlers ──────────────────────────────

  // (Managed by TranslationPanel)

  const TABS = advancedMode
    ? ['targets', 'translation', 'service', 'details']
    : ['targets', 'translation', 'service'];

  const box = (
      <div className="settings-modal__box" style={inline ? { position: 'static', maxWidth: '100%', maxHeight: '100%', height: '100%', borderRadius: 0, border: 'none', boxShadow: 'none' } : {}}>
        <div className="settings-modal__header">
          <span className="settings-modal__title">{t('statusBar.ccTitle')}</span>
          {!inline && <button className="settings-modal__close" onClick={onClose} title="Close (Esc)">✕</button>}
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

          {/* ── Service (STT) ── */}
          {activeTab === 'service' && (
            <ServicePanel
              sttEngine={sttEngine}
              onSttEngineChange={onSttEngineChange}

              selectedMicId={selectedMicId}
              onMicIdChange={value => { setSelectedMicId(value); try { localStorage.setItem(KEYS.audio.deviceId, value); } catch {} window.dispatchEvent(new Event('lcyt:stt-config-changed')); }}
              micDevices={micDevices}
              onRefreshMics={refreshMics}

              sttLang={sttLang}
              onSttLangChange={code => { setSttLangState(code); setSttLang(code); if (sttEngine === 'webkit') checkLocalAvailability(code); }}

              sttLocal={sttLocal}
              onSttLocalChange={enabled => handleLocalToggle(enabled, sttLang)}
              localAvailability={localAvailability}

              utteranceEndButton={utteranceEndButton}
              onUtteranceEndButtonChange={v => { setUtteranceEndButton(v); try { localStorage.setItem(KEYS.audio.utteranceEndButton, v ? '1' : '0'); } catch {} window.dispatchEvent(new Event('lcyt:stt-config-changed')); }}
              utteranceEndTimer={utteranceEndTimer}
              onUtteranceEndTimerChange={v => { setUtteranceEndTimer(v); try { localStorage.setItem(KEYS.audio.utteranceEndTimer, String(v)); } catch {} }}

              cloudModel={sttModel}
              onCloudModelChange={v => { setSttModel(v); patchSttCloudConfig({ model: v }); }}
              cloudPunctuation={cloudPunctuation}
              onCloudPunctuationChange={v => { setCloudPunctuation(v); patchSttCloudConfig({ punctuation: v }); }}
              cloudProfanity={cloudProfanity}
              onCloudProfanityChange={v => { setCloudProfanity(v); patchSttCloudConfig({ profanity: v }); }}
              cloudConfidence={cloudConfidence}
              onCloudConfidenceChange={v => { setCloudConfidence(Number(v)); patchSttCloudConfig({ confidence: Number(v) }); }}
              cloudMaxLen={cloudMaxLen}
              onCloudMaxLenChange={v => { setCloudMaxLen(Number(v)); patchSttCloudConfig({ maxLen: Number(v) }); }}

              credential={credential}
              onCredentialLoad={handleCredentialFile}
              onCredentialClear={handleClearCredential}
              credError={credError}

              serverSttProvider={serverSttProvider}
              onServerSttProviderChange={v => { setServerSttProvider(v); if (session.connected) { session.updateSttConfig({ provider: v }).catch(() => {}); } }}
              serverSttLang={serverSttLang}
              onServerSttLangChange={code => { setServerSttLang(code); if (session.connected) { session.updateSttConfig({ language: code }).catch(() => {}); } }}
              serverSttAudioSource={serverSttAudioSource}
              onServerSttAudioSourceChange={v => { setServerSttAudioSource(v); if (session.connected) { session.updateSttConfig({ audioSource: v }).catch(() => {}); } }}
              serverSttConfidenceThreshold={serverSttConfidenceThreshold}
              onServerSttConfidenceThresholdChange={v => { setServerSttConfidenceThreshold(v); if (session.connected) { session.updateSttConfig({ confidenceThreshold: v || null }).catch(() => {}); } }}
              serverSttAutoStart={serverSttAutoStart}
              onServerSttAutoStartChange={v => { setServerSttAutoStart(v); if (session.connected) { session.updateSttConfig({ autoStart: v }).catch(() => {}); } }}
              serverSttRunning={serverSttRunning}
              serverSttBusy={serverSttBusy}
              serverSttError={serverSttError}
              serverSttWhepAvailable={serverSttWhepAvailable}
              onServerSttStart={async () => {
                setServerSttBusy(true);
                setServerSttError('');
                try {
                  await session.startStt({
                    provider: serverSttProvider,
                    language: serverSttLang,
                    audioSource: serverSttAudioSource,
                    confidenceThreshold: serverSttConfidenceThreshold || null,
                  });
                  setServerSttRunning(true);
                } catch (err) {
                  setServerSttError(err.message || t('settings.serverStt.errorStart'));
                } finally {
                  setServerSttBusy(false);
                }
              }}
              onServerSttStop={async () => {
                setServerSttBusy(true);
                setServerSttError('');
                try {
                  await session.stopStt();
                  setServerSttRunning(false);
                } catch (err) {
                  setServerSttError(err.message || t('settings.serverStt.errorStop'));
                } finally {
                  setServerSttBusy(false);
                }
              }}

              advancedMode={advancedMode}
              connected={session.connected}
            />

          {/* ── Targets ── */}
          {activeTab === 'targets' && (
            <div className="settings-panel settings-panel--active">
              <TargetsPanel
                targets={targets}
                onChange={next => { setTargetsState(next); setTargets(next); }}
                backendUrl={backendUrl}
                icons={icons}
                connected={connected}
              />
              <div className="settings-field">
                <span className="settings-field__hint">
                  {connected
                    ? t('settings.targets.appliedOnClose')
                    : t('settings.targets.reconnectHint')}
                </span>
              </div>
            </div>
          )}

          {/* ── Details (advanced mode only) ── */}
          {activeTab === 'details' && (
            <DetailsPanel
              batchInterval={batchInterval}
              onBatchIntervalChange={onBatchChange}
              batchLocked={batchLocked}

              transcriptionOffset={transcriptionOffset}
              onTranscriptionOffsetChange={onTranscriptionOffsetChange}

              vadEnabled={vadEnabled}
              onVadEnabledChange={v => { setVadEnabled(v); try { localStorage.setItem(KEYS.audio.clientVad, v ? '1' : '0'); } catch {} }}
              vadSilenceMs={vadSilenceMs}
              onVadSilenceMsChange={v => { setVadSilenceMs(v); try { localStorage.setItem(KEYS.audio.clientVadSilenceMs, String(v)); } catch {} }}
              vadThreshold={vadThreshold}
              onVadThresholdChange={v => { setVadThreshold(v); try { localStorage.setItem(KEYS.audio.clientVadThreshold, String(v)); } catch {} }}
            />
          )}

          {/* ── Translation ── */}
          {activeTab === 'translation' && (
            <div className="settings-panel settings-panel--active">
              <TranslationPanel
                translations={translations}
                onTranslationsChange={next => { setTranslationsState(next); setTranslations(next); }}
                vendor={translationVendor}
                onVendorChange={v => { setTranslationVendorState(v); setTranslationVendor(v); }}
                vendorKey={translationApiKey}
                onVendorKeyChange={k => { setTranslationApiKeyState(k); setTranslationApiKey(k); }}
                libreUrl={translationLibreUrl}
                onLibreUrlChange={u => { setTranslationLibreUrlState(u); setTranslationLibreUrl(u); }}
                libreKey={translationLibreKey}
                onLibreKeyChange={k => { setTranslationLibreKeyState(k); setTranslationLibreKey(k); }}
                showOriginal={translationShowOriginal}
                onShowOriginalChange={v => { setTranslationShowOriginalState(v); setTranslationShowOriginal(v); }}
              />
            </div>
          )}
        </div>

        {!inline && (
          <div className="settings-modal__footer">
            <div className="settings-modal__actions">
              <button className="btn btn--secondary" onClick={onClose} style={{ marginLeft: 'auto' }}>
                {t('settings.footer.close')}
              </button>
            </div>
          </div>
        )}
      </div>
  );

  if (inline) return box;

  return (
    <div className="settings-modal" role="dialog" aria-modal="true">
      <div className="settings-modal__backdrop" onClick={onClose} />
      {box}
    </div>
  );
}
