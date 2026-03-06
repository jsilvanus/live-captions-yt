import { useState, useEffect, useRef } from 'react';
import { FloatingPanel } from './FloatingPanel';
import { StatsModal } from './StatsModal';
import { FilesModal } from './FilesModal';
import { useSessionContext } from '../contexts/SessionContext';
import { useFileContext } from '../contexts/FileContext';
import { useSentLogContext } from '../contexts/SentLogContext';
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

export function ControlsPanel({ onClose }) {
  const session = useSessionContext();
  const fileStore = useFileContext();
  const sentLog = useSentLogContext();
  const { showToast } = useToastContext();
  const { t } = useLang();

  // ── Status section state ──────────────────────────────────
  const [lastConnectedTime, setLastConnectedTime] = useState(null);
  const [statsOpen, setStatsOpen] = useState(false);
  const [statsData, setStatsData] = useState(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const [statusExpanded, setStatusExpanded] = useState(false);

  // ── Actions section state ─────────────────────────────────
  const [customSequence, setCustomSequence] = useState(0);
  const [hbResult, setHbResult] = useState(null);
  const [syncResult, setSyncResult] = useState(null);

  // Caption code state
  const [inputLang, setInputLang] = useState(readInputLang);
  const [activeCodes, setActiveCodesState] = useState(getActiveCodes);
  const [langPickerOpen, setLangPickerOpen] = useState(false);
  const [langQuery, setLangQuery] = useState('');
  const langPickerRef = useRef(null);

  // Custom code state
  const [customCodeOpen, setCustomCodeOpen] = useState(false);
  const [customCodeKey, setCustomCodeKey] = useState('');
  const [customCodeValue, setCustomCodeValue] = useState('');

  // Raw edit button: track hold timer
  const rawEditHoldTimerRef = useRef(null);
  const rawEditHoldFiredRef = useRef(false);

  useEffect(() => {
    if (session.connected) setLastConnectedTime(Date.now());
  }, [session.connected]);

  // Keep local state in sync with localStorage changes from other components
  useEffect(() => {
    function onLangChange() { setInputLang(readInputLang()); }
    function onCodesChange() { setActiveCodesState(getActiveCodes()); }
    window.addEventListener('lcyt:input-lang-changed', onLangChange);
    window.addEventListener('lcyt:active-codes-changed', onCodesChange);
    return () => {
      window.removeEventListener('lcyt:input-lang-changed', onLangChange);
      window.removeEventListener('lcyt:active-codes-changed', onCodesChange);
    };
  }, []);

  // ── Status section handlers ───────────────────────────────

  async function handleGetStats() {
    if (!session.connected) { showToast(t('settings.actions.notConnected'), 'warning'); return; }
    setStatsLoading(true);
    try {
      const data = await session.getStats();
      setStatsData(data);
      setStatsOpen(true);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setStatsLoading(false);
    }
  }

  // ── Actions section handlers ──────────────────────────────

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

  // ── Caption code handlers ─────────────────────────────────

  function handleLangBtn() {
    if (inputLang) {
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

  function toggleNoTranslate() {
    setActiveCode('no-translate', activeCodes['no-translate'] ? null : true);
  }

  // ── Custom code handlers ──────────────────────────────────

  const PREDEFINED_CODE_KEYS = ['no-translate'];

  function commitCustomCode() {
    const key = customCodeKey.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
    const value = customCodeValue.trim();
    if (key && value) {
      setActiveCode(key, value);
    }
    setCustomCodeKey('');
    setCustomCodeValue('');
    setCustomCodeOpen(false);
  }

  function removeCustomCode(key) {
    clearActiveCode(key);
  }

  // ── Raw Edit handlers ─────────────────────────────────────

  function newFileName() {
    return `new-file-${new Date().toISOString().slice(0, 10)}.txt`;
  }

  function createAndEdit() {
    const name = newFileName();
    fileStore.createEmptyFile(name);
    showToast(`Created ${name} — editing`, 'info');
  }

  function handleRawEditPointerDown(e) {
    rawEditHoldFiredRef.current = false;
    rawEditHoldTimerRef.current = setTimeout(() => {
      rawEditHoldFiredRef.current = true;
      createAndEdit();
    }, 2000);
  }

  function handleRawEditPointerUp() {
    if (rawEditHoldTimerRef.current) {
      clearTimeout(rawEditHoldTimerRef.current);
      rawEditHoldTimerRef.current = null;
    }
  }

  function handleRawEditClick() {
    if (rawEditHoldFiredRef.current) return;

    if (fileStore.rawEditMode) {
      if (fileStore.activeFile) {
        fileStore.updateFileFromRawText(fileStore.activeFile.id, fileStore.rawEditValue);
      }
      fileStore.setRawEditMode(false);
    } else {
      if (!fileStore.activeFile) {
        createAndEdit();
      } else {
        fileStore.setRawEditMode(true);
      }
    }
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
    <>
      <FloatingPanel title={t('statusBar.controls')} onClose={onClose}>

        {/* ── Status section ── */}
        <div className="settings-status-row">
          <span className="settings-status-row__label">{t('settings.status.connection')}</span>
          <span
            className="settings-status-row__value"
            style={{ color: session.connected ? 'var(--color-success)' : 'var(--color-text-dim)' }}
          >
            {session.connected ? t('settings.status.connected') : t('settings.status.disconnected')}
          </span>
          <button
            className="btn btn--secondary btn--sm"
            style={{ marginLeft: 'auto', padding: '2px 6px', fontSize: '11px' }}
            onClick={() => setStatusExpanded(v => !v)}
            title={statusExpanded ? t('statusBar.collapseStatus') : t('statusBar.expandStatus')}
          >
            {statusExpanded ? '▲' : '▼'}
          </button>
        </div>
        {statusExpanded && (
          <>
        <div className="settings-status-row">
          <span className="settings-status-row__label">{t('settings.status.backendUrl')}</span>
          <span className="settings-status-row__value">{session.backendUrl || '—'}</span>
        </div>
        <div className="settings-status-row">
          <span className="settings-status-row__label">{t('settings.status.sequence')}</span>
          <span className="settings-status-row__value">{session.connected ? session.sequence : '—'}</span>
        </div>
        <div className="settings-status-row">
          <span className="settings-status-row__label">{t('settings.status.syncOffset')}</span>
          <span className="settings-status-row__value">{session.connected ? `${session.syncOffset}ms` : '—'}</span>
        </div>
        <div className="settings-status-row">
          <span className="settings-status-row__label">{t('settings.status.lastConnected')}</span>
          <span className="settings-status-row__value">
            {lastConnectedTime ? new Date(lastConnectedTime).toLocaleTimeString() : '—'}
          </span>
        </div>
          </>
        )}
        <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
          <button
            className="btn btn--secondary btn--sm"
            onClick={handleGetStats}
            disabled={statsLoading || !session.connected}
          >
            {statsLoading ? '…' : t('settings.status.statsButton')}
          </button>
          <button
            className="btn btn--secondary btn--sm"
            onClick={() => setFilesOpen(true)}
            disabled={!session.connected}
          >
            {t('settings.status.filesButton')}
          </button>
        </div>

        <hr style={{ borderColor: 'var(--color-border)', margin: '12px 0' }} />

        {/* ── Actions section ── */}
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

        {/* ── Caption Codes ── */}
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

            {/* no-translate */}
            <button
              className={`code-btn${activeCodes['no-translate'] ? ' code-btn--active' : ''}`}
              title={t('settings.actions.codeNoTranslateHint')}
              onClick={toggleNoTranslate}
            >
              {t('settings.actions.codeNoTranslate')}
            </button>

            {/* Custom codes */}
            {Object.entries(activeCodes)
              .filter(([k]) => !PREDEFINED_CODE_KEYS.includes(k))
              .map(([k, v]) => (
                <button
                  key={k}
                  className="code-btn code-btn--active code-btn--custom"
                  title={`${k}: ${v} — ${t('settings.actions.codeActiveHint')}`}
                  onClick={() => removeCustomCode(k)}
                >
                  {k}: {v}
                </button>
              ))
            }

            {/* Add custom code */}
            <div className="caption-codes-item">
              {!customCodeOpen ? (
                <button
                  className="code-btn code-btn--add"
                  title={t('settings.actions.codeCustomHint')}
                  onClick={() => setCustomCodeOpen(true)}
                >+ {t('settings.actions.codeCustom')}</button>
              ) : (
                <div className="custom-code-form">
                  <input
                    type="text"
                    className="code-btn-input code-btn-input--key"
                    placeholder={t('settings.actions.codeCustomKeyPlaceholder')}
                    value={customCodeKey}
                    autoFocus
                    onChange={e => setCustomCodeKey(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') commitCustomCode(); if (e.key === 'Escape') { setCustomCodeOpen(false); setCustomCodeKey(''); setCustomCodeValue(''); } }}
                  />
                  <span className="custom-code-sep">:</span>
                  <input
                    type="text"
                    className="code-btn-input code-btn-input--val"
                    placeholder={t('settings.actions.codeCustomValuePlaceholder')}
                    value={customCodeValue}
                    onChange={e => setCustomCodeValue(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') commitCustomCode(); if (e.key === 'Escape') { setCustomCodeOpen(false); setCustomCodeKey(''); setCustomCodeValue(''); } }}
                    onBlur={commitCustomCode}
                  />
                </div>
              )}
            </div>
          </div>
          <span className="settings-field__hint">{t('settings.actions.captionCodesHint')}</span>
        </div>

        <hr style={{ borderColor: 'var(--color-border)', margin: '8px 0' }} />

        {/* ── File actions ── */}
        <div className="settings-field">
          <label className="settings-field__label">{t('settings.actions.fileActions')}</label>
          <div className="settings-modal__actions">
            <button
              className={`btn btn--sm${fileStore.rawEditMode ? ' btn--primary' : ' btn--secondary'}`}
              title={fileStore.rawEditMode ? t('settings.actions.rawEditClose') : t('settings.actions.rawEditHint')}
              onClick={handleRawEditClick}
              onPointerDown={handleRawEditPointerDown}
              onPointerUp={handleRawEditPointerUp}
              onPointerLeave={handleRawEditPointerUp}
              onPointerCancel={handleRawEditPointerUp}
            >
              {fileStore.rawEditMode ? `✔ ${t('settings.actions.rawEditClose')}` : `✏ ${t('settings.actions.rawEdit')}`}
            </button>
            <button
              className="btn btn--secondary btn--sm"
              title={t('settings.actions.clearSentLogHint')}
              onClick={() => {
                if (sentLog.entries.length === 0 || confirm(t('settings.actions.clearSentLogConfirm'))) {
                  sentLog.clear();
                }
              }}
            >
              {t('settings.actions.clearSentLog')}
            </button>
          </div>
          <span className="settings-field__hint">{t('settings.actions.rawEditHoldHint')}</span>
        </div>

        <hr style={{ borderColor: 'var(--color-border)', margin: '8px 0' }} />
        <button className="btn btn--danger btn--sm" onClick={handleClearConfig}>{t('settings.actions.clearConfig')}</button>
      </FloatingPanel>
      <StatsModal isOpen={statsOpen} onClose={() => setStatsOpen(false)} stats={statsData} />
      <FilesModal isOpen={filesOpen} onClose={() => setFilesOpen(false)} />
    </>
  );
}
