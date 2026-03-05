import { useState, useEffect, useRef } from 'react';
import { FloatingPanel } from './FloatingPanel';
import { useSessionContext } from '../contexts/SessionContext';
import { useToastContext } from '../contexts/ToastContext';
import { useLang } from '../contexts/LangContext';
import { COMMON_LANGUAGES } from '../lib/sttConfig';
import { getActiveCodes, setActiveCode, clearActiveCode } from '../lib/activeCodes';

/** Read input-bar lang from localStorage. */
function readInputLang() {
  try { return localStorage.getItem('lcyt:input-bar-lang') || ''; } catch { return ''; }
}

/** Write input-bar lang to localStorage and notify listeners. */
function writeInputLang(code) {
  try {
    if (code) localStorage.setItem('lcyt:input-bar-lang', code);
    else localStorage.removeItem('lcyt:input-bar-lang');
    window.dispatchEvent(new CustomEvent('lcyt:input-lang-changed'));
  } catch {}
}

export function ActionsPanel({ onClose }) {
  const session = useSessionContext();
  const { showToast } = useToastContext();
  const { t } = useLang();

  const [customSequence, setCustomSequence] = useState(0);
  const [hbResult, setHbResult] = useState(null);
  const [syncResult, setSyncResult] = useState(null);

  // Caption code state
  const [inputLang, setInputLang] = useState(readInputLang);
  const [activeCodes, setActiveCodesState] = useState(getActiveCodes);
  const [langPickerOpen, setLangPickerOpen] = useState(false);
  const [langQuery, setLangQuery] = useState('');
  const [sectionInputOpen, setSectionInputOpen] = useState(false);
  const [speakerInputOpen, setSpeakerInputOpen] = useState(false);
  const [sectionValue, setSectionValue] = useState(() => getActiveCodes().section || '');
  const [speakerValue, setSpeakerValue] = useState(() => getActiveCodes().speaker || '');
  const langPickerRef = useRef(null);

  // Keep local state in sync with localStorage changes from other components
  useEffect(() => {
    function onLangChange() { setInputLang(readInputLang()); }
    function onCodesChange() {
      const codes = getActiveCodes();
      setActiveCodesState(codes);
      setSectionValue(codes.section || '');
      setSpeakerValue(codes.speaker || '');
    }
    window.addEventListener('lcyt:input-lang-changed', onLangChange);
    window.addEventListener('lcyt:active-codes-changed', onCodesChange);
    return () => {
      window.removeEventListener('lcyt:input-lang-changed', onLangChange);
      window.removeEventListener('lcyt:active-codes-changed', onCodesChange);
    };
  }, []);

  async function handleSync() {
    if (!session.connected) { showToast(t('settings.actions.notConnected'), 'warning'); return; }
    try {
      const data = await session.sync();
      setSyncResult(`${data.syncOffset}ms`);
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function handleHeartbeat() {
    if (!session.connected) { showToast(t('settings.actions.notConnected'), 'warning'); return; }
    try {
      const data = await session.heartbeat();
      setHbResult(`${data.roundTripTime}ms`);
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function handleResetSequence() {
    if (!session.connected) { showToast(t('settings.actions.notConnected'), 'warning'); return; }
    try {
      await session.updateSequence(0);
      showToast(t('settings.actions.sequenceReset'), 'success');
    } catch (err) {
      showToast(err.message || t('settings.actions.sequenceSetError'), 'error');
    }
  }

  async function handleSetSequence() {
    if (!session.connected) { showToast(t('settings.actions.notConnected'), 'warning'); return; }
    try {
      await session.updateSequence(customSequence);
      showToast(`${t('settings.actions.setSequence')}: ${customSequence}`, 'success');
    } catch (err) {
      showToast(err.message || t('settings.actions.sequenceSetError'), 'error');
    }
  }

  function handleClearConfig() {
    session.clearPersistedConfig();
    showToast(t('settings.connection.configCleared'), 'info');
  }

  // ─── Caption code handlers ────────────────────────────

  function handleLangBtn() {
    if (inputLang) {
      // Deactivate: clear the language
      writeInputLang('');
      setInputLang('');
      setLangPickerOpen(false);
    } else {
      setLangPickerOpen(v => !v);
      setLangQuery('');
    }
  }

  function selectLang(code) {
    writeInputLang(code);
    setInputLang(code);
    setLangPickerOpen(false);
    setLangQuery('');
  }

  function toggleSection() {
    if (activeCodes.section) {
      clearActiveCode('section');
      setSectionInputOpen(false);
    } else {
      setSectionInputOpen(v => !v);
    }
  }

  function commitSection() {
    if (sectionValue.trim()) {
      setActiveCode('section', sectionValue.trim());
    } else {
      clearActiveCode('section');
    }
    setSectionInputOpen(false);
  }

  function toggleSpeaker() {
    if (activeCodes.speaker) {
      clearActiveCode('speaker');
      setSpeakerInputOpen(false);
    } else {
      setSpeakerInputOpen(v => !v);
    }
  }

  function commitSpeaker() {
    if (speakerValue.trim()) {
      setActiveCode('speaker', speakerValue.trim());
    } else {
      clearActiveCode('speaker');
    }
    setSpeakerInputOpen(false);
  }

  function toggleLyrics() {
    setActiveCode('lyrics', activeCodes.lyrics ? null : true);
  }

  function toggleNoTranslate() {
    setActiveCode('no-translate', activeCodes['no-translate'] ? null : true);
  }

  const langMatches = langQuery.trim().length > 0
    ? COMMON_LANGUAGES.filter(l =>
        l.label.toLowerCase().includes(langQuery.toLowerCase()) ||
        l.code.toLowerCase().includes(langQuery.toLowerCase())
      )
    : COMMON_LANGUAGES.slice(0, 12);

  const langLabel = inputLang
    ? (COMMON_LANGUAGES.find(l => l.code === inputLang)?.code ?? inputLang)
    : t('settings.actions.codeLang');

  return (
    <FloatingPanel title={t('statusBar.actions')} onClose={onClose}>
      <div className="settings-modal__actions">
        <button className="btn btn--secondary btn--sm" onClick={handleSync}>{t('settings.actions.syncNow')}</button>
        <button className="btn btn--secondary btn--sm" onClick={handleHeartbeat}>{t('settings.actions.heartbeat')}</button>
        <button className="btn btn--secondary btn--sm" onClick={handleResetSequence}>{t('settings.actions.resetSequence')}</button>
      </div>
      {hbResult && (
        <div className="settings-status-row">
          <span className="settings-status-row__label">{t('settings.actions.roundTrip')}</span>
          <span className="settings-status-row__value">{hbResult}</span>
        </div>
      )}
      {syncResult && (
        <div className="settings-status-row">
          <span className="settings-status-row__label">{t('settings.actions.syncOffset')}</span>
          <span className="settings-status-row__value">{syncResult}</span>
        </div>
      )}
      <div className="settings-field">
        <label className="settings-field__label">{t('settings.actions.setSequence')}</label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="number"
            className="settings-field__input"
            style={{ width: 90 }}
            min="0"
            value={customSequence}
            onChange={e => setCustomSequence(Math.max(0, parseInt(e.target.value, 10) || 0))}
          />
          <button className="btn btn--secondary btn--sm" onClick={handleSetSequence}>{t('settings.actions.setSequenceBtn')}</button>
        </div>
      </div>
      <hr style={{ borderColor: 'var(--color-border)', margin: '8px 0' }} />

      {/* ─── Caption Codes ──────────────────────────────── */}
      <div className="settings-field">
        <label className="settings-field__label">{t('settings.actions.captionCodes')}</label>
        <div className="caption-codes-row">

          {/* lang */}
          <div className="caption-codes-item" ref={langPickerRef}>
            <button
              className={`code-btn${inputLang ? ' code-btn--active' : ''}`}
              title={inputLang ? `lang: ${inputLang} — ${t('settings.actions.codeActiveHint')}` : t('settings.actions.codeLangHint')}
              onClick={handleLangBtn}
            >
              {inputLang ? langLabel : `${langLabel} ▾`}
            </button>
            {langPickerOpen && (
              <div className="code-btn-dropdown">
                <input
                  type="text"
                  placeholder={t('settings.actions.codeFilterPlaceholder')}
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

          {/* section */}
          <div className="caption-codes-item">
            <button
              className={`code-btn${activeCodes.section ? ' code-btn--active' : ''}`}
              title={activeCodes.section ? `section: ${activeCodes.section} — ${t('settings.actions.codeActiveHint')}` : t('settings.actions.codeSectionHint')}
              onClick={toggleSection}
            >
              {activeCodes.section ? `§ ${activeCodes.section}` : t('settings.actions.codeSection')}
            </button>
            {sectionInputOpen && !activeCodes.section && (
              <input
                type="text"
                className="code-btn-input"
                autoFocus
                value={sectionValue}
                placeholder={t('settings.actions.codeSectionPlaceholder')}
                onChange={e => setSectionValue(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') commitSection(); if (e.key === 'Escape') setSectionInputOpen(false); }}
                onBlur={commitSection}
              />
            )}
          </div>

          {/* speaker */}
          <div className="caption-codes-item">
            <button
              className={`code-btn${activeCodes.speaker ? ' code-btn--active' : ''}`}
              title={activeCodes.speaker ? `speaker: ${activeCodes.speaker} — ${t('settings.actions.codeActiveHint')}` : t('settings.actions.codeSpeakerHint')}
              onClick={toggleSpeaker}
            >
              {activeCodes.speaker ? `🎤 ${activeCodes.speaker}` : t('settings.actions.codeSpeaker')}
            </button>
            {speakerInputOpen && !activeCodes.speaker && (
              <input
                type="text"
                className="code-btn-input"
                autoFocus
                value={speakerValue}
                placeholder={t('settings.actions.codeSpeakerPlaceholder')}
                onChange={e => setSpeakerValue(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') commitSpeaker(); if (e.key === 'Escape') setSpeakerInputOpen(false); }}
                onBlur={commitSpeaker}
              />
            )}
          </div>

          {/* lyrics */}
          <button
            className={`code-btn${activeCodes.lyrics ? ' code-btn--active' : ''}`}
            title={t('settings.actions.codeLyricsHint')}
            onClick={toggleLyrics}
          >
            {t('settings.actions.codeLyrics')}
          </button>

          {/* no-translate */}
          <button
            className={`code-btn${activeCodes['no-translate'] ? ' code-btn--active' : ''}`}
            title={t('settings.actions.codeNoTranslateHint')}
            onClick={toggleNoTranslate}
          >
            {t('settings.actions.codeNoTranslate')}
          </button>
        </div>
        <span className="settings-field__hint">{t('settings.actions.captionCodesHint')}</span>
      </div>

      <hr style={{ borderColor: 'var(--color-border)', margin: '8px 0' }} />
      <button className="btn btn--danger btn--sm" onClick={handleClearConfig}>{t('settings.actions.clearConfig')}</button>
    </FloatingPanel>
  );
}
