import { createContext, useContext, useRef, useState } from 'react';
import { AudioPanel } from '../components/AudioPanel';
import { useMusic } from '../hooks/useMusic';

const AudioContext = createContext(null);

export function useAudioContext() {
  const ctx = useContext(AudioContext);
  if (!ctx) throw new Error('useAudioContext must be used inside AudioProvider');
  return ctx;
}

export function AudioProvider({ children }) {
  const audioPanelRef = useRef(null);
  const analyserRef = useRef(null);

  const music = useMusic({ analyserRef });

  const [listening, setListening] = useState(false);
  const [interimText, setInterimText] = useState('');
  const [utteranceActive, setUtteranceActive] = useState(false);
  const [utteranceTimerRunning, setUtteranceTimerRunning] = useState(false);
  const [utteranceTimerSec, setUtteranceTimerSec] = useState(0);

  function handleUtteranceChange(active, timerRunning, timerSec) {
    setUtteranceActive(active ?? false);
    setUtteranceTimerRunning(timerRunning ?? false);
    setUtteranceTimerSec(timerSec ?? 0);
  }

  function toggle() { audioPanelRef.current?.toggle(); }
  function utteranceEndClick() { audioPanelRef.current?.utteranceEndClick(); }

  return (
    <AudioContext.Provider value={{
      listening,
      interimText,
      utteranceActive,
      utteranceTimerRunning,
      utteranceTimerSec,
      toggle,
      utteranceEndClick,
      analyserRef,
      music,
    }}>
      {children}
      <AudioPanel
        ref={audioPanelRef}
        visible={false}
        onListeningChange={setListening}
        onInterimChange={setInterimText}
        onUtteranceChange={handleUtteranceChange}
        onAnalyserChange={(a) => { analyserRef.current = a; }}
      />
    </AudioContext.Provider>
  );
}
