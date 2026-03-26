import React, { useRef } from 'react';
import { useLang } from '../../contexts/LangContext.jsx';
import { LanguagePicker } from '../LanguagePicker.jsx';
import { STT_MODELS } from '../../lib/sttConfig';

/**
 * ServicePanel — STT / service settings panel (pure UI, no side-effects).
 *
 * Props (see CCModal for handlers/state wiring):
 *  sttEngine, onSttEngineChange,
 *  selectedMicId, onMicIdChange, micDevices, onRefreshMics,
 *  sttLang, onSttLangChange,
 *  sttLocal, onSttLocalChange, localAvailability,
 *  utteranceEndButton, onUtteranceEndButtonChange,
 *  utteranceEndTimer, onUtteranceEndTimerChange,
 *  cloudModel, onCloudModelChange,
 *  cloudPunctuation, onCloudPunctuationChange,
 *  cloudProfanity, onCloudProfanityChange,
 *  cloudConfidence, onCloudConfidenceChange,
 *  cloudMaxLen, onCloudMaxLenChange,
 *  credential, onCredentialLoad, onCredentialClear, credError,
 *  serverSttProvider, onServerSttProviderChange,
 *  serverSttLang, onServerSttLangChange,
 *  serverSttAudioSource, onServerSttAudioSourceChange,
 *  serverSttConfidenceThreshold, onServerSttConfidenceThresholdChange,
 *  serverSttAutoStart, onServerSttAutoStartChange,
 *  serverSttRunning, serverSttBusy, serverSttError, serverSttWhepAvailable,
 *  onServerSttStart, onServerSttStop,
 *  advancedMode, connected
 */
export function ServicePanel(props) {
  const { t } = useLang();
  const {
    sttEngine, onSttEngineChange,
    selectedMicId, onMicIdChange, micDevices = [], onRefreshMics,
    sttLang, onSttLangChange,
    sttLocal, onSttLocalChange, localAvailability,
    utteranceEndButton, onUtteranceEndButtonChange,
    utteranceEndTimer, onUtteranceEndTimerChange,
    cloudModel, onCloudModelChange,
    cloudPunctuation, onCloudPunctuationChange,
    cloudProfanity, onCloudProfanityChange,
    cloudConfidence, onCloudConfidenceChange,
    cloudMaxLen, onCloudMaxLenChange,
    credential, onCredentialLoad, onCredentialClear, credError,
    serverSttProvider, onServerSttProviderChange,
    serverSttLang, onServerSttLangChange,
    serverSttAudioSource, onServerSttAudioSourceChange,
    serverSttConfidenceThreshold, onServerSttConfidenceThresholdChange,
    serverSttAutoStart, onServerSttAutoStartChange,
    serverSttRunning, serverSttBusy, serverSttError, serverSttWhepAvailable,
    onServerSttStart, onServerSttStop,
    advancedMode, connected,
  } = props;

  const credRef = useRef(null);

  return (
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
              onChange={e => onMicIdChange(e.target.value)}
            >
              <option value="">{t('settings.stt.microphoneDefault')}</option>
              {micDevices.map(d => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || d.deviceId}
                </option>
              ))}
            </select>
            <button type="button" className="btn" onClick={onRefreshMics}>{t('settings.stt.microphoneRefresh')}</button>
          </div>
        </div>
      )}

      <div className="settings-field">
        <label className="settings-field__label">{t('settings.stt.language')}</label>
        <LanguagePicker
          value={sttLang}
          onChange={onSttLangChange}
          placeholder={t('settings.stt.languagePlaceholder')}
        />
        <span className="settings-field__hint">{sttLang}</span>
      </div>

      {sttEngine === 'webkit' && localAvailability !== null && localAvailability !== 'no' && (
        <div className="settings-field">
          <label className="settings-field__label">{t('settings.stt.onDevice')}</label>
          <label className="settings-checkbox">
            <input
              type="checkbox"
              checked={sttLocal}
              onChange={e => onSttLocalChange(e.target.checked)}
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
                onChange={e => onUtteranceEndButtonChange(e.target.checked)}
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
              onChange={e => onUtteranceEndTimerChange(Number(e.target.value))}
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
              value={cloudModel}
              onChange={e => onCloudModelChange(e.target.value)}
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
                onChange={e => onCloudPunctuationChange(e.target.checked)}
              />
              {t('settings.stt.punctuation')}
            </label>
            <label className="settings-checkbox">
              <input
                type="checkbox"
                checked={cloudProfanity}
                onChange={e => onCloudProfanityChange(e.target.checked)}
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
              onChange={e => onCloudConfidenceChange(Number(e.target.value))}
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
              onChange={e => onCloudMaxLenChange(Number(e.target.value))}
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
                <button className="btn btn--secondary btn--sm" onClick={onCredentialClear}>
                  {t('settings.stt.credentialRemove')}
                </button>
              </div>
            ) : (
              <button className="btn btn--secondary btn--sm" onClick={() => credRef.current?.click()}>
                {t('settings.stt.credentialLoad')}
              </button>
            )}
            {credError && <div className="settings-error">{credError}</div>}
            <span className="settings-field__hint">{t('settings.stt.credentialHint')}</span>
            <input
              ref={credRef}
              type="file"
              accept="application/json,.json"
              style={{ display: 'none' }}
              aria-label={t('settings.stt.credentialLoad')}
              onChange={onCredentialLoad}
            />
          </div>
        </>
      )}

      {/* Server STT */}
      <div style={{ borderTop: '1px solid var(--border)', marginTop: 16, paddingTop: 16 }}>
        <div className="settings-section-title">{t('settings.serverStt.title')}</div>

        <div className="settings-field" style={{ marginTop: 8 }}>
          <label className="settings-field__label">{t('settings.serverStt.provider')}</label>
          <select
            className="settings-field__input"
            value={serverSttProvider}
            onChange={e => onServerSttProviderChange(e.target.value)}
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
            onChange={onServerSttLangChange}
            placeholder={t('settings.stt.languagePlaceholder')}
          />
        </div>

        <div className="settings-field">
          <label className="settings-field__label">{t('settings.serverStt.audioSource')}</label>
          <select
            className="settings-field__input"
            value={serverSttAudioSource}
            onChange={e => onServerSttAudioSourceChange(e.target.value)}
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
            onChange={e => onServerSttConfidenceThresholdChange(Number(e.target.value))}
          />
          <span className="settings-field__hint">{t('settings.serverStt.confidenceThresholdHint')}</span>
        </div>

        <div className="settings-field">
          <label className="settings-checkbox">
            <input
              type="checkbox"
              checked={serverSttAutoStart}
              onChange={e => onServerSttAutoStartChange(e.target.checked)}
            />
            {t('settings.serverStt.autoStart')}
          </label>
          <span className="settings-field__hint">{t('settings.serverStt.autoStartHint')}</span>
        </div>

        <div className="settings-field">
          {!connected ? (
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
                    onClick={onServerSttStop}
                  >
                    {t('settings.serverStt.stop')}
                  </button>
                ) : (
                  <button
                    className="btn btn--primary btn--sm"
                    disabled={serverSttBusy}
                    onClick={onServerSttStart}
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
  );
}
