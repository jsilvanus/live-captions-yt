import { useState, useEffect, useRef, useCallback } from 'react';

const STUN_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

const CANVAS_W = 1280;
const CANVAS_H = 720;
const THUMB_INTERVAL_MS = 5000;

// Extract mixer ID from path: /production/lcyt-mixer/:mixerId
function getMixerIdFromPath() {
  const parts = window.location.pathname.split('/');
  return parts[3] ?? null;
}

function getBackendUrl() {
  return localStorage.getItem('lcyt_backend_url') ?? '';
}

export function LcytMixerPage() {
  const mixerId    = getMixerIdFromPath();
  const backendUrl = getBackendUrl();

  const [mixerInfo, setMixerInfo]       = useState(null);
  const [sources, setSources]           = useState([]);
  const [activeIdx, setActiveIdx]       = useState(0);
  const [audioMode, setAudioMode]       = useState('follow'); // 'follow' | 'fixed'
  const [fixedAudioIdx, setFixedAudioIdx] = useState(0);
  const [outputState, setOutputState]   = useState('idle'); // idle | connecting | live | stopping
  const [thumbUrls, setThumbUrls]       = useState({}); // cameraId → data URL
  const [error, setError]               = useState(null);

  const canvasRef      = useRef(null);
  const videoRefs      = useRef({}); // cameraId → <video> element
  const hlsRefs        = useRef({}); // cameraId → Hls instance (active source only)
  const pcRef          = useRef(null);
  const audioCtxRef    = useRef(null);
  const gainNodesRef   = useRef({}); // cameraId → GainNode
  const audioDestRef   = useRef(null);
  const rafRef         = useRef(null);
  const thumbTimersRef = useRef({}); // cameraId → interval id

  // ---------------------------------------------------------------------------
  // Load mixer info and sources
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!mixerId || !backendUrl) {
      setError(!mixerId ? 'No mixer ID in URL' : 'Backend URL not configured — open Settings first');
      return;
    }

    Promise.all([
      fetch(`${backendUrl}/production/mixers/${mixerId}/sources`).then(r => r.ok ? r.json() : r.json().then(j => Promise.reject(j.error))),
      fetch(`${backendUrl}/production/mixers/${mixerId}/whip-url`).then(r => r.ok ? r.json() : r.json().then(j => Promise.reject(j.error))),
    ])
      .then(([srcs, whipInfo]) => {
        setSources(srcs);
        setMixerInfo(whipInfo);
      })
      .catch(err => setError(String(err)));
  }, [mixerId, backendUrl]);

  // ---------------------------------------------------------------------------
  // Thumbnail polling
  // ---------------------------------------------------------------------------
  useEffect(() => {
    // Clear old timers
    Object.values(thumbTimersRef.current).forEach(t => clearInterval(t));
    thumbTimersRef.current = {};

    for (const src of sources) {
      if (!src.thumbUrl) continue;
      const fetchThumb = () => {
        fetch(`${backendUrl}${new URL(src.thumbUrl).pathname}?_t=${Date.now()}`)
          .then(r => r.ok ? r.blob() : null)
          .then(blob => {
            if (!blob) return;
            const url = URL.createObjectURL(blob);
            setThumbUrls(prev => {
              if (prev[src.cameraId]) URL.revokeObjectURL(prev[src.cameraId]);
              return { ...prev, [src.cameraId]: url };
            });
          })
          .catch(() => {});
      };
      fetchThumb();
      thumbTimersRef.current[src.cameraId] = setInterval(fetchThumb, THUMB_INTERVAL_MS);
    }

    return () => {
      Object.values(thumbTimersRef.current).forEach(t => clearInterval(t));
    };
  }, [sources, backendUrl]);

  // ---------------------------------------------------------------------------
  // HLS loading for active source
  // ---------------------------------------------------------------------------
  const loadHlsForSource = useCallback(async (cameraId, hlsUrl) => {
    if (!hlsUrl) return;
    const videoEl = videoRefs.current[cameraId];
    if (!videoEl) return;

    // Destroy old HLS instances for all sources except the new active one
    for (const [id, hls] of Object.entries(hlsRefs.current)) {
      if (id !== cameraId) {
        hls.destroy();
        delete hlsRefs.current[id];
        if (videoRefs.current[id]) {
          videoRefs.current[id].src = '';
        }
      }
    }

    if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
      // Native HLS (Safari)
      videoEl.src = hlsUrl;
      videoEl.play().catch(() => {});
      return;
    }

    // HLS.js
    const { default: Hls } = await import('hls.js');
    if (Hls.isSupported()) {
      const hls = new Hls({ lowLatencyMode: true });
      hls.loadSource(hlsUrl);
      hls.attachMedia(videoEl);
      hls.on(Hls.Events.MANIFEST_PARSED, () => videoEl.play().catch(() => {}));
      hlsRefs.current[cameraId] = hls;
    }
  }, []);

  useEffect(() => {
    if (sources.length === 0) return;
    const src = sources[activeIdx];
    if (src?.hlsUrl) {
      loadHlsForSource(src.cameraId, src.hlsUrl);
    }
  }, [activeIdx, sources, loadHlsForSource]);

  // ---------------------------------------------------------------------------
  // Audio routing (WebAudio API)
  // ---------------------------------------------------------------------------
  const initAudio = useCallback(() => {
    if (audioCtxRef.current) return;
    const ctx = new AudioContext();
    const dest = ctx.createMediaStreamDestination();
    audioCtxRef.current = ctx;
    audioDestRef.current = dest;
    gainNodesRef.current = {};

    // Wire up gain nodes for all video elements
    for (const src of sources) {
      const el = videoRefs.current[src.cameraId];
      if (!el) continue;
      const srcNode = ctx.createMediaElementSource(el);
      const gain = ctx.createGain();
      gain.gain.value = 0;
      srcNode.connect(gain);
      gain.connect(dest);
      gainNodesRef.current[src.cameraId] = gain;
    }
  }, [sources]);

  const updateGains = useCallback((newActiveIdx, newAudioMode, newFixedAudioIdx) => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    const now = ctx.currentTime;
    const audioCameraId = newAudioMode === 'fixed'
      ? sources[newFixedAudioIdx]?.cameraId
      : sources[newActiveIdx]?.cameraId;

    for (const src of sources) {
      const gain = gainNodesRef.current[src.cameraId];
      if (!gain) continue;
      const target = src.cameraId === audioCameraId ? 1.0 : 0.0;
      gain.gain.setTargetAtTime(target, now, 0.05); // 50ms crossfade
    }
  }, [sources]);

  useEffect(() => {
    updateGains(activeIdx, audioMode, fixedAudioIdx);
  }, [activeIdx, audioMode, fixedAudioIdx, updateGains]);

  // ---------------------------------------------------------------------------
  // Canvas draw loop
  // ---------------------------------------------------------------------------
  const startDrawLoop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    function draw() {
      const activeSrc = sources[activeIdx];
      const el = activeSrc ? videoRefs.current[activeSrc.cameraId] : null;
      if (el && el.readyState >= 2) {
        ctx.drawImage(el, 0, 0, CANVAS_W, CANVAS_H);
      } else {
        ctx.fillStyle = '#111';
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
        ctx.fillStyle = '#555';
        ctx.font = '32px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText('No signal', CANVAS_W / 2, CANVAS_H / 2);
      }
      rafRef.current = requestAnimationFrame(draw);
    }
    rafRef.current = requestAnimationFrame(draw);
  }, [sources, activeIdx]);

  const stopDrawLoop = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  // ---------------------------------------------------------------------------
  // WHIP output
  // ---------------------------------------------------------------------------
  const startOutput = useCallback(async () => {
    if (!mixerInfo || !canvasRef.current) return;
    setOutputState('connecting');

    initAudio();
    startDrawLoop();

    const canvas = canvasRef.current;
    const canvasStream = canvas.captureStream(30);

    // Add audio track
    const audioTrack = audioDestRef.current?.stream?.getAudioTracks()[0];
    if (audioTrack) canvasStream.addTrack(audioTrack);

    const pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
    pcRef.current = pc;

    for (const track of canvasStream.getTracks()) {
      pc.addTrack(track, canvasStream);
    }

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') setOutputState('live');
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        setOutputState('idle');
        stopDrawLoop();
      }
    };

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Wait for ICE gathering (max 1000ms)
      await new Promise(resolve => {
        if (pc.iceGatheringState === 'complete') { resolve(); return; }
        const timeout = setTimeout(resolve, 1000);
        pc.onicegatheringstatechange = () => {
          if (pc.iceGatheringState === 'complete') { clearTimeout(timeout); resolve(); }
        };
      });

      const whipUrl = `${backendUrl}${mixerInfo.whipUrl}`;
      const res = await fetch(whipUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body: pc.localDescription.sdp,
      });

      if (!res.ok && res.status !== 201) {
        const msg = await res.text().catch(() => res.status);
        throw new Error(`WHIP error: ${msg}`);
      }

      const answerSdp = await res.text();
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
    } catch (err) {
      pc.close();
      pcRef.current = null;
      stopDrawLoop();
      setOutputState('idle');
      setError(`Failed to start output: ${err.message}`);
    }
  }, [mixerInfo, backendUrl, initAudio, startDrawLoop, stopDrawLoop]);

  const stopOutput = useCallback(async () => {
    setOutputState('stopping');
    stopDrawLoop();
    if (pcRef.current) { pcRef.current.close(); pcRef.current = null; }
    if (mixerInfo) {
      fetch(`${backendUrl}${mixerInfo.whipUrl}`, { method: 'DELETE' }).catch(() => {});
    }
    setOutputState('idle');
  }, [mixerInfo, backendUrl, stopDrawLoop]);

  // ---------------------------------------------------------------------------
  // Source cut
  // ---------------------------------------------------------------------------
  const cutTo = useCallback((idx) => {
    setActiveIdx(idx);
    const src = sources[idx];
    if (!src) return;
    // Notify backend about the switch
    fetch(`${backendUrl}/production/mixers/${mixerId}/switch/${src.mixerInput}`, { method: 'POST' })
      .catch(() => {});
  }, [sources, backendUrl, mixerId]);

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------
  useEffect(() => {
    return () => {
      stopDrawLoop();
      if (pcRef.current) pcRef.current.close();
      if (mixerInfo) {
        fetch(`${getBackendUrl()}${mixerInfo.whipUrl}`, { method: 'DELETE' }).catch(() => {});
      }
      for (const hls of Object.values(hlsRefs.current)) hls.destroy();
      if (audioCtxRef.current) audioCtxRef.current.close();
      Object.values(thumbTimersRef.current).forEach(t => clearInterval(t));
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const isLive = outputState === 'live';

  const s = {
    page: {
      minHeight: '100vh', background: '#111', color: '#eee',
      fontFamily: 'system-ui, sans-serif', display: 'flex', flexDirection: 'column',
    },
    header: {
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '12px 20px', background: '#1a1a1a', borderBottom: '1px solid #333',
    },
    title: { margin: 0, fontSize: '1.1rem', fontWeight: 700 },
    airBadge: {
      background: isLive ? '#e03' : '#333', color: '#fff',
      fontSize: '0.75rem', fontWeight: 700, padding: '4px 12px',
      borderRadius: 4, letterSpacing: '0.05em', transition: 'background 0.3s',
    },
    body: { display: 'flex', flex: 1, gap: 0, overflow: 'hidden' },
    // Left panel: source grid
    sourcePanel: { width: 260, background: '#1a1a1a', borderRight: '1px solid #333', overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 },
    sourceCard: (idx) => ({
      position: 'relative', borderRadius: 8, overflow: 'hidden', cursor: 'pointer',
      border: `3px solid ${idx === activeIdx ? '#e03' : '#333'}`,
      transition: 'border-color 0.15s',
    }),
    sourceThumb: { width: '100%', aspectRatio: '16/9', objectFit: 'cover', display: 'block', background: '#222' },
    sourceLabel: {
      position: 'absolute', bottom: 0, left: 0, right: 0,
      background: 'rgba(0,0,0,0.7)', padding: '4px 8px',
      fontSize: '0.75rem', fontWeight: 600,
    },
    cutBtn: {
      position: 'absolute', top: 6, right: 6,
      background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.3)',
      color: '#fff', fontSize: '0.65rem', padding: '2px 6px', borderRadius: 4, cursor: 'pointer',
    },
    // Right panel: preview canvas + controls
    mainPanel: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
    canvasWrap: {
      flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#000', overflow: 'hidden',
    },
    canvas: { maxWidth: '100%', maxHeight: '100%', display: 'block' },
    controlBar: {
      padding: '12px 16px', background: '#1a1a1a', borderTop: '1px solid #333',
      display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center',
    },
    outputBtn: {
      padding: '10px 20px', fontWeight: 700, fontSize: '0.95rem',
      border: 'none', borderRadius: 8, cursor: 'pointer',
      background: isLive ? '#e03' : '#1a7f4b', color: '#fff',
      minWidth: 140, transition: 'background 0.2s',
    },
    label: { fontSize: '0.8rem', color: '#aaa', marginRight: 4 },
    select: {
      background: '#2a2a2a', color: '#eee', border: '1px solid #444',
      borderRadius: 6, padding: '6px 8px', fontSize: '0.85rem',
    },
    radioGroup: { display: 'flex', gap: 8, alignItems: 'center' },
    outputKeyBadge: {
      fontSize: '0.75rem', color: '#888', fontFamily: 'monospace',
      background: '#2a2a2a', padding: '4px 8px', borderRadius: 4,
    },
  };

  if (error && !mixerInfo) {
    return (
      <div style={{ ...s.page, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 }}>
        <div style={{ fontSize: '2rem' }}>⚠</div>
        <div style={{ color: '#f88', maxWidth: 400, textAlign: 'center' }}>{error}</div>
      </div>
    );
  }

  return (
    <div style={s.page}>
      {/* Header */}
      <div style={s.header}>
        <h1 style={s.title}>LCYT Mixer</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {mixerInfo?.outputKey && (
            <span style={s.outputKeyBadge}>{mixerInfo.outputKey}</span>
          )}
          <span style={s.airBadge}>{isLive ? 'ON AIR' : outputState === 'connecting' ? 'CONNECTING…' : 'OFF AIR'}</span>
        </div>
      </div>

      <div style={s.body}>
        {/* Source panel */}
        <div style={s.sourcePanel}>
          <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#666', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
            Sources
          </div>
          {sources.length === 0 && (
            <div style={{ color: '#666', fontSize: '0.85rem', textAlign: 'center', marginTop: 20 }}>
              No camera sources found.<br />Add cameras with mixer input numbers.
            </div>
          )}
          {sources.map((src, idx) => (
            <div
              key={src.cameraId}
              style={s.sourceCard(idx)}
              onClick={() => cutTo(idx)}
            >
              {thumbUrls[src.cameraId]
                ? <img src={thumbUrls[src.cameraId]} style={s.sourceThumb} alt={src.name} />
                : <div style={s.sourceThumb} />
              }
              <div style={s.sourceLabel}>
                <span>{src.name}</span>
                {src.isLive && <span style={{ marginLeft: 6, color: '#6e6', fontSize: '0.65rem' }}>● LIVE</span>}
                <span style={{ float: 'right', color: '#aaa' }}>IN {src.mixerInput}</span>
              </div>
              {idx !== activeIdx && (
                <button style={s.cutBtn} onClick={(e) => { e.stopPropagation(); cutTo(idx); }}>CUT</button>
              )}
              {idx === activeIdx && (
                <div style={{ position: 'absolute', top: 6, left: 6, background: '#e03', color: '#fff', fontSize: '0.65rem', fontWeight: 700, padding: '2px 6px', borderRadius: 4 }}>PGM</div>
              )}
              {/* Hidden video element for HLS + canvas drawing */}
              <video
                ref={el => { if (el) videoRefs.current[src.cameraId] = el; }}
                style={{ display: 'none' }}
                muted={audioMode === 'follow' ? idx !== activeIdx : idx !== fixedAudioIdx}
                playsInline
                crossOrigin="anonymous"
              />
            </div>
          ))}
        </div>

        {/* Main panel */}
        <div style={s.mainPanel}>
          <div style={s.canvasWrap}>
            <canvas
              ref={canvasRef}
              width={CANVAS_W}
              height={CANVAS_H}
              style={s.canvas}
            />
          </div>

          {/* Control bar */}
          <div style={s.controlBar}>
            {/* Output toggle */}
            <button
              style={s.outputBtn}
              onClick={isLive ? stopOutput : startOutput}
              disabled={outputState === 'connecting' || outputState === 'stopping' || !mixerInfo}
            >
              {outputState === 'connecting' ? 'Connecting…'
                : outputState === 'stopping' ? 'Stopping…'
                : isLive ? 'Stop Output'
                : 'Start Output'}
            </button>

            {/* Audio mode */}
            <div style={s.radioGroup}>
              <span style={s.label}>Audio:</span>
              <label style={{ fontSize: '0.85rem', cursor: 'pointer' }}>
                <input
                  type="radio" value="follow" checked={audioMode === 'follow'}
                  onChange={() => setAudioMode('follow')} style={{ marginRight: 4 }}
                />
                Follow video
              </label>
              <label style={{ fontSize: '0.85rem', cursor: 'pointer' }}>
                <input
                  type="radio" value="fixed" checked={audioMode === 'fixed'}
                  onChange={() => setAudioMode('fixed')} style={{ marginRight: 4 }}
                />
                Fixed source
              </label>
              {audioMode === 'fixed' && sources.length > 0 && (
                <select
                  style={s.select}
                  value={fixedAudioIdx}
                  onChange={e => setFixedAudioIdx(Number(e.target.value))}
                >
                  {sources.map((src, idx) => (
                    <option key={src.cameraId} value={idx}>{src.name}</option>
                  ))}
                </select>
              )}
            </div>

            {/* Error display */}
            {error && (
              <span style={{ color: '#f88', fontSize: '0.8rem', flex: 1, textAlign: 'right' }}>{error}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
