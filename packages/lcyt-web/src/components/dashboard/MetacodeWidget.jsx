import { useState, useEffect } from 'react';
import { getActiveCodes, setActiveCode, clearActiveCode } from '../../lib/activeCodes';
import { readInputLang, writeInputLang, INPUT_LANG_EVENT } from '../../lib/inputLang';
import { LanguagePicker } from '../LanguagePicker';

function ActiveCodesDisplay({ activeCodes, inputLang, onRemoveLang, onRemoveCode }) {
  const hasAny = inputLang || Object.keys(activeCodes).length > 0;
  if (!hasAny) {
    return <div className="db-metacode__empty">No active codes</div>;
  }
  return (
    <div className="db-metacode__codes">
      {inputLang && (
        <button
          className="db-metacode__badge db-metacode__badge--active"
          title="lang — click to clear"
          onClick={onRemoveLang}
        >
          lang:{inputLang} ×
        </button>
      )}
      {Object.entries(activeCodes).map(([k, v]) => (
        <button
          key={k}
          className="db-metacode__badge db-metacode__badge--active"
          title={`${k}: ${v} — click to clear`}
          onClick={() => onRemoveCode(k)}
        >
          {v === true ? k : `${k}:${v}`} ×
        </button>
      ))}
    </div>
  );
}

export function MetacodeWidget({ size }) {
  const [activeCodes, setActiveCodesState] = useState(getActiveCodes);
  const [inputLang, setInputLang] = useState(readInputLang);
  const [customCodeKey, setCustomCodeKey] = useState('');
  const [customCodeValue, setCustomCodeValue] = useState('');
  const [customOpen, setCustomOpen] = useState(false);

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

  function removeLang() { writeInputLang(''); setInputLang(''); }
  function removeCode(key) { clearActiveCode(key); }
  function toggleNoTranslate() {
    setActiveCode('no-translate', activeCodes['no-translate'] ? null : true);
  }

  function commitCustom() {
    const key = customCodeKey.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
    const val = customCodeValue.trim();
    if (key && val) setActiveCode(key, val);
    setCustomCodeKey('');
    setCustomCodeValue('');
    setCustomOpen(false);
  }

  if (size === 'small') {
    return (
      <div className="db-widget db-metacode">
        <div className="db-metacode__label">Active codes</div>
        <ActiveCodesDisplay
          activeCodes={activeCodes}
          inputLang={inputLang}
          onRemoveLang={removeLang}
          onRemoveCode={removeCode}
        />
      </div>
    );
  }

  return (
    <div className="db-widget db-metacode db-metacode--large">
      <div className="db-metacode__section">
        <div className="db-metacode__label">Active codes</div>
        <ActiveCodesDisplay
          activeCodes={activeCodes}
          inputLang={inputLang}
          onRemoveLang={removeLang}
          onRemoveCode={removeCode}
        />
      </div>
      <div className="db-metacode__section">
        <div className="db-metacode__label">Set codes</div>
        <div className="db-metacode__lang-row">
          <LanguagePicker
            value={inputLang}
            onChange={code => { writeInputLang(code); setInputLang(code); }}
            placeholder="Language…"
            className="db-metacode__lang-input"
          />
          {inputLang && (
            <button className="btn btn--ghost btn--xs" onClick={removeLang} title="Clear language">×</button>
          )}
        </div>
        <div className="db-metacode__actions">
          <button
            className={`code-btn${activeCodes['no-translate'] ? ' code-btn--active' : ''}`}
            onClick={toggleNoTranslate}
            title="Toggle no-translate"
          >
            no-translate
          </button>
          {customOpen ? (
            <div className="custom-code-form">
              <input
                type="text"
                className="code-btn-input code-btn-input--key"
                placeholder="key"
                value={customCodeKey}
                autoFocus
                onChange={e => setCustomCodeKey(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') commitCustom();
                  if (e.key === 'Escape') { setCustomOpen(false); setCustomCodeKey(''); setCustomCodeValue(''); }
                }}
              />
              <span className="custom-code-sep">:</span>
              <input
                type="text"
                className="code-btn-input code-btn-input--val"
                placeholder="value"
                value={customCodeValue}
                onChange={e => setCustomCodeValue(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') commitCustom();
                  if (e.key === 'Escape') { setCustomOpen(false); setCustomCodeKey(''); setCustomCodeValue(''); }
                }}
                onBlur={commitCustom}
              />
            </div>
          ) : (
            <button className="code-btn code-btn--add" onClick={() => setCustomOpen(true)}>
              + custom
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

