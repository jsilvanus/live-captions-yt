import { useLang } from '../../contexts/LangContext.jsx';

/**
 * VadPanel — client-side Voice Activity Detection settings.
 *
 * Props:
 *   vadEnabled: boolean
 *   onVadEnabledChange: (enabled: boolean) => void
 *   vadSilenceMs: number
 *   onVadSilenceMsChange: (ms: number) => void
 *   vadThreshold: number
 *   onVadThresholdChange: (v: number) => void
 */
export function VadPanel({
  vadEnabled, onVadEnabledChange,
  vadSilenceMs, onVadSilenceMsChange,
  vadThreshold, onVadThresholdChange,
}) {
  const { t } = useLang();

  return (
    <>
      <div className="settings-field">
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
          onChange={e => onVadSilenceMsChange(parseInt(e.target.value, 10))}
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
          onChange={e => onVadThresholdChange(parseFloat(e.target.value))}
        />
        <span className="settings-field__hint">{t('settings.vad.energyThresholdHint')}</span>
      </div>
    </>
  );
}
