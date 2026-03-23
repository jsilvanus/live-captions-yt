import { useState, useEffect, useRef } from 'react';
import { useToastContext } from '../contexts/ToastContext';
import { useLang } from '../contexts/LangContext';
import { useSessionContext } from '../contexts/SessionContext';
import { getAnyTargetNoBatch } from '../lib/targetConfig';
import { KEYS } from '../lib/storageKeys.js';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { getTargets, setTargets } from '../lib/targetConfig';
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
  TRANSLATION_VENDORS, TRANSLATION_TARGETS, CAPTION_FORMATS,
  getTranslations, setTranslations,
  getTranslationVendor, setTranslationVendor,
  getTranslationApiKey, setTranslationApiKey,
  getTranslationLibreUrl, setTranslationLibreUrl,
  getTranslationLibreKey, setTranslationLibreKey,
  getTranslationShowOriginal, setTranslationShowOriginal,
} from '../lib/translationConfig';
import { getAdvancedMode } from '../lib/settings';
import { LanguagePicker } from './LanguagePicker';

// ── Translation row ───────────────────────────────────────────

function TranslationRow({ entry, onChange, onRemove, hasExistingCaptionTarget, t }) {
  const lang = COMMON_LANGUAGES.find(l => l.code === entry.lang);
  const disableCaptions = entry.target !== 'captions' && hasExistingCaptionTarget;

  return (
    <div className="translation-row">
      <label className="settings-checkbox" style={{ marginBottom: 0 }}>
        <input
          type="checkbox"
          checked={entry.enabled}
          onChange={e => onChange({ ...entry, enabled: e.target.checked })}
        />
      </label>

      <div style={{ flex: 1, minWidth: 0 }}>
        <LanguagePicker
          value={entry.lang}
          onChange={code => onChange({ ...entry, lang: code })}
          placeholder={t('settings.translation.targetLangPlaceholder')}
        />
        {lang && <span className="settings-field__hint" style={{ marginTop: 2 }}>{entry.lang}</span>}
      </div>

      <div>
        <select
          className="settings-field__input"
          value={entry.target}
          onChange={e => {
            const next = { ...entry, target: e.target.value };
            if (e.target.value === 'captions') delete next.format;
            if (!next.format && (e.target.value === 'file' || e.target.value === 'backend-file'))
              next.format = 'youtube';
            onChange(next);
          }}
          style={{ width: 'auto' }}
        >
          {TRANSLATION_TARGETS.map(tgt => (
            <option
              key={tgt.value}
              value={tgt.value}
              disabled={tgt.value === 'captions' && disableCaptions}
            >
              {t(tgt.labelKey)}
            </option>
          ))}
        </select>
      </div>

      {(entry.target === 'file' || entry.target === 'backend-file') && (
        <div>
          <select
            className="settings-field__input"
            value={entry.format || 'youtube'}
            onChange={e => onChange({ ...entry, format: e.target.value })}
            style={{ width: 'auto' }}
          >
            {CAPTION_FORMATS.map(fmt => (
              <option key={fmt.value} value={fmt.value}>{t(fmt.labelKey)}</option>
            ))}
          </select>
        </div>
      )}

      <button
        type="button"
        className="btn btn--secondary btn--sm"
        onClick={onRemove}
        title={t('settings.translation.removeTranslation')}
        style={{ flexShrink: 0 }}
      >✕</button>
    </div>
  );
}

// ── Target row ────────────────────────────────────────────────

