import { useState, useEffect, useRef } from 'react';
import { useSessionContext } from '../../contexts/SessionContext';
import { useToastContext } from '../../contexts/ToastContext';
import { useLang } from '../../contexts/LangContext';
import { COMMON_LANGUAGES } from '../../lib/sttConfig';
import { getActiveCodes, setActiveCode, clearActiveCode } from '../../lib/activeCodes';
import { readInputLang, writeInputLang, INPUT_LANG_EVENT } from '../../lib/inputLang';
import { ControlsPanel } from '../ControlsPanel';

export function QuickActionsPopover() {
  const session = useSessionContext();
  const { showToast } = useToastContext();
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [customSequence, setCustomSequence] = useState(0);
  const [hbResult, setHbResult] = useState(null);
  const [syncResult, setSyncResult] = useState(null);
  const [inputLang, setInputLang] = useState(readInputLang);
  const [activeCodes, setActiveCodesState] = useState(getActiveCodes);
  const [langPickerOpen, setLangPickerOpen] = useState(false);
  const [langQuery, setLangQuery] = useState('');
  const popoverRef = useRef(null);

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

  useEffect(() => {
    if (!open) return;
    function onDown(e) {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) {
        setOpen(false);
        setLangPickerOpen(false);
      }
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  async function handleSync() {
    if (!session.connected) { showToast('Not connected', 'warning'); return; }
    try {
      const data = await session.sync();
      setSyncResult(`+${data.syncOffset}ms`);
    } catch (err) { showToast(err.message, 'error'); }
  }

  async function handleHeartbeat() {
    if (!session.connected) { showToast('Not connected', 'warning'); return; }
    try {
      const data = await session.heartbeat();
      setHbResult(`${data.roundTripTime}ms`);
    } catch (err) { showToast(err.message, 'error'); }
  }

  async function handleResetSequence() {
    if (!session.connected) { showToast('Not connected', 'warning'); return; }
    try { await session.updateSequence(0); showToast('Sequence reset to 0', 'success'); } catch (err) { showToast(err.message, 'error'); }
  }

  async function handleSetSequence() {
    if (!session.connected) { showToast('Not connected', 'warning'); return; }
    try { await session.updateSequence(customSequence); showToast(`Sequence set to ${customSequence}`, 'success'); } catch (err) { showToast(err.message, 'error'); }
  }

  function selectLang(code) {
    writeInputLang(code);
    setInputLang(code);
    setLangPickerOpen(false);
    setLangQuery('');
    window.dispatchEvent(new Event(INPUT_LANG_EVENT));
  }

  function handleLangBtn() {
    if (inputLang) { writeInputLang(''); setInputLang(''); window.dispatchEvent(new Event(INPUT_LANG_EVENT)); }
    else setLangPickerOpen(v => !v);
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
  const hasActiveCodes = inputLang || activeCodes['no-translate'] || customCodeKeys.length > 0;

  return (
    <div className="quick-actions" ref={popoverRef}>
      <button
        className={['quick-actions__btn', open ? 'quick-actions__btn--open' : '', hasActiveCodes ? 'quick-actions__btn--codes' : ''].filter(Boolean).join(' ')}
        onClick={() => setOpen(v => !v)}
        title="Quick Actions"
        aria-expanded={open}
        aria-haspopup="true"
      >
        ⚡{hasActiveCodes ? <span className="quick-actions__code-dot" /> : null}
      </button>

      {controlsOpen && <ControlsPanel onClose={() => setControlsOpen(false)} />}

      {open && (
        <div className="quick-actions__panel" role="menu">
          <div className="quick-actions__row">
            <button className="btn btn--secondary btn--sm" onClick={() => { setOpen(false); setControlsOpen(true); }}>
              ⚙ Controls
            </button>
          </div>
          <div className="quick-actions__section-label">Session</div>
          <div className="quick-actions__row">
            <button className="btn btn--secondary btn--sm" onClick={handleSync} disabled={!session.connected}>
              🔄 Sync{syncResult && <span className="quick-actions__result">{syncResult}</span>}
            </button>
            <button className="btn btn--secondary btn--sm" onClick={handleHeartbeat} disabled={!session.connected}>
              💓 Heartbeat{hbResult && <span className="quick-actions__result">{hbResult}</span>}
            </button>
            <button className="btn btn--secondary btn--sm" onClick={handleResetSequence} disabled={!session.connected}>
              ↺ Reset seq
            </button>
          </div>
          <div className="quick-actions__row quick-actions__row--seq">
            <input
              type="number"
              className="settings-field__input quick-actions__seq-input"
              min="0"
              value={customSequence}
              onChange={e => setCustomSequence(Math.max(0, parseInt(e.target.value, 10) || 0))}
              aria-label="Set sequence number"
            />
            <button className="btn btn--secondary btn--sm" onClick={handleSetSequence} disabled={!session.connected}>
              Set seq
            </button>
          </div>

          <div className="quick-actions__section-label quick-actions__section-label--mt">Caption codes</div>
          <div className="quick-actions__codes">
            <div className="quick-actions__code-wrap">
              <button
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
                    <button key={l.code} className="audio-lang-option" onClick={() => selectLang(l.code)}>
                      {l.label} <span className="audio-lang-code">{l.code}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              className={`code-btn${activeCodes['no-translate'] ? ' code-btn--active' : ''}`}
              title="Toggle no-translate"
              onClick={toggleNoTranslate}
            >
              no-translate
            </button>
            {customCodeKeys.map(([k, v]) => (
              <button
                key={k}
                className="code-btn code-btn--active code-btn--custom"
                title={`${k}: ${v} — click to remove`}
                onClick={() => clearActiveCode(k)}
              >
                {k}: {v}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
