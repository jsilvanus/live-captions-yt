/**
 * SpeechCapturePage — standalone speech capture page for MCP speech sessions.
 *
 * Rendered when lcyt-web is opened at /mcp/:sessionId
 * All session config arrives as URL search params (injected by lcyt-mcp-sse):
 *   ?server=http://localhost:3002   MCP speech server base URL
 *   &lang=fi-FI                     recognition.lang
 *   &key=****XXXX                   masked stream key (display only)
 *   &label=...                      optional label (display only)
 *   &silence=30000                  server-side silence timeout ms (display only)
 *
 * This component is entirely self-contained — it does NOT use SessionContext
 * or any other app context. Data is POSTed directly to the MCP speech server.
 *
 * Speech recognition logic mirrors AudioPanel.startWebkit() exactly:
 *   - utteranceStartRef set on first interim/final text
 *   - auto-restart in recognition.onend (100 ms delay)
 *   - no-speech errors silently ignored
 *   - utterance-start timestamp sent alongside each final chunk
 */

import { useState, useRef, useEffect, useCallback } from 'react';

export function SpeechCapturePage({ sessionId }) {
  // ── Read URL params ────────────────────────────────────────────────────────

  const params    = new URLSearchParams(window.location.search);
  const serverUrl = params.get('server') || '';
  const lang      = params.get('lang')   || 'fi-FI';
  const keyDisplay = params.get('key')   || null;
  const label     = params.get('label')  || null;
  const silenceMs = parseInt(params.get('silence') || '30000', 10);

  // ── State ──────────────────────────────────────────────────────────────────

  const [listening, setListening]     = useState(false);
  const [interimText, setInterimText] = useState('');
  const [finals, setFinals]           = useState([]);   // array of sent final strings
  const [error, setError]             = useState('');
  const [done, setDone]               = useState(false);

  const [supported] = useState(
    () => !!(window.SpeechRecognition || window.webkitSpeechRecognition)
  );

  // ── Refs (mirrors AudioPanel) ──────────────────────────────────────────────

  const recognitionRef    = useRef(null);
  const runningRef        = useRef(false);
  const utteranceStartRef = useRef(null);   // timestamp of utterance start

  // Audio meter
  const meterCanvasRef = useRef(null);
  const audioCtxRef    = useRef(null);
  const analyserRef    = useRef(null);
  const meterAnimRef   = useRef(null);
  const meterStreamRef = useRef(null);

  // ── Cleanup on unmount ─────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      stopRecognition();
      detachMeter();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Meter helpers (same pattern as AudioPanel) ─────────────────────────────

  function attachMeter(stream) {
    if (!stream || analyserRef.current) return;
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

      const data = new Float32Array(analyser.fftSize);
      function draw() {
        analyser.getFloatTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
        const rms = Math.sqrt(sum / data.length);
        const level = Math.min(1, rms * 3);

        const cvs = meterCanvasRef.current;
        if (cvs && cvs.clientWidth) {
          const w = cvs.width  = cvs.clientWidth  * (window.devicePixelRatio || 1);
          const h = cvs.height = cvs.clientHeight * (window.devicePixelRatio || 1);
          const ctx2 = cvs.getContext('2d');
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
    if (meterAnimRef.current) { cancelAnimationFrame(meterAnimRef.current); meterAnimRef.current = null; }
    if (analyserRef.current)  { try { analyserRef.current.disconnect(); } catch {} analyserRef.current = null; }
    if (audioCtxRef.current)  { try { audioCtxRef.current.close(); } catch {} audioCtxRef.current = null; }
    if (meterStreamRef.current) {
      try { meterStreamRef.current.getTracks().forEach(t => t.stop()); } catch {}
      meterStreamRef.current = null;
    }
    const cvs = meterCanvasRef.current;
    if (cvs) try { cvs.getContext('2d').clearRect(0, 0, cvs.width, cvs.height); } catch {}
  }

  // ── Network helpers ────────────────────────────────────────────────────────

  function postChunk(text, timestamp) {
    if (!serverUrl || !text) return;
    fetch(`${serverUrl}/mcp/${sessionId}/chunk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, isFinal: true, timestamp }),
      keepalive: true,
    }).catch(() => {});
  }

  function postDone() {
    if (!serverUrl) return;
    fetch(`${serverUrl}/mcp/${sessionId}/done`, {
      method: 'POST',
      keepalive: true,
    }).catch(() => {});
  }

  // ── Recognition — mirrors AudioPanel.startWebkit() ────────────────────────

  function buildRecognition() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SR();
    recognition.continuous     = true;
    recognition.interimResults = true;
    recognition.lang           = lang;

    recognition.onresult = (event) => {
      let interim = '', final = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) final += t;
        else interim += t;
      }

      // Capture utterance start on first text (interim or final) — matches AudioPanel
      if ((interim || final) && !utteranceStartRef.current) {
        utteranceStartRef.current = new Date().toISOString().replace('Z', '');
      }

      setInterimText(interim);

      if (final) {
        const ts = utteranceStartRef.current;
        utteranceStartRef.current = null;
        const trimmed = final.trim();
        if (trimmed) {
          postChunk(trimmed, ts);
          setFinals(prev => [...prev, trimmed]);
        }
      }
    };

    // Auto-restart — same 100 ms delay as AudioPanel
    recognition.onend = () => {
      if (runningRef.current) {
        setTimeout(() => {
          if (!runningRef.current) return;
          try { recognitionRef.current?.start(); } catch {}
        }, 100);
      }
    };

    recognition.onerror = (e) => {
      if (e.error === 'no-speech') return;  // ignored, same as AudioPanel
      setError(`STT error: ${e.error}`);
      stopRecognition();
    };

    return recognition;
  }

  async function startRecognition() {
    if (!supported || listening) return;
    setError('');

    // Attach meter — attempt getUserMedia first; non-fatal if denied
    if (navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        meterStreamRef.current = stream;
        attachMeter(stream);
      } catch {}
    }

    const recognition = buildRecognition();
    recognitionRef.current = recognition;
    runningRef.current = true;
    try {
      recognition.start();
    } catch (err) {
      setError(`Could not start: ${err.message}`);
      runningRef.current = false;
      recognitionRef.current = null;
      return;
    }

    utteranceStartRef.current = null;
    setListening(true);
    setInterimText('');
  }

  function stopRecognition() {
    runningRef.current = false;
    const rec = recognitionRef.current;
    recognitionRef.current = null;
    if (rec) try { rec.stop(); } catch {}
    utteranceStartRef.current = null;
    setListening(false);
    setInterimText('');
    detachMeter();
  }

  const handleStop = useCallback(() => {
    stopRecognition();
    postDone();
    setDone(true);
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Render ─────────────────────────────────────────────────────────────────

  const silenceSec = Math.round(silenceMs / 1000);

  return (
    <div style={styles.page}>
      {/* ── Header ── */}
      <h1 style={styles.h1}>Live Captions — Mic Capture</h1>
      <div style={styles.meta}>
        <span>Session: <code style={styles.code}>{sessionId}</code></span>
        <span> · Lang: <code style={styles.code}>{lang}</code></span>
        {keyDisplay && <span> · Stream: <code style={styles.code}>{keyDisplay}</code></span>}
        {label     && <span> · <em>{label}</em></span>}
        <span style={styles.metaMuted}> (silence timeout: {silenceSec}s)</span>
      </div>

      {/* ── Compatibility warning ── */}
      {!supported && (
        <div style={styles.warning}>
          ⚠️ <strong>Web Speech API not supported.</strong> Please open this page in{' '}
          <strong>Google Chrome</strong> or <strong>Microsoft Edge</strong>.
        </div>
      )}

      {/* ── Controls ── */}
      {supported && !done && (
        <div style={styles.controls}>
          <button
            style={{ ...styles.btn, ...(listening ? styles.btnStop : styles.btnStart) }}
            disabled={listening}
            onClick={startRecognition}
          >
            🎙 Start
          </button>
          <button
            style={{ ...styles.btn, ...styles.btnStop }}
            disabled={!listening}
            onClick={handleStop}
          >
            ⏹ Stop
          </button>
        </div>
      )}

      {/* ── Audio meter ── */}
      {listening && (
        <div style={styles.meterWrap}>
          <canvas ref={meterCanvasRef} style={styles.meter} aria-hidden="true" />
        </div>
      )}

      {/* ── Error ── */}
      {error && <p style={styles.error}>{error}</p>}

      {/* ── Live transcript ── */}
      {(finals.length > 0 || interimText) && (
        <div style={styles.transcriptBox} aria-live="polite">
          {finals.map((t, i) => (
            <p key={i} style={styles.finalLine}>{t}</p>
          ))}
          {interimText && (
            <p style={styles.interimLine}>{interimText}</p>
          )}
        </div>
      )}

      {/* ── Done message ── */}
      {done && (
        <div style={styles.doneMsg}>
          <p>✅ Transkriptio valmis. Voit sulkea tämän välilehden.</p>
          <p>✅ Transcription complete. You can close this tab.</p>
        </div>
      )}

      {/* ── Status hint ── */}
      {supported && !done && !listening && finals.length === 0 && (
        <p style={styles.hint}>Click Start to begin speaking.</p>
      )}
      {listening && (
        <p style={styles.hint}>Listening… click Stop when done.</p>
      )}
    </div>
  );
}

// ── Inline styles (no external CSS deps needed for this standalone page) ──────

const styles = {
  page: {
    fontFamily: 'system-ui, sans-serif',
    maxWidth: 700,
    margin: '2rem auto',
    padding: '0 1rem',
    color: '#111',
  },
  h1: {
    fontSize: '1.4rem',
    marginBottom: '0.25rem',
  },
  meta: {
    color: '#555',
    fontSize: '0.85rem',
    marginBottom: '1rem',
    lineHeight: 1.6,
  },
  metaMuted: {
    color: '#888',
  },
  code: {
    background: '#f0f0f0',
    padding: '0 3px',
    borderRadius: 3,
    fontFamily: 'monospace',
    fontSize: '0.9em',
  },
  warning: {
    background: '#fff3cd',
    border: '1px solid #ffc107',
    borderRadius: 6,
    padding: '0.75rem 1rem',
    marginBottom: '1rem',
    color: '#664d03',
  },
  controls: {
    display: 'flex',
    gap: '0.75rem',
    marginBottom: '1rem',
  },
  btn: {
    padding: '0.5rem 1.4rem',
    fontSize: '1rem',
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    fontWeight: 600,
  },
  btnStart: {
    background: '#1a73e8',
    color: '#fff',
  },
  btnStop: {
    background: '#e53935',
    color: '#fff',
  },
  meterWrap: {
    height: 12,
    background: '#eee',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: '0.75rem',
  },
  meter: {
    width: '100%',
    height: '100%',
    display: 'block',
  },
  error: {
    color: '#c00',
    marginBottom: '0.5rem',
  },
  transcriptBox: {
    minHeight: 120,
    border: '1px solid #ccc',
    borderRadius: 6,
    padding: '0.75rem 1rem',
    background: '#fff',
    fontSize: '1.05rem',
    lineHeight: 1.6,
    marginBottom: '1rem',
  },
  finalLine: {
    margin: '0 0 0.35rem',
    color: '#111',
  },
  interimLine: {
    margin: '0 0 0.35rem',
    color: '#888',
    fontStyle: 'italic',
  },
  doneMsg: {
    background: '#d4edda',
    border: '1px solid #28a745',
    borderRadius: 6,
    padding: '0.75rem 1rem',
    marginTop: '1rem',
    color: '#155724',
    lineHeight: 1.8,
  },
  hint: {
    color: '#555',
    fontSize: '0.9rem',
    marginTop: '0.5rem',
  },
};
