import { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { useSessionContext } from '../contexts/SessionContext';
import { useSentLogContext } from '../contexts/SentLogContext';
import { getSttEngine, getSttLang, getSttCloudConfig } from '../lib/sttConfig';
import { getGoogleCredential, fetchOAuthToken } from '../lib/googleCredential';
import { KEYS } from '../lib/storageKeys.js';
import { getEnabledTranslations, getTranslationShowOriginal } from '../lib/translationConfig';
import { translateAll, openLocalCaptionFile, formatVttCue, formatYouTubeLine } from '../lib/translate';
import { blobToBase64 } from '../lib/fileUtils';
import { isMobileDevice } from '../lib/device';

// Duration of the utterance-end button click flash animation (ms) — must match CSS @keyframes
const UTTERANCE_CLICK_FLASH_MS = 400;

// VAD polling and grace-period constants
const VAD_POLL_INTERVAL_MS       = 50;   // normal check interval (ms)
const VAD_POLL_INTERVAL_GRACE_MS = 100;  // check interval while in grace period (ms)
const VAD_GRACE_PERIOD_MS        = 1000; // cooldown after a VAD-triggered force-stop (ms)

// ─── Component ────────────────────────────────────────────────────────────────

export const AudioPanel = forwardRef(function AudioPanel(
  { visible, onListeningChange, onHoldingChange, onUtteranceChange, onInterimChange, extraMeterCanvasRef },
  ref
) {
  const [listening, setListening] = useState(false);
  const [interimText, setInterimText] = useState('');
  const [engine, setEngine] = useState(getSttEngine);
  const [credLoaded, setCredLoaded] = useState(!!getGoogleCredential());
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
  const lastFinalRef    = useRef('');   // last final transcript sent (for mobile deduplication)

  // Utterance start timestamp — set on first text, cleared after final is dispatched
  const utteranceStartRef   = useRef(null);
  const utteranceTimerRef   = useRef(null);  // setTimeout for timer-based utterance end
  const utteranceTimerSecRef = useRef(0);    // duration (s) of the current utterance timer

  // Whether an utterance is currently in progress (drives the meter overlay button)
  const [utteranceActive, setUtteranceActive] = useState(false);
  // Flash state for the utterance end button click visual cue
  const [utteranceClickFlash, setUtteranceClickFlash] = useState(false);
  // Whether the utterance timer is currently running (drives the timer border animation)
  const [utteranceTimerRunning, setUtteranceTimerRunning] = useState(false);
  // Timer duration in seconds — kept as both state (for effect deps) and ref (for animation style reads)
  const [utteranceTimerSec, setUtteranceTimerSec] = useState(0);

  // Client-side VAD refs (only used when lcyt:client-vad === '1')
  const vadTimerRef         = useRef(null);   // setTimeout handle for the VAD check loop
  const vadAudioCtxRef      = useRef(null);   // AudioContext created locally for VAD
  const vadAnalyserRef      = useRef(null);   // AnalyserNode created locally for VAD
  const vadLocalStreamRef   = useRef(null);   // MediaStream obtained locally for VAD
  const vadSpeakingRef      = useRef(false);  // current VAD speaking state
  const vadSilenceStartRef  = useRef(null);   // timestamp (ms) when silence began
  const vadStartingRef      = useRef(false);  // prevents concurrent VAD initializations
  const vadLastForceStopRef = useRef(0);      // timestamp of last VAD-triggered force-stop (ms)

  // Cloud STT refs
  const streamRef    = useRef(null);   // MediaStream
  const recorderRef  = useRef(null);   // current MediaRecorder
  const oauthRef     = useRef(null);   // { token, expires }

  // Per-language local file handles for "file" target: Map<lang, { writable, seqIdx, format }>
  const localFileHandlesRef = useRef(new Map());
  // Caption sequence index per lang for VTT cue numbering
  const localFileSeqRef = useRef({});

  // Mic soft lock — hold-to-steal state
  const [isHolding, setIsHolding] = useState(false);
  const holdTimerRef = useRef(null);

  // Hold-to-speak mode
  const [holdSpeakEnabled, setHoldSpeakEnabled] = useState(
    () => { try { return localStorage.getItem(KEYS.audio.holdToSpeak) === '1'; } catch { return false; } }
  );

  // Stable refs so imperative handles never have stale closures
  const toggleFnRef      = useRef(null);
  const holdStartRef     = useRef(null);
  const holdEndRef       = useRef(null);
  const holdSpeakStartRef = useRef(null);
  const holdSpeakEndRef   = useRef(null);
  useImperativeHandle(ref, () => ({
    toggle:            ()  => toggleFnRef.current?.(),
    holdStart:         (e) => holdStartRef.current?.(e),
    holdEnd:           ()  => holdEndRef.current?.(),
    holdSpeakStart:    (e) => holdSpeakStartRef.current?.(e),
    holdSpeakEnd:      ()  => holdSpeakEndRef.current?.(),
    utteranceEndClick: () => handleUtteranceEndClick(),
  }), []);

  // ── Sync engine/credential from settings events ──────────────────────────
  useEffect(() => {
    function onCfgChange()  {
      setEngine(getSttEngine());
      try { setHoldSpeakEnabled(localStorage.getItem(KEYS.audio.holdToSpeak) === '1'); } catch {}
    }
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

  const { micHolder, clientId, claimMic, releaseMic, connected } = session;
  const iHaveMic    = micHolder === clientId;
  const otherHasMic = micHolder !== null && !iHaveMic;

  function pushFinalTranscript(text, utteranceTimestamp) {
    const cleaned = String(text || '').trim();
    if (!cleaned) return;

    const enabledTranslations = getEnabledTranslations();
    if (enabledTranslations.length > 0) {
      const sourceLang = getSttLang();
      translateAll(cleaned, sourceLang, enabledTranslations)
        .then(({ translationsMap, captionLang, localFileEntries }) => {
          // Write to local files for "file" target translations
          writeLocalFileEntries(localFileEntries, utteranceTimestamp);

          // Compose caption text: backend will do it now, but we still need text for local display
          // Send original + translations to backend; backend composes the <br> caption
          sendTranscript(cleaned, utteranceTimestamp, translationsMap, captionLang);
        })
        .catch(err => {
          console.warn('Translation failed, using original text', err);
          sendTranscript(cleaned, utteranceTimestamp);
        });
      return;
    }

    // Do not render finalized words in the audio panel UI; just send them.
    sendTranscript(cleaned, utteranceTimestamp);
  }

  async function writeLocalFileEntries(entries, timestamp) {
    const ts = timestamp || new Date().toISOString().replace('Z', '');
    for (const entry of entries) {
      const lang = entry.lang;
      let fileInfo = localFileHandlesRef.current.get(lang);
      if (!fileInfo) {
        // Open a new file for this language
        const suggestedName = `captions-${lang}-${new Date().toISOString().slice(0, 10)}.${entry.format === 'vtt' ? 'vtt' : 'txt'}`;
        const opened = await openLocalCaptionFile(suggestedName);
        if (!opened) continue;
        if (entry.format === 'vtt') {
          await opened.writable.write('WEBVTT\n\n');
        }
        localFileSeqRef.current[lang] = 0;
        fileInfo = { writable: opened.writable, format: entry.format };
        localFileHandlesRef.current.set(lang, fileInfo);
      }
      const seqIdx = (localFileSeqRef.current[lang] || 0) + 1;
      localFileSeqRef.current[lang] = seqIdx;
      try {
        if (fileInfo.format === 'vtt') {
          await fileInfo.writable.write(formatVttCue(seqIdx, ts, null, entry.text));
        } else {
          await fileInfo.writable.write(formatYouTubeLine(entry.text));
        }
      } catch (e) {
        console.warn('Local file write failed', e);
      }
    }
  }

  function getTimestampWithOffset() {
    const offsetSec = parseFloat(localStorage.getItem(KEYS.audio.transcriptionOffset) || '0');
    const offsetMs = Math.round(offsetSec * 1000);
    const syncOffsetMs = session.syncOffset || 0;
    if (!offsetMs && !syncOffsetMs) return undefined; // let backend use its own clock
    const ms = Date.now() + offsetMs + syncOffsetMs;
    // Format as YYYY-MM-DDTHH:MM:SS.mmm (no trailing Z — YouTube API format)
    return new Date(ms).toISOString().replace('Z', '');
  }

  // Returns an utterance start timestamp: uses offset-adjusted time if available,
  // otherwise falls back to a plain ISO string (no trailing Z).
  function getUtteranceTimestamp() {
    return getTimestampWithOffset() || new Date().toISOString().replace('Z', '');
  }

  // Forces the current utterance to end by stopping (and auto-restarting) the recognizer.
  function forceUtteranceEnd() {
    if (utteranceTimerRef.current) {
      clearTimeout(utteranceTimerRef.current);
      utteranceTimerRef.current = null;
    }
    setUtteranceTimerRunning(false);
    const rec = recognitionRef.current;
    if (!rec) return;
    try { rec.stop(); } catch {}
    // recognition.onend will auto-restart
  }

  // Handles a click on the utterance end button — flashes a visual cue then ends the utterance.
  function handleUtteranceEndClick() {
    setUtteranceClickFlash(true);
    setTimeout(() => setUtteranceClickFlash(false), UTTERANCE_CLICK_FLASH_MS);
    forceUtteranceEnd();
  }

  function isUtteranceEndButtonEnabled() {
    try { return localStorage.getItem(KEYS.audio.utteranceEndButton) === '1'; } catch { return false; }
  }

  function getUtteranceEndTimerSec() {
    try { return parseInt(localStorage.getItem(KEYS.audio.utteranceEndTimer) || '0', 10); } catch { return 0; }
  }

  // Starts the utterance-end timer if configured. Call when an utterance begins.
  function maybeStartUtteranceTimer() {
    const timerSec = getUtteranceEndTimerSec();
    if (timerSec > 0 && !utteranceTimerRef.current) {
      utteranceTimerSecRef.current = timerSec;
      setUtteranceTimerSec(timerSec);
      setUtteranceTimerRunning(true);
      utteranceTimerRef.current = setTimeout(() => {
        utteranceTimerRef.current = null;
        setUtteranceTimerRunning(false);
        forceUtteranceEnd();
      }, timerSec * 1000);
    }
  }

  async function sendTranscript(text, explicitTimestamp, translationsMap, captionLang) {
    if (!text) return;
    if (session?.connected) {
      // Use explicit timestamp when provided (e.g. utterance start), otherwise compute now
      const timestamp = explicitTimestamp !== undefined ? explicitTimestamp : getTimestampWithOffset();
      try {
        // Honor batching: if batch interval > 0, queue via construct
        const v = parseInt(localStorage.getItem(KEYS.captions.batchInterval) || '0', 10);
        const intervalMs = Math.min(20, Math.max(0, v)) * 1000;
        const opts = {
          translations: translationsMap,
          captionLang,
          showOriginal: getTranslationShowOriginal(),
        };
        if (intervalMs > 0) {
          await session.construct(text, timestamp, opts);
        } else {
          await session.send(text, timestamp, opts);
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

  // ── Cleanup on unmount ───────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      stopWebkit();
      stopCloud();
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
      // Close any open local caption files
      for (const { writable } of localFileHandlesRef.current.values()) {
        try { writable.close(); } catch {}
      }
      localFileHandlesRef.current.clear();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Auto-stop when another client steals the mic lock ────────────────────
  useEffect(() => {
    if (listening && otherHasMic) {
      if (engine === 'webkit') stopWebkit();
      else stopCloud();
      // Don't releaseMic — the other client already holds it
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [micHolder]);

  // Notify parent when listening state changes (e.g. for mobile bar button appearance)
  useEffect(() => { onListeningChange?.(listening); }, [listening, onListeningChange]);

  // Notify parent when utterance state changes (e.g. for mobile bar overlays)
  useEffect(() => {
    onUtteranceChange?.(utteranceActive, utteranceTimerRunning, utteranceTimerSec);
  }, [utteranceActive, utteranceTimerRunning, utteranceTimerSec, onUtteranceChange]);

  // Notify parent when interim text changes (e.g. for mobile live text display)
  useEffect(() => {
    onInterimChange?.(interimText);
  }, [interimText, onInterimChange]);

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
    const selectedDeviceId = (() => { try { return localStorage.getItem(KEYS.audio.deviceId) || ''; } catch { return ''; } })();
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
    const isMobile = isMobileDevice();
    recognition.interimResults = !isMobile;
    recognition.lang           = getSttLang();

    recognition.onresult = (event) => {
      let interim = '';
      let final   = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) final += t;
        else interim += t;
      }
      // Capture utterance start on first text (interim or final) if not already set
      if ((interim || final) && !utteranceStartRef.current) {
        utteranceStartRef.current = getUtteranceTimestamp();
        setUtteranceActive(true);
        maybeStartUtteranceTimer();
      }
      if (!isMobile) setInterimText(interim);
      if (final) {
        if (isMobile) {
          const trimmed = final.trim();
          if (trimmed === lastFinalRef.current) return;
          lastFinalRef.current = trimmed;
        }
        const ts = utteranceStartRef.current;
        utteranceStartRef.current = null;
        setUtteranceActive(false);
        if (utteranceTimerRef.current) {
          clearTimeout(utteranceTimerRef.current);
          utteranceTimerRef.current = null;
        }
        setUtteranceTimerRunning(false);
        pushFinalTranscript(final, ts);
      }
    };

    recognition.onstart = () => { }; 

    recognition.onend = () => {
      // Auto-restart so continuous mode survives silence pauses.
      // A small delay prevents rapid start/stop cycles on browsers that need settling time.
      if (recognitionRef.current) {
        setTimeout(() => {
          if (!recognitionRef.current) return;
          try { recognition.start(); } catch {}
          // Restart VAD check loop if enabled — it exits early after forcing finalization
          if (localStorage.getItem(KEYS.audio.clientVad) === '1' && !vadTimerRef.current) {
            startVAD(recognition);
          }
        }, 100);
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
    lastFinalRef.current = '';
    utteranceStartRef.current = null;

    // Optional client-side VAD — enabled via localStorage flag lcyt:client-vad = '1'
    if (localStorage.getItem(KEYS.audio.clientVad) === '1') {
      startVAD(recognition);
    }
  }

  function stopWebkit() {
    const rec = recognitionRef.current;
    recognitionRef.current = null;
    if (rec) try { rec.stop(); } catch {}
    stopVAD();
    utteranceStartRef.current = null;
    setUtteranceActive(false);
    setUtteranceTimerRunning(false);
    if (utteranceTimerRef.current) {
      clearTimeout(utteranceTimerRef.current);
      utteranceTimerRef.current = null;
    }
    // Stop meter stream if we opened one for WebKit
    if (meterStreamRef.current) {
      try { meterStreamRef.current.getTracks().forEach(t => t.stop()); } catch {}
      meterStreamRef.current = null;
    }
    detachMeter();
    setListening(false);
    setInterimText('');
  }

  // ─── Client-side VAD (optional) ──────────────────────────────────────────

  function stopVAD() {
    vadStartingRef.current = false;
    if (vadTimerRef.current) {
      clearTimeout(vadTimerRef.current);
      vadTimerRef.current = null;
    }
    if (vadAnalyserRef.current) {
      try { vadAnalyserRef.current.disconnect(); } catch {}
      vadAnalyserRef.current = null;
    }
    if (vadAudioCtxRef.current) {
      try { vadAudioCtxRef.current.close(); } catch {}
      vadAudioCtxRef.current = null;
    }
    if (vadLocalStreamRef.current) {
      try { vadLocalStreamRef.current.getTracks().forEach(t => t.stop()); } catch {}
      vadLocalStreamRef.current = null;
    }
    vadSpeakingRef.current = false;
    vadSilenceStartRef.current = null;
  }

  async function startVAD(recognition) {
    // Guard against concurrent initializations — e.g. rapid onend→startVAD cycles
    if (vadStartingRef.current) return;
    vadStartingRef.current = true;
    try {
      const silenceMs = Math.max(0, parseInt(localStorage.getItem(KEYS.audio.clientVadSilenceMs) || '500', 10));
      const threshold = Math.max(0, parseFloat(localStorage.getItem(KEYS.audio.clientVadThreshold) || '0.01'));

      // Prefer the already-running meter analyser; fall back to locally-created VAD analyser or create one
      let analyser = analyserRef.current || vadAnalyserRef.current;
      if (!analyser) {
        try {
          const AudioCtx = window.AudioContext || window.webkitAudioContext;
          if (!AudioCtx) return;
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          vadLocalStreamRef.current = stream;
          const ctx = new AudioCtx();
          vadAudioCtxRef.current = ctx;
          const src = ctx.createMediaStreamSource(stream);
          const an = ctx.createAnalyser();
          an.fftSize = 256;
          src.connect(an);
          vadAnalyserRef.current = an;
          analyser = an;
        } catch (e) {
          console.warn('Client VAD: could not obtain audio stream for analysis', e);
          return;
        }
      }

      const data = new Float32Array(analyser.fftSize);
      vadSpeakingRef.current = false;
      vadSilenceStartRef.current = null;

      function check() {
        // Stop the loop if recognition was torn down
        if (!recognitionRef.current) return;
        try {
          analyser.getFloatTimeDomainData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
          const rms = Math.sqrt(sum / data.length);

          if (rms >= threshold) {
            // Speech energy detected
            vadSilenceStartRef.current = null;
            if (!vadSpeakingRef.current) {
              vadSpeakingRef.current = true;
            }
            // Capture utterance start timestamp before the first interim/final arrives
            if (!utteranceStartRef.current) {
              utteranceStartRef.current = getUtteranceTimestamp();
              setUtteranceActive(true);
              maybeStartUtteranceTimer();
            }
          } else {
            // Below threshold — measure sustained silence
            if (vadSpeakingRef.current) {
              if (!vadSilenceStartRef.current) {
                vadSilenceStartRef.current = Date.now();
              } else if (Date.now() - vadSilenceStartRef.current >= silenceMs) {
                // Sustained silence: flip speaking state and force finalization
                vadSpeakingRef.current = false;
                vadSilenceStartRef.current = null;
                vadLastForceStopRef.current = Date.now();
                try { recognition.stop(); } catch {}
                // recognition.onend will auto-restart; utteranceStartRef cleared by onresult
                return; // stop polling until onend restarts recognition
              }
            }
          }
        } catch {}
        // Skip polling if we're within the grace period after a VAD-triggered force-stop,
        // to prevent rapid stop/start cycles when silence persists after restart.
        if (Date.now() - vadLastForceStopRef.current < VAD_GRACE_PERIOD_MS) {
          vadTimerRef.current = setTimeout(check, VAD_POLL_INTERVAL_GRACE_MS);
        } else {
          vadTimerRef.current = setTimeout(check, VAD_POLL_INTERVAL_MS);
        }
      }

      vadTimerRef.current = setTimeout(check, VAD_POLL_INTERVAL_MS);
    } catch (e) {
      console.warn('Client VAD: initialization error', e);
    } finally {
      vadStartingRef.current = false;
    }
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

  async function recognizeChunk(blob, chunkTimestamp) {
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
      // Pass the chunk start timestamp so it is preserved through async translation.
      pushFinalTranscript(transcript, chunkTimestamp);
    }
  }

  function scheduleNextChunk(stream) {
    // Don't schedule if we've stopped
    if (!streamRef.current) return;

    // Capture the chunk start time now — before the async STT round-trip.
    // This timestamp is passed to pushFinalTranscript so the utterance-start
    // time is preserved even when translation adds latency.
    const chunkTimestamp = getUtteranceTimestamp();

    const recorder = new MediaRecorder(stream);
    const chunks   = [];
    recorderRef.current = recorder;

    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

    recorder.onstop = async () => {
      if (!streamRef.current) return; // user stopped
      const blob = new Blob(chunks, { type: recorder.mimeType });
      try {
        await recognizeChunk(blob, chunkTimestamp);
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

    const selectedDeviceId = (() => { try { return localStorage.getItem(KEYS.audio.deviceId) || ''; } catch { return ''; } })();
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

      const data = new Float32Array(analyser.fftSize);

      function draw() {
        analyser.getFloatTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
        const rms = Math.sqrt(sum / data.length);
        const level = Math.min(1, rms * 3); // scale for visibility

        for (const cvs of [meterCanvasRef.current, extraMeterCanvasRef?.current]) {
          if (!cvs || !cvs.clientWidth) continue;
          const w = cvs.width = cvs.clientWidth * (window.devicePixelRatio || 1);
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
    for (const cvs of [meterCanvasRef.current, extraMeterCanvasRef?.current]) {
      if (!cvs) continue;
      cvs.getContext('2d').clearRect(0, 0, cvs.width, cvs.height);
    }
  }

  // ─── Toggle ───────────────────────────────────────────────────────────────

  async function toggle() {
    if (listening) {
      if (engine === 'webkit') stopWebkit();
      else stopCloud();
      if (connected) releaseMic().catch(() => {});
    } else {
      if (connected) claimMic().catch(() => {});
      if (engine === 'webkit') startWebkit();
      else startCloud();
    }
  }

  // ─── Hold-to-steal handlers ──────────────────────────────────────────────

  function onHoldStart(e) {
    e.preventDefault();
    setIsHolding(true);
    holdTimerRef.current = setTimeout(async () => {
      setIsHolding(false);
      if (connected) claimMic().catch(() => {});
      if (engine === 'webkit') startWebkit();
      else startCloud();
    }, 2000);
  }

  function onHoldEnd() {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    setIsHolding(false);
  }

  // ─── Hold-to-speak handlers ──────────────────────────────────────────────

  function onHoldSpeakStart(e) {
    e.preventDefault();
    if (!listening) {
      if (connected) claimMic().catch(() => {});
      if (engine === 'webkit') startWebkit();
      else startCloud();
    }
  }

  function onHoldSpeakEnd() {
    if (listening) {
      if (engine === 'webkit') stopWebkit();
      else stopCloud();
      if (connected) releaseMic().catch(() => {});
    }
  }

  // ─── Derived state ────────────────────────────────────────────────────────

  const isWebkit = engine === 'webkit';
  const canStart = isWebkit ? webkitSupported : credLoaded;

  const hint = listening ? null
    : isWebkit && !webkitSupported ? 'Web Speech API not supported — try Chrome or Edge.'
    : !isWebkit && !credLoaded     ? 'Load a Google service account key in Settings → STT / Audio.'
    : null;

  // Keep fn refs current so imperative handles never have stale closures
  toggleFnRef.current      = toggle;
  holdStartRef.current     = onHoldStart;
  holdEndRef.current       = onHoldEnd;
  holdSpeakStartRef.current = onHoldSpeakStart;
  holdSpeakEndRef.current   = onHoldSpeakEnd;

  // Notify parent of holding state changes (for mobile bar)
  useEffect(() => { onHoldingChange?.(isHolding); }, [isHolding, onHoldingChange]);

  return (
    <div className={`audio-panel${visible ? ' audio-panel--open' : ' audio-panel--hidden'}`}>
      <div className="audio-panel__row">
        {/* Toggle / locked button */}
        {otherHasMic ? (
          <button
            className={`btn audio-caption-btn audio-caption-btn--locked${isHolding ? ' audio-caption-btn--holding' : ''}`}
            disabled={!canStart}
            onPointerDown={onHoldStart}
            onPointerUp={onHoldEnd}
            onPointerLeave={onHoldEnd}
            onPointerCancel={onHoldEnd}
          >
            {isHolding ? '🎙 Hold…' : '🔒 Another mic is active'}
          </button>
        ) : holdSpeakEnabled ? (
          <button
            className={`btn audio-caption-btn audio-caption-btn--hold-to-speak${listening ? ' audio-caption-btn--active' : ' btn--primary'}`}
            disabled={!canStart}
            onPointerDown={onHoldSpeakStart}
            onPointerUp={onHoldSpeakEnd}
            onPointerLeave={onHoldSpeakEnd}
            onPointerCancel={onHoldSpeakEnd}
          >
            {listening ? '🎙 Hold…' : '🎙 Hold to speak'}
          </button>
        ) : (
          <button
            className={`btn audio-caption-btn${listening ? ' audio-caption-btn--active' : ' btn--primary'}`}
            disabled={!canStart}
            onClick={toggle}
          >
            {listening ? '⏹ Stop' : '🎙 Mic Capture'}
          </button>
        )}

        {/* Level meter — always visible when panel is open */}
        <div className="audio-meter-wrap">
          <canvas
            ref={meterCanvasRef}
            className="audio-meter"
            aria-hidden="true"
          />
          {listening && isUtteranceEndButtonEnabled() && (
            <button
              className={[
                'audio-meter-end-btn',
                utteranceActive ? 'audio-meter-end-btn--active' : 'audio-meter-end-btn--idle',
                utteranceClickFlash ? 'audio-meter-end-btn--clicked' : '',
              ].filter(Boolean).join(' ')}
              onClick={utteranceActive ? handleUtteranceEndClick : undefined}
              title={utteranceActive ? 'Force end utterance' : 'Utterance detection active'}
            >
              🗣
            </button>
          )}
          {listening && utteranceTimerRunning && (
            <div
              className="audio-meter-timer-border"
              style={{ animationDuration: `${utteranceTimerSecRef.current}s` }}
            />
          )}
        </div>
      </div>

      {/* Hint / error line */}
      {(hint || cloudError) && (
        <p className={`audio-panel__hint${cloudError ? ' audio-panel__hint--error' : ''}`}>
          {cloudError || hint}
        </p>
      )}

      {/* Live transcription box — hidden on mobile via CSS */}
      {listening && (
        <div className="audio-caption-live audio-caption-live--compact">
          {interimText
            ? <span className="audio-caption-interim">{interimText}</span>
            : <span className="audio-caption-placeholder">
                {isWebkit ? 'Listening…' : 'Sending to Google Cloud STT…'}
              </span>
          }
        </div>
      )}
    </div>
  );
});

