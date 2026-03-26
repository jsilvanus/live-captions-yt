import { useState, useRef, useEffect, useCallback } from 'react';

export function useWebSpeech({ lang, continuous = true, interim = true, onInterim, onFinal, onStart, onError, enabled = true }) {
  const [status, setStatus] = useState('idle'); // 'idle' | 'listening' | 'error'
  const recRef = useRef(null);
  const restartingRef = useRef(false);

  const start = useCallback(() => {
    if (!enabled) return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setStatus('error');
      onError?.(new Error('SpeechRecognition not supported'));
      return;
    }

    // If an existing instance exists, stop it first
    if (recRef.current) {
      try { recRef.current.stop(); } catch {}
      recRef.current = null;
    }

    const recognition = new SR();
    recognition.continuous = !!continuous;
    recognition.interimResults = !!interim;
    if (lang) recognition.lang = lang;

    recognition.onresult = (event) => {
      let interimText = '';
      let finalText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText += t;
        else interimText += t;
      }
      if (interimText && onInterim) onInterim(interimText);
      if (finalText && onFinal) onFinal(finalText);
    };

    recognition.onstart = () => {
      setStatus('listening');
      onStart?.();
    };

    recognition.onend = () => {
      // Auto-restart so continuous mode survives silence pauses.
      // Small delay prevents rapid cycles.
      if (!recRef.current) {
        setStatus('idle');
        return;
      }
      setTimeout(() => {
        if (!recRef.current) return;
        try { recognition.start(); } catch (e) {
          // If start fails, propagate error
          setStatus('error');
          onError?.(e);
        }
      }, 100);
    };

    recognition.onerror = (e) => {
      if (e && e.error === 'no-speech') return;
      setStatus('error');
      onError?.(e);
      recRef.current = null;
    };

    recRef.current = recognition;
    try {
      recognition.start();
    } catch (e) {
      setStatus('error');
      onError?.(e);
      recRef.current = null;
    }
  }, [continuous, interim, lang, onInterim, onFinal, onStart, onError, enabled]);

  const stop = useCallback(() => {
    const r = recRef.current;
    recRef.current = null;
    try { r?.stop(); } catch {}
    setStatus('idle');
  }, []);

  // Update lang/interim while running
  useEffect(() => {
    if (!recRef.current) return;
    try {
      recRef.current.lang = lang;
      recRef.current.interimResults = !!interim;
      recRef.current.continuous = !!continuous;
    } catch {}
  }, [lang, interim, continuous]);

  // Stop on unmount
  useEffect(() => {
    return () => {
      try { recRef.current?.stop(); } catch {}
      recRef.current = null;
    };
  }, []);

  return { status, start, stop };
}
