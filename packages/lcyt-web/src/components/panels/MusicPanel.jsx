import { useLang } from '../../contexts/LangContext.jsx';

/**
 * MusicPanel — browser-side music detection settings.
 *
 * Props:
 *   enabled: boolean
 *   onEnabledChange: (v: boolean) => void
 *   bpmEnabled: boolean
 *   onBpmEnabledChange: (v: boolean) => void
 *   label: string | null          current sound label ('music'|'speech'|'silence'|null)
 *   bpm: number | null            current BPM estimate
 *   available: boolean            true when an AnalyserNode is available (mic active)
 *   running: boolean              true when the detection loop is running
 */
export function MusicPanel({
  enabled, onEnabledChange,
  bpmEnabled, onBpmEnabledChange,
  label, bpm,
  available, running,
}) {
  const { t } = useLang();

  function labelText() {
    if (!available) return t('settings.music.notAvailable');
    if (!enabled) return '—';
    if (label === 'music') {
      const bpmPart = bpmEnabled && bpm ? ` · ${Math.round(bpm)} ${t('settings.music.bpmSuffix')}` : '';
      return `${t('settings.music.labelMusic')}${bpmPart}`;
    }
    if (label === 'speech') return t('settings.music.labelSpeech');
    if (label === 'silence') return t('settings.music.labelSilence');
    return '—';
  }

  return (
    <>
      <div className="settings-field">
        <label className="settings-field__label">{t('settings.music.title')}</label>
        <label className="settings-checkbox">
          <input
            type="checkbox"
            checked={enabled}
            onChange={e => onEnabledChange(e.target.checked)}
          />
          {t('settings.music.enable')}
        </label>
        <span className="settings-field__hint">{t('settings.music.enableHint')}</span>
      </div>

      <div className="settings-field">
        <label className="settings-checkbox">
          <input
            type="checkbox"
            checked={bpmEnabled}
            disabled={!enabled}
            onChange={e => onBpmEnabledChange(e.target.checked)}
          />
          {t('settings.music.bpm')}
        </label>
        <span className="settings-field__hint">{t('settings.music.bpmHint')}</span>
      </div>

      {enabled && (
        <div className="settings-field">
          <label className="settings-field__label">{t('settings.music.statusTitle')}</label>
          <span className="settings-field__hint">{labelText()}</span>
        </div>
      )}
    </>
  );
}
