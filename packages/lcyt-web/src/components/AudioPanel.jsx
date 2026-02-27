import { useState, useEffect, useRef } from 'react';
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
  const [finalText, setFinalText] = useState('');
  const [engine, setEngine] = useState(getSttEngine);
  const [credLoaded, setCredLoaded] = useState(!!getGoogleCredential());
  const [webkitSupported] = useState(
    () => !!(window.SpeechRecognition || window.webkitSpeechRecognition),
  );
  const [cloudError, setCloudError] = useState('');

  // WebKit refs
  const recognitionRef = useRef(null);

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

  // ── Cleanup on unmount ───────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      stopWebkit();
      stopCloud();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── WebKit engine ────────────────────────────────────────────────────────

  function startWebkit() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;

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
      if (final) setFinalText(prev => prev + final + ' ');
      setInterimText(interim);
    };

    recognition.onend = () => {
      // Auto-restart so continuous mode survives silence pauses
      if (recognitionRef.current) {
        try { recognition.start(); } catch {}
      }
    };

    recognition.onerror = (e) => {
      if (e.error === 'no-speech') return;
      recognitionRef.current = null;
      setListening(false);
      setInterimText('');
    };

    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
    setInterimText('');
    setFinalText('');
  }

  function stopWebkit() {
    const rec = recognitionRef.current;
    recognitionRef.current = null;
    if (rec) try { rec.stop(); } catch {}
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

    const data = await res.json();
    if (data.error) throw new Error(data.error.message || 'Cloud STT error');

    const transcript = data.results?.[0]?.alternatives?.[0]?.transcript;
    if (transcript) setFinalText(prev => prev + transcript + ' ');
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
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setCloudError('Microphone access denied.');
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
    setListening(true);
    setInterimText('');
    setFinalText('');
    scheduleNextChunk(stream);
  }

  function stopCloud() {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    if (recorderRef.current?.state === 'recording') {
      try { recorderRef.current.stop(); } catch {}
    }
    recorderRef.current = null;
    setListening(false);
    setInterimText('');
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
              {!finalText && !interimText ? (
                <span className="audio-caption-placeholder">
                  {isWebkit ? 'Listening for speech…' : 'Sending audio to Google Cloud STT…'}
                </span>
              ) : (
                <>
                  {finalText   && <span className="audio-caption-final">{finalText}</span>}
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
