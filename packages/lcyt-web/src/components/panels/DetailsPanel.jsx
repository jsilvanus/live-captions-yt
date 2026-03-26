import React from 'react';
import { useLang } from '../../contexts/LangContext.jsx';

/**
 * DetailsPanel — advanced details settings (pure UI)
 *
 * Props:
 *  batchInterval, onBatchIntervalChange, batchLocked,
 *  transcriptionOffset, onTranscriptionOffsetChange,
 *  vadEnabled, onVadEnabledChange,
 *  vadSilenceMs, onVadSilenceMsChange,
 *  vadThreshold, onVadThresholdChange,
 */
export function DetailsPanel({
  batchInterval, onBatchIntervalChange, batchLocked,
  transcriptionOffset, onTranscriptionOffsetChange,
  vadEnabled, onVadEnabledChange,
  vadSilenceMs, onVadSilenceMsChange,
  vadThreshold, onVadThresholdChange,
}) {
  const { t } = useLang();

  return (
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
          onChange={e => onBatchIntervalChange(Number(e.target.value))}
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
          onChange={e => onTranscriptionOffsetChange(Number(e.target.value))}
          onDoubleClick={() => onTranscriptionOffsetChange(0)}
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
            onChange={e => onVadEnabledChange(e.target.checked)}
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
          onChange={e => onVadSilenceMsChange(Number(e.target.value))}
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
          onChange={e => onVadThresholdChange(Number(e.target.value))}
        />
        <span className="settings-field__hint">{t('settings.vad.energyThresholdHint')}</span>
      </div>
    </div>
  );
}
