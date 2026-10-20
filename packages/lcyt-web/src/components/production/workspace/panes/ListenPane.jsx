import { useEffect, useState } from 'react';
import { C } from '../theme.js';
import { useAudioContext } from '../../../../contexts/AudioContext';
import { useLang } from '../../../../contexts/LangContext';
import { useSourceLanguages } from '../../../../hooks/useSourceLanguages.js';
import { COMMON_LANGUAGES, getSttEngine, getSttLang, getSttSpeechMode, setSttLang, subscribeSttConfig } from '../../../../lib/sttConfig.js';
import { KEYS } from '../../../../lib/storageKeys.js';
import { requestMicWindow } from '../../../../lib/micWindow.js';

const BLUE = '#1a6fd4';
const RED = '#cc0022';

function readStt() {
  return { engine: getSttEngine(), lang: getSttLang(), mode: getSttSpeechMode() };
}

function readDeviceId() {
  try { return localStorage.getItem(KEYS.audio.deviceId) || ''; } catch { return ''; }
}

/** Audio input devices for the browser engines; refreshed when permission or hardware changes. */
function useAudioInputs() {
  const [devices, setDevices] = useState([]);
  useEffect(() => {
    const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : null;
    if (!md?.enumerateDevices) return undefined;
    let alive = true;
    const load = () => md.enumerateDevices()
      .then((list) => { if (alive) setDevices(list.filter((d) => d.kind === 'audioinput')); })
      .catch(() => {});
    load();
    md.addEventListener?.('devicechange', load);
    return () => { alive = false; md.removeEventListener?.('devicechange', load); };
  }, []);
  return devices;
}

/**
 * Listen pane: start/stop of whichever STT the STT card selects (browser or server), a quick
 * recognition-language switcher, and the audio input for the browser engines. The engine itself
 * is the hidden AudioPanel; this is a second control for it, like the top-bar mic.
 */
export function ListenPane() {
  const { t } = useLang();
  const { listening, toggle, interimText } = useAudioContext();
  const { sourceLanguages } = useSourceLanguages();
  const devices = useAudioInputs();
  const [stt, setStt] = useState(readStt);
  const [deviceId, setDeviceId] = useState(readDeviceId);

  useEffect(() => subscribeSttConfig(() => { setStt(readStt()); setDeviceId(readDeviceId()); }), []);

  const langs = sourceLanguages.length > 0
    ? sourceLanguages.map((l) => ({ code: l.lang, label: l.label || l.lang }))
    : COMMON_LANGUAGES;
  const options = langs.some((l) => l.code === stt.lang) ? langs : [{ code: stt.lang, label: stt.lang }, ...langs];

  function changeDevice(id) {
    setDeviceId(id);
    try { localStorage.setItem(KEYS.audio.deviceId, id); } catch { /* ignore */ }
    window.dispatchEvent(new Event('lcyt:stt-config-changed'));
  }

  const isServer = stt.engine === 'server';
  const how = isServer
    ? t('topMic.server')
    : `${t('topMic.browser')}${stt.engine === 'webkit' ? `, ${stt.mode === 'local' ? t('topMic.local') : t('topMic.cloud')}` : ''}`;
  const field = { background: C.inputBg, border: `1px solid ${C.inputBorder}`, borderRadius: 6, padding: '5px 8px', fontSize: '.7rem', color: '#ddd', width: '100%' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 9, height: '100%', overflow: 'auto' }}>
      <button
        type="button"
        onClick={toggle}
        aria-pressed={listening}
        style={{ padding: '12px', borderRadius: 8, background: listening ? RED : BLUE, color: '#fff', fontSize: '.8rem', fontWeight: 700, border: 'none' }}
      >
        {listening ? t('listenPane.stop') : t('listenPane.start')}
      </button>
      <div style={{ fontSize: '.62rem', color: C.textMuted }}>{how}</div>
      <button type="button" onClick={() => requestMicWindow('toggle')}
        style={{ padding: '6px', borderRadius: 6, background: C.btnBg, border: `1px solid ${C.panelBorder}`, color: '#dcdcdc', fontSize: '.68rem', fontWeight: 600 }}>
        {t('micWindow.open')}
      </button>

      <label style={{ fontSize: '.62rem', color: C.textMuted }}>
        {t('listenPane.language')}
        <select value={stt.lang} onChange={(e) => setSttLang(e.target.value)} style={field} aria-label={t('listenPane.language')}>
          {options.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
        </select>
      </label>

      <label style={{ fontSize: '.62rem', color: C.textMuted }}>
        {t('listenPane.audioFrom')}
        {isServer ? (
          <div style={{ ...field, color: C.textMuted }}>{t('listenPane.serverSource')}</div>
        ) : (
          <select value={deviceId} onChange={(e) => changeDevice(e.target.value)} style={field} aria-label={t('listenPane.audioFrom')}>
            <option value="">{t('listenPane.defaultInput')}</option>
            {devices.map((d, i) => <option key={d.deviceId || i} value={d.deviceId}>{d.label || `${t('listenPane.input')} ${i + 1}`}</option>)}
          </select>
        )}
      </label>
      {stt.engine === 'webkit' && <div style={{ fontSize: '.58rem', color: C.textMuted }}>{t('listenPane.webkitNote')}</div>}

      {interimText && <div style={{ fontSize: '.72rem', color: '#d0d0d0', fontStyle: 'italic' }}>{interimText}</div>}
    </div>
  );
}

/** Compact blue/red Listen toggle for other panes' headers (e.g. Sent Captions). */
export function ListenButton() {
  const { t } = useLang();
  const { listening, toggle } = useAudioContext();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={listening}
      title={listening ? t('listenPane.stop') : t('listenPane.start')}
      style={{ fontSize: '.56rem', fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', padding: '3px 8px', borderRadius: 5, border: 'none', color: '#fff', background: listening ? RED : BLUE }}
    >
      {listening ? t('listenPane.short.stop') : t('listenPane.short.start')}
    </button>
  );
}
