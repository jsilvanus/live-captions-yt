/**
 * useMusicDetector — client-side music / speech / silence detection hook.
 *
 * Attaches to the AnalyserNode provided by AudioPanel (via analyserRef) and
 * runs spectral classification and BPM estimation on each analysis tick.
 *
 * When a label change is confirmed (after `confirmFrames` consecutive frames
 * agree), the hook emits a <!-- sound:label --> (and optionally <!-- bpm:N -->)
 * metacode caption via captionContext.send().  The caption is routed through
 * the server's SoundCaptionProcessor, which strips the metacode before YouTube
 * delivery and fires sound_label / bpm_update SSE events.
 *
 * This hook NEVER requests microphone access itself; it only reads from the
 * analyserRef that AudioPanel already set up.
 *
 * @param {object} opts
 * @param {React.RefObject<AnalyserNode|null>} opts.analyserRef
 * @param {boolean}  [opts.enabled=false]            master on/off switch
 * @param {boolean}  [opts.bpmEnabled=true]          run BPM estimation
 * @param {number}   [opts.intervalMs=500]           analysis tick interval (ms)
 * @param {number}   [opts.confirmFrames=4]          consecutive frames to confirm a label
 * @param {number}   [opts.confidenceThreshold=0.5]  minimum confidence to accept classification
 * @param {function} [opts.onLabelChange]            ({ label, previous, confidence, bpm })
 * @param {function} [opts.onBpmUpdate]              ({ bpm, confidence })
 * @returns {{ label: string|null, bpm: number|null, confidence: number|null, available: boolean, running: boolean }}
 */

import { useState, useEffect, useRef } from 'react';
import { classifyFromFrequency, detectBpmFromPcm, createBpmSmoother } from '../lib/musicAnalysis.js';
import { useCaptionContext } from '../contexts/CaptionContext.jsx';
import { useSessionContext } from '../contexts/SessionContext.jsx';

export function useMusicDetector({
  analyserRef,
  enabled         = false,
  bpmEnabled      = true,
  intervalMs      = 500,
  confirmFrames   = 4,
  confidenceThreshold = 0.5,
  onLabelChange,
  onBpmUpdate,
} = {}) {
  const caption = useCaptionContext();
  const session = useSessionContext();

  const [label, setLabel]           = useState(null);
  const [bpm, setBpm]               = useState(null);
  const [confidence, setConfidence] = useState(null);
  const [running, setRunning]       = useState(false);

  // Stable refs for stateful classification
  const pendingLabelRef   = useRef(null);
  const pendingCountRef   = useRef(0);
  const currentLabelRef   = useRef(null);
  const lastBpmRef        = useRef(null);
  const smootherRef       = useRef(createBpmSmoother(0.3));

  useEffect(() => {
    if (!enabled) {
      setRunning(false);
      return;
    }

    setRunning(true);

    const id = setInterval(() => {
      const analyser = analyserRef?.current;
      if (!analyser) return;

      // ── Read frequency domain data ────────────────────────────────────
      const freqData = new Float32Array(analyser.frequencyBinCount);
      analyser.getFloatFrequencyData(freqData);

      const sampleRate = analyser.context?.sampleRate ?? 44100;

      // ── Classify ──────────────────────────────────────────────────────
      const result = classifyFromFrequency(freqData, sampleRate);
      if (result.confidence < confidenceThreshold && result.label !== 'silence') {
        // Low-confidence non-silence: skip this frame to avoid noise
        return;
      }

      // ── BPM estimation (when label is music) ──────────────────────────
      let estimatedBpm = null;
      if (bpmEnabled && result.label === 'music') {
        const timeData = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(timeData);
        const bpmResult = detectBpmFromPcm(timeData, sampleRate);
        if (bpmResult) {
          estimatedBpm = smootherRef.current.smooth(bpmResult.bpm);
        }
      } else {
        smootherRef.current.reset();
      }

      // ── Confirm state machine ─────────────────────────────────────────
      const newLabel = result.label;
      if (newLabel === pendingLabelRef.current) {
        pendingCountRef.current += 1;
      } else {
        pendingLabelRef.current  = newLabel;
        pendingCountRef.current  = 1;
      }

      if (pendingCountRef.current >= confirmFrames) {
        const prev = currentLabelRef.current;
        if (newLabel !== prev) {
          currentLabelRef.current = newLabel;
          setLabel(newLabel);
          setConfidence(result.confidence);
          onLabelChange?.({ label: newLabel, previous: prev, confidence: result.confidence, bpm: estimatedBpm });

          // Emit metacode via caption pipeline
          if (session?.connected) {
            let metacode = `<!-- sound:${newLabel} -->`;
            if (newLabel === 'music' && estimatedBpm != null) {
              metacode += ` <!-- bpm:${estimatedBpm} -->`;
            }
            caption?.send(metacode, undefined, { skipLog: true }).catch(() => {});
          }
        }
      }

      // ── BPM update (independent of label change) ──────────────────────
      if (estimatedBpm != null && estimatedBpm !== lastBpmRef.current) {
        const bpmDiff = lastBpmRef.current != null ? Math.abs(estimatedBpm - lastBpmRef.current) : Infinity;
        if (bpmDiff > 2) {
          lastBpmRef.current = estimatedBpm;
          setBpm(estimatedBpm);
          onBpmUpdate?.({ bpm: estimatedBpm, confidence: result.confidence });
        }
      }
    }, intervalMs);

    return () => {
      clearInterval(id);
      setRunning(false);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, bpmEnabled, intervalMs, confirmFrames, confidenceThreshold]);

  const available = !!(analyserRef?.current);

  return { label, bpm, confidence, available, running };
}
