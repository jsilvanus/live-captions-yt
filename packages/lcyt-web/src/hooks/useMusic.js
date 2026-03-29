import { useState, useEffect, useCallback } from 'react';
import { useMusicDetector } from './useMusicDetector';
import { useSessionContext } from '../contexts/SessionContext';
import { KEYS } from '../lib/storageKeys.js';

/**
 * Unified music state hook.
 *
 * Combines client-side microphone analysis (useMusicDetector) with
 * SSE-confirmed sound_label / bpm_update events from the backend.
 *
 * The SSE events (fired when the backend strips <!-- sound:... --> metacodes
 * from captions sent by useMusicDetector) are treated as authoritative — they
 * confirm that the metacode reached the server.  When disconnected, the raw
 * detector values are used directly.
 *
 * @param {object} [opts]
 * @param {React.RefObject} [opts.analyserRef] - AnalyserNode ref from AudioContext
 * @returns {{ label, bpm, confidence, available, running, enabled, bpmEnabled,
 *             setEnabled, setBpmEnabled }}
 */
export function useMusic({ analyserRef } = {}) {
  const [enabled, setEnabledState] = useState(() => {
    try { return localStorage.getItem(KEYS.audio.musicDetect) !== 'false'; } catch { return true; }
  });
  const [bpmEnabled, setBpmEnabledState] = useState(() => {
    try { return localStorage.getItem(KEYS.audio.musicDetectBpm) !== 'false'; } catch { return true; }
  });

  // SSE-confirmed state from backend
  const [sseLabel, setSseLabel] = useState(null);
  const [sseBpm, setSseBpm]     = useState(null);

  const session = useSessionContext();

  // Subscribe to sound SSE events while session exposes subscribeSseEvent
  useEffect(() => {
    if (!session?.subscribeSseEvent) return;
    const unsubLabel = session.subscribeSseEvent('sound_label', (data) => {
      setSseLabel(data.label ?? null);
    });
    const unsubBpm = session.subscribeSseEvent('bpm_update', (data) => {
      const v = Number(data.bpm);
      setSseBpm(Number.isFinite(v) ? v : null);
    });
    return () => { unsubLabel(); unsubBpm(); };
  }, [session.subscribeSseEvent]);

  // Clear SSE state when session disconnects
  useEffect(() => {
    if (!session.connected) {
      setSseLabel(null);
      setSseBpm(null);
    }
  }, [session.connected]);

  // Client-side detector (sends metacodes when running)
  const detector = useMusicDetector({ analyserRef, enabled, bpmEnabled });

  const setEnabled = useCallback(function setEnabled(v) {
    setEnabledState(v);
    try { localStorage.setItem(KEYS.audio.musicDetect, v ? 'true' : 'false'); } catch {}
  }, []);

  const setBpmEnabled = useCallback(function setBpmEnabled(v) {
    setBpmEnabledState(v);
    try { localStorage.setItem(KEYS.audio.musicDetectBpm, v ? 'true' : 'false'); } catch {}
  }, []);

  return {
    // SSE (confirmed) takes priority over local detector; fall back when disconnected
    label:      sseLabel ?? detector.label,
    bpm:        sseBpm   ?? detector.bpm,
    confidence: detector.confidence,
    available:  detector.available,
    running:    detector.running,
    enabled,
    bpmEnabled,
    setEnabled,
    setBpmEnabled,
  };
}
