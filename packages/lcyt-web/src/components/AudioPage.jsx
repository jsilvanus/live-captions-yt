import { useState, useEffect } from 'react';
import { useAudioContext } from '../contexts/AudioContext';
import { useSentLogContext } from '../contexts/SentLogContext';
import { LanguagePicker } from './LanguagePicker';
import { readInputLang, writeInputLang, INPUT_LANG_EVENT } from '../lib/inputLang';
import { formatTime } from '../lib/formatting';
import { KEYS } from '../lib/storageKeys.js';

function MiniSentLog() {
  const { entries } = useSentLogContext();
  const recent = entries.slice(0, 10);

  if (recent.length === 0) {
    return <div className="audio-page__sentlog-empty">No captions sent yet.</div>;
  }

  return (
    <ul className="audio-page__sentlog">
      {recent.map(entry => {
        const seqLabel = entry.pending ? '?' : entry.error ? '✕' : `#${entry.sequence}`;
        const ticksLabel = entry.pending ? '✓' : entry.error ? '✗' : '✓✓';
        const ticksCls = entry.pending ? 'sent-item__ticks--pending'
          : entry.error ? 'sent-item__ticks--error'
          : 'sent-item__ticks--confirmed';
        return (
          <li key={entry.requestId} className={`audio-page__sent-entry${entry.error ? ' audio-page__sent-entry--error' : ''}`}>
            <span className="audio-page__sent-seq">{seqLabel}</span>
            <span className={`audio-page__sent-ticks ${ticksCls}`}>{ticksLabel}</span>
            <span className="audio-page__sent-time">{formatTime(entry.timestamp)}</span>
            <span className="audio-page__sent-text">{entry.text}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function AudioPage() {
  const audio = useAudioContext();
  const [lang, setLang] = useState(readInputLang);
  const [utteranceEnd, setUtteranceEnd] = useState(
    () => { try { return localStorage.getItem(KEYS.audio.utteranceEndButton) === '1'; } catch { return false; } }
  );

  useEffect(() => {
    function onLangChange() { setLang(readInputLang()); }
    window.addEventListener(INPUT_LANG_EVENT, onLangChange);
    return () => window.removeEventListener(INPUT_LANG_EVENT, onLangChange);
  }, []);

  function handleLangChange(code) {
    setLang(code);
    writeInputLang(code);
    window.dispatchEvent(new Event(INPUT_LANG_EVENT));
  }

  return (
    <div className="audio-page">
      <div className="audio-page__inner">
        <section className="audio-page__sentlog-section">
          <MiniSentLog />
        </section>

        <section className="audio-page__lang-section">
          <label className="audio-page__lang-label">Language</label>
          <LanguagePicker
            value={lang}
            onChange={handleLangChange}
            placeholder="Caption language…"
            className="audio-page__lang-picker"
          />
        </section>

        <section className="audio-page__controls">
          <button
            className={`btn ${audio.listening ? 'btn--danger' : 'btn--primary'} audio-page__mic-btn`}
            onClick={audio.toggle}
          >
            {audio.listening ? '⏹ Stop recording' : '🎤 Start recording'}
          </button>
          {utteranceEnd && (
            <button
              className="btn btn--secondary audio-page__utter-btn"
              onClick={audio.utteranceEndClick}
            >
              ✂ Send utterance
            </button>
          )}
        </section>

        {audio.interimText && (
          <div className="audio-page__interim">
            <span className="audio-page__interim-text">{audio.interimText}</span>
          </div>
        )}
      </div>
    </div>
  );
}
