/**
 * Tests for musicAnalysis pure functions.
 *
 * No DOM / Web Audio / browser APIs required — pure node:test.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyFromFrequency,
  detectBpmFromPcm,
  createBpmSmoother,
} from '../src/lib/musicAnalysis.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

const SAMPLE_RATE = 44100;

/** Build a Float32Array of dB frequency bins simulating silence (−Infinity). */
function makeSilentBins(n = 1024) {
  return new Float32Array(n).fill(-Infinity);
}

/**
 * Build frequency bins with energy concentrated at low-frequency bins —
 * simulating a tonal, bass-heavy signal (music-like).
 * Uses 15 prominent peaks at low frequencies so the overall RMS exceeds the
 * silence threshold while spectral flatness stays low (tonal).
 */
function makeTonalBins(n = 1024) {
  const bins = new Float32Array(n).fill(-96);
  // 15 prominent low-frequency peaks at −3 dBFS
  for (let i = 5; i <= 19; i++) {
    bins[i] = -3;
  }
  return bins;
}

/**
 * Build flat (white-noise-like) frequency bins across the whole spectrum —
 * simulating speech energy spread evenly.
 */
function makeNoisyBins(n = 1024) {
  return new Float32Array(n).fill(-20);
}

/**
 * Build a PCM click-track at a known BPM.
 * Places a short impulse every `period` samples.
 */
function makeClickTrack(bpm, durationSec = 3, sampleRate = SAMPLE_RATE) {
  const total = Math.round(durationSec * sampleRate);
  const pcm = new Float32Array(total);
  const periodSamples = Math.round((60 / bpm) * sampleRate);
  for (let i = 0; i < total; i += periodSamples) {
    pcm[i]     = 1.0;
    if (i + 1 < total) pcm[i + 1] = 0.5;
  }
  return pcm;
}

// ─── classifyFromFrequency ────────────────────────────────────────────────────

describe('classifyFromFrequency — silence', () => {
  it('classifies −Infinity bins as silence', () => {
    const { label } = classifyFromFrequency(makeSilentBins(), SAMPLE_RATE);
    assert.equal(label, 'silence');
  });

  it('returns confidence > 0 for silence', () => {
    const { confidence } = classifyFromFrequency(makeSilentBins(), SAMPLE_RATE);
    assert.ok(confidence > 0);
  });

  it('classifies very low energy bins as silence', () => {
    const bins = new Float32Array(1024).fill(-100);
    const { label } = classifyFromFrequency(bins, SAMPLE_RATE);
    assert.equal(label, 'silence');
  });
});

describe('classifyFromFrequency — music', () => {
  it('classifies tonal bass-heavy bins as music', () => {
    const { label } = classifyFromFrequency(makeTonalBins(), SAMPLE_RATE);
    assert.equal(label, 'music');
  });

  it('returns confidence in [0, 1] for music', () => {
    const { confidence } = classifyFromFrequency(makeTonalBins(), SAMPLE_RATE);
    assert.ok(confidence >= 0 && confidence <= 1, `confidence=${confidence} out of range`);
  });

  it('exposes spectral features in the result', () => {
    const { features } = classifyFromFrequency(makeTonalBins(), SAMPLE_RATE);
    assert.ok('rms' in features);
    assert.ok('centroid' in features);
    assert.ok('flatness' in features);
  });
});

describe('classifyFromFrequency — speech', () => {
  it('classifies flat white-noise bins as speech', () => {
    const { label } = classifyFromFrequency(makeNoisyBins(), SAMPLE_RATE);
    assert.equal(label, 'speech');
  });

  it('returns confidence in [0, 1] for speech', () => {
    const { confidence } = classifyFromFrequency(makeNoisyBins(), SAMPLE_RATE);
    assert.ok(confidence >= 0 && confidence <= 1);
  });
});

