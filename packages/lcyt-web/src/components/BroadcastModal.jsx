import { useState, useEffect, useRef, useCallback } from 'react';
import { MonarchHDX } from '@jsilvanus/matrox-monarch-control';
import {
  getYtClientId, setYtClientId,
  requestYouTubeToken, getYouTubeToken, revokeYouTubeToken,
} from '../lib/youtubeAuth';
import {
  listScheduledBroadcasts, transitionBroadcast, enableHttpCaptions,
} from '../lib/youtubeApi';
import { useToastContext } from '../contexts/ToastContext';

// ── Encoder types ──────────────────────────────────────────────────────────

const ENCODER_TYPES = [
  { id: 'matrox-monarch-hdx', label: 'Matrox Monarch HDx' },
];

function loadEncoderPref(key, fallback = '') {
  try { return localStorage.getItem(`lcyt:broadcast:${key}`) || fallback; } catch { return fallback; }
}
function saveEncoderPref(key, val) {
  try { localStorage.setItem(`lcyt:broadcast:${key}`, val); } catch {}
}

// ── Encoder Tab ────────────────────────────────────────────────────────────

function EncoderTab() {
  const { showToast } = useToastContext();
  const [encoderType] = useState('matrox-monarch-hdx');
  const [ip, setIp] = useState(() => loadEncoderPref('ip'));
  const [rtmpUrl, setRtmpUrl] = useState(() => loadEncoderPref('rtmpUrl'));
  const [rtmpName, setRtmpName] = useState(() => loadEncoderPref('rtmpName', 'live'));
  const [status, setStatus] = useState(null); // null | HDXStatus object
  const [statusErr, setStatusErr] = useState('');
  const [busy, setBusy] = useState(false);

  const controllerRef = useRef(null);

  const getController = useCallback(() => {
    if (!ip) throw new Error('Enter the encoder IP address first');
    controllerRef.current = new MonarchHDX({ host: ip });
    return controllerRef.current;
  }, [ip]);

  // Poll status whenever IP is set
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
      {/* Encoder type */}
      <div className="settings-field">
        <label className="settings-field__label">Encoder</label>
        <select className="settings-field__input" value={encoderType} disabled>
          {ENCODER_TYPES.map(e => (
            <option key={e.id} value={e.id}>{e.label}</option>
          ))}
        </select>
      </div>

      {/* IP address */}
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

      {/* Status indicator */}
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

      {/* RTMP target */}
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

      {/* Start / Stop */}
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

// ── YouTube Tab ────────────────────────────────────────────────────────────

function YouTubeTab() {
  const { showToast } = useToastContext();
  const [clientId, setClientId] = useState(getYtClientId);
  const [token, setToken] = useState(getYouTubeToken);
  const [loggingIn, setLoggingIn] = useState(false);
  const [broadcasts, setBroadcasts] = useState([]);
  const [loadingBroadcasts, setLoadingBroadcasts] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [ytBusy, setYtBusy] = useState(false);
  const [captionsBusy, setCaptionsBusy] = useState(false);

  const selectedBroadcast = broadcasts.find(b => b.id === selectedId) || null;
  const broadcastStatus = selectedBroadcast?.status?.lifeCycleStatus || '';
  const isLive = broadcastStatus === 'live';
  const isComplete = broadcastStatus === 'complete';
  const httpCaptionsEnabled =
    selectedBroadcast?.contentDetails?.closedCaptionsType === 'closedCaptionsHttpPost';

  const fetchBroadcasts = useCallback(async (tok) => {
    setLoadingBroadcasts(true);
    try {
      const items = await listScheduledBroadcasts(tok);
      setBroadcasts(items);
      if (items.length > 0) setSelectedId(items[0].id);
    } catch (err) {
      showToast(`Could not load broadcasts: ${err.message}`, 'error');
      setBroadcasts([]);
    } finally {
      setLoadingBroadcasts(false);
    }
  }, [showToast]);

  async function handleSignIn() {
    setLoggingIn(true);
    try {
      const tok = await requestYouTubeToken();
      setToken(tok);
      await fetchBroadcasts(tok);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoggingIn(false);
    }
  }

  function handleSignOut() {
    revokeYouTubeToken();
    setToken(null);
    setBroadcasts([]);
    setSelectedId('');
  }

  async function handleTransition(targetStatus) {
    if (!token || !selectedId) return;
    setYtBusy(true);
    try {
      await transitionBroadcast(token, selectedId, targetStatus);
      showToast(
        targetStatus === 'live' ? 'Stream is now live!' : 'Stream ended.',
        targetStatus === 'live' ? 'success' : 'info',
      );
      await fetchBroadcasts(token);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setYtBusy(false);
    }
  }

  async function handleEnableHttpCaptions() {
    if (!token || !selectedBroadcast) return;
    setCaptionsBusy(true);
    try {
      await enableHttpCaptions(token, selectedBroadcast);
      showToast(
        'HTTP captions enabled. YouTube requires a ~30 s caption delay for live streams — this is now configured.',
        'success',
      );
      await fetchBroadcasts(token);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setCaptionsBusy(false);
    }
  }

  const thumb = selectedBroadcast?.snippet?.thumbnails?.medium?.url
    || selectedBroadcast?.snippet?.thumbnails?.default?.url
    || null;
  const channelId = selectedBroadcast?.snippet?.channelId;
  const scheduledStart = selectedBroadcast?.snippet?.scheduledStartTime;

  return (
    <div className="settings-panel settings-panel--active broadcast-tab">
      {/* Client ID config */}
      <div className="settings-field">
        <label className="settings-field__label">
          Google OAuth Client ID
          <span className="broadcast-hint-inline"> — create in Google Cloud Console → APIs &amp; Services → Credentials</span>
        </label>
        <input
          className="settings-field__input"
          type="text"
          placeholder="xxxxxxxxxx-xxxx.apps.googleusercontent.com"
          value={clientId}
          onChange={e => { setClientId(e.target.value); setYtClientId(e.target.value); }}
          disabled={!!token}
        />
      </div>

      {/* Auth row */}
      {!token ? (
        <button
          className="btn btn--primary broadcast-google-btn"
          onClick={handleSignIn}
          disabled={loggingIn || !clientId}
        >
          {loggingIn ? 'Signing in…' : 'Sign in with Google'}
        </button>
      ) : (
        <div className="broadcast-signed-in-row">
          <span className="broadcast-signed-in-label">Signed in</span>
          <button className="btn btn--secondary btn--sm" onClick={handleSignOut}>Sign out</button>
        </div>
      )}

      {token && (
        <>
          {/* Broadcast selector */}
          <div className="settings-field">
            <label className="settings-field__label">Scheduled stream</label>
            {loadingBroadcasts ? (
              <p className="broadcast-hint">Loading broadcasts…</p>
            ) : broadcasts.length === 0 ? (
              <p className="broadcast-hint">No upcoming scheduled streams found.</p>
            ) : (
              <select
                className="settings-field__input"
                value={selectedId}
                onChange={e => setSelectedId(e.target.value)}
              >
                {broadcasts.map(b => (
                  <option key={b.id} value={b.id}>
                    {b.snippet?.title || b.id}
                    {b.snippet?.scheduledStartTime
                      ? ` — ${new Date(b.snippet.scheduledStartTime).toLocaleString()}`
                      : ''}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Preview */}
          {selectedBroadcast && (
            <div className="broadcast-preview">
              {thumb && (
                <a
                  href={`https://www.youtube.com/watch?v=${selectedBroadcast.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <img className="yt-thumb" src={thumb} alt="Stream preview" />
                </a>
              )}
              <div className="broadcast-preview-meta">
                <span className="broadcast-preview-title">{selectedBroadcast.snippet?.title}</span>
                {scheduledStart && (
                  <span className="broadcast-preview-time">
                    Scheduled: {new Date(scheduledStart).toLocaleString()}
                  </span>
                )}
                <span className={`broadcast-preview-status broadcast-preview-status--${broadcastStatus}`}>
                  {broadcastStatus || 'unknown'}
                </span>
              </div>
            </div>
          )}

          {/* Go Live / End Stream */}
          {selectedBroadcast && (
            <div className="broadcast-actions">
              <button
                className="btn btn--primary"
                onClick={() => handleTransition('live')}
                disabled={ytBusy || isLive || isComplete}
                title={isComplete ? 'Stream has ended' : isLive ? 'Already live' : 'Go live'}
              >
                {ytBusy && !isLive ? 'Going live…' : 'Go Live'}
              </button>
              <button
                className="btn btn--danger"
                onClick={() => handleTransition('complete')}
                disabled={ytBusy || !isLive || isComplete}
                title={!isLive ? 'Stream is not live' : 'End the stream'}
              >
                {ytBusy && isLive ? 'Ending…' : 'End Stream'}
              </button>
            </div>
          )}

          {/* HTTP captions */}
          {selectedBroadcast && (
            <div className="broadcast-captions-section">
              <div className="broadcast-captions-status">
                HTTP captions:{' '}
                <strong className={httpCaptionsEnabled ? 'broadcast-captions-on' : 'broadcast-captions-off'}>
                  {httpCaptionsEnabled ? 'enabled' : 'disabled'}
                </strong>
              </div>
              {!httpCaptionsEnabled && (
                <>
                  <button
                    className="btn btn--secondary"
                    onClick={handleEnableHttpCaptions}
                    disabled={captionsBusy}
                  >
                    {captionsBusy ? 'Enabling…' : 'Enable HTTP Captions (30 s delay)'}
                  </button>
                  <p className="broadcast-hint">
                    Enables HTTP POST caption ingestion on this broadcast. YouTube uses a ~30-second
                    caption delay to align captions with stream latency — this is a YouTube requirement
                    and is handled automatically when you enable HTTP captions.
                  </p>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── BroadcastModal ─────────────────────────────────────────────────────────

const TABS = ['encoder', 'youtube'];
const TAB_LABELS = { encoder: 'Encoder', youtube: 'YouTube' };

export function BroadcastModal({ isOpen, onClose }) {
  const [activeTab, setActiveTab] = useState('encoder');

  useEffect(() => {
    if (!isOpen) return;
    function onKeyDown(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="settings-modal broadcast-modal" role="dialog" aria-modal="true" aria-label="Broadcast">
      <div className="settings-modal__backdrop" onClick={onClose} />
      <div className="settings-modal__box broadcast-modal__box">
        <div className="settings-modal__header">
          <span className="settings-modal__title">Broadcast</span>
          <button className="settings-modal__close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="settings-modal__tabs">
          {TABS.map(tab => (
            <button
              key={tab}
              className={`settings-tab${activeTab === tab ? ' settings-tab--active' : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              {TAB_LABELS[tab]}
            </button>
          ))}
        </div>

        <div className="settings-modal__body">
          {activeTab === 'encoder' && <EncoderTab />}
          {activeTab === 'youtube' && <YouTubeTab />}
        </div>
      </div>
    </div>
  );
}
