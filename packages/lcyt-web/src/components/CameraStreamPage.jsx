import { useState, useEffect, useRef, useCallback } from 'react';

const STUN_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

// Extract camera ID from path: /production/camera/:cameraId
function getCameraIdFromPath() {
  const parts = window.location.pathname.split('/');
  return parts[3] ?? null;
}

function getBackendUrl() {
  return localStorage.getItem('lcyt_backend_url') ?? '';
}

export function CameraStreamPage() {
  const cameraId = getCameraIdFromPath();
  const backendUrl = getBackendUrl();

  const [cameraInfo, setCameraInfo]   = useState(null);
  const [error, setError]             = useState(null);
  const [mediaError, setMediaError]   = useState(null);
  const [state, setState]             = useState('idle'); // idle | requesting_media | media_ready | connecting | live | stopping
  const [videoMuted, setVideoMuted]   = useState(false);
  const [audioMuted, setAudioMuted]   = useState(false);
  const [focusLocked, setFocusLocked] = useState(false);
  const [facing, setFacing]           = useState('environment'); // 'environment' | 'user'

  const localVideoRef = useRef(null);
  const streamRef     = useRef(null);
  const pcRef         = useRef(null);

  // ---------------------------------------------------------------------------
  // Load camera info
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!cameraId) { setError('No camera ID in URL'); return; }
    if (!backendUrl) { setError('Backend URL not configured — open Settings first'); return; }
    if (!window.isSecureContext) {
      setError('Camera requires a secure context (HTTPS or localhost). Please access this page over HTTPS.');
      return;
    }

    fetch(`${backendUrl}/production/cameras/${cameraId}/whip-url`)
      .then(r => r.ok ? r.json() : r.json().then(j => Promise.reject(j.error ?? 'Failed to load camera info')))
      .then(info => setCameraInfo(info))
      .catch(err => setError(String(err)));
  }, [cameraId, backendUrl]);

  // ---------------------------------------------------------------------------
  // Request camera / microphone
  // ---------------------------------------------------------------------------
  const requestMedia = useCallback(async (facingMode = facing) => {
    setMediaError(null);
    setState('requesting_media');
    try {
      const constraints = {
        video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      setState('media_ready');
    } catch (err) {
      setMediaError(`Camera access denied: ${err.message}`);
      setState('idle');
    }
  }, [facing]);

  // Start media on mount once camera info is loaded
  useEffect(() => {
    if (cameraInfo && state === 'idle') {
      requestMedia();
    }
  }, [cameraInfo]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopStream();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // WHIP connection
  // ---------------------------------------------------------------------------
  const goLive = useCallback(async () => {
    if (!streamRef.current || !cameraInfo) return;
    setState('connecting');

    const pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
    pcRef.current = pc;

    // Add tracks
    for (const track of streamRef.current.getTracks()) {
      pc.addTrack(track, streamRef.current);
    }

    // Connection state monitoring
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') setState('live');
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        setState('media_ready');
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

      const sdpOffer = pc.localDescription.sdp;
      const whipUrl = `${backendUrl}${cameraInfo.whipUrl}`;

      const res = await fetch(whipUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body: sdpOffer,
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
      setMediaError(`Failed to go live: ${err.message}`);
      setState('media_ready');
    }
  }, [cameraInfo, backendUrl]);

  const stopLive = useCallback(async () => {
    setState('stopping');
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    // Tell backend to kick the publisher
    if (cameraInfo) {
      fetch(`${backendUrl}${cameraInfo.whipUrl}`, { method: 'DELETE' }).catch(() => {});
    }
    setState('media_ready');
  }, [cameraInfo, backendUrl]);

  function stopStream() {
    if (pcRef.current) { pcRef.current.close(); pcRef.current = null; }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (cameraInfo) {
      fetch(`${getBackendUrl()}${cameraInfo.whipUrl}`, { method: 'DELETE' }).catch(() => {});
    }
  }

  // ---------------------------------------------------------------------------
  // Controls
  // ---------------------------------------------------------------------------
  const toggleVideo = useCallback(() => {
    if (!streamRef.current) return;
    const vt = streamRef.current.getVideoTracks()[0];
    if (!vt) return;
    vt.enabled = !vt.enabled;
    setVideoMuted(!vt.enabled);
  }, []);

  const toggleAudio = useCallback(() => {
    if (!streamRef.current) return;
    const at = streamRef.current.getAudioTracks()[0];
    if (!at) return;
    at.enabled = !at.enabled;
    setAudioMuted(!at.enabled);
  }, []);

  const toggleFocus = useCallback(async () => {
    if (!streamRef.current) return;
    const vt = streamRef.current.getVideoTracks()[0];
    if (!vt) return;
    const newFocusLocked = !focusLocked;
    try {
      await vt.applyConstraints({
        advanced: [{ focusMode: newFocusLocked ? 'manual' : 'continuous' }],
      });
      setFocusLocked(newFocusLocked);
    } catch {
      // Not supported on this device — silently ignore
    }
  }, [focusLocked]);

  const flipCamera = useCallback(async () => {
    const newFacing = facing === 'environment' ? 'user' : 'environment';
    setFacing(newFacing);

    if (!streamRef.current) return;
    const pc = pcRef.current;
    const wasLive = state === 'live';

    // Stop old video track
    streamRef.current.getVideoTracks().forEach(t => t.stop());

    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: newFacing, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      const newVideoTrack = newStream.getVideoTracks()[0];

      // Update local preview
      const oldVideo = streamRef.current.getVideoTracks()[0];
      if (oldVideo) streamRef.current.removeTrack(oldVideo);
      streamRef.current.addTrack(newVideoTrack);
      if (localVideoRef.current) localVideoRef.current.srcObject = streamRef.current;

      // Replace sender in active peer connection
      if (pc && wasLive) {
        const sender = pc.getSenders().find(s => s.track?.kind === 'video');
        if (sender) await sender.replaceTrack(newVideoTrack);
      }
    } catch (err) {
      setMediaError(`Could not flip camera: ${err.message}`);
    }
  }, [facing, state]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const isLive = state === 'live';

  const styles = {
    page: {
      position: 'fixed', inset: 0, background: '#000', color: '#fff',
      display: 'flex', flexDirection: 'column', fontFamily: 'system-ui, sans-serif',
      userSelect: 'none',
    },
    header: {
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '12px 16px', background: 'rgba(0,0,0,0.6)',
      position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
    },
    title: { fontSize: '1rem', fontWeight: 600, margin: 0, letterSpacing: '0.01em' },
    liveBadge: {
      background: isLive ? '#e03' : '#555',
      color: '#fff', fontSize: '0.75rem', fontWeight: 700,
      padding: '3px 10px', borderRadius: 4, letterSpacing: '0.05em',
      transition: 'background 0.3s',
    },
    video: {
      flex: 1, width: '100%', objectFit: 'cover',
      opacity: videoMuted ? 0.3 : 1, transition: 'opacity 0.2s',
    },
    controls: {
      position: 'absolute', bottom: 0, left: 0, right: 0,
      display: 'flex', flexDirection: 'column', gap: 8,
      padding: '12px 16px', background: 'linear-gradient(transparent, rgba(0,0,0,0.85))',
    },
    mainBtn: {
      width: '100%', padding: '16px', fontSize: '1.1rem', fontWeight: 700,
      border: 'none', borderRadius: 8, cursor: 'pointer',
      background: isLive ? '#e03' : '#1a7f4b',
      color: '#fff', transition: 'background 0.2s',
      minHeight: 56,
    },
    row: { display: 'flex', gap: 8 },
    iconBtn: {
      flex: 1, padding: '12px 8px', fontSize: '0.85rem', fontWeight: 600,
      border: '2px solid rgba(255,255,255,0.2)', borderRadius: 8, cursor: 'pointer',
      background: 'rgba(255,255,255,0.1)', color: '#fff', minHeight: 52,
      transition: 'background 0.15s, border-color 0.15s',
    },
    iconBtnActive: {
      background: 'rgba(255,80,80,0.25)', borderColor: 'rgba(255,80,80,0.6)',
    },
    errorBox: {
      position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: '#111', padding: 24,
      flexDirection: 'column', gap: 16, textAlign: 'center',
    },
    errorText: { color: '#f88', fontSize: '1rem', maxWidth: 360 },
  };

  if (error) {
    return (
      <div style={styles.page}>
        <div style={styles.errorBox}>
          <div style={{ fontSize: '2rem' }}>⚠</div>
          <div style={styles.errorText}>{error}</div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      {/* Header */}
      <div style={styles.header}>
        <h1 style={styles.title}>{cameraInfo?.cameraName ?? 'Camera'}</h1>
        <span style={styles.liveBadge}>{isLive ? 'LIVE' : state === 'connecting' ? 'CONNECTING…' : 'OFF'}</span>
      </div>

      {/* Local video preview */}
      <video
        ref={localVideoRef}
        style={styles.video}
        autoPlay
        muted
        playsInline
      />

      {/* Controls overlay */}
      <div style={styles.controls}>
        {mediaError && (
          <div style={{ color: '#f88', fontSize: '0.85rem', textAlign: 'center', padding: '4px 0' }}>
            {mediaError}
          </div>
        )}

        {/* Main go live / stop button */}
        <button
          style={styles.mainBtn}
          onClick={isLive ? stopLive : goLive}
          disabled={state === 'connecting' || state === 'stopping' || state === 'requesting_media' || !cameraInfo || state === 'idle'}
        >
          {state === 'connecting' ? 'Connecting…'
            : state === 'stopping' ? 'Stopping…'
            : state === 'requesting_media' ? 'Requesting camera…'
            : isLive ? 'Stop'
            : 'Go Live'}
        </button>

        {/* Secondary controls */}
        <div style={styles.row}>
          <button
            style={{ ...styles.iconBtn, ...(videoMuted ? styles.iconBtnActive : {}) }}
            onClick={toggleVideo}
            title="Mute/unmute video"
          >
            {videoMuted ? '📵 Video off' : '📷 Mute video'}
          </button>
          <button
            style={{ ...styles.iconBtn, ...(audioMuted ? styles.iconBtnActive : {}) }}
            onClick={toggleAudio}
            title="Mute/unmute microphone"
          >
            {audioMuted ? '🔇 Mic off' : '🎤 Mute mic'}
          </button>
        </div>
        <div style={styles.row}>
          <button
            style={{ ...styles.iconBtn, ...(focusLocked ? styles.iconBtnActive : {}) }}
            onClick={toggleFocus}
            title="Lock/unlock autofocus"
          >
            {focusLocked ? '🔒 Focus locked' : '🔍 Lock focus'}
          </button>
          <button
            style={styles.iconBtn}
            onClick={flipCamera}
            title="Flip camera"
          >
            🔄 Flip
          </button>
        </div>
      </div>
    </div>
  );
}
