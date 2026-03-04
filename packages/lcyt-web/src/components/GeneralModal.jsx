import { useState, useEffect } from 'react';
import { useSessionContext } from '../contexts/SessionContext';
import { useToastContext } from '../contexts/ToastContext';
import { useLang } from '../contexts/LangContext';
import {
  getRelayMode, setRelayMode,
  getRelayTargetType, setRelayTargetType,
  getRelayYoutubeKey, setRelayYoutubeKey,
  getRelayGenericUrl, setRelayGenericUrl,
  getRelayGenericName, setRelayGenericName,
  getRelayCaptionMode, setRelayCaptionMode,
  getAllRelayConfig,
  buildRelayTarget, buildRelayTargetUrl,
} from '../lib/relayConfig.js';

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

  // Relay settings
  const [relayMode, setRelayModeState] = useState('caption');
  const [relayTargetType, setRelayTargetTypeState] = useState('youtube');
  const [relayYoutubeKey, setRelayYoutubeKeyState] = useState('');
  const [relayGenericUrl, setRelayGenericUrlState] = useState('');
  const [relayGenericName, setRelayGenericNameState] = useState('');
  const [relayCaptionMode, setRelayCaptionModeState] = useState('http');
  const [relayStatus, setRelayStatus] = useState(null); // { relay, running } | null
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

    // Load relay settings from localStorage (single consolidated read)
    const rc = getAllRelayConfig();
    setRelayModeState(rc.mode);
    setRelayTargetTypeState(rc.targetType);
    setRelayYoutubeKeyState(rc.youtubeKey);
    setRelayGenericUrlState(rc.genericUrl);
    setRelayGenericNameState(rc.genericName);
    setRelayCaptionModeState(rc.captionMode);
    setRelayError('');

    // Fetch current relay status from backend if connected
    if (session.connected) {
      session.getRelayStatus().then(setRelayStatus).catch(() => setRelayStatus(null));
    } else {
      setRelayStatus(null);
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

  function onRelayTargetTypeChange(type) {
    setRelayTargetTypeState(type);
    setRelayTargetType(type);
  }

  function onRelayYoutubeKeyChange(val) {
    setRelayYoutubeKeyState(val);
    setRelayYoutubeKey(val);
  }

  function onRelayGenericUrlChange(val) {
    setRelayGenericUrlState(val);
    setRelayGenericUrl(val);
  }

  function onRelayGenericNameChange(val) {
    setRelayGenericNameState(val);
    setRelayGenericName(val);
  }

  function onRelayCaptionModeChange(mode) {
    setRelayCaptionModeState(mode);
    setRelayCaptionMode(mode);
  }

  async function handleStartRelay() {
    setRelayError('');
    const { targetUrl, targetName } = buildRelayTarget();
    if (!targetUrl) {
      setRelayError(t('settings.relay.errorNoTarget'));
      return;
    }
    setRelayLoading(true);
    try {
      await session.configureRelay({ targetUrl, targetName, captionMode: relayCaptionMode });
      const status = await session.getRelayStatus();
      setRelayStatus(status);
      showToast(t('settings.relay.configured'), 'success');
    } catch (err) {
      setRelayError(err.message);
    } finally {
      setRelayLoading(false);
    }
  }

  async function handleStopRelay() {
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

  const builtTargetUrl = buildRelayTargetUrl();

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

            {/* ── RTMP relay settings ── */}
            {relayMode === 'rtmp' && (
              <>
                <div className="settings-field">
                  <label className="settings-field__label">{t('settings.relay.targetType')}</label>
                  <div className="lang-switcher">
                    <button
                      className={`lang-btn${relayTargetType === 'youtube' ? ' lang-btn--active' : ''}`}
                      onClick={() => onRelayTargetTypeChange('youtube')}
                    >
                      YouTube
                    </button>
                    <button
                      className={`lang-btn${relayTargetType === 'generic' ? ' lang-btn--active' : ''}`}
                      onClick={() => onRelayTargetTypeChange('generic')}
                    >
                      {t('settings.relay.generic')}
                    </button>
                  </div>
                </div>

                {relayTargetType === 'youtube' && (
                  <div className="settings-field">
                    <label className="settings-field__label">{t('settings.relay.youtubeStreamKey')}</label>
                    <input
                      className="settings-field__input"
                      type="text"
                      placeholder="xxxx-xxxx-xxxx-xxxx-xxxx"
                      autoComplete="off"
                      value={relayYoutubeKey}
                      onChange={e => onRelayYoutubeKeyChange(e.target.value)}
                    />
                    {relayYoutubeKey.trim() && (
                      <span className="settings-field__hint">
                        → rtmp://a.rtmp.youtube.com/live2/{relayYoutubeKey.trim()}
                      </span>
                    )}
                  </div>
                )}

                {relayTargetType === 'generic' && (
                  <>
                    <div className="settings-field">
                      <label className="settings-field__label">{t('settings.relay.rtmpUrl')}</label>
                      <input
                        className="settings-field__input"
                        type="text"
                        placeholder="rtmp://your-server.example.com/live"
                        autoComplete="off"
                        value={relayGenericUrl}
                        onChange={e => onRelayGenericUrlChange(e.target.value)}
                      />
                    </div>
                    <div className="settings-field">
                      <label className="settings-field__label">{t('settings.relay.rtmpStreamName')}</label>
                      <input
                        className="settings-field__input"
                        type="text"
                        placeholder={t('settings.relay.rtmpStreamNamePlaceholder')}
                        autoComplete="off"
                        value={relayGenericName}
                        onChange={e => onRelayGenericNameChange(e.target.value)}
                      />
                      {relayGenericUrl.trim() && (
                        <span className="settings-field__hint">
                          → {relayGenericUrl.trim()}{relayGenericName.trim() ? `/${relayGenericName.trim()}` : ''}
                        </span>
                      )}
                    </div>
                  </>
                )}

                {/* Captions in relay */}
                <div className="settings-field">
                  <label className="settings-field__label">{t('settings.relay.captionDelivery')}</label>
                  <div className="lang-switcher">
                    <button
                      className={`lang-btn${relayCaptionMode === 'http' ? ' lang-btn--active' : ''}`}
                      onClick={() => onRelayCaptionModeChange('http')}
                    >
                      {t('settings.relay.captionHttp')}
                    </button>
                    <button
                      className="lang-btn"
                      disabled
                      title={t('settings.relay.comingSoon')}
                      style={{ opacity: 0.4, cursor: 'not-allowed' }}
                    >
                      CEA-708 ({t('settings.relay.comingSoon')})
                    </button>
                  </div>
                </div>

                {/* Relay status */}
                {relayStatus && (
                  <div className="settings-field">
                    <label className="settings-field__label">{t('settings.relay.status')}</label>
                    <span style={{ fontSize: '0.85em' }}>
                      {relayStatus.running ? '🔴 ' + t('settings.relay.live') : '⚫ ' + t('settings.relay.inactive')}
                      {' — '}{relayStatus.relay?.targetUrl}
                      {relayStatus.relay?.targetName ? `/${relayStatus.relay.targetName}` : ''}
                      {relayStatus.relay?.captionMode === 'cea708' ? ' · CEA-708' : ' · HTTP'}
                    </span>
                  </div>
                )}

                {relayError && <div className="settings-error">{relayError}</div>}

                <div className="settings-modal__actions" style={{ paddingTop: '0.5rem' }}>
                  <button
                    className="btn btn--primary"
                    onClick={handleStartRelay}
                    disabled={relayLoading || !session.connected || !builtTargetUrl}
                    title={!session.connected ? t('settings.relay.notConnected') : !builtTargetUrl ? t('settings.relay.errorNoTarget') : ''}
                  >
                    ▶ {t('settings.relay.start')}
                  </button>
                  <button
                    className="btn btn--secondary"
                    onClick={handleStopRelay}
                    disabled={relayLoading || !session.connected}
                  >
                    ■ {t('settings.relay.stop')}
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
