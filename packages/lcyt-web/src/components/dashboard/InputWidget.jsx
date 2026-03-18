import { useState, useEffect } from 'react';
import { useSessionContext } from '../../contexts/SessionContext';
import { getActiveCodes, setActiveCode, clearActiveCode } from '../../lib/activeCodes';
import { readInputLang, writeInputLang, INPUT_LANG_EVENT } from '../../lib/inputLang';
import { COMMON_LANGUAGES } from '../../lib/sttConfig';

export function InputWidget({ size }) {
  const { connected, send } = useSessionContext();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  // Metacode state (large view only)
  const [inputLang, setInputLang] = useState(readInputLang);
  const [activeCodes, setActiveCodesState] = useState(getActiveCodes);
  const [langPickerOpen, setLangPickerOpen] = useState(false);
  const [langQuery, setLangQuery] = useState('');

  useEffect(() => {
    function onLangChange() { setInputLang(readInputLang()); }
    function onCodesChange() { setActiveCodesState(getActiveCodes()); }
    window.addEventListener(INPUT_LANG_EVENT, onLangChange);
    window.addEventListener('lcyt:active-codes-changed', onCodesChange);
    return () => {
      window.removeEventListener(INPUT_LANG_EVENT, onLangChange);
      window.removeEventListener('lcyt:active-codes-changed', onCodesChange);
    };
  }, []);

  async function handleSend(e) {
    e.preventDefault();
    if (!text.trim() || !connected) return;
    setSending(true);
    try {
      const codes = { ...activeCodes };
      if (inputLang) codes.lang = inputLang;
      const opts = Object.keys(codes).length > 0 ? { codes } : undefined;
      await send(text.trim(), null, opts);
      setText('');
    } catch {}
    setSending(false);
  }

  function selectLang(code) {
    writeInputLang(code);
    setInputLang(code);
    setLangPickerOpen(false);
    setLangQuery('');
    window.dispatchEvent(new Event(INPUT_LANG_EVENT));
  }

  function handleLangBtn() {
    if (inputLang) {
      writeInputLang('');
      setInputLang('');
      window.dispatchEvent(new Event(INPUT_LANG_EVENT));
    } else {
      setLangPickerOpen(v => !v);
    }
  }

  function toggleNoTranslate() {
    setActiveCode('no-translate', activeCodes['no-translate'] ? null : true);
  }

  const langMatches = langQuery.trim().length > 0
    ? COMMON_LANGUAGES.filter(l =>
        l.label.toLowerCase().includes(langQuery.toLowerCase()) ||
        l.code.toLowerCase().includes(langQuery.toLowerCase()))
    : COMMON_LANGUAGES.slice(0, 12);

  const langLabel = inputLang
    ? (COMMON_LANGUAGES.find(l => l.code === inputLang)?.code ?? inputLang)
    : 'Lang';

  const customCodeKeys = Object.entries(activeCodes).filter(([k]) => k !== 'no-translate');

  if (size === 'small') {
    return (
      <form className="db-widget db-widget--input-sm" onSubmit={handleSend}>
        <input
          className="db-input"
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder={connected ? 'Caption…' : 'Not connected'}
          disabled={!connected || sending}
        />
        <button type="submit" className="btn btn--primary btn--sm" disabled={!connected || !text.trim() || sending}>
          {sending ? '…' : '▶'}
        </button>
      </form>
    );
  }

  return (
    <form className="db-widget" onSubmit={handleSend}>
      <textarea
        className="db-textarea"
        rows={3}
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder={connected ? 'Type a caption and press Send…' : 'Connect first to send captions'}
        disabled={!connected || sending}
        onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { handleSend(e); } }}
      />
      <div className="db-row" style={{ marginTop: 8, justifyContent: 'flex-end' }}>
        <span className="db-widget__muted" style={{ flex: 1, fontSize: 11 }}>Ctrl+Enter to send</span>
        <button type="submit" className="btn btn--primary" disabled={!connected || !text.trim() || sending}>
          {sending ? 'Sending…' : 'Send'}
        </button>
      </div>

      {/* Metacode section */}
      <div className="db-input-codes">
        <div className="db-input-codes__row">
          <div className="db-input-codes__lang-wrap">
            <button
              type="button"
              className={`code-btn${inputLang ? ' code-btn--active' : ''}`}
              title={inputLang ? `lang: ${inputLang} — click to clear` : 'Set caption language'}
              onClick={handleLangBtn}
            >
              {inputLang ? langLabel : `${langLabel} ▾`}
            </button>
            {langPickerOpen && (
              <div className="code-btn-dropdown">
                <input
                  type="text"
                  placeholder="Filter languages…"
                  value={langQuery}
                  autoFocus
                  onChange={e => setLangQuery(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Escape') setLangPickerOpen(false);
                    if (e.key === 'Enter' && langMatches.length > 0) selectLang(langMatches[0].code);
                  }}
                  style={{ width: '100%', boxSizing: 'border-box', padding: '4px 8px', border: 'none', borderBottom: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text)', outline: 'none' }}
                />
                {langMatches.map(l => (
                  <button key={l.code} type="button" className="audio-lang-option" onClick={() => selectLang(l.code)}>
                    {l.label} <span className="audio-lang-code">{l.code}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            className={`code-btn${activeCodes['no-translate'] ? ' code-btn--active' : ''}`}
            title="Toggle no-translate"
            onClick={toggleNoTranslate}
          >
            no-translate
          </button>
          {customCodeKeys.map(([k, v]) => (
            <button
              key={k}
              type="button"
              className="code-btn code-btn--active code-btn--custom"
              title={`${k}: ${v} — click to remove`}
              onClick={() => clearActiveCode(k)}
            >
              {k}: {v}
            </button>
          ))}
        </div>
      </div>
    </form>
  );
}
