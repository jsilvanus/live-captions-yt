import { useState, useEffect, useRef, useCallback } from 'react';
import { MonarchHDX } from '@jsilvanus/matrox-monarch-control';
import { useEscapeKey } from '../hooks/useEscapeKey';
import {
  requestYouTubeToken, getYouTubeToken, revokeYouTubeToken,
} from '../lib/youtubeAuth';
import {
  listScheduledBroadcasts, transitionBroadcast, enableHttpCaptions,
} from '../lib/youtubeApi';
import { useToastContext } from '../contexts/ToastContext';
import { broadcastKey } from '../lib/storageKeys.js';
import { useSessionContext } from '../contexts/SessionContext';
import {
  setSlotTargetType,
  setSlotYoutubeKey, setSlotGenericUrl, setSlotGenericName,
  setSlotCaptionMode, setSlotScale, setSlotFps, setSlotVideoBitrate, setSlotAudioBitrate,
  clearSlot,
  MAX_RELAY_SLOTS,
  buildInitialRelayList,
} from '../lib/relayConfig.js';

// ── Encoder types ──────────────────────────────────────────────────────────

const ENCODER_TYPES = [
  { id: 'matrox-monarch-hdx', label: 'Matrox Monarch HDx' },
];

function loadEncoderPref(key, fallback = '') {
  try { return localStorage.getItem(broadcastKey(key)) || fallback; } catch { return fallback; }
}
function saveEncoderPref(key, val) {
  try { localStorage.setItem(broadcastKey(key), val); } catch {}
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

// ── Stream Tab (RTMP relay config) ─────────────────────────────────────────

function RelayRow({ entry, onChange, onRemove }) {
  const [showAdvanced, setShowAdvanced] = useState(
    Boolean(entry.scale || entry.fps != null || entry.videoBitrate || entry.audioBitrate || entry.captionMode === 'cea708')
  );
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
          <option value="generic">Generic</option>
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
            placeholder="rtmp://ingest.example.com/live/my-stream-key"
            autoComplete="off"
            value={entry.genericUrl || ''}
            onChange={e => onChange({ ...entry, genericUrl: e.target.value })}
            style={{ flex: 1 }}
          />
        )}
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          onClick={() => setShowAdvanced(v => !v)}
          title="Advanced"
          style={{ flexShrink: 0, fontSize: '0.75em' }}
        >⚙</button>
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          onClick={onRemove}
          title="Remove"
          style={{ flexShrink: 0 }}
        >✕</button>
      </div>
      {entry.targetType === 'youtube' && (entry.youtubeKey || '').trim() && (
        <span className="settings-field__hint">
          → rtmp://a.rtmp.youtube.com/live2/{(entry.youtubeKey || '').trim()}
        </span>
      )}
      {showAdvanced && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 10px', borderTop: '1px solid var(--color-border)', paddingTop: 6, marginTop: 2 }}>
          <div style={{ gridColumn: '1 / -1' }}>
            <label className="settings-field__label" style={{ fontSize: '0.8em', marginBottom: 2 }}>Caption mode</label>
            <select
              className="settings-field__input"
              value={entry.captionMode || 'http'}
              onChange={e => onChange({ ...entry, captionMode: e.target.value })}
              style={{ width: '100%' }}
            >
              <option value="http">HTTP POST</option>
              <option value="cea708">CEA-708 (embed in stream)</option>
            </select>
          </div>
          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.8em', marginBottom: 2 }}>
              <input type="checkbox" checked={!entry.scale}
                onChange={e => { if (e.target.checked) onChange({ ...entry, scale: '' }); }} />
              Use original — Resolution
            </label>
            <input className="settings-field__input" type="text" placeholder="e.g. 1280x720"
              value={entry.scale || ''}
              onChange={e => onChange({ ...entry, scale: e.target.value })}
              style={!entry.scale ? { opacity: 0.55 } : {}} />
          </div>
          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.8em', marginBottom: 2 }}>
              <input type="checkbox" checked={entry.fps == null}
                onChange={e => { if (e.target.checked) onChange({ ...entry, fps: null }); }} />
              Use original — Frame rate
            </label>
            <input className="settings-field__input" type="number" min="1" max="120" placeholder="e.g. 30"
              value={entry.fps ?? ''}
              onChange={e => { const v = parseInt(e.target.value, 10); onChange({ ...entry, fps: Number.isFinite(v) ? v : null }); }}
              style={entry.fps == null ? { opacity: 0.55 } : {}} />
          </div>
          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.8em', marginBottom: 2 }}>
              <input type="checkbox" checked={!entry.videoBitrate}
                onChange={e => { if (e.target.checked) onChange({ ...entry, videoBitrate: '' }); }} />
              Use original — Video bitrate
            </label>
            <input className="settings-field__input" type="text" placeholder="e.g. 2500k"
              value={entry.videoBitrate || ''}
              onChange={e => onChange({ ...entry, videoBitrate: e.target.value })}
              style={!entry.videoBitrate ? { opacity: 0.55 } : {}} />
          </div>
          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.8em', marginBottom: 2 }}>
              <input type="checkbox" checked={!entry.audioBitrate}
                onChange={e => { if (e.target.checked) onChange({ ...entry, audioBitrate: '' }); }} />
              Use original — Audio bitrate
            </label>
            <input className="settings-field__input" type="text" placeholder="e.g. 128k"
              value={entry.audioBitrate || ''}
              onChange={e => onChange({ ...entry, audioBitrate: e.target.value })}
              style={!entry.audioBitrate ? { opacity: 0.55 } : {}} />
          </div>
        </div>
      )}
    </div>
  );
}

