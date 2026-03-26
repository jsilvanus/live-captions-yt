import { useState, useEffect, useRef, useCallback } from 'react';
import { MonarchHDX } from '@jsilvanus/matrox-monarch-control';
import { useToastContext } from '../../contexts/ToastContext';
import { broadcastKey } from '../../lib/storageKeys.js';

const ENCODER_TYPES = [
  { id: 'matrox-monarch-hdx', label: 'Matrox Monarch HDx' },
];

function loadEncoderPref(key, fallback = '') {
  try { return localStorage.getItem(broadcastKey(key)) || fallback; } catch { return fallback; }
}
function saveEncoderPref(key, val) {
  try { localStorage.setItem(broadcastKey(key), val); } catch {}
}

export function EncoderTab() {
  const { showToast } = useToastContext();
  const [encoderType] = useState('matrox-monarch-hdx');
  const [ip, setIp] = useState(() => loadEncoderPref('ip'));
  const [rtmpUrl, setRtmpUrl] = useState(() => loadEncoderPref('rtmpUrl'));
  const [rtmpName, setRtmpName] = useState(() => loadEncoderPref('rtmpName', 'live'));
  const [status, setStatus] = useState(null);
  const [statusErr, setStatusErr] = useState('');
  const [busy, setBusy] = useState(false);

  const controllerRef = useRef(null);

  const getController = useCallback(() => {
    if (!ip) throw new Error('Enter the encoder IP address first');
    controllerRef.current = new MonarchHDX({ host: ip });
    return controllerRef.current;
  }, [ip]);

  useEffect(() => {
    if (!ip) { setStatus(null); setStatusErr(''); return; }
    let cancelled = false;

    async function fetchStatus() {
      try {
        const ctrl = new MonarchHDX({ host: ip, timeout: 4000 });
        const s = await ctrl.getStatus();
        if (!cancelled) { setStatus(s); setStatusErr(''); }
      } catch (err) {
        if (!cancelled) { setStatus(null); setStatusErr(err.message); }
      }
    }

    fetchStatus();
    const id = setInterval(fetchStatus, 8000);
    return () => { cancelled = true; clearInterval(id); };
  }, [ip]);

  async function handleStart() {
    setBusy(true);
    try {
      const ctrl = getController();
      const [url, ...rest] = rtmpUrl.split('/');
      const streamName = rtmpName || rest.join('/') || 'live';
      await ctrl.setEncoderRTMP(1, { url: rtmpUrl, streamName });
      await ctrl.startEncoder(1);
      showToast('Encoder 1 started', 'success');
      setStatus(await ctrl.getStatus());
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleStop() {
    setBusy(true);
    try {
      const ctrl = getController();
      await ctrl.stopEncoder(1);
      showToast('Encoder 1 stopped', 'success');
      setStatus(await ctrl.getStatus());
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const enc1State = status?.encoder1?.state;
  const isEncoding = enc1State === 'ON';

  return (
    <div className="settings-panel settings-panel--active broadcast-tab">
      <div className="settings-field">
        <label className="settings-field__label">Encoder</label>
        <select className="settings-field__input" value={encoderType} disabled>
          {ENCODER_TYPES.map(e => (
            <option key={e.id} value={e.id}>{e.label}</option>
          ))}
        </select>
      </div>

      <div className="settings-field">
        <label className="settings-field__label">Encoder IP address</label>
        <input
          className="settings-field__input"
          type="text"
          placeholder="192.168.1.100"
          value={ip}
          onChange={e => { setIp(e.target.value); saveEncoderPref('ip', e.target.value); }}
        />
      </div>

      <div className="broadcast-status-row">
        <span
          className={[
            'broadcast-status-dot',
            isEncoding ? 'broadcast-status-dot--encoding' :
            statusErr   ? 'broadcast-status-dot--error'    :
                          'broadcast-status-dot--idle',
          ].join(' ')}
        />
        <span className="broadcast-status-label">
          {statusErr ? `Unreachable: ${statusErr}` :
           !status   ? (ip ? 'Connecting…' : 'Enter IP to connect') :
           isEncoding ? `Encoder 1: streaming (${status?.encoder1?.mode || ''})` :
                        `Encoder 1: idle (${enc1State || 'READY'})`}
        </span>
      </div>

      <div className="settings-field">
        <label className="settings-field__label">RTMP target URL (Encoder 1)</label>
        <input
          className="settings-field__input"
          type="text"
          placeholder="rtmp://a.rtmp.youtube.com/live2"
          value={rtmpUrl}
          onChange={e => { setRtmpUrl(e.target.value); saveEncoderPref('rtmpUrl', e.target.value); }}
        />
      </div>

      <div className="settings-field">
        <label className="settings-field__label">Stream name / key</label>
        <input
          className="settings-field__input"
          type="text"
          placeholder="xxxx-xxxx-xxxx-xxxx"
          value={rtmpName}
          onChange={e => { setRtmpName(e.target.value); saveEncoderPref('rtmpName', e.target.value); }}
        />
      </div>

      <div className="broadcast-actions">
        <button
          className="btn btn--primary"
          onClick={handleStart}
          disabled={busy || !ip || !rtmpUrl || isEncoding}
        >
          {busy && !isEncoding ? 'Starting…' : 'Start Encoder 1'}
        </button>
        <button
          className="btn btn--danger"
          onClick={handleStop}
          disabled={busy || !ip || !isEncoding}
        >
          {busy && isEncoding ? 'Stopping…' : 'Stop Encoder 1'}
        </button>
      </div>

      <p className="broadcast-hint">
        The Matrox Monarch HDx HTTP API must be reachable from this browser.
        If you see CORS errors, access the app from the same network as the encoder.
      </p>
    </div>
  );
}
