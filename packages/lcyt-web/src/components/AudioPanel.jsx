import { useState, useEffect, useRef } from 'react';
import { useSessionContext } from '../contexts/SessionContext';
import { useSentLogContext } from '../contexts/SentLogContext';
import { getSttEngine, getSttLang, getSttCloudConfig } from '../lib/sttConfig';
import { getGoogleCredential, fetchOAuthToken } from '../lib/googleCredential';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AudioPanel({ visible }) {
  const [listening, setListening] = useState(false);
  const [interimText, setInterimText] = useState('');
  const [engine, setEngine] = useState(getSttEngine);
  const [credLoaded, setCredLoaded] = useState(!!getGoogleCredential());
  const [devices, setDevices] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState(() => {
    try { return localStorage.getItem('lcyt:audioDeviceId') || ''; } catch { return ''; }
  });
  const [webkitSupported] = useState(
    () => !!(window.SpeechRecognition || window.webkitSpeechRecognition),
  );
  const [cloudError, setCloudError] = useState('');

  // WebKit refs
  const recognitionRef = useRef(null);
  const meterStreamRef = useRef(null); // MediaStream used for analyser when WebKit is active
  const audioCtxRef     = useRef(null);
  const analyserRef     = useRef(null);
  const meterAnimRef    = useRef(null);
  const meterCanvasRef  = useRef(null);

  // Cloud STT refs
  const streamRef    = useRef(null);   // MediaStream
  const recorderRef  = useRef(null);   // current MediaRecorder
  const oauthRef     = useRef(null);   // { token, expires }

  // ── Sync engine/credential from settings events ──────────────────────────
  useEffect(() => {
    function onCfgChange()  { setEngine(getSttEngine()); }
    function onCredChange() { setCredLoaded(!!getGoogleCredential()); }
    window.addEventListener('lcyt:stt-config-changed',     onCfgChange);
    window.addEventListener('lcyt:stt-credential-changed', onCredChange);
    return () => {
      window.removeEventListener('lcyt:stt-config-changed',     onCfgChange);
      window.removeEventListener('lcyt:stt-credential-changed', onCredChange);
    };
  }, []);

  // Session / sent log
  const session = useSessionContext();
  const sentLog = useSentLogContext();

  function pushFinalTranscript(text) {
    const t = String(text || '').trim();
    if (!t) return;
    // Do not render finalized words in the audio panel UI; just send them.
    sendTranscript(t);
  }

  function getTimestampWithOffset() {
    const offsetSec = parseFloat(localStorage.getItem('lcyt:transcription-offset') || '0');
    if (!offsetSec) return undefined; // let backend use its own clock
    const ms = Date.now() + Math.round(offsetSec * 1000);
    // Format as YYYY-MM-DDTHH:MM:SS.mmm (no trailing Z — YouTube API format)
    return new Date(ms).toISOString().replace('Z', '');
  }

  async function sendTranscript(text) {
    if (!text) return;
    if (session?.connected) {
      const timestamp = getTimestampWithOffset();
      try {
        // Honor batching: if batch interval > 0, queue via construct
        const v = parseInt(localStorage.getItem('lcyt-batch-interval') || '0', 10);
        const intervalMs = Math.min(20, Math.max(0, v)) * 1000;
        if (intervalMs > 0) {
          await session.construct(text, timestamp);
        } else {
          await session.send(text, timestamp);
        }
        setCloudError('');
      } catch (err) {
        console.error('Failed to send caption', err);
        setCloudError(err?.message || 'Failed to send caption');
        // add to sent log as pending fallback
        try { sentLog?.add({ requestId: `local-${Date.now()}`, text, pending: true }); } catch {}
      }
    } else {
      // Not connected — add to sent log as a local pending entry so it appears in SentPanel
      try { sentLog?.add({ requestId: `local-${Date.now()}`, text, pending: true }); } catch {}
    }
  }

  // ── Enumerate audio input devices and track selection ─────────────────
  async function enumerateDevices() {
    if (!navigator?.mediaDevices?.enumerateDevices) return;
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      const inputs = list.filter(d => d.kind === 'audioinput');
      setDevices(inputs);
    } catch {}
  }

  useEffect(() => {
    enumerateDevices();
    const onChange = () => enumerateDevices();
    navigator?.mediaDevices?.addEventListener?.('devicechange', onChange);
    return () => navigator?.mediaDevices?.removeEventListener?.('devicechange', onChange);
  }, []);

  // ── Cleanup on unmount ───────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      stopWebkit();
      stopCloud();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Respond to toggle requests from FileTabs: if not currently listening, allow hiding the panel.
  useEffect(() => {
    function onToggleRequest() {
      const allowed = !listening;
      try { window.dispatchEvent(new CustomEvent('lcyt:audio-toggle-response', { detail: { allowed } })); } catch {}
    }
    window.addEventListener('lcyt:audio-toggle-request', onToggleRequest);
    return () => window.removeEventListener('lcyt:audio-toggle-request', onToggleRequest);
  }, [listening]);

  // ─── WebKit engine ────────────────────────────────────────────────────────

  async function startWebkit() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    // Try to pre-select the device by requesting permission for the chosen device.
    // Await the permission so failures surface and we can show a helpful message.
    if (selectedDeviceId && navigator?.mediaDevices?.getUserMedia) {
      // stop any existing meter stream first
      if (meterStreamRef.current) {
        try { meterStreamRef.current.getTracks().forEach(t => t.stop()); } catch {}
        meterStreamRef.current = null;
      }
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: selectedDeviceId } } });
        meterStreamRef.current = s;
        try { attachMeter(s); } catch (err) { }
      } catch (err) {
        console.warn('getUserMedia for selected device failed', err);
        // Surface a readable message for the user
        if (err && err.name === 'NotAllowedError') setCloudError('Microphone access denied for selected device.');
        else if (err && (err.name === 'NotFoundError' || err.name === 'OverconstrainedError')) setCloudError('Selected microphone not found.');
        else setCloudError('Unable to open selected microphone.');
        // Continue — some browsers allow SpeechRecognition even without a successful getUserMedia
      }
    }

    const recognition = new SR();
    recognition.continuous     = true;
    recognition.interimResults = true;
    recognition.lang           = getSttLang();

    recognition.onresult = (event) => {
      let interim = '';
      let final   = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) final += t;
        else interim += t;
      }
      setInterimText(interim);
      if (final) pushFinalTranscript(final);
    };

    recognition.onstart = () => { }; 

    recognition.onend = () => {
      // Auto-restart so continuous mode survives silence pauses
      if (recognitionRef.current) {
        try { recognition.start(); } catch {}
      }
    };

    recognition.onerror = (e) => {
      if (e.error === 'no-speech') return;
      console.error('WebKit recognition error', e);
      setCloudError(`WebKit STT error: ${e.error || 'unknown'}`);
      recognitionRef.current = null;
      setListening(false);
      setInterimText('');
    };

    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
    setInterimText('');
  }

  function stopWebkit() {
    const rec = recognitionRef.current;
    recognitionRef.current = null;
    if (rec) try { rec.stop(); } catch {}
    // Stop meter stream if we opened one for WebKit
    if (meterStreamRef.current) {
      try { meterStreamRef.current.getTracks().forEach(t => t.stop()); } catch {}
      meterStreamRef.current = null;
    }
    detachMeter();
    setListening(false);
    setInterimText('');
  }

  // ─── Cloud STT engine ─────────────────────────────────────────────────────

  async function getToken() {
    const now = Math.floor(Date.now() / 1000);
    if (oauthRef.current && oauthRef.current.expires > now + 60) {
      return oauthRef.current.token;
    }
    const cred = getGoogleCredential();
    if (!cred) throw new Error('No Google credential loaded');
    const tokenData = await fetchOAuthToken(cred);
    oauthRef.current = tokenData;
    return tokenData.token;
  }

  async function recognizeChunk(blob) {
    const base64 = await blobToBase64(blob);
    const cfg    = getSttCloudConfig();
    const token  = await getToken();

    const res = await fetch('https://speech.googleapis.com/v1/speech:recognize', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        config: {
          encoding:                   'WEBM_OPUS',
          sampleRateHertz:            48000,
          languageCode:               getSttLang(),
          model:                      cfg.model || 'latest_long',
          enableAutomaticPunctuation: cfg.punctuation !== false,
          profanityFilter:            !!cfg.profanity,
        },
        audio: { content: base64 },
      }),
    });
    let data;
    try {
      data = await res.json();
    } catch (err) {
      console.error('Failed parsing STT response', err);
      throw new Error('Invalid STT response');
    }

    if (!res.ok) {
      console.error('Cloud STT error', res.status, data);
      throw new Error(data?.error?.message || `STT HTTP ${res.status}`);
    }

    if (data.error) {
      console.error('Cloud STT returned error', data.error);
      throw new Error(data.error.message || 'Cloud STT error');
    }

    const transcript = data.results?.[0]?.alternatives?.[0]?.transcript;
    
    if (transcript) {
      pushFinalTranscript(transcript);
    }
  }

  function scheduleNextChunk(stream) {
    // Don't schedule if we've stopped
    if (!streamRef.current) return;

    const recorder = new MediaRecorder(stream);
    const chunks   = [];
    recorderRef.current = recorder;

    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

    recorder.onstop = async () => {
      if (!streamRef.current) return; // user stopped
      const blob = new Blob(chunks, { type: recorder.mimeType });
      try {
        await recognizeChunk(blob);
        setCloudError('');
      } catch (err) {
        setCloudError(err.message);
      }
      scheduleNextChunk(stream);
    };

    recorder.start();
    setTimeout(() => { if (recorder.state === 'recording') recorder.stop(); }, 5000);
  }

  async function startCloud() {
    setCloudError('');

    const cred = getGoogleCredential();
    if (!cred) {
      setCloudError('Load a Google service account key in Settings → STT / Audio first.');
      return;
    }

    let stream;
    try {
      const audioConstraint = selectedDeviceId
        ? { deviceId: { exact: selectedDeviceId } }
        : true;
      stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraint });
    } catch (err) {
      setCloudError(err?.name === 'NotAllowedError' ? 'Microphone access denied.' : 'Failed to open microphone.');
      return;
    }

    // Pre-fetch the OAuth token so any auth error surfaces before we start recording
    try {
      await getToken();
    } catch (err) {
      stream.getTracks().forEach(t => t.stop());
      setCloudError(`Auth error: ${err.message}`);
      return;
    }

    streamRef.current = stream;
    // Attach meter to the active cloud stream
    try { attachMeter(streamRef.current); } catch {}
    setListening(true);
    setInterimText('');
    scheduleNextChunk(stream);
  }

  function stopCloud() {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    if (recorderRef.current?.state === 'recording') {
      try { recorderRef.current.stop(); } catch {}
    }
    recorderRef.current = null;
    detachMeter();
    setListening(false);
    setInterimText('');
  }

  // ── Audio meter helpers ─────────────────────────────────────────────────
  function attachMeter(stream) {
    if (!stream) return;
    if (analyserRef.current) return; // already attached
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = audioCtxRef.current || new AudioCtx();
      audioCtxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      analyserRef.current = analyser;

      const canvas = meterCanvasRef.current;
      const data = new Float32Array(analyser.fftSize);

      function draw() {
        analyser.getFloatTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
        const rms = Math.sqrt(sum / data.length);
        const level = Math.min(1, rms * 3); // scale for visibility

        if (canvas) {
          const w = canvas.width = canvas.clientWidth * (window.devicePixelRatio || 1);
          const h = canvas.height = canvas.clientHeight * (window.devicePixelRatio || 1);
          const ctx2 = canvas.getContext('2d');
          ctx2.clearRect(0, 0, w, h);
          ctx2.fillStyle = '#0b8';
          ctx2.fillRect(0, 0, Math.round(w * level), h);
        }

        meterAnimRef.current = requestAnimationFrame(draw);
      }

      draw();
    } catch {}
  }

  function detachMeter() {
    if (meterAnimRef.current) {
      cancelAnimationFrame(meterAnimRef.current);
      meterAnimRef.current = null;
    }
    if (analyserRef.current) {
      try { analyserRef.current.disconnect(); } catch {}
      analyserRef.current = null;
    }
    if (audioCtxRef.current) {
      try { audioCtxRef.current.close(); } catch {}
      audioCtxRef.current = null;
    }
    const canvas = meterCanvasRef.current;
    if (canvas) {
      const ctx2 = canvas.getContext('2d');
      ctx2.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  // ─── Toggle ───────────────────────────────────────────────────────────────

  function toggle() {
    if (listening) {
      if (engine === 'webkit') stopWebkit();
      else stopCloud();
    } else {
      if (engine === 'webkit') startWebkit();
      else startCloud();
    }
  }

  // ─── Derived state ────────────────────────────────────────────────────────

  const isWebkit = engine === 'webkit';
  const canStart = isWebkit ? webkitSupported : credLoaded;

  const hint = listening ? null
    : isWebkit && !webkitSupported ? 'Web Speech API not supported — try Chrome or Edge.'
    : !isWebkit && !credLoaded     ? 'Load a Google service account key in Settings → STT / Audio.'
    : null;

  const engineLabel = isWebkit ? 'Web Speech API' : 'Google Cloud STT';

  if (!visible) return null;

  return (
    <div className="audio-panel">
      <div className="audio-panel__scroll">
        <section className="audio-section">
          <h3 className="audio-section__title">Speech to Text</h3>

          <div className={`audio-engine-badge audio-engine-badge--${engine}`}>
            {engineLabel}
            {!isWebkit && credLoaded && <span className="audio-engine-badge__sub"> · credential loaded</span>}
            {!isWebkit && !credLoaded && <span className="audio-engine-badge__sub audio-engine-badge__sub--warn"> · no credential</span>}
          </div>

          {hint && <p className="audio-field__hint">{hint}</p>}
          {cloudError && <p className="audio-field__hint audio-field__hint--error">{cloudError}</p>}

          <div className="audio-field">
            <label className="audio-field__label">Microphone</label>
            <div className="audio-field__control" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <select
                value={selectedDeviceId}
                onChange={(e) => {
                  const id = e.target.value;
                  setSelectedDeviceId(id);
                  try { localStorage.setItem('lcyt:audioDeviceId', id); } catch {}
                  window.dispatchEvent(new Event('lcyt:stt-config-changed'));
                }}
                style={{ minWidth: 180 }}
              >
                <option value="">Default device</option>
                {devices.map(d => (
                  <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId}</option>
                ))}
              </select>
              <button type="button" className="btn" onClick={enumerateDevices}>Refresh</button>
              <canvas
                ref={meterCanvasRef}
                className="audio-meter"
                aria-hidden="true"
                style={{ width: 80, height: 18, borderRadius: 3, background: '#222' }}
              />
            </div>
          </div>

          {/* Finalized transcripts are not shown here; they are sent directly. */}

          <div className="audio-field">
            <button
              className={`btn audio-caption-btn${listening ? ' audio-caption-btn--active' : ' btn--primary'}`}
              disabled={!canStart}
              onClick={toggle}
            >
              {listening ? '⏹ Stop Captioning' : '🎙 Click to Caption'}
            </button>
          </div>

          {listening && (
            <div className="audio-caption-live">
              {!interimText ? (
                <span className="audio-caption-placeholder">
                  {isWebkit ? 'Listening for speech…' : 'Sending audio to Google Cloud STT…'}
                </span>
              ) : (
                <>
                  {interimText && <span className="audio-caption-interim">{interimText}</span>}
                </>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

// Respond to toggle requests from the FileTabs: if not currently listening, allow the panel to be hidden.
// We add the listener at module scope inside the component via effect below.
