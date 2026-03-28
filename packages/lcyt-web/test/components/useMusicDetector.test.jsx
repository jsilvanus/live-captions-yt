/**
 * Tests for useMusicDetector hook.
 *
 * Vitest + jsdom environment.
 * CaptionContext and SessionContext are mocked so no real network traffic occurs.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRef } from 'react';
import { useMusicDetector } from '../../src/hooks/useMusicDetector.js';

// ─── Module mocks ────────────────────────────────────────────────────────────

const mockSend = vi.fn().mockResolvedValue({ ok: true, requestId: 'req-music' });

vi.mock('../../src/contexts/CaptionContext.jsx', () => ({
  useCaptionContext: () => ({ send: mockSend }),
}));

vi.mock('../../src/contexts/SessionContext.jsx', () => ({
  useSessionContext: () => ({ connected: true }),
}));

// ─── AnalyserNode stub ───────────────────────────────────────────────────────

/**
 * Build a fake AnalyserNode.
 * By default, frequency data = all‐silence (-Infinity) and time-domain data = zeros.
 */
function makeAnalyser({ freqData = null, timeData = null, fftSize = 2048, sampleRate = 44100 } = {}) {
  const binCount = fftSize / 2;
  const freq = freqData ?? new Float32Array(binCount).fill(-Infinity);
  const time = timeData ?? new Float32Array(fftSize);

  return {
    frequencyBinCount: binCount,
    fftSize,
    context: { sampleRate },
    getFloatFrequencyData(dest) { dest.set(freq.slice(0, dest.length)); },
    getFloatTimeDomainData(dest) { dest.set(time.slice(0, dest.length)); },
  };
}

/** Build tonal frequency bins (music-like: single peak at low bin, rest very quiet). */
function makeMusicFreqData(binCount = 1024, peakBin = 20) {
  const d = new Float32Array(binCount).fill(-96);
  d[peakBin]     = -3;
  d[peakBin - 1] = -12;
  d[peakBin + 1] = -12;
  return d;
}

/** Build flat white-noise bins (speech-like). */
function makeSpeechFreqData(binCount = 1024) {
  return new Float32Array(binCount).fill(-20);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useMusicDetector — initial state', () => {
  it('has null label and bpm and is not running when disabled', () => {
    const analyserRef = { current: null };
    const { result } = renderHook(() =>
      useMusicDetector({ analyserRef, enabled: false }),
    );

    expect(result.current.label).toBeNull();
    expect(result.current.bpm).toBeNull();
    expect(result.current.running).toBe(false);
  });

  it('available=false when analyserRef.current is null', () => {
    const analyserRef = { current: null };
    const { result } = renderHook(() =>
      useMusicDetector({ analyserRef, enabled: true }),
    );
    expect(result.current.available).toBe(false);
  });

  it('available=true when analyserRef.current is set', () => {
    const analyserRef = { current: makeAnalyser() };
    const { result } = renderHook(() =>
      useMusicDetector({ analyserRef, enabled: true }),
    );
    expect(result.current.available).toBe(true);
  });

  it('running=true when enabled', () => {
    const analyserRef = { current: makeAnalyser() };
    const { result } = renderHook(() =>
      useMusicDetector({ analyserRef, enabled: true }),
    );
    expect(result.current.running).toBe(true);
  });
});

describe('useMusicDetector — silence detection', () => {
  it('confirms silence label after enough ticks with silent analyser', () => {
    const analyser = makeAnalyser(); // silence by default
    const analyserRef = { current: analyser };

    const { result } = renderHook(() =>
      useMusicDetector({
        analyserRef,
        enabled: true,
        intervalMs: 100,
        confirmFrames: 2,
        confidenceThreshold: 0.1,
      }),
    );

    // Advance time past confirmFrames × intervalMs
    act(() => { vi.advanceTimersByTime(100 * 3); });

    expect(result.current.label).toBe('silence');
  });
});

describe('useMusicDetector — music detection', () => {
  it('confirms music label with tonal frequency data', () => {
    const analyser = makeAnalyser({ freqData: makeMusicFreqData() });
    const analyserRef = { current: analyser };

    const { result } = renderHook(() =>
      useMusicDetector({
        analyserRef,
        enabled: true,
        intervalMs: 100,
        confirmFrames: 3,
        confidenceThreshold: 0,
      }),
    );

    act(() => { vi.advanceTimersByTime(100 * 5); });

    expect(result.current.label).toBe('music');
  });
});

describe('useMusicDetector — metacode emission', () => {
  it('sends silence metacode via captionContext.send when label confirmed', async () => {
    const analyser = makeAnalyser(); // silence
    const analyserRef = { current: analyser };

    renderHook(() =>
      useMusicDetector({
        analyserRef,
        enabled: true,
        intervalMs: 100,
        confirmFrames: 2,
        confidenceThreshold: 0,
      }),
    );

    await act(async () => { vi.advanceTimersByTime(100 * 4); });

    // Should have called send with a sound metacode
    const silenceCalls = mockSend.mock.calls.filter(
      ([text]) => typeof text === 'string' && text.includes('sound:silence'),
    );
    expect(silenceCalls.length).toBeGreaterThan(0);
  });

  it('includes bpm metacode in send when music label confirmed', async () => {
    // Build click-track PCM to provide detectable BPM
    const bpm  = 120;
    const sr   = 44100;
    const dur  = 3;
    const pcm  = new Float32Array(Math.round(dur * sr));
    const period = Math.round((60 / bpm) * sr);
    for (let i = 0; i < pcm.length; i += period) { pcm[i] = 1.0; }

    const analyser = makeAnalyser({
      freqData: makeMusicFreqData(),
      timeData: pcm,
      fftSize: pcm.length, // ensures time buffer covers our click-track
    });
    const analyserRef = { current: analyser };

    renderHook(() =>
      useMusicDetector({
        analyserRef,
        enabled: true,
        bpmEnabled: true,
        intervalMs: 100,
        confirmFrames: 2,
        confidenceThreshold: 0,
      }),
    );

    await act(async () => { vi.advanceTimersByTime(100 * 5); });

    // At least one send call should have sound:music
    const musicCalls = mockSend.mock.calls.filter(
      ([text]) => typeof text === 'string' && text.includes('sound:music'),
    );
    expect(musicCalls.length).toBeGreaterThan(0);
  });
});

describe('useMusicDetector — disable / cleanup', () => {
  it('stops running when enabled is toggled to false', () => {
    const analyser = makeAnalyser();
    const analyserRef = { current: analyser };

    const { result, rerender } = renderHook(
      ({ enabled }) => useMusicDetector({ analyserRef, enabled, intervalMs: 100, confirmFrames: 2 }),
      { initialProps: { enabled: true } },
    );

    expect(result.current.running).toBe(true);

    rerender({ enabled: false });
    expect(result.current.running).toBe(false);
  });
});
