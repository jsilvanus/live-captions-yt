import { useEffect, useState } from 'react';
import { useAudioContext } from '../../contexts/AudioContext';
import { useLang } from '../../contexts/LangContext';
import { requestMicWindow } from '../../lib/micWindow.js';
import { getSttEngine, getSttLang, getSttSpeechMode, subscribeSttConfig } from '../../lib/sttConfig';

function readStt() {
  return { engine: getSttEngine(), lang: getSttLang(), mode: getSttSpeechMode() };
}

/**
 * Always-visible microphone control in the top bar. The recognition engine itself lives in the
 * hidden AudioPanel mounted by AudioProvider; this button starts/stops it (browser or server STT,
 * whichever the STT card selects) and shows the state: blue = idle, red = listening.
 */
export function TopBarMic() {
  const { t } = useLang();
  const { listening, toggle } = useAudioContext();
  const [stt, setStt] = useState(readStt);

  useEffect(() => subscribeSttConfig(() => setStt(readStt())), []);

  const where = stt.engine === 'server'
    ? t('topMic.server')
    : `${t('topMic.browser')}${stt.engine === 'webkit' ? `, ${stt.mode === 'local' ? t('topMic.local') : t('topMic.cloud')}` : ''}`;
  const label = `${listening ? t('topMic.stop') : t('topMic.start')} (${where}, ${stt.lang})`;

  return (
    <>
    <button
      type="button"
      className={['top-bar__mic', listening ? 'top-bar__mic--on' : ''].filter(Boolean).join(' ')}
      onClick={toggle}
      aria-pressed={listening}
      aria-label={label}
      title={label}
      data-testid="top-bar-mic"
    >
      <span aria-hidden="true">🎤</span>
      <span className="top-bar__mic-lang">{stt.lang}</span>
    </button>
    <button type="button" className="top-bar__icon-btn" onClick={() => requestMicWindow('toggle')}
      title={t('micWindow.open')} aria-label={t('micWindow.open')} data-testid="top-bar-mic-window">⧉</button>
    </>
  );
}
