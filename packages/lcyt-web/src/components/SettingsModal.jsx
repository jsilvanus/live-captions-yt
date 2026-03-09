import { useState, useEffect, useRef } from 'react';
import { useSessionContext } from '../contexts/SessionContext';
import { useLang } from '../contexts/LangContext';import {
  getSlotConfig, setSlotTargetType,
  setSlotYoutubeKey, setSlotGenericUrl, setSlotCaptionMode,
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
    <div style={{ border: '1px solid var(--color-border)', borderRadius: 4, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <label className="settings-checkbox" style={{ marginBottom: 0 }}>
          <input
            type="checkbox"
            checked={!!entry.active}
            onChange={e => onChange({ ...entry, active: e.target.checked })}
          />
        </label>
        <select
          className="settings-field__input"
          value={entry.targetType}
          onChange={e => onChange({ ...entry, targetType: e.target.value })}
          style={{ width: 'auto' }}
        >
          <option value="youtube">YouTube</option>
          <option value="generic">{t('settings.relay.generic')}</option>
        </select>
        {entry.targetType === 'youtube' ? (
          <input
            className="settings-field__input"
            type="password"
            placeholder="xxxx-xxxx-xxxx-xxxx-xxxx"
            autoComplete="off"
            value={entry.youtubeKey || ''}
            onChange={e => onChange({ ...entry, youtubeKey: e.target.value })}
            style={{ flex: 1 }}
          />
        ) : (
          <input
            className="settings-field__input"
            type="text"
            placeholder={t('settings.relay.rtmpFullPathPlaceholder')}
            autoComplete="off"
            value={entry.genericUrl || ''}
            onChange={e => onChange({ ...entry, genericUrl: e.target.value })}
            style={{ flex: 1 }}
          />
        )}
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          onClick={onRemove}
          title={t('settings.relay.removeRelay')}
          style={{ flexShrink: 0 }}
        >✕</button>
      </div>
      {entry.targetType === 'youtube' && (entry.youtubeKey || '').trim() && (
        <span className="settings-field__hint">
          → rtmp://a.rtmp.youtube.com/live2/{(entry.youtubeKey || '').trim()}
        </span>
      )}
    </div>
  );
}

export function SettingsModal({ isOpen, onClose, inline }) {
  const session = useSessionContext();
  const { showToast } = useToastContext();
  const { lang, setLang, t, LOCALE_CODES } = useLang();

  const [activeTab, setActiveTab] = useState('basic');
  const [advancedMode, setAdvancedModeState] = useState(getAdvancedMode);

  // ── Basic tab fields ──────────────────────────────────────
  const [backendUrl, setBackendUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [autoConnect, setAutoConnect] = useState(false);
  const [theme, setTheme] = useState('auto');
  const [textSize, setTextSize] = useState(
    () => { try { return parseInt(localStorage.getItem('lcyt:textSize') || '13', 10); } catch { return 13; } }
  );
  const [showApiKey, setShowApiKey] = useState(false);

  // ── RTMP Relay tab ────────────────────────────────────────
  const [relayList, setRelayList] = useState(() => buildInitialRelayList());
  const [relayStatus, setRelayStatus] = useState(null);
  const [relayLoading, setRelayLoading] = useState(false);
  const [relayError, setRelayError] = useState('');

  // ── Credentials tab ───────────────────────────────────────
  const [credential, setCredentialState] = useState(getGoogleCredential);
  const credInputRef = useRef(null);

  // ── Icons tab ─────────────────────────────────────────────
  const [icons, setIcons] = useState([]);
  const [iconsLoading, setIconsLoading] = useState(false);
  const iconInputRef = useRef(null);

  // Load persisted values when modal opens
  useEffect(() => {
    if (!isOpen) return;
    const cfg = session.getPersistedConfig();
    setBackendUrl(cfg.backendUrl || '');
    setApiKey(cfg.apiKey || '');
    setAutoConnect(session.getAutoConnect());
    try { setTheme(localStorage.getItem('lcyt-theme') || 'auto'); } catch {}
    const savedSize = parseInt(localStorage.getItem('lcyt:textSize') || '13', 10);
    setTextSize(savedSize);
    applyTextSize(savedSize);
    setAdvancedModeState(getAdvancedMode());
    // Load relay settings
    setRelayList(buildInitialRelayList());
    setRelayError('');
    if (session.connected) {
      session.getRelayStatus().then(status => {
        setRelayStatus(status);
      }).catch(() => {
        setRelayStatus(null);
      });
      // Load icons list
      setIconsLoading(true);
      session.listIcons().then(data => {
        setIcons(data.icons || []);
      }).catch(() => {
        setIcons([]);
      }).finally(() => setIconsLoading(false));
    } else {
      setRelayStatus(null);
      setIcons([]);
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

  if (!isOpen && !inline) return null;

  // ── Field change handlers (auto-save) ─────────────────────

  function handleBackendUrlChange(val) {
    setBackendUrl(val);
    persist({ backendUrl: val });
  }

  function handleApiKeyChange(val) {
    setApiKey(val);
    persist({ apiKey: val });
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

  const runningSlots = relayStatus?.runningSlots ?? [];

  const TABS = advancedMode ? ['basic', 'rtmpRelay', 'credentials', 'icons'] : ['basic', 'credentials', 'icons'];

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

  // ── Icon handlers ──────────────────────────────────────────

  async function handleIconFile(e) {
    const file = e.target.files?.[0];
    if (iconInputRef.current) iconInputRef.current.value = '';
    if (!file) return;

    const ALLOWED_TYPES = ['image/png', 'image/svg+xml'];
    if (!ALLOWED_TYPES.includes(file.type)) {
      showToast(t('settings.icons.typeError'), 'error');
      return;
    }
    const MAX_BYTES = 200 * 1024;
    if (file.size > MAX_BYTES) {
      showToast(t('settings.icons.sizeError'), 'error');
      return;
    }

    try {
      const arrayBuf = await file.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuf)));
      const result = await session.uploadIcon({ filename: file.name, mimeType: file.type, data: base64 });
      setIcons(prev => [{ id: result.id, filename: result.filename, mimeType: result.mimeType, sizeBytes: result.sizeBytes, createdAt: new Date().toISOString() }, ...prev]);
      showToast(`${result.filename} uploaded`, 'success');
    } catch (err) {
      showToast(err.message || t('settings.icons.uploadError'), 'error');
    }
  }

  async function handleDeleteIcon(id) {
    if (!window.confirm(t('settings.icons.deleteConfirm'))) return;
    try {
      await session.deleteIcon(id);
      setIcons(prev => prev.filter(ic => ic.id !== id));
    } catch (err) {
      showToast(err.message || 'Failed to delete icon', 'error');
    }
  }

  const box = (
      <div className="settings-modal__box" style={inline ? { position: 'static', maxWidth: '100%', maxHeight: '100%', height: '100%', borderRadius: 0, border: 'none', boxShadow: 'none' } : {}}>
        <div className="settings-modal__header">
          <span className="settings-modal__title">{t('statusBar.settings')}</span>
          {!inline && <button className="settings-modal__close" onClick={onClose} title="Close (Esc)">✕</button>}
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
                <span className="settings-field__hint">{t('settings.relay.fanOutHint')}</span>
              </div>

              <div className="settings-field">
                <label className="settings-field__label">{t('settings.relay.relayTargets')}</label>
                {relayList.length === 0 && (
                  <span className="settings-field__hint">{t('settings.relay.noRelays')}</span>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
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

              <div className="settings-field">
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button className="btn btn--secondary btn--sm" disabled>
                    {t('settings.credentials.loginWithGoogle')}
                  </button>
                  <button className="btn btn--secondary btn--sm" disabled>
                    {t('settings.credentials.selectStream')}
                  </button>
                </div>
                <span className="settings-field__hint" style={{ marginTop: 6, display: 'block' }}>
                  {t('settings.credentials.googleLoginNote')}
                </span>
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

          {/* ── Icons ── */}
          {activeTab === 'icons' && (
            <div className="settings-panel settings-panel--active">
              {!session.connected ? (
                <div className="settings-field">
                  <span className="settings-field__hint" style={{ color: 'var(--color-text-dim)' }}>
                    {t('settings.icons.notConnected')}
                  </span>
                </div>
              ) : (
                <>
                  <div className="settings-field">
                    <label className="settings-field__label">{t('settings.icons.upload')}</label>
                    <span className="settings-field__hint">{t('settings.icons.uploadHint')}</span>
                    <input
                      ref={iconInputRef}
                      type="file"
                      accept="image/png,image/svg+xml"
                      style={{ display: 'none' }}
                      onChange={handleIconFile}
                    />
                    <button
                      className="btn btn--secondary btn--sm"
                      style={{ marginTop: 4 }}
                      onClick={() => iconInputRef.current?.click()}
                    >
                      {t('settings.icons.uploadButton')}
                    </button>
                  </div>

                  <div className="settings-field">
                    {iconsLoading && <span className="settings-field__hint">Loading…</span>}
                    {!iconsLoading && icons.length === 0 && (
                      <span className="settings-field__hint">{t('settings.icons.noIcons')}</span>
                    )}
                    {icons.map(icon => (
                      <div key={icon.id} style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        marginBottom: 8,
                        padding: '6px 8px',
                        border: '1px solid var(--border)',
                        borderRadius: 4,
                      }}>
                        <img
                          src={`${backendUrl}/icons/${icon.id}`}
                          alt={icon.filename}
                          style={{ width: 40, height: 40, objectFit: 'contain', flexShrink: 0, borderRadius: 4 }}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: '0.85em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {icon.filename}
                          </div>
                          <div style={{ fontSize: '0.75em', opacity: 0.5 }}>
                            {Math.round(icon.sizeBytes / 1024)} KB · {icon.mimeType}
                          </div>
                        </div>
                        <button
                          className="btn btn--secondary btn--sm"
                          style={{ flexShrink: 0 }}
                          onClick={() => handleDeleteIcon(icon.id)}
                        >
                          {t('settings.icons.deleteIcon')}
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {!inline && (
          <div className="settings-modal__footer">
            <div className="settings-modal__actions">
              <button className="btn btn--secondary" onClick={onClose} style={{ marginLeft: 'auto' }}>
                {t('settings.footer.close')}
              </button>
            </div>
          </div>
        )}
      </div>
  );

  if (inline) return box;

  return (
    <div className="settings-modal" role="dialog" aria-modal="true">
      <div className="settings-modal__backdrop" onClick={onClose} />
      {box}
    </div>
  );
}
