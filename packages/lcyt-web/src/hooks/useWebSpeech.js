import { useState, useRef, useEffect, useCallback } from 'react';

/**
 * Browser SpeechRecognition wrapper.
 *
 * - Callbacks are read through a ref, so handlers bound at start() never see stale props/closures.
 * - `mode: 'local'` prefers on-device recognition (`processLocally`); when the browser rejects it
 *   (`language-not-supported`, no language pack) the recognizer restarts once in normal mode.
 *   `effectiveMode` reports what is actually in use.
 * - Changing `lang` or `mode` while listening restarts the recognizer (Chrome applies them on start only).
 * - `restart()` can be called explicitly.
 */
export function useWebSpeech({ lang, mode = 'normal', continuous = true, interim = true, onInterim, onFinal, onStart, onError, enabled = true }) {
  const [status, setStatus] = useState('idle'); // 'idle' | 'listening' | 'error'
  const [effectiveMode, setEffectiveMode] = useState('normal'); // 'normal' | 'local'
  const recRef = useRef(null);
  const localFailedRef = useRef(false); // local mode was refused: stay in normal until the mode/lang changes

  const cbRef = useRef({});
  cbRef.current = { onInterim, onFinal, onStart, onError };
  const propsRef = useRef({});
  propsRef.current = { lang, mode, continuous, interim };

  const applySettings = useCallback((recognition) => {
    const p = propsRef.current;
    recognition.continuous = !!p.continuous;
    recognition.interimResults = !!p.interim;
    if (p.lang) recognition.lang = p.lang;
    const wantLocal = p.mode === 'local' && !localFailedRef.current && 'processLocally' in recognition;
    try { if ('processLocally' in recognition) recognition.processLocally = wantLocal; } catch {}
    setEffectiveMode(wantLocal ? 'local' : 'normal');
  }, []);

  const start = useCallback(() => {
    if (!enabled) return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setStatus('error');
      cbRef.current.onError?.(new Error('SpeechRecognition not supported'));
      return;
    }

    // If an existing instance exists, stop it first
    if (recRef.current) {
      const old = recRef.current;
      recRef.current = null;
      try { old.stop(); } catch {}
    }

    const recognition = new SR();
    applySettings(recognition);

    recognition.onresult = (event) => {
      let interimText = '';
      let finalText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText += t;
        else interimText += t;
      }
      if (interimText) cbRef.current.onInterim?.(interimText);
      if (finalText) cbRef.current.onFinal?.(finalText);
    };

    recognition.onstart = () => {
      setStatus('listening');
      cbRef.current.onStart?.();
    };

    recognition.onend = () => {
      // Auto-restart so continuous mode survives silence pauses.
      // Small delay prevents rapid cycles.
      if (recRef.current !== recognition) {
        if (!recRef.current) setStatus('idle');
        return;
      }
      setTimeout(() => {
        if (recRef.current !== recognition) return;
        applySettings(recognition); // pick up a changed language or mode
        try { recognition.start(); } catch (e) {
          setStatus('error');
          cbRef.current.onError?.(e);
        }
      }, 100);
    };

    recognition.onerror = (e) => {
      if (e && e.error === 'no-speech') return;
      if (e && e.error === 'language-not-supported' && propsRef.current.mode === 'local' && !localFailedRef.current) {
        // On-device recognition is not available for this language: carry on in normal mode.
        localFailedRef.current = true;
        return; // onend follows and restarts with the settings re-applied
      }
      setStatus('error');
      cbRef.current.onError?.(e);
      if (recRef.current === recognition) recRef.current = null;
    };

    recRef.current = recognition;
    try {
      recognition.start();
    } catch (e) {
      setStatus('error');
      cbRef.current.onError?.(e);
      recRef.current = null;
    }
  }, [enabled, applySettings]);

  const stop = useCallback(() => {
    const r = recRef.current;
    recRef.current = null;
    try { r?.stop(); } catch {}
    setStatus('idle');
  }, []);

  // Apply new settings now: stop() ends the current session and onend starts the next one.
  const restart = useCallback(() => {
    const r = recRef.current;
    if (!r) return;
    try { r.stop(); } catch {}
  }, []);

  // A changed language or mode while listening restarts the recognizer.
  const prevRef = useRef({ lang, mode });
  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = { lang, mode };
    if (prev.lang === lang && prev.mode === mode) return;
    localFailedRef.current = false;
    restart();
  }, [lang, mode, restart]);

  // Stop on unmount
  useEffect(() => {
    return () => {
      const r = recRef.current;
      recRef.current = null;
      try { r?.stop(); } catch {}
    };
  }, []);

  return { status, effectiveMode, start, stop, restart };
}