function RtmpUrlField({ label, hint, url }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };
  return (
    <div className="settings-field">
      <label className="settings-field__label">{label}</label>
      {hint && <span className="settings-field__hint">{hint}</span>}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input className="settings-field__input" readOnly value={url}
          style={{ flex: 1, fontSize: '0.82em', fontFamily: 'monospace' }}
          onClick={e => e.target.select()} />
        <button className="btn btn--secondary btn--sm" onClick={copy} title="Copy URL">
          {copied ? '✓' : '⎘'}
        </button>
      </div>
    </div>
  );
}

function StreamTab() {
  const session = useSessionContext();
  const { showToast } = useToastContext();

  const [relayList, setRelayList] = useState(buildInitialRelayList);
  const [relayStatus, setRelayStatus] = useState(null);
  const [relayActive, setRelayActiveState] = useState(false);
  const [relayError, setRelayError] = useState('');
  const [rtmpIngest, setRtmpIngest] = useState(null);

  // Fetch RTMP ingest info from health endpoint
  useEffect(() => {
    const url = session.backendUrl;
    if (!url) return;
    fetch(`${url}/health`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.rtmpIngest) setRtmpIngest(data.rtmpIngest); })
      .catch(() => {});
  }, [session.backendUrl]);

  function refreshStatus() {
    if (!session.connected) { setRelayStatus(null); return; }
    session.getRelayStatus()
      .then(s => { setRelayStatus(s); setRelayActiveState(!!s.active); })
      .catch(() => setRelayStatus(null));
  }

  useEffect(() => { refreshStatus(); }, [session.connected]); // eslint-disable-line react-hooks/exhaustive-deps

  function addRelay() {
    const usedSlots = relayList.map(r => r.slot);
    for (let s = 1; s <= MAX_RELAY_SLOTS; s++) {
      if (!usedSlots.includes(s)) {
        setRelayList(prev => [...prev, { slot: s, targetType: 'youtube', youtubeKey: '', genericUrl: '', genericName: '', captionMode: 'http', scale: '', fps: null, videoBitrate: '', audioBitrate: '' }]);
        return;
      }
    }
  }

  function updateRelayItem(slot, updated) {
    if ('targetType'   in updated) setSlotTargetType(slot, updated.targetType);
    if ('youtubeKey'   in updated) setSlotYoutubeKey(slot, updated.youtubeKey);
    if ('genericUrl'   in updated) setSlotGenericUrl(slot, updated.genericUrl);
    if ('genericName'  in updated) setSlotGenericName(slot, updated.genericName);
    if ('captionMode'  in updated) setSlotCaptionMode(slot, updated.captionMode);
    if ('scale'        in updated) setSlotScale(slot, updated.scale ?? '');
    if ('fps'          in updated) setSlotFps(slot, updated.fps ?? null);
    if ('videoBitrate' in updated) setSlotVideoBitrate(slot, updated.videoBitrate ?? '');
    if ('audioBitrate' in updated) setSlotAudioBitrate(slot, updated.audioBitrate ?? '');
    setRelayList(prev => prev.map(r => r.slot === slot ? { ...r, ...updated } : r));
  }

  function removeRelay(slot) {
    clearSlot(slot);
    setRelayList(prev => prev.filter(r => r.slot !== slot));
  }

  async function handleRelayActive(active) {
    try {
      setRelayError('');
      await session.setRelayActive(active);
      setRelayActiveState(active);
      refreshStatus();
    } catch (err) {
      const msg = err.message || 'Failed to toggle relay';
      setRelayError(msg);
      showToast(msg, 'error');
    }
  }

  const runningSlots = relayStatus?.runningSlots ?? [];
  const backendUrl = session.backendUrl;
  const apiKey = session.apiKey;

  // Compute DSK RTMP URL
  const dskUrl = (() => {
    try {
      if (!backendUrl || !apiKey) return null;
      const host = new URL(backendUrl).hostname;
      return `rtmp://${host}/dsk/${encodeURIComponent(apiKey)}`;
    } catch { return null; }
  })();

  // Compute input RTMP ingest URL
  const ingestUrl = rtmpIngest && apiKey
    ? `rtmp://${rtmpIngest.host}/${rtmpIngest.app}/${apiKey}`
    : null;

  return (
    <div className="settings-panel settings-panel--active broadcast-tab">
      {!session.connected && (
        <div className="settings-field">
          <span className="settings-field__hint" style={{ color: 'var(--color-text-dim)' }}>
            Connect to the backend first to manage the RTMP relay.
          </span>
        </div>
      )}

      <div className="settings-field">
        <span className="settings-field__hint">
          The RTMP relay receives your stream and fans it out to all configured targets with embedded captions.
        </span>
      </div>

      {/* Input RTMP stream address */}
      {ingestUrl && (
        <RtmpUrlField
          label="RTMP ingest address"
          hint="Point your streaming software (OBS, vMix, etc.) here. Use your API key as the stream name."
          url={ingestUrl}
        />
      )}

      {/* Relay targets */}
      <div className="settings-field">
        <label className="settings-field__label">RTMP relay targets</label>
        {relayList.length === 0 && (
          <span className="settings-field__hint">No relay targets configured. Click &quot;+ Add relay target&quot; to add one.</span>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {relayList.map(entry => (
            <RelayRow
              key={entry.slot}
              entry={entry}
              onChange={updated => updateRelayItem(entry.slot, updated)}
              onRemove={() => removeRelay(entry.slot)}
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
            + Add relay target
          </button>
        )}
      </div>

      {/* Relay active toggle */}
      {session.connected && (
        <div className="settings-field">
          <label className="settings-field__label">Relay status</label>
          <label className="settings-checkbox">
            <input
              type="checkbox"
              checked={relayActive}
              onChange={e => handleRelayActive(e.target.checked)}
            />
            {relayActive ? 'Active — will fan-out when stream arrives' : 'Inactive — incoming stream accepted but not relayed'}
          </label>
        </div>
      )}

      {/* Running slot status */}
      {relayStatus && relayStatus.relays?.length > 0 && (
        <div className="settings-field">
          <label className="settings-field__label">Running slots</label>
          {relayStatus.relays.map(r => (
            <div key={r.slot} style={{ fontSize: '0.85em', marginBottom: '0.25rem' }}>
              {runningSlots.includes(r.slot) ? '🔴 Live' : '⚫ Inactive'}
              {' — '}{r.targetUrl}{r.targetName ? `/${r.targetName}` : ''}
            </div>
          ))}
        </div>
      )}

      {relayError && <div className="settings-error">{relayError}</div>}

      {/* DSK RTMP ingest URL */}
      {dskUrl && (
        <RtmpUrlField
          label="DSK RTMP ingest URL"
          hint="Push a DSK graphics stream from OBS to this address. It will be overlaid on the relay in real time."
          url={dskUrl}
        />
      )}
    </div>
  );
}

// ── YouTube Tab ────────────────────────────────────────────────────────────

function YouTubeTab() {
  const { showToast } = useToastContext();
  const session = useSessionContext();
  const [clientId, setClientId] = useState('');
  const [clientIdLoading, setClientIdLoading] = useState(false);
  const [token, setToken] = useState(getYouTubeToken);
  const [loggingIn, setLoggingIn] = useState(false);
  const [broadcasts, setBroadcasts] = useState([]);
  const [loadingBroadcasts, setLoadingBroadcasts] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [ytBusy, setYtBusy] = useState(false);
  const [captionsBusy, setCaptionsBusy] = useState(false);

  // Fetch the OAuth client ID from the backend when connected
  useEffect(() => {
    if (!session.connected) return;
    setClientIdLoading(true);
    session.getYouTubeConfig()
      .then(cfg => setClientId(cfg.clientId))
      .catch(err => showToast(`YouTube not configured on server: ${err.message}`, 'error'))
      .finally(() => setClientIdLoading(false));
  }, [session.connected]); // eslint-disable-line react-hooks/exhaustive-deps

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
      const tok = await requestYouTubeToken(clientId);
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
      {!session.connected && (
        <p className="broadcast-hint">Connect to the backend first to use YouTube features.</p>
      )}

      {/* Auth row */}
      {!token ? (
        <button
          className="btn btn--primary broadcast-google-btn"
          onClick={handleSignIn}
          disabled={loggingIn || !clientId || clientIdLoading || !session.connected}
        >
          {clientIdLoading ? 'Loading…' : loggingIn ? 'Signing in…' : 'Sign in with Google'}
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <label className="settings-field__label" style={{ margin: 0 }}>Scheduled stream</label>
              <button
                className="btn btn--secondary btn--sm"
                onClick={() => fetchBroadcasts(token)}
                disabled={loadingBroadcasts}
                title="Refresh scheduled streams list"
              >
                {loadingBroadcasts ? '…' : '↻ Refresh'}
              </button>
            </div>
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

const TABS = ['encoder', 'youtube', 'stream'];
const TAB_LABELS = { encoder: 'Encoder', youtube: 'YouTube', stream: 'Stream' };

export function BroadcastModal({ isOpen, onClose, inline }) {
  const [activeTab, setActiveTab] = useState('encoder');

  useEscapeKey(onClose, isOpen && !inline);

  if (!isOpen && !inline) return null;

  const box = (
    <div
      className="settings-modal__box broadcast-modal__box"
      style={inline ? { position: 'static', maxWidth: '100%', maxHeight: '100%', height: '100%', borderRadius: 0, border: 'none', boxShadow: 'none' } : {}}
    >
      <div className="settings-modal__header">
        <span className="settings-modal__title">Broadcast</span>
        {!inline && <button className="settings-modal__close" onClick={onClose} aria-label="Close">✕</button>}
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
        {activeTab === 'stream' && <StreamTab />}
      </div>
    </div>
  );

  if (inline) return box;

  return (
    <div className="settings-modal broadcast-modal" role="dialog" aria-modal="true" aria-label="Broadcast">
      <div className="settings-modal__backdrop" onClick={onClose} />
      {box}
    </div>
  );
}
