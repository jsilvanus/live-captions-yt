import { useState, useEffect, useRef } from 'react';
import { useSessionContext } from '../contexts/SessionContext';
import { useLang } from '../contexts/LangContext';
import {
  getRelayMode, setRelayMode,
  getSlotConfig, setSlotTargetType,
  setSlotYoutubeKey, setSlotGenericUrl, setSlotGenericName, setSlotCaptionMode,
  buildSlotTarget,
  clearSlot,
} from '../lib/relayConfig.js';
import {
  getGoogleCredential, setGoogleCredential, clearGoogleCredential,
} from '../lib/googleCredential.js';
import { useToastContext } from '../contexts/ToastContext';

const CONFIG_KEY = 'lcyt-config';
const MAX_RELAY_SLOTS = 4;

function applyTheme(value) {
  const html = document.documentElement;
  if (value === 'dark') {
    html.setAttribute('data-theme', 'dark');
  } else if (value === 'light') {
    html.setAttribute('data-theme', 'light');
  } else {
    html.removeAttribute('data-theme');
  }
  try { localStorage.setItem('lcyt-theme', value); } catch {}
}

function applyTextSize(px) {
  document.documentElement.style.setProperty('--caption-text-size', px + 'px');
  try { localStorage.setItem('lcyt:textSize', String(px)); } catch {}
}

function getAdvancedMode() {
  try { return localStorage.getItem('lcyt:advanced-mode') === '1'; } catch { return false; }
}

function setAdvancedMode(val) {
  try { localStorage.setItem('lcyt:advanced-mode', val ? '1' : '0'); } catch {}
}

function persist(patch) {
  try {
    const saved = JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}');
    localStorage.setItem(CONFIG_KEY, JSON.stringify({ ...saved, ...patch }));
  } catch {}
}

function buildInitialRelayList() {
  const list = [];
  for (let s = 1; s <= MAX_RELAY_SLOTS; s++) {
    const cfg = getSlotConfig(s);
    const hasConfig = cfg.targetType === 'youtube'
      ? !!(cfg.youtubeKey ?? '').trim()
      : !!(cfg.genericUrl ?? '').trim();
    if (hasConfig) list.push({ ...cfg });
  }
  return list;
}

