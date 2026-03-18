import { useState, useEffect } from 'react';
import { useAudioContext } from '../../contexts/AudioContext';
import { LanguagePicker } from '../LanguagePicker';
import { readInputLang, writeInputLang, INPUT_LANG_EVENT } from '../../lib/inputLang';
import { KEYS } from '../../lib/storageKeys.js';

export function AudioWidget({ size }) {
  const audio = useAudioContext();
  const [utteranceEnd, setUtteranceEnd] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [lang, setLang] = useState(readInputLang);

  useEffect(() => {
    const ueb = localStorage.getItem(KEYS.audio.utteranceEndButton);
    setUtteranceEnd(ueb === '1');

    function onLangChange() { setLang(readInputLang()); }
    window.addEventListener(INPUT_LANG_EVENT, onLangChange);
    return () => window.removeEventListener(INPUT_LANG_EVENT, onLangChange);
  }, []);

  function handleLangChange(code) {
    setLang(code);
    writeInputLang(code);
    window.dispatchEvent(new Event(INPUT_LANG_EVENT));
  }

  if (size === 'small') {
    return (
      <div className="db-widget db-widget--audio-sm">
        <button
          className={`btn btn--sm ${audio.listening ? 'btn--danger' : 'btn--primary'} db-mic-btn`}
          onClick={audio.toggle}
        >
          {audio.listening ? '■ Stop' : '🎤 Mic'}
        </button>
        {utteranceEnd && (
          <button
            className="btn btn--sm btn--secondary db-utter-btn"
            onClick={audio.utteranceEndClick}
            title="Send utterance"
          >
            ✂ {pendingCount > 0 && <span className="db-badge">{pendingCount}</span>}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="db-widget">
      <div className="db-row">
        <button
          className={`btn ${audio.listening ? 'btn--danger' : 'btn--primary'}`}
          style={{ flex: 1 }}
          onClick={audio.toggle}
        >
          {audio.listening ? '■ Stop recording' : '🎤 Start recording'}
        </button>
      </div>
      {utteranceEnd && (
        <div className="db-row" style={{ marginTop: 8 }}>
          <button
            className="btn btn--secondary"
            style={{ flex: 1 }}
            onClick={audio.utteranceEndClick}
          >
            ✂ Send utterance {pendingCount > 0 && `(${pendingCount} pending)`}
          </button>
        </div>
      )}
      {audio.listening && audio.interimText && (
        <div className="db-interim-text">{audio.interimText}</div>
      )}
      <div className="db-row" style={{ marginTop: 8, alignItems: 'center', gap: 8 }}>
        <span className="db-widget__label" style={{ whiteSpace: 'nowrap' }}>Language</span>
        <LanguagePicker
          value={lang}
          onChange={handleLangChange}
          placeholder="Caption language…"
          className="db-lang-picker"
        />
      </div>
    </div>
  );
}
