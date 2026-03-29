import { useLang } from '../contexts/LangContext';
import { useAudioContext } from '../contexts/AudioContext';

/**
 * Status-bar chip showing the current music-detection state.
 *
 * Self-contained: reads music state from AudioContext (single shared instance).
 *
 * @param {{ onClick?: () => void }} props
 */
export function MusicChip({ onClick }) {
  const { t } = useLang();
  const { music } = useAudioContext();

  if (!music.enabled) return null;
  if (!music.available) return null;

  const isMusicLabel = music.label === 'music';
  const chipClass = [
    'status-bar__stt-chip',
    isMusicLabel ? 'status-bar__music-chip--music' : 'status-bar__music-chip--other',
  ].join(' ');

  let label;
  if (music.label === 'music') {
    label = music.bpmEnabled && music.bpm
      ? `♪ ${Math.round(music.bpm)} ${t('settings.music.bpmSuffix')}`
      : t('settings.music.labelMusic');
  } else if (music.label === 'speech') {
    label = t('settings.music.labelSpeech');
  } else {
    label = t('settings.music.labelSilence');
  }

  return (
    <button
      className={chipClass}
      title={t('settings.music.statusTitle')}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