// ── Relay row component ────────────────────────────────────────
function RelayRow({ entry, onChange, onRemove, t }) {
  return (
    <div style={{ border: '1px solid var(--color-border)', borderRadius: 4, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <select
          className="settings-field__input"
          value={entry.targetType}
          onChange={e => onChange({ ...entry, targetType: e.target.value })}
          style={{ width: 'auto' }}
        >
          <option value="youtube">YouTube</option>
          <option value="generic">{t('settings.relay.generic')}</option>
        </select>
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          onClick={onRemove}
          title={t('settings.relay.removeRelay')}
          style={{ flexShrink: 0, marginLeft: 'auto' }}
        >✕</button>
      </div>

      {entry.targetType === 'youtube' && (
        <div>
          <label className="settings-field__label">{t('settings.relay.youtubeStreamKey')}</label>
          <input
            className="settings-field__input"
            type="password"
            placeholder="xxxx-xxxx-xxxx-xxxx-xxxx"
            autoComplete="off"
            value={entry.youtubeKey || ''}
            onChange={e => onChange({ ...entry, youtubeKey: e.target.value })}
          />
          {(entry.youtubeKey || '').trim() && (
            <span className="settings-field__hint">
              → rtmp://a.rtmp.youtube.com/live2/{(entry.youtubeKey || '').trim()}
            </span>
          )}
        </div>
      )}

      {entry.targetType === 'generic' && (
        <>
          <div>
            <label className="settings-field__label">{t('settings.relay.rtmpUrl')}</label>
            <input
              className="settings-field__input"
              type="text"
              placeholder="rtmp://your-server.example.com/live"
              autoComplete="off"
              value={entry.genericUrl || ''}
              onChange={e => onChange({ ...entry, genericUrl: e.target.value })}
            />
          </div>
          <div>
            <label className="settings-field__label">{t('settings.relay.rtmpStreamName')}</label>
            <input
              className="settings-field__input"
              type="text"
              placeholder={t('settings.relay.rtmpStreamNamePlaceholder')}
              autoComplete="off"
              value={entry.genericName || ''}
              onChange={e => onChange({ ...entry, genericName: e.target.value })}
            />
            {(entry.genericUrl || '').trim() && (
              <span className="settings-field__hint">
                → {(entry.genericUrl || '').trim()}{(entry.genericName || '').trim() ? `/${(entry.genericName || '').trim()}` : ''}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export function SettingsModal({ isOpen, onClose }) {
  const session = useSessionContext();
  const { showToast } = useToastContext();
  const { lang, setLang, t, LOCALE_CODES } = useLang();

  const [activeTab, setActiveTab] = useState('basic');
  const [advancedMode, setAdvancedModeState] = useState(getAdvancedMode);

  // ── Basic tab fields ──────────────────────────────────────
  const [backendUrl, setBackendUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [streamKey, setStreamKey] = useState('');
  const [autoConnect, setAutoConnect] = useState(false);
  const [theme, setTheme] = useState('auto');
  const [textSize, setTextSize] = useState(
    () => { try { return parseInt(localStorage.getItem('lcyt:textSize') || '13', 10); } catch { return 13; } }
  );
  const [showApiKey, setShowApiKey] = useState(false);
  const [showStreamKey, setShowStreamKey] = useState(false);

  // ── RTMP Relay tab ────────────────────────────────────────
  const [relayMode, setRelayModeState] = useState('caption');
  const [relayList, setRelayList] = useState(() => buildInitialRelayList());
  const [relayActive, setRelayActiveState] = useState(false);
  const [relayStatus, setRelayStatus] = useState(null);
  const [relayLoading, setRelayLoading] = useState(false);
  const [relayError, setRelayError] = useState('');

  // ── Credentials tab ───────────────────────────────────────
  const [credential, setCredentialState] = useState(getGoogleCredential);
  const credInputRef = useRef(null);

  // Load persisted values when modal opens
  useEffect(() => {
    if (!isOpen) return;
    const cfg = session.getPersistedConfig();
    setBackendUrl(cfg.backendUrl || '');
    setApiKey(cfg.apiKey || '');
    setStreamKey(cfg.streamKey || '');
    setAutoConnect(session.getAutoConnect());
    try { setTheme(localStorage.getItem('lcyt-theme') || 'auto'); } catch {}
    const savedSize = parseInt(localStorage.getItem('lcyt:textSize') || '13', 10);
    setTextSize(savedSize);
    applyTextSize(savedSize);
    setAdvancedModeState(getAdvancedMode());
    // Load relay settings
    const rc = getRelayMode();
    setRelayModeState(rc);
    setRelayList(buildInitialRelayList());
    setRelayError('');
    if (session.connected) {
      session.getRelayStatus().then(status => {
        setRelayStatus(status);
        setRelayActiveState(status?.active ?? false);
      }).catch(() => {
        setRelayStatus(null);
        setRelayActiveState(false);
      });
    } else {
      setRelayStatus(null);
      setRelayActiveState(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    function onKeyDown(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  // Keep credential state in sync with external changes (e.g. from CCModal)
  useEffect(() => {
    function onCredChanged() { setCredentialState(getGoogleCredential()); }
    window.addEventListener('lcyt:stt-credential-changed', onCredChanged);
    return () => window.removeEventListener('lcyt:stt-credential-changed', onCredChanged);
  }, []);

  if (!isOpen) return null;

  // ── Field change handlers (auto-save) ─────────────────────

  function handleBackendUrlChange(val) {
    setBackendUrl(val);
    persist({ backendUrl: val });
  }

  function handleApiKeyChange(val) {
    setApiKey(val);
    persist({ apiKey: val });
  }

  function handleStreamKeyChange(val) {
    setStreamKey(val);
    persist({ streamKey: val });
  }

  function handleAutoConnectChange(val) {
    setAutoConnect(val);
    session.setAutoConnect(val);
  }

  function handleThemeChange(value) {
    setTheme(value);
    applyTheme(value);
  }

  function handleTextSizeChange(value) {
    const v = parseInt(value, 10);
    setTextSize(v);
    applyTextSize(v);
  }

  function handleAdvancedModeChange(val) {
    setAdvancedModeState(val);
    setAdvancedMode(val);
  }

  // ── Relay helpers ──────────────────────────────────────────

  function onRelayModeChange(mode) {
    setRelayModeState(mode);
    setRelayMode(mode);
  }

  function addRelay() {
    const usedSlots = relayList.map(r => r.slot);
    for (let s = 1; s <= MAX_RELAY_SLOTS; s++) {
      if (!usedSlots.includes(s)) {
        setRelayList(prev => [...prev, { slot: s, targetType: 'youtube', youtubeKey: '', genericUrl: '', genericName: '', captionMode: 'http' }]);
        return;
      }
    }
  }

  function updateRelayItem(slot, updated) {
    if ('targetType' in updated) setSlotTargetType(slot, updated.targetType);
    if ('youtubeKey' in updated) setSlotYoutubeKey(slot, updated.youtubeKey);
    if ('genericUrl' in updated) setSlotGenericUrl(slot, updated.genericUrl);
    if ('genericName' in updated) setSlotGenericName(slot, updated.genericName);
    if ('captionMode' in updated) setSlotCaptionMode(slot, updated.captionMode);
    setRelayList(prev => prev.map(r => r.slot === slot ? { ...r, ...updated } : r));
  }

  function removeRelay(slot) {
    clearSlot(slot);
    setRelayList(prev => prev.filter(r => r.slot !== slot));
  }

  async function handleToggleRelayActive(newActive) {
    setRelayActiveState(newActive);
    setRelayError('');
    try {
      if (newActive) {
        // Configure all relays in the list before activating
        for (const relay of relayList) {
          const { targetUrl, targetName } = buildSlotTarget(relay.slot);
          if (targetUrl) {
            await session.configureRelay({ slot: relay.slot, targetUrl, targetName, captionMode: relay.captionMode || 'http' });
          }
        }
      }
      await session.setRelayActive(newActive);
      const status = await session.getRelayStatus();
      setRelayStatus(status);
      setRelayActiveState(status?.active ?? newActive);
      showToast(newActive ? t('settings.relay.activated') : t('settings.relay.deactivated'), 'info');
    } catch (err) {
      setRelayActiveState(!newActive);
      setRelayError(err.message);
    }
  }

  const runningSlots = relayStatus?.runningSlots ?? [];

  const TABS = advancedMode ? ['basic', 'rtmpRelay', 'credentials'] : ['basic', 'credentials'];

  // ── Credential handlers ────────────────────────────────────

  async function handleCredentialFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      if (
        typeof json.client_email !== 'string' || !json.client_email.includes('@') ||
        typeof json.private_key !== 'string' || !json.private_key.startsWith('-----BEGIN')
      ) {
        throw new Error('Not a valid service account JSON key.');
      }
      setGoogleCredential(json);
      setCredentialState(json);
      const displayEmail = String(json.client_email).slice(0, 60);
      showToast(`Credential loaded: ${displayEmail}`, 'success');
    } catch (err) {
      showToast(`Failed to load credential: ${err.message}`, 'error');
    }
    if (credInputRef.current) credInputRef.current.value = '';
  }

  function handleClearCredential() {
    clearGoogleCredential();
    setCredentialState(null);
  }

  return (
    <div className="settings-modal" role="dialog" aria-modal="true">
      <div className="settings-modal__backdrop" onClick={onClose} />
      <div className="settings-modal__box">
        <div className="settings-modal__header">
          <span className="settings-modal__title">{t('statusBar.settings')}</span>
          <button className="settings-modal__close" onClick={onClose} title="Close (Esc)">✕</button>
        </div>

        {TABS.length > 1 && (
          <div className="settings-modal__tabs">
            {TABS.map(tab => (
              <button
                key={tab}
                className={`settings-tab${activeTab === tab ? ' settings-tab--active' : ''}`}
                onClick={() => setActiveTab(tab)}
              >
                {t(`settings.tabs.${tab}`)}
              </button>
            ))}
          </div>
        )}

        <div className="settings-modal__body">

          {/* ── Basic ── */}
          {activeTab === 'basic' && (
            <div className="settings-panel settings-panel--active">

              <div className="settings-field">
                <label className="settings-field__label">{t('settings.connection.backendUrl')}</label>
                <input
                  className="settings-field__input"
                  type="url"
                  placeholder="https://api.lcyt.fi"
                  autoComplete="off"
                  value={backendUrl}
                  onChange={e => handleBackendUrlChange(e.target.value)}
                />
              </div>

              <div className="settings-field">
                <label className="settings-field__label">{t('settings.connection.apiKey')}</label>
                <div className="settings-field__input-wrap">
                  <input
                    className="settings-field__input settings-field__input--has-eye"
                    type={showApiKey ? 'text' : 'password'}
                    placeholder="••••••••"
                    autoComplete="off"
                    value={apiKey}
                    onChange={e => handleApiKeyChange(e.target.value)}
                  />
                  <button className="settings-field__eye" onClick={() => setShowApiKey(v => !v)} title="Toggle visibility">👁</button>
                </div>
              </div>

              <div className="settings-field">
                <label className="settings-field__label">{t('settings.connection.streamKey')}</label>
                <div className="settings-field__input-wrap">
                  <input
                    className="settings-field__input settings-field__input--has-eye"
                    type={showStreamKey ? 'text' : 'password'}
                    placeholder="••••••••"
                    autoComplete="off"
                    value={streamKey}
                    onChange={e => handleStreamKeyChange(e.target.value)}
                  />
                  <button className="settings-field__eye" onClick={() => setShowStreamKey(v => !v)} title="Toggle visibility">👁</button>
                </div>
              </div>

              <div className="settings-field">
                <label className="settings-checkbox">
                  <input type="checkbox" checked={autoConnect} onChange={e => handleAutoConnectChange(e.target.checked)} />
                  {t('settings.connection.autoConnect')}
                </label>
              </div>

              <div className="settings-field">
                <label className="settings-field__label">{t('settings.connection.theme')}</label>
                <select
                  className="settings-field__input"
                  style={{ appearance: 'auto' }}
                  value={theme}
                  onChange={e => handleThemeChange(e.target.value)}
                >
                  <option value="auto">{t('settings.connection.themeAuto')}</option>
                  <option value="dark">{t('settings.connection.themeDark')}</option>
                  <option value="light">{t('settings.connection.themeLight')}</option>
                </select>
              </div>

              <div className="settings-field">
                <label className="settings-field__label">{t('settings.language')}</label>
                <div className="lang-switcher">
                  {LOCALE_CODES.map(code => (
                    <button
                      key={code}
                      className={`lang-btn${lang === code ? ' lang-btn--active' : ''}`}
                      onClick={() => setLang(code)}
                      title={code.toUpperCase()}
                    >
                      🌐 {code.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>

              <div className="settings-field">
                <label className="settings-field__label">
                  {t('settings.captions.textSize')}: <span>{textSize}px</span>
                </label>
                <input
                  className="settings-field__input"
                  type="range"
                  min="10" max="24" step="1"
                  value={textSize}
                  onChange={e => handleTextSizeChange(e.target.value)}
                  style={{ padding: 0, cursor: 'pointer' }}
                />
              </div>

              <div className="settings-field">
                <label className="settings-checkbox">
                  <input
                    type="checkbox"
                    checked={advancedMode}
                    onChange={e => handleAdvancedModeChange(e.target.checked)}
                  />
                  {t('settings.basic.showAdvanced')}
                </label>
              </div>
            </div>
          )}

          {/* ── RTMP Relay (advanced mode only) ── */}
          {activeTab === 'rtmpRelay' && (
            <div className="settings-panel settings-panel--active">
              {!session.connected && (
                <div className="settings-field">
                  <span className="settings-field__hint" style={{ color: 'var(--color-text-dim)' }}>
                    {t('settings.relay.notConnected')}
                  </span>
                </div>
              )}

              <div className="settings-field">
                <label className="settings-field__label">{t('settings.relay.mode')}</label>
                <div className="lang-switcher">
                  <button
                    className={`lang-btn${relayMode === 'caption' ? ' lang-btn--active' : ''}`}
                    onClick={() => onRelayModeChange('caption')}
                  >
                    {t('settings.relay.modeCaptions')}
                  </button>
                  <button
                    className={`lang-btn${relayMode === 'rtmp' ? ' lang-btn--active' : ''}`}
                    onClick={() => onRelayModeChange('rtmp')}
                  >
                    {t('settings.relay.modeRtmp')}
                  </button>
                </div>
              </div>

              {relayMode === 'caption' && (
                <>
                  <div className="settings-field">
                    <label className="settings-field__label" style={{ opacity: 0.5 }}>{t('settings.relay.genericService')} ({t('settings.relay.comingSoon')})</label>
                  </div>
                </>
              )}

              {relayMode === 'rtmp' && (
                <>
                  <div className="settings-field">
                    <label className="settings-field__label">{t('settings.relay.activeToggle')}</label>
                    <label className="settings-checkbox">
                      <input
                        type="checkbox"
                        checked={relayActive}
                        onChange={e => handleToggleRelayActive(e.target.checked)}
                        disabled={!session.connected || relayLoading}
                      />
                      {relayActive ? t('settings.relay.activeLabel') : t('settings.relay.inactiveLabel')}
                    </label>
                    <span className="settings-field__hint">{t('settings.relay.activeHint')}</span>
                  </div>

                  <div className="settings-field">
                    <label className="settings-field__label">{t('settings.relay.relayTargets')}</label>
                    {relayList.length === 0 && (
                      <span className="settings-field__hint">{t('settings.relay.noRelays')}</span>
                    )}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {relayList.map(entry => (
                        <RelayRow
                          key={entry.slot}
                          entry={entry}
                          onChange={updated => updateRelayItem(entry.slot, updated)}
                          onRemove={() => removeRelay(entry.slot)}
                          t={t}
                        />
                      ))}
                    </div>
                    {relayList.length < MAX_RELAY_SLOTS && (
                      <button
                        type="button"
                        className="btn btn--secondary btn--sm"
                        onClick={addRelay}
                        style={{ marginTop: 8 }}
                      >
                        + {t('settings.relay.addRelay')}
                      </button>
                    )}
                  </div>

                  {relayStatus && relayStatus.relays?.length > 0 && (
                    <div className="settings-field">
                      <label className="settings-field__label">{t('settings.relay.status')}</label>
                      {relayStatus.relays.map(r => (
                        <div key={r.slot} style={{ fontSize: '0.85em', marginBottom: '0.25rem' }}>
                          {runningSlots.includes(r.slot) ? '🔴 ' + t('settings.relay.live') : '⚫ ' + t('settings.relay.inactive')}
                          {' — '}{r.targetUrl}{r.targetName ? `/${r.targetName}` : ''}
                        </div>
                      ))}
                    </div>
                  )}

                  {relayError && <div className="settings-error">{relayError}</div>}
                </>
              )}
            </div>
          )}

          {/* ── Credentials ── */}
          {activeTab === 'credentials' && (
            <div className="settings-panel settings-panel--active">

              <div className="settings-field">
                <label className="settings-field__label">{t('settings.credentials.googleCredential')}</label>
                <span className="settings-field__hint">{t('settings.credentials.googleCredentialHint')}</span>
                {credential ? (
                  <div className="stt-cred-loaded">
                    <span className="stt-cred-loaded__email" title={credential.client_email}>
                      {credential.client_email}
                    </span>
                    <button className="btn btn--secondary btn--sm" onClick={handleClearCredential}>
                      {t('settings.stt.credentialRemove')}
                    </button>
                  </div>
                ) : (
                  <>
                    <input
                      ref={credInputRef}
                      type="file"
                      accept=".json,application/json"
                      style={{ display: 'none' }}
                      onChange={handleCredentialFile}
                    />
                    <button
                      className="btn btn--secondary btn--sm"
                      onClick={() => credInputRef.current?.click()}
                    >
                      {t('settings.stt.credentialLoad')}
                    </button>
                  </>
                )}
              </div>

              <hr style={{ borderColor: 'var(--color-border)', margin: '12px 0' }} />

              {/* Keyboard shortcuts reference */}
              <div className="settings-field">
                <label className="settings-field__label">{t('settings.credentials.shortcuts')}</label>
                <table className="shortcuts-table">
                  <tbody>
                    <tr>
                      <td className="shortcuts-table__key">Ctrl+,</td>
                      <td className="shortcuts-table__desc">{t('settings.credentials.shortcutSettings')}</td>
                    </tr>
                    <tr>
                      <td className="shortcuts-table__key">Ctrl+1…9</td>
                      <td className="shortcuts-table__desc">{t('settings.credentials.shortcutFileTabs')}</td>
                    </tr>
                    <tr>
                      <td className="shortcuts-table__key">Enter</td>
                      <td className="shortcuts-table__desc">{t('settings.credentials.shortcutSend')}</td>
                    </tr>
                    <tr>
                      <td className="shortcuts-table__key">↑ / ↓</td>
                      <td className="shortcuts-table__desc">{t('settings.credentials.shortcutNav')}</td>
                    </tr>
                    <tr>
                      <td className="shortcuts-table__key">Tab</td>
                      <td className="shortcuts-table__desc">{t('settings.credentials.shortcutCycle')}</td>
                    </tr>
                    <tr>
                      <td className="shortcuts-table__key">Escape</td>
                      <td className="shortcuts-table__desc">{t('settings.credentials.shortcutClose')}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

            </div>
          )}
        </div>

        <div className="settings-modal__footer">
          <div className="settings-modal__actions">
            <button className="btn btn--secondary" onClick={onClose} style={{ marginLeft: 'auto' }}>
              {t('settings.footer.close')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
