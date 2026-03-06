import { useState, useEffect } from 'react';
import { useSessionContext } from '../contexts/SessionContext';
import { useToastContext } from '../contexts/ToastContext';
import { useLang } from '../contexts/LangContext';
import {
  getRelayMode, setRelayMode,
  getSlotConfig, setSlotTargetType,
  setSlotYoutubeKey, setSlotGenericUrl, setSlotGenericName, setSlotCaptionMode,
  buildSlotTarget,
  clearSlot,
} from '../lib/relayConfig.js';

const MAX_RELAY_SLOTS = 4;

// ── Relay row component ───────────────────────────────────────
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

export function GeneralModal({ isOpen, onClose }) {
  const session = useSessionContext();
  const { showToast } = useToastContext();
  const { lang, setLang, t, LOCALE_CODES } = useLang();

  const [backendUrl, setBackendUrl] = useState('https://api.lcyt.fi');
  const [apiKey, setApiKey] = useState('');
  const [streamKey, setStreamKey] = useState('');
  const [autoConnect, setAutoConnect] = useState(false);
  const [theme, setTheme] = useState('auto');
  const [showApiKey, setShowApiKey] = useState(false);
  const [showStreamKey, setShowStreamKey] = useState(false);
  const [error, setError] = useState('');
  const [connecting, setConnecting] = useState(false);

  // Relay top-level settings
  const [relayMode, setRelayModeState] = useState('caption');
  // RTMP fan-out: list of relay entries
  const [relayList, setRelayList] = useState(() => buildInitialRelayList());
  // Whether the relay fan-out is activated (user toggle)
  const [relayActive, setRelayActiveState] = useState(false);
  // Backend relay status: { relays: [...], runningSlots: [...], active: bool } | null
  const [relayStatus, setRelayStatus] = useState(null);
  const [relayLoading, setRelayLoading] = useState(false);
  const [relayError, setRelayError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    const cfg = session.getPersistedConfig();
    if (cfg.backendUrl) setBackendUrl(cfg.backendUrl);
    if (cfg.apiKey) setApiKey(cfg.apiKey);
    if (cfg.streamKey) setStreamKey(cfg.streamKey);
    setAutoConnect(session.getAutoConnect());
    try { setTheme(localStorage.getItem('lcyt-theme') || 'auto'); } catch {}
    setError('');

    // Load relay settings
    const rc = getRelayMode();
    setRelayModeState(rc);
    setRelayList(buildInitialRelayList());
    setRelayError('');

    // Fetch current relay status from backend if connected
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

  if (!isOpen) return null;

  function onThemeChange(value) {
    setTheme(value);
    applyTheme(value);
  }

  async function handleConnect() {
    setError('');
    if (!backendUrl) { setError(t('settings.connection.errorBackendUrl')); return; }
    if (!apiKey) { setError(t('settings.connection.errorApiKey')); return; }
    if (!streamKey) { setError(t('settings.connection.errorStreamKey')); return; }
    setConnecting(true);
    try {
      await session.connect({ backendUrl, apiKey, streamKey });
      session.setAutoConnect(autoConnect);
      showToast(t('settings.connection.connected'), 'success');
      onClose();
    } catch (err) {
      setError(err.message || 'Connection failed');
    } finally {
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    await session.disconnect();
    showToast(t('settings.connection.disconnected'), 'info');
    onClose();
  }

  function handleClearConfig() {
    session.clearPersistedConfig();
    setBackendUrl('');
    setApiKey('');
    setStreamKey('');
    setAutoConnect(false);
    showToast(t('settings.connection.configCleared'), 'info');
  }

  // Relay helpers

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
      setRelayActiveState(!newActive); // revert on error
      setRelayError(err.message);
    }
  }

  const runningSlots = relayStatus?.runningSlots ?? [];

  return (
    <div className="settings-modal" role="dialog" aria-modal="true">
      <div className="settings-modal__backdrop" onClick={onClose} />
      <div className="settings-modal__box">
        <div className="settings-modal__header">
          <span className="settings-modal__title">{t('statusBar.general')}</span>
          <button className="settings-modal__close" onClick={onClose} title="Close (Esc)">✕</button>
        </div>
        <div className="settings-modal__body">
          <div className="settings-panel settings-panel--active">

            {/* ── API Key (at top) ── */}
            <div className="settings-field">
              <label className="settings-field__label">{t('settings.connection.apiKey')}</label>
              <div className="settings-field__input-wrap">
                <input
                  className="settings-field__input settings-field__input--has-eye"
                  type={showApiKey ? 'text' : 'password'}
                  placeholder="••••••••"
                  autoComplete="off"
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                />
                <button className="settings-field__eye" onClick={() => setShowApiKey(v => !v)} title="Toggle visibility">👁</button>
              </div>
            </div>

            {/* ── Relay mode selector ── */}
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

            {/* ── Caption relay settings ── */}
            {relayMode === 'caption' && (
              <>
                <div className="settings-field">
                  <label className="settings-field__label">{t('settings.connection.streamKey')}</label>
                  <div className="settings-field__input-wrap">
                    <input
                      className="settings-field__input settings-field__input--has-eye"
                      type={showStreamKey ? 'text' : 'password'}
                      placeholder="••••••••"
                      autoComplete="off"
                      value={streamKey}
                      onChange={e => setStreamKey(e.target.value)}
                    />
                    <button className="settings-field__eye" onClick={() => setShowStreamKey(v => !v)} title="Toggle visibility">👁</button>
                  </div>
                  <span className="settings-field__hint">{t('settings.relay.captionYouTubeHint')}</span>
                </div>
                <div className="settings-field">
                  <label className="settings-field__label" style={{ opacity: 0.5 }}>{t('settings.relay.genericService')} ({t('settings.relay.comingSoon')})</label>
                </div>
              </>
            )}

            {/* ── RTMP relay settings (list-based, up to 4 destinations) ── */}
            {relayMode === 'rtmp' && (
              <>
                {/* Relay active toggle */}
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

                {/* Relay list */}
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

                {/* Backend relay status */}
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

            {/* ── Connection ── */}
            <div className="settings-field" style={{ marginTop: '1rem' }}>
              <label className="settings-field__label">{t('settings.connection.backendUrl')}</label>
              <input
                className="settings-field__input"
                type="url"
                placeholder="https://api.lcyt.fi"
                autoComplete="off"
                value={backendUrl}
                onChange={e => setBackendUrl(e.target.value)}
              />
            </div>
            <label className="settings-checkbox">
              <input type="checkbox" checked={autoConnect} onChange={e => setAutoConnect(e.target.checked)} />
              {t('settings.connection.autoConnect')}
            </label>
            <div className="settings-field">
              <label className="settings-field__label">{t('settings.connection.theme')}</label>
              <select
                className="settings-field__input"
                style={{ appearance: 'auto' }}
                value={theme}
                onChange={e => onThemeChange(e.target.value)}
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
            {error && <div className="settings-error">{error}</div>}
          </div>
        </div>
        <div className="settings-modal__footer">
          <div className="settings-modal__actions">
            <button className="btn btn--primary" onClick={handleConnect} disabled={connecting}>
              {connecting ? t('settings.footer.connecting') : t('settings.footer.connect')}
            </button>
            <button className="btn btn--secondary" onClick={handleDisconnect}>{t('settings.footer.disconnect')}</button>
            <button className="btn btn--secondary" onClick={onClose}>{t('settings.footer.close')}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