function TargetRow({ entry, onChange, onRemove, backendUrl, icons, t }) {
  const [urlError, setUrlError] = useState('');
  const [headersError, setHeadersError] = useState('');
  const [viewerKeyError, setViewerKeyError] = useState('');
  const [qrOpen, setQrOpen] = useState(false);

  function validateUrl(val) {
    if (!val) return t('settings.targets.errorUrlRequired');
    try {
      const u = new URL(val);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return t('settings.targets.errorUrlProtocol');
      return '';
    } catch {
      return t('settings.targets.errorUrlInvalid');
    }
  }

  function validateHeaders(val) {
    if (!val) return '';
    try {
      const parsed = JSON.parse(val);
      if (typeof parsed !== 'object' || Array.isArray(parsed) || parsed === null) {
        return t('settings.targets.errorHeadersObject');
      }
      return '';
    } catch {
      return t('settings.targets.errorHeadersInvalid');
    }
  }

  function validateViewerKey(val) {
    if (!val) return t('settings.targets.viewerKeyError');
    if (!/^[a-zA-Z0-9_-]{3,}$/.test(val)) return t('settings.targets.viewerKeyError');
    return '';
  }

  const isValidViewerKey = entry.type === 'viewer' && entry.viewerKey && /^[a-zA-Z0-9_-]{3,}$/.test(entry.viewerKey);

  // Build the viewer URL — includes icon param when an icon is selected
  const viewerPageUrl = (isValidViewerKey && backendUrl)
    ? `${window.location.origin}/view/${encodeURIComponent(entry.viewerKey)}?server=${encodeURIComponent(backendUrl)}${entry.iconId ? `&icon=${entry.iconId}` : ''}`
    : null;

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 4, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <label className="settings-checkbox" style={{ marginBottom: 0 }}>
          <input
            type="checkbox"
            checked={entry.enabled}
            onChange={e => onChange({ ...entry, enabled: e.target.checked })}
          />
        </label>
        <select
          className="settings-field__input"
          value={entry.type}
          onChange={e => {
            const next = { ...entry, type: e.target.value };
            // Clear all type-specific fields when switching types to prevent stale data
            delete next.url;
            delete next.headers;
            delete next.streamKey;
            delete next.viewerKey;
            onChange(next);
            setUrlError('');
            setHeadersError('');
            setViewerKeyError('');
          }}
          style={{ width: 'auto' }}
        >
          <option value="youtube">{t('settings.targets.typeYouTube')}</option>
          <option value="generic">{t('settings.targets.typeGeneric')}</option>
          <option value="viewer">{t('settings.targets.typeViewer')}</option>
        </select>
        {entry.type !== 'viewer' && (
          <select
            className="settings-field__input"
            value={entry.format || 'youtube'}
            onChange={e => onChange({ ...entry, format: e.target.value })}
            style={{ width: 'auto' }}
          >
            <option value="youtube">{t('settings.targets.formatYouTube')}</option>
            <option value="json">{t('settings.targets.formatJson')}</option>
          </select>
        )}
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          onClick={onRemove}
          title={t('settings.targets.removeTarget')}
          style={{ flexShrink: 0, marginLeft: 'auto' }}
        >✕</button>
      </div>

      {entry.type === 'youtube' && (
        <div>
          <label className="settings-field__label">{t('settings.targets.streamKey')}</label>
          <input
            className="settings-field__input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={t('settings.targets.streamKeyPlaceholder')}
            value={entry.streamKey || ''}
            onChange={e => onChange({ ...entry, streamKey: e.target.value })}
          />
          <span className="settings-field__hint">{t('settings.targets.streamKeyHint')}</span>
        </div>
      )}

      {entry.type === 'generic' && (
        <>
          <div>
            <label className="settings-field__label">{t('settings.targets.endpointUrl')}</label>
            <input
              className="settings-field__input"
              type="url"
              autoComplete="off"
              placeholder="https://example.com/captions"
              value={entry.url || ''}
              onChange={e => {
                onChange({ ...entry, url: e.target.value });
                setUrlError(validateUrl(e.target.value));
              }}
              onBlur={e => setUrlError(validateUrl(e.target.value))}
            />
            {urlError && (
              <span className="settings-field__hint" style={{ color: 'var(--color-error, #c00)' }}>{urlError}</span>
            )}
            <span className="settings-field__hint">{t('settings.targets.endpointUrlHint')}</span>
          </div>
          <div>
            <label className="settings-field__label">{t('settings.targets.headers')}</label>
            <textarea
              className="settings-field__input"
              rows={3}
              placeholder={'{"Authorization": "Bearer token"}'}
              value={entry.headers || ''}
              onChange={e => {
                onChange({ ...entry, headers: e.target.value });
                setHeadersError(validateHeaders(e.target.value));
              }}
              onBlur={e => setHeadersError(validateHeaders(e.target.value))}
              style={{ fontFamily: 'monospace', fontSize: '0.85em', resize: 'vertical' }}
            />
            {headersError && (
              <span className="settings-field__hint" style={{ color: 'var(--color-error, #c00)' }}>{headersError}</span>
            )}
            <span className="settings-field__hint">{t('settings.targets.headersHint')}</span>
          </div>
        </>
      )}

      {entry.type === 'viewer' && (
        <div>
          <label className="settings-field__label">{t('settings.targets.viewerKey')}</label>
          <input
            className="settings-field__input"
            type="text"
            autoComplete="off"
            spellCheck={false}
            placeholder={t('settings.targets.viewerKeyPlaceholder')}
            value={entry.viewerKey || ''}
            onChange={e => {
              onChange({ ...entry, viewerKey: e.target.value });
              setViewerKeyError(validateViewerKey(e.target.value));
            }}
            onBlur={e => setViewerKeyError(validateViewerKey(e.target.value))}
          />
          {viewerKeyError && (
            <span className="settings-field__hint" style={{ color: 'var(--color-error, #c00)' }}>{viewerKeyError}</span>
          )}
          <span className="settings-field__hint">{t('settings.targets.viewerKeyHint')}</span>

          {/* Icon selector */}
          <label className="settings-field__label" style={{ marginTop: 8 }}>{t('settings.targets.viewerIcon')}</label>
          <select
            className="settings-field__input"
            style={{ width: 'auto' }}
            value={entry.iconId || ''}
            onChange={e => onChange({ ...entry, iconId: e.target.value ? Number(e.target.value) : null })}
          >
            <option value="">{t('settings.targets.viewerIconNone')}</option>
            {(icons || []).map(icon => (
              <option key={icon.id} value={icon.id}>{icon.filename}</option>
            ))}
          </select>
          <span className="settings-field__hint">{t('settings.targets.viewerIconHint')}</span>

          {viewerPageUrl && (
            <div style={{ marginTop: 6 }}>
              <span className="settings-field__label">{t('settings.targets.viewerUrl')}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2, flexWrap: 'wrap' }}>
                <a
                  href={viewerPageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ wordBreak: 'break-all', fontSize: '0.85em', flex: 1, minWidth: 0 }}
                >{viewerPageUrl}</a>
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  style={{ flexShrink: 0 }}
                  onClick={() => setQrOpen(v => !v)}
                  title={t('settings.targets.viewerQrTitle')}
                >
                  {t('settings.targets.viewerQr')}
                </button>
              </div>

              {/* QR code popover */}
              {qrOpen && (
                <div style={{
                  marginTop: 8,
                  padding: '12px 14px',
                  background: 'var(--color-bg, #1a1a1a)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  display: 'inline-flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 8,
                }}>
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(viewerPageUrl)}`}
                    alt="QR code"
                    width={180}
                    height={180}
                    style={{ display: 'block', borderRadius: 4 }}
                  />
                  <span style={{ fontSize: '0.72em', opacity: 0.6, textAlign: 'center' }}>
                    {t('settings.targets.viewerQrHint')}
                  </span>
                  <button
                    type="button"
                    className="btn btn--secondary btn--sm"
                    onClick={() => setQrOpen(false)}
                  >✕</button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
        <label className="settings-checkbox" style={{ marginBottom: 0 }}>
          <input
            type="checkbox"
            checked={!!entry.noBatch}
            onChange={e => onChange({ ...entry, noBatch: e.target.checked })}
          />
          {t('settings.targets.noBatch')}
        </label>
        <span className="settings-field__hint" style={{ display: 'block', marginTop: 4 }}>
          {t('settings.targets.noBatchHint')}
        </span>
      </div>
    </div>
  );
}

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

  // ── Receivers tab handlers ────────────────────────────────

  function updateTargetRow(id, updatedEntry) {
    const next = targets.map(r => r.id === id ? updatedEntry : r);
    setTargetsState(next);
    setTargets(next);
  }

  function removeTargetRow(id) {
    const next = targets.filter(r => r.id !== id);
    setTargetsState(next);
    setTargets(next);
  }

  function addTargetRow() {
    const newRow = {
      id: crypto.randomUUID(),
      enabled: true,
      type: 'youtube',
      streamKey: '',
    };
    const next = [...targets, newRow];
    setTargetsState(next);
    setTargets(next);
  }

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

  function updateTranslationRow(id, updatedEntry) {
    const next = translations.map(r => r.id === id ? updatedEntry : r);
    setTranslationsState(next);
    setTranslations(next);
  }

  function removeTranslationRow(id) {
    const next = translations.filter(r => r.id !== id);
    setTranslationsState(next);
    setTranslations(next);
  }

  function addTranslationRow() {
    const hasCaptionTarget = translations.some(r => r.target === 'captions');
    const newRow = {
      id: crypto.randomUUID(),
      enabled: true,
      lang: 'en-US',
      target: hasCaptionTarget ? 'file' : 'captions',
      format: hasCaptionTarget ? 'youtube' : undefined,
    };
    const next = [...translations, newRow];
    setTranslationsState(next);
    setTranslations(next);
  }

  const hasCaptionTarget = translations.some(r => r.target === 'captions');

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
            <div className="settings-panel settings-panel--active">
              <div className="settings-field">
                <label className="settings-field__label">{t('settings.stt.engineLabel')}</label>
                <div className="stt-engine-list">
                  {[
                    { value: 'webkit', name: t('settings.stt.engineWebkitName'), desc: t('settings.stt.engineWebkitDesc') },
                    { value: 'cloud',  name: t('settings.stt.engineCloudName'),  desc: t('settings.stt.engineCloudDesc') },
                    { value: 'server', name: t('settings.stt.engineServerName'), desc: t('settings.stt.engineServerDesc') },
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

              {sttEngine !== 'server' && (
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
              )}

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

              {advancedMode && (
                <>
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
                </>
              )}

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

              {/* ── Server STT ─────────────────────────────── */}
              <div style={{ borderTop: '1px solid var(--border)', marginTop: 16, paddingTop: 16 }}>
                <div className="settings-section-title">{t('settings.serverStt.title')}</div>

                <div className="settings-field" style={{ marginTop: 8 }}>
                  <label className="settings-field__label">{t('settings.serverStt.provider')}</label>
                  <select
                    className="settings-field__input"
                    value={serverSttProvider}
                    onChange={e => {
                      const v = e.target.value;
                      setServerSttProvider(v);
                      if (session.connected) {
                        session.updateSttConfig({ provider: v }).catch(() => {});
                      }
                    }}
                  >
                    <option value="google">{t('settings.serverStt.providerGoogle')}</option>
                    <option value="whisper_http">{t('settings.serverStt.providerWhisper')}</option>
                    <option value="openai">{t('settings.serverStt.providerOpenAi')}</option>
                  </select>
                </div>

                <div className="settings-field">
                  <label className="settings-field__label">{t('settings.serverStt.language')}</label>
                  <LanguagePicker
                    value={serverSttLang}
                    onChange={code => {
                      setServerSttLang(code);
                      if (session.connected) {
                        session.updateSttConfig({ language: code }).catch(() => {});
                      }
                    }}
                    placeholder={t('settings.stt.languagePlaceholder')}
                  />
                </div>

                <div className="settings-field">
                  <label className="settings-field__label">{t('settings.serverStt.audioSource')}</label>
                  <select
                    className="settings-field__input"
                    value={serverSttAudioSource}
                    onChange={e => {
                      const v = e.target.value;
                      setServerSttAudioSource(v);
                      if (session.connected) {
                        session.updateSttConfig({ audioSource: v }).catch(() => {});
                      }
                    }}
                  >
                    <option value="hls">{t('settings.serverStt.audioSourceHls')}</option>
                    <option value="rtmp">{t('settings.serverStt.audioSourceRtmp')}</option>
                    <option value="whep">{t('settings.serverStt.audioSourceWhep')}</option>
                  </select>
                  {serverSttAudioSource === 'whep' && serverSttWhepAvailable === false && (
                    <span className="stt-whep-warning">{t('settings.serverStt.whepUnavailable')}</span>
                  )}
                  <span className="settings-field__hint">{t('settings.serverStt.audioSourceHint')}</span>
                </div>

                <div className="settings-field">
                  <label className="settings-field__label">
                    {t('settings.serverStt.confidenceThreshold')}: <strong>{serverSttConfidenceThreshold === 0 ? 'off' : Number(serverSttConfidenceThreshold).toFixed(2)}</strong>
                  </label>
                  <input
                    type="range"
                    className="settings-field__input"
                    style={{ padding: 0, cursor: 'pointer' }}
                    min="0" max="1" step="0.05"
                    value={serverSttConfidenceThreshold}
                    onChange={e => {
                      const v = Number(e.target.value);
                      setServerSttConfidenceThreshold(v);
                      if (session.connected) {
                        session.updateSttConfig({ confidenceThreshold: v || null }).catch(() => {});
                      }
                    }}
                  />
                  <span className="settings-field__hint">{t('settings.serverStt.confidenceThresholdHint')}</span>
                </div>

                <div className="settings-field">
                  <label className="settings-checkbox">
                    <input
                      type="checkbox"
                      checked={serverSttAutoStart}
                      onChange={e => {
                        const v = e.target.checked;
                        setServerSttAutoStart(v);
                        if (session.connected) {
                          session.updateSttConfig({ autoStart: v }).catch(() => {});
                        }
                      }}
                    />
                    {t('settings.serverStt.autoStart')}
                  </label>
                  <span className="settings-field__hint">{t('settings.serverStt.autoStartHint')}</span>
                </div>

                <div className="settings-field">
                  {!session.connected ? (
                    <span className="settings-field__hint">{t('settings.serverStt.notConnected')}</span>
                  ) : (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span className={`stt-status-dot${serverSttRunning ? ' stt-status-dot--active' : ''}`} />
                        <span>{serverSttRunning ? t('settings.serverStt.statusRunning') : t('settings.serverStt.statusStopped')}</span>
                        {serverSttRunning ? (
                          <button
                            className="btn btn--secondary btn--sm"
                            disabled={serverSttBusy}
                            onClick={async () => {
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
                          >
                            {t('settings.serverStt.stop')}
                          </button>
                        ) : (
                          <button
                            className="btn btn--primary btn--sm"
                            disabled={serverSttBusy}
                            onClick={async () => {
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
                          >
                            {t('settings.serverStt.start')}
                          </button>
                        )}
                      </div>
                      {serverSttError && <div className="settings-error" style={{ marginTop: 4 }}>{serverSttError}</div>}
                      <span className="settings-field__hint">{t('settings.serverStt.hint')}</span>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── Targets ── */}
          {activeTab === 'targets' && (
            <div className="settings-panel settings-panel--active">
              <div className="settings-field">
                {targets.length === 0 && (
                  <span className="settings-field__hint">{t('settings.targets.noTargets')}</span>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {targets.map(entry => (
                    <TargetRow
                      key={entry.id}
                      entry={entry}
                      onChange={updated => updateTargetRow(entry.id, updated)}
                      onRemove={() => removeTargetRow(entry.id)}
                      backendUrl={backendUrl}
                      icons={icons}
                      t={t}
                    />
                  ))}
                </div>
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  onClick={addTargetRow}
                  style={{ marginTop: 8 }}
                >
                  + {t('settings.targets.addTarget')}
                </button>
              </div>

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
                <label className="settings-field__label">{t('settings.vad.clientVad')}</label>
                <label className="settings-checkbox">
                  <input
                    type="checkbox"
                    checked={vadEnabled}
                    onChange={e => {
                      setVadEnabled(e.target.checked);
                      try { localStorage.setItem(KEYS.audio.clientVad, e.target.checked ? '1' : '0'); } catch {}
                    }}
                  />
                  {t('settings.vad.enableCheckbox')}
                </label>
                <span className="settings-field__hint">{t('settings.vad.enableHint')}</span>
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
                    try { localStorage.setItem(KEYS.audio.clientVadSilenceMs, String(v)); } catch {}
                  }}
                />
                <span className="settings-field__hint">{t('settings.vad.silenceDurationHint')}</span>
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
                    try { localStorage.setItem(KEYS.audio.clientVadThreshold, String(v)); } catch {}
                  }}
                />
                <span className="settings-field__hint">{t('settings.vad.energyThresholdHint')}</span>
              </div>
            </div>
          )}

          {/* ── Translation ── */}
          {activeTab === 'translation' && (
            <div className="settings-panel settings-panel--active">
              <div className="settings-field">
                <label className="settings-field__label">{t('settings.translation.translationList')}</label>
                <span className="settings-field__hint" style={{ display: 'block', marginBottom: 8 }}>
                  {t('settings.translation.enableHint')}
                </span>
                {translations.length === 0 && (
                  <span className="settings-field__hint">{t('settings.translation.noTranslations')}</span>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {translations.map(entry => (
                    <TranslationRow
                      key={entry.id}
                      entry={entry}
                      onChange={updated => updateTranslationRow(entry.id, updated)}
                      onRemove={() => removeTranslationRow(entry.id)}
                      hasExistingCaptionTarget={hasCaptionTarget}
                      t={t}
                    />
                  ))}
                </div>
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  onClick={addTranslationRow}
                  style={{ marginTop: 8 }}
                >
                  + {t('settings.translation.addTranslation')}
                </button>
              </div>

              {hasCaptionTarget && (
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
              )}

              <div className="settings-field">
                <label className="settings-field__label">{t('settings.translation.vendor')}</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {TRANSLATION_VENDORS.map(v => (
                    <button
                      key={v.value}
                      type="button"
                      className={`lang-btn${translationVendor === v.value ? ' lang-btn--active' : ''}`}
                      onClick={() => {
                        setTranslationVendorState(v.value);
                        setTranslationVendor(v.value);
                      }}
                    >
                      {t(v.labelKey)}
                    </button>
                  ))}
                </div>
              </div>

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