describe('classifyFromFrequency — edge cases', () => {
  it('handles empty array gracefully', () => {
    const { label } = classifyFromFrequency(new Float32Array(0), SAMPLE_RATE);
    assert.equal(label, 'silence');
  });

  it('respects custom silenceThreshold override', () => {
    // Flat bins at −30 dBFS — energy is above default threshold so speech,
    // but below silenceThreshold=0.9 so should be silence when raised
    const bins = new Float32Array(1024).fill(-30);
    const defaultResult = classifyFromFrequency(bins, SAMPLE_RATE);
    const highThreshold = classifyFromFrequency(bins, SAMPLE_RATE, { silenceThreshold: 0.9 });
    assert.equal(highThreshold.label, 'silence');
    assert.notEqual(defaultResult.label, 'silence'); // should be speech at default
  });
});

// ─── detectBpmFromPcm ─────────────────────────────────────────────────────────

describe('detectBpmFromPcm — click track', () => {
  it('detects BPM within ±10 of ground truth at 120 BPM', () => {
    const pcm = makeClickTrack(120, 4);
    const result = detectBpmFromPcm(pcm, SAMPLE_RATE);
    assert.ok(result !== null, 'should return a result for clear click track');
    assert.ok(
      Math.abs(result.bpm - 120) <= 10,
      `expected ~120 BPM, got ${result.bpm}`,
    );
  });

  it('detects BPM within ±10 at 90 BPM', () => {
    const pcm = makeClickTrack(90, 5);
    const result = detectBpmFromPcm(pcm, SAMPLE_RATE);
    assert.ok(result !== null, 'should return a result for clear 90 BPM click track');
    assert.ok(
      Math.abs(result.bpm - 90) <= 10,
      `expected ~90 BPM, got ${result?.bpm}`,
    );
  });

  it('returns confidence in (0, 1] for clear click track', () => {
    const pcm = makeClickTrack(120, 4);
    const result = detectBpmFromPcm(pcm, SAMPLE_RATE);
    assert.ok(result !== null);
    assert.ok(result.confidence > 0 && result.confidence <= 1);
  });
});

describe('detectBpmFromPcm — silence / short input', () => {
  it('returns null for all-zero PCM', () => {
    const result = detectBpmFromPcm(new Float32Array(1024), SAMPLE_RATE);
    assert.equal(result, null);
  });

  it('returns null for too-short buffer (< 4 frames)', () => {
    const pcm = new Float32Array(10); // way too short
    const result = detectBpmFromPcm(pcm, SAMPLE_RATE);
    assert.equal(result, null);
  });

  it('respects bpmMin / bpmMax opts — no result outside range', () => {
    const pcm = makeClickTrack(120, 4);
    const result = detectBpmFromPcm(pcm, SAMPLE_RATE, { bpmMin: 130, bpmMax: 200 });
    // 120 BPM is outside [130, 200], so autocorrelation peak should not align
    if (result !== null) {
      assert.ok(result.bpm >= 130, `got ${result.bpm} which is below bpmMin`);
    }
  });
});

// ─── createBpmSmoother ────────────────────────────────────────────────────────

describe('createBpmSmoother', () => {
  it('returns the first value unchanged', () => {
    const smoother = createBpmSmoother(0.5);
    assert.equal(smoother.smooth(120), 120);
  });

  it('converges toward the new value', () => {
    const smoother = createBpmSmoother(0.5);
    smoother.smooth(100);
    const v = smoother.smooth(120);
    assert.ok(v > 100 && v < 120, `converged to ${v}`);
  });

  it('reset() clears internal state', () => {
    const smoother = createBpmSmoother(0.5);
    smoother.smooth(100);
    smoother.smooth(100);
    smoother.reset();
    // After reset, first value should be the new seed
    assert.equal(smoother.smooth(200), 200);
  });

  it('alpha=1 gives no smoothing', () => {
    const smoother = createBpmSmoother(1);
    smoother.smooth(100);
    assert.equal(smoother.smooth(140), 140);
  });
});
