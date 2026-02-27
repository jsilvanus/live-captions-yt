import { useState, useEffect, useRef } from 'react';

const STORAGE_KEY_STT_LANG = 'lcyt-stt-lang';

const COMMON_LANGUAGES = [
  { code: 'en-US', label: 'English (US)' },
  { code: 'en-GB', label: 'English (UK)' },
  { code: 'es-ES', label: 'Spanish (Spain)' },
  { code: 'es-MX', label: 'Spanish (Mexico)' },
  { code: 'fr-FR', label: 'French' },
  { code: 'de-DE', label: 'German' },
  { code: 'it-IT', label: 'Italian' },
  { code: 'pt-BR', label: 'Portuguese (Brazil)' },
  { code: 'pt-PT', label: 'Portuguese (Portugal)' },
  { code: 'ja-JP', label: 'Japanese' },
  { code: 'ko-KR', label: 'Korean' },
  { code: 'zh-CN', label: 'Chinese (Simplified)' },
  { code: 'zh-TW', label: 'Chinese (Traditional)' },
  { code: 'ar-SA', label: 'Arabic' },
  { code: 'hi-IN', label: 'Hindi' },
  { code: 'ru-RU', label: 'Russian' },
  { code: 'nl-NL', label: 'Dutch' },
  { code: 'pl-PL', label: 'Polish' },
  { code: 'sv-SE', label: 'Swedish' },
  { code: 'da-DK', label: 'Danish' },
  { code: 'fi-FI', label: 'Finnish' },
  { code: 'nb-NO', label: 'Norwegian' },
  { code: 'tr-TR', label: 'Turkish' },
  { code: 'id-ID', label: 'Indonesian' },
  { code: 'th-TH', label: 'Thai' },
  { code: 'vi-VN', label: 'Vietnamese' },
  { code: 'uk-UA', label: 'Ukrainian' },
  { code: 'cs-CZ', label: 'Czech' },
  { code: 'ro-RO', label: 'Romanian' },
  { code: 'hu-HU', label: 'Hungarian' },
];

export function AudioPanel({ visible }) {
  const savedLang = localStorage.getItem(STORAGE_KEY_STT_LANG) || 'en-US';
  const savedLangEntry = COMMON_LANGUAGES.find(l => l.code === savedLang);

  const [listening, setListening] = useState(false);
  const [langQuery, setLangQuery] = useState(savedLangEntry ? savedLangEntry.label : savedLang);
  const [langCode, setLangCode] = useState(savedLang);
  const [langDropdownOpen, setLangDropdownOpen] = useState(false);
  const [interimText, setInterimText] = useState('');
  const [finalText, setFinalText] = useState('');
  const [supported, setSupported] = useState(true);

  const recognitionRef = useRef(null);

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    setSupported(!!SpeechRecognition);
  }, []);

  // Stop recognition when component unmounts
  useEffect(() => {
    return () => {
      const rec = recognitionRef.current;
      recognitionRef.current = null;
      if (rec) try { rec.stop(); } catch {}
    };
  }, []);

  function startListening() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = langCode;

    recognition.onresult = function(event) {
      let interim = '';
      let final = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          final += transcript;
        } else {
          interim += transcript;
        }
      }
      if (final) setFinalText(prev => prev + final + ' ');
      setInterimText(interim);
    };

    recognition.onend = function() {
      // Auto-restart to keep continuous listening (browser may stop on silence)
      if (recognitionRef.current) {
        try { recognition.start(); } catch {}
      }
    };

    recognition.onerror = function(event) {
      if (event.error === 'no-speech') return;
      recognitionRef.current = null;
      setListening(false);
      setInterimText('');
    };

    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
    setInterimText('');
    setFinalText('');
  }

  function stopListening() {
    const rec = recognitionRef.current;
    recognitionRef.current = null;
    if (rec) try { rec.stop(); } catch {}
    setListening(false);
    setInterimText('');
  }

  function toggleSpeechRecognition() {
    if (listening) {
      stopListening();
    } else {
      startListening();
    }
  }

  function onLangInput(value) {
    setLangQuery(value);
    setLangDropdownOpen(value.trim().length > 0);
  }

  function selectLang(entry) {
    setLangQuery(entry.label);
    setLangCode(entry.code);
    setLangDropdownOpen(false);
    try { localStorage.setItem(STORAGE_KEY_STT_LANG, entry.code); } catch {}
  }

  const langMatches = langDropdownOpen
    ? COMMON_LANGUAGES.filter(l =>
        l.label.toLowerCase().includes(langQuery.toLowerCase()) ||
        l.code.toLowerCase().includes(langQuery.toLowerCase())
      )
    : [];

  if (!visible) return null;

  return (
    <div className="audio-panel">
      <div className="audio-panel__scroll">

        <section className="audio-section">
          <h3 className="audio-section__title">Speech to Text</h3>

          {!supported && (
            <p className="audio-field__hint">
              Web Speech API is not supported in this browser. Try Chrome or Edge.
            </p>
          )}

          <div className="audio-field">
            <label className="audio-field__label">Language</label>
            <div className="audio-lang-wrap">
              <input
                className="audio-field__input"
                type="text"
                placeholder="Type to filter…"
                autoComplete="off"
                spellCheck={false}
                value={langQuery}
                onChange={e => onLangInput(e.target.value)}
                onBlur={() => setTimeout(() => setLangDropdownOpen(false), 150)}
              />
              {langDropdownOpen && langMatches.length > 0 && (
                <div className="audio-lang-list">
                  {langMatches.map(l => (
                    <button
                      key={l.code}
                      className="audio-lang-option"
                      onMouseDown={() => selectLang(l)}
                    >
                      {l.label} <span className="audio-lang-code">{l.code}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <span className="audio-field__hint">{langCode}</span>
          </div>

          <div className="audio-field">
            <button
              className={`btn audio-caption-btn${listening ? ' audio-caption-btn--active' : ' btn--primary'}`}
              disabled={!supported}
              onClick={toggleSpeechRecognition}
            >
              {listening ? '⏹ Stop Captioning' : '🎙 Click to Caption'}
            </button>
          </div>

          {listening && (
            <div className="audio-caption-live">
              {!finalText && !interimText ? (
                <span className="audio-caption-placeholder">Listening for speech…</span>
              ) : (
                <>
                  {finalText && <span className="audio-caption-final">{finalText}</span>}
                  {interimText && <span className="audio-caption-interim">{interimText}</span>}
                </>
              )}
            </div>
          )}
        </section>

      </div>
    </div>
  );
}
