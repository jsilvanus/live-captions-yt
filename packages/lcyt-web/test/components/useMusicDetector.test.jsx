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
import * as musicAnalysis from '../../src/lib/musicAnalysis.js';

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
  localStorage.clear();
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
        autoCalibrate: false,
      }),
    );

    // Advance time past confirmFrames × intervalMs
    act(() => { vi.advanceTimersByTime(100 * 3); });

    expect(result.current.label).toBe('silence');
  });
});

describe('useMusicDetector — music detection', () => {
  it('confirms music label with tonal frequency data', () => {
    const spyClassify = vi.spyOn(musicAnalysis, 'classifyFromFrequency').mockImplementation(() => ({ label: 'music', confidence: 1, features: {} }));
    const analyser = makeAnalyser({ freqData: makeMusicFreqData() });
    const analyserRef = { current: analyser };

    const { result } = renderHook(() =>
      useMusicDetector({
        analyserRef,
        enabled: true,
        intervalMs: 100,
        confirmFrames: 3,
        confidenceThreshold: 0,
        autoCalibrate: false,
      }),
    );

    act(() => { vi.advanceTimersByTime(100 * 5); });

    expect(result.current.label).toBe('music');
    spyClassify.mockRestore();
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
        autoCalibrate: false,
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
    const spyClassify = vi.spyOn(musicAnalysis, 'classifyFromFrequency').mockImplementation(() => ({ label: 'music', confidence: 1, features: {} }));
    const spyDetect = vi.spyOn(musicAnalysis, 'detectBpmFromPcm').mockImplementation(() => ({ bpm: 120, confidence: 0.9 }));
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
        autoCalibrate: false,
      }),
    );

    await act(async () => { vi.advanceTimersByTime(100 * 5); });

    // At least one send call should have sound:music
    const musicCalls = mockSend.mock.calls.filter(
      ([text]) => typeof text === 'string' && text.includes('sound:music'),
    );
    expect(musicCalls.length).toBeGreaterThan(0);
    spyClassify.mockRestore();
    spyDetect.mockRestore();
  });
});

describe('useMusicDetector — disable / cleanup', () => {
  it('stops running when enabled is toggled to false', () => {
    const analyser = makeAnalyser();
    const analyserRef = { current: analyser };

    const { result, rerender } = renderHook(
      ({ enabled }) => useMusicDetector({ analyserRef, enabled, intervalMs: 100, confirmFrames: 2, autoCalibrate: false }),
      { initialProps: { enabled: true } },
    );

    expect(result.current.running).toBe(true);

    rerender({ enabled: false });
    expect(result.current.running).toBe(false);
  });
});

describe('useMusicDetector — auto-calibration', () => {
  const STORAGE_KEY = 'lcyt.audio.musicDetectThreshold';
  const CALIBRATION_TICKS = 50; // Math.ceil(5000ms / 100ms intervalMs)

  it('skips classification while calibrating (no label, no metacode sent)', async () => {
    const spyClassify = vi.spyOn(musicAnalysis, 'classifyFromFrequency').mockImplementation(() => ({
      label: 'music', confidence: 1, features: { rms: 0.01 },
    }));
    const analyser = makeAnalyser({ freqData: makeMusicFreqData() });
    const analyserRef = { current: analyser };

    const { result } = renderHook(() =>
      useMusicDetector({
        analyserRef,
        enabled: true,
        intervalMs: 100,
        confirmFrames: 2,
        confidenceThreshold: 0,
        autoCalibrate: true,
      }),
    );

    // Advance well short of the calibration window.
    await act(async () => { vi.advanceTimersByTime(100 * (CALIBRATION_TICKS - 5)); });

    expect(result.current.label).toBeNull();
    expect(mockSend).not.toHaveBeenCalled();
    spyClassify.mockRestore();
  });

  it('derives and persists a calibrated threshold once the calibration window elapses', async () => {
    const rmsValues = [0.001, 0.004, 0.002, 0.006, 0.003];
    let i = 0;
    const spyClassify = vi.spyOn(musicAnalysis, 'classifyFromFrequency').mockImplementation(() => ({
      label: 'silence', confidence: 1, features: { rms: rmsValues[i++ % rmsValues.length] },
    }));
    const analyser = makeAnalyser();
    const analyserRef = { current: analyser };

    renderHook(() =>
      useMusicDetector({
        analyserRef,
        enabled: true,
        intervalMs: 100,
        confirmFrames: 2,
        confidenceThreshold: 0,
        autoCalibrate: true,
      }),
    );

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    await act(async () => { vi.advanceTimersByTime(100 * CALIBRATION_TICKS); });

    const persisted = localStorage.getItem(STORAGE_KEY);
    expect(persisted).not.toBeNull();
    const threshold = Number(persisted);
    expect(threshold).toBeGreaterThanOrEqual(0.002);
    expect(threshold).toBeLessThanOrEqual(0.05);
    spyClassify.mockRestore();
  });

  it('skips calibration and classifies immediately when a threshold is already persisted', async () => {
    localStorage.setItem(STORAGE_KEY, '0.01');
    const spyClassify = vi.spyOn(musicAnalysis, 'classifyFromFrequency').mockImplementation((freqData, sampleRate, opts) => {
      expect(opts).toEqual({ silenceThreshold: 0.01 });
      return { label: 'music', confidence: 1, features: { rms: 0.05 } };
    });
    const analyser = makeAnalyser({ freqData: makeMusicFreqData() });
    const analyserRef = { current: analyser };

    const { result } = renderHook(() =>
      useMusicDetector({
        analyserRef,
        enabled: true,
        intervalMs: 100,
        confirmFrames: 2,
        confidenceThreshold: 0,
        autoCalibrate: true,
      }),
    );

    // Only a few ticks needed — no calibration phase to wait through.
    await act(async () => { vi.advanceTimersByTime(100 * 3); });

    expect(result.current.label).toBe('music');
    spyClassify.mockRestore();
  });

  it('classifies immediately with the default threshold when autoCalibrate is false, even without a persisted value', async () => {
    const spyClassify = vi.spyOn(musicAnalysis, 'classifyFromFrequency').mockImplementation((freqData, sampleRate, opts) => {
      expect(opts).toEqual({});
      return { label: 'music', confidence: 1, features: { rms: 0.05 } };
    });
    const analyser = makeAnalyser({ freqData: makeMusicFreqData() });
    const analyserRef = { current: analyser };

    const { result } = renderHook(() =>
      useMusicDetector({
        analyserRef,
        enabled: true,
        intervalMs: 100,
        confirmFrames: 2,
        confidenceThreshold: 0,
        autoCalibrate: false,
      }),
    );

    await act(async () => { vi.advanceTimersByTime(100 * 3); });

    expect(result.current.label).toBe('music');
    spyClassify.mockRestore();
  });
});
