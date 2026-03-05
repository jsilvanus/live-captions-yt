import { useState, useEffect } from 'react';
import { useSessionContext } from '../contexts/SessionContext';
import { useToastContext } from '../contexts/ToastContext';
import { useLang } from '../contexts/LangContext';
import {
  getRelayMode, setRelayMode,
  getAllRelayConfig,
  buildRelayTargetUrl,
  getSlotConfig, setSlotTargetType,
  setSlotYoutubeKey, setSlotGenericUrl, setSlotGenericName, setSlotCaptionMode,
  buildSlotTarget, buildSlotTargetUrl,
  clearSlot,
} from '../lib/relayConfig.js';

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

function loadAllSlotConfigs() {
  const configs = {};
  for (let s = 1; s <= MAX_RELAY_SLOTS; s++) {
    configs[s] = getSlotConfig(s);
  }
  return configs;
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
  // RTMP fan-out: per-slot configs + active slot
  const [activeRelaySlot, setActiveRelaySlot] = useState(1);
  const [slotConfigs, setSlotConfigs] = useState(() => loadAllSlotConfigs());
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
    const rc = getAllRelayConfig();
    setRelayModeState(rc.mode);
    setSlotConfigs(loadAllSlotConfigs());
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

  function updateSlotField(slot, field, value) {
    switch (field) {
      case 'targetType':  setSlotTargetType(slot, value);  break;
      case 'youtubeKey':  setSlotYoutubeKey(slot, value);  break;
      case 'genericUrl':  setSlotGenericUrl(slot, value);  break;
      case 'genericName': setSlotGenericName(slot, value); break;
      case 'captionMode': setSlotCaptionMode(slot, value); break;
    }
    setSlotConfigs(prev => ({
      ...prev,
      [slot]: { ...prev[slot], [field]: value },
    }));
  }

  async function handleActivateSlot(slot) {
    setRelayError('');
    const { targetUrl, targetName } = buildSlotTarget(slot);
    const captionMode = slotConfigs[slot]?.captionMode || 'http';
    if (!targetUrl) {
      setRelayError(t('settings.relay.errorNoTarget'));
      return;
    }
    setRelayLoading(true);
    try {
      await session.configureRelay({ slot, targetUrl, targetName, captionMode });
      const status = await session.getRelayStatus();
      setRelayStatus(status);
      showToast(t('settings.relay.configured'), 'success');
    } catch (err) {
      setRelayError(err.message);
    } finally {
      setRelayLoading(false);
    }
  }

  async function handleStopSlot(slot) {
    setRelayError('');
    setRelayLoading(true);
    try {
      await session.stopRelaySlot({ slot });
      const status = await session.getRelayStatus();
      setRelayStatus(status);
      showToast(t('settings.relay.stopped'), 'info');
    } catch (err) {
      setRelayError(err.message);
    } finally {
      setRelayLoading(false);
    }
  }

  async function handleStopAll() {
    setRelayError('');
    setRelayLoading(true);
    try {
      await session.stopRelay();
      setRelayStatus(null);
      showToast(t('settings.relay.stopped'), 'info');
    } catch (err) {
      setRelayError(err.message);
    } finally {
      setRelayLoading(false);
    }
  }

  function handleClearSlot(slot) {
    clearSlot(slot);
    setSlotConfigs(prev => ({ ...prev, [slot]: getSlotConfig(slot) }));
  }

  async function handleToggleRelayActive(newActive) {
    setRelayActiveState(newActive);
    setRelayError('');
    try {
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
  const sc = slotConfigs[activeRelaySlot] || {};
  const builtSlotUrl = buildSlotTargetUrl(activeRelaySlot);

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

            {/* ── RTMP relay settings (fan-out: up to 4 slots) ── */}
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

                {/* Slot selector tabs */}
                <div className="settings-field">
                  <label className="settings-field__label">{t('settings.relay.relayTarget')}</label>
                  <div className="lang-switcher">
                    {[1, 2, 3, 4].map(slot => {
                      const slotBuilt = buildSlotTargetUrl(slot);
                      const isRunning = runningSlots.includes(slot);
                      return (
                        <button
                          key={slot}
                          className={`lang-btn${activeRelaySlot === slot ? ' lang-btn--active' : ''}`}
                          onClick={() => setActiveRelaySlot(slot)}
                          title={slotBuilt || ''}
                        >
                          {isRunning ? '🔴' : slotBuilt ? '●' : ''} {slot}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Target type for active slot */}
                <div className="settings-field">
                  <label className="settings-field__label">{t('settings.relay.targetType')}</label>
                  <div className="lang-switcher">
                    <button
                      className={`lang-btn${sc.targetType === 'youtube' ? ' lang-btn--active' : ''}`}
                      onClick={() => updateSlotField(activeRelaySlot, 'targetType', 'youtube')}
                    >
                      YouTube
                    </button>
                    <button
                      className={`lang-btn${sc.targetType === 'generic' ? ' lang-btn--active' : ''}`}
                      onClick={() => updateSlotField(activeRelaySlot, 'targetType', 'generic')}
                    >
                      {t('settings.relay.generic')}
                    </button>
                  </div>
                </div>

                {sc.targetType === 'youtube' && (
                  <div className="settings-field">
                    <label className="settings-field__label">{t('settings.relay.youtubeStreamKey')}</label>
                    <input
                      className="settings-field__input"
                      type="text"
                      placeholder="xxxx-xxxx-xxxx-xxxx-xxxx"
                      autoComplete="off"
                      value={sc.youtubeKey || ''}
                      onChange={e => updateSlotField(activeRelaySlot, 'youtubeKey', e.target.value)}
                    />
                    {(sc.youtubeKey || '').trim() && (
                      <span className="settings-field__hint">
                        → rtmp://a.rtmp.youtube.com/live2/{(sc.youtubeKey || '').trim()}
                      </span>
                    )}
                  </div>
                )}

                {sc.targetType === 'generic' && (
                  <>
                    <div className="settings-field">
                      <label className="settings-field__label">{t('settings.relay.rtmpUrl')}</label>
                      <input
                        className="settings-field__input"
                        type="text"
                        placeholder="rtmp://your-server.example.com/live"
                        autoComplete="off"
                        value={sc.genericUrl || ''}
                        onChange={e => updateSlotField(activeRelaySlot, 'genericUrl', e.target.value)}
                      />
                    </div>
                    <div className="settings-field">
                      <label className="settings-field__label">{t('settings.relay.rtmpStreamName')}</label>
                      <input
                        className="settings-field__input"
                        type="text"
                        placeholder={t('settings.relay.rtmpStreamNamePlaceholder')}
                        autoComplete="off"
                        value={sc.genericName || ''}
                        onChange={e => updateSlotField(activeRelaySlot, 'genericName', e.target.value)}
                      />
                      {(sc.genericUrl || '').trim() && (
                        <span className="settings-field__hint">
                          → {(sc.genericUrl || '').trim()}{(sc.genericName || '').trim() ? `/${(sc.genericName || '').trim()}` : ''}
                        </span>
                      )}
                    </div>
                  </>
                )}

                {/* Caption delivery for active slot */}
                <div className="settings-field">
                  <label className="settings-field__label">{t('settings.relay.captionDelivery')}</label>
                  <div className="lang-switcher">
                    <button
                      className={`lang-btn${(sc.captionMode || 'http') === 'http' ? ' lang-btn--active' : ''}`}
                      onClick={() => updateSlotField(activeRelaySlot, 'captionMode', 'http')}
                    >
                      {t('settings.relay.captionHttp')}
                    </button>
                  </div>
                </div>

                {/* Per-slot backend status */}
                {relayStatus && relayStatus.relays?.length > 0 && (
                  <div className="settings-field">
                    <label className="settings-field__label">{t('settings.relay.status')}</label>
                    {relayStatus.relays.map(r => (
                      <div key={r.slot} style={{ fontSize: '0.85em', marginBottom: '0.25rem' }}>
                        <span style={{ fontWeight: 600 }}>{t('settings.relay.slot')} {r.slot}:</span>{' '}
                        {runningSlots.includes(r.slot) ? '🔴 ' + t('settings.relay.live') : '⚫ ' + t('settings.relay.inactive')}
                        {' — '}{r.targetUrl}{r.targetName ? `/${r.targetName}` : ''}
                        {' · '}HTTP
                      </div>
                    ))}
                  </div>
                )}

                {relayError && <div className="settings-error">{relayError}</div>}

                <div className="settings-modal__actions" style={{ paddingTop: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <button
                    className="btn btn--primary"
                    onClick={() => handleActivateSlot(activeRelaySlot)}
                    disabled={relayLoading || !session.connected || !builtSlotUrl}
                    title={!session.connected ? t('settings.relay.notConnected') : !builtSlotUrl ? t('settings.relay.errorNoTarget') : ''}
                  >
                    ▶ {t('settings.relay.start')} ({t('settings.relay.slot')} {activeRelaySlot})
                  </button>
                  <button
                    className="btn btn--secondary"
                    onClick={() => handleStopSlot(activeRelaySlot)}
                    disabled={relayLoading || !session.connected}
                  >
                    ■ {t('settings.relay.stop')} ({t('settings.relay.slot')} {activeRelaySlot})
                  </button>
                  {runningSlots.length > 1 && (
                    <button
                      className="btn btn--secondary"
                      onClick={handleStopAll}
                      disabled={relayLoading || !session.connected}
                    >
                      ■ {t('settings.relay.stopAll')}
                    </button>
                  )}
                  <button
                    className="btn btn--secondary"
                    onClick={() => handleClearSlot(activeRelaySlot)}
                    disabled={relayLoading}
                    style={{ opacity: 0.7 }}
                  >
                    🗑 {t('settings.relay.clearSlot')} {activeRelaySlot}
                  </button>
                </div>
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
