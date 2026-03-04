import { useState, useEffect } from 'react';
import { useSessionContext } from '../contexts/SessionContext';
import { useToastContext } from '../contexts/ToastContext';
import { useLang } from '../contexts/LangContext';

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

  useEffect(() => {
    if (!isOpen) return;
    const cfg = session.getPersistedConfig();
    if (cfg.backendUrl) setBackendUrl(cfg.backendUrl);
    if (cfg.apiKey) setApiKey(cfg.apiKey);
    if (cfg.streamKey) setStreamKey(cfg.streamKey);
    setAutoConnect(session.getAutoConnect());
    try { setTheme(localStorage.getItem('lcyt-theme') || 'auto'); } catch {}
    setError('');
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
