import { useState, useEffect } from 'react';
import { useSessionContext } from '../../contexts/SessionContext';
import { useToastContext } from '../../contexts/ToastContext';
import { RelayPanel } from '../panels/RelayPanel.jsx';
import {
  setSlotTargetType,
  setSlotYoutubeKey, setSlotGenericUrl, setSlotGenericName,
  setSlotCaptionMode, setSlotScale, setSlotFps, setSlotVideoBitrate, setSlotAudioBitrate,
  clearSlot,
  buildInitialRelayList,
} from '../../lib/relayConfig.js';

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

export function StreamTab() {
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

  const backendUrl = session.backendUrl;
  const apiKey = session.apiKey;

  // Compute input RTMP ingest URL
  const ingestUrl = rtmpIngest && apiKey
    ? `rtmp://${rtmpIngest.host}/${rtmpIngest.app}/${apiKey}`
    : null;

  return (
    <div className="settings-panel settings-panel--active broadcast-tab">
      {/* Input RTMP stream address */}
      {ingestUrl && (
        <RtmpUrlField
          label="RTMP ingest address"
          hint="Point your streaming software (OBS, vMix, etc.) here. Use your API key as the stream name."
          url={ingestUrl}
        />
      )}

      <RelayPanel
        relayList={relayList}
        onRelayListChange={next => {
          const prevBySlot = Object.fromEntries(relayList.map(r => [r.slot, r]));
          next.forEach(r => {
            const prev = prevBySlot[r.slot];
            if (!prev || r.targetType   !== prev.targetType)   setSlotTargetType(r.slot, r.targetType);
            if (!prev || r.youtubeKey   !== prev.youtubeKey)   setSlotYoutubeKey(r.slot, r.youtubeKey);
            if (!prev || r.genericUrl   !== prev.genericUrl)   setSlotGenericUrl(r.slot, r.genericUrl);
            if (!prev || r.genericName  !== prev.genericName)  setSlotGenericName(r.slot, r.genericName);
            if (!prev || r.captionMode  !== prev.captionMode)  setSlotCaptionMode(r.slot, r.captionMode);
            if (!prev || r.scale        !== prev.scale)        setSlotScale(r.slot, r.scale ?? '');
            if (!prev || r.fps          !== prev.fps)          setSlotFps(r.slot, r.fps ?? null);
            if (!prev || r.videoBitrate !== prev.videoBitrate) setSlotVideoBitrate(r.slot, r.videoBitrate ?? '');
            if (!prev || r.audioBitrate !== prev.audioBitrate) setSlotAudioBitrate(r.slot, r.audioBitrate ?? '');
          });
          const newSlots = new Set(next.map(r => r.slot));
          relayList.filter(r => !newSlots.has(r.slot)).forEach(r => clearSlot(r.slot));
          setRelayList(next);
        }}
        relayStatus={relayStatus}
        relayError={relayError}
        connected={session.connected}
        backendUrl={backendUrl}
        apiKey={apiKey}
      />

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
    </div>
  );
}
