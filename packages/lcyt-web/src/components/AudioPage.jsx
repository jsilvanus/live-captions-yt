import { useRef, useState } from 'react';
import { AudioPanel } from './AudioPanel';

/**
 * AudioPage — full-page Audio / STT view at /audio.
 *
 * Renders the AudioPanel full-screen. Captions are sent through the
 * shared SessionContext exactly as they are when AudioPanel is mounted
 * in the Captions page.
 */
export function AudioPage() {
  const audioPanelRef = useRef(null);
  const [listening, setListening] = useState(false);
  const [interimText, setInterimText] = useState('');
  const [utteranceActive, setUtteranceActive] = useState(false);
  const [utteranceTimerRunning, setUtteranceTimerRunning] = useState(false);
  const [utteranceTimerSec, setUtteranceTimerSec] = useState(0);

  function handleUtteranceChange({ active, timerRunning, timerSec }) {
    setUtteranceActive(active);
    setUtteranceTimerRunning(timerRunning ?? false);
    setUtteranceTimerSec(timerSec ?? 0);
  }

  return (
    <div className="audio-page">
      <div className="audio-page__panel">
        <AudioPanel
          ref={audioPanelRef}
          visible
          onListeningChange={setListening}
          onInterimChange={setInterimText}
          onUtteranceChange={handleUtteranceChange}
        />
      </div>
      {interimText && (
        <div className="audio-page__interim">
          <span className="audio-page__interim-text">{interimText}</span>
        </div>
      )}
    </div>
  );
}
