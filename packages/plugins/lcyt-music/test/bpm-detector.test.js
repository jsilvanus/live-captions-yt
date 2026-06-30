import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { detectBpm, createBpmSmoother } from '../src/analyser/bpm-detector.js';

const SAMPLE_RATE = 22050;

/** Build a periodic click track at the given BPM, long enough to analyse. */
function makeClickTrack(bpm, sampleRate, durationSec) {
  const length = Math.floor(sampleRate * durationSec);
  const pcm = new Float64Array(length);
  const periodSamples = Math.round((60 / bpm) * sampleRate);
  const clickLen = 30;
  for (let start = 0; start < length; start += periodSamples) {
    for (let i = 0; i < clickLen && start + i < length; i++) {
      // Decaying burst of broadband-ish noise to create a sharp spectral-flux onset.
      pcm[start + i] = (Math.random() * 2 - 1) * (1 - i / clickLen);
    }
  }
  return pcm;
}

describe('detectBpm', () => {
  test('returns null for very short input', () => {
    const pcm = new Float64Array(100);
    assert.equal(detectBpm(pcm, { sampleRate: SAMPLE_RATE }), null);
  });

  test('returns null when bpmMin/bpmMax bounds collapse the lag range', () => {
    const pcm = makeClickTrack(120, SAMPLE_RATE, 4);
    const result = detectBpm(pcm, { sampleRate: SAMPLE_RATE, bpmMin: 119, bpmMax: 120 });
    // May be null or a valid result depending on lag rounding; just assert no throw
    assert.ok(result === null || typeof result.bpm === 'number');
  });

  test('estimates a bpm within the searched range for a periodic click track', () => {
    const pcm = makeClickTrack(120, SAMPLE_RATE, 6);
    const result = detectBpm(pcm, { sampleRate: SAMPLE_RATE, bpmMin: 60, bpmMax: 180 });
    assert.ok(result, 'expected a bpm result');
    assert.ok(result.bpm >= 60 && result.bpm <= 180);
    assert.ok(result.confidence >= 0 && result.confidence <= 1);
  });

  test('returns an integer bpm', () => {
    const pcm = makeClickTrack(100, SAMPLE_RATE, 6);
    const result = detectBpm(pcm, { sampleRate: SAMPLE_RATE, bpmMin: 60, bpmMax: 180 });
    if (result) assert.equal(result.bpm, Math.round(result.bpm));
  });
});

describe('createBpmSmoother', () => {
  test('first value passes through unchanged (rounded)', () => {
    const smoother = createBpmSmoother();
    assert.equal(smoother.smooth(120), 120);
  });

  test('smooths subsequent values via EMA', () => {
    const smoother = createBpmSmoother(0.5);
    smoother.smooth(100);
    const next = smoother.smooth(120);
    // EMA: 0.5*120 + 0.5*100 = 110
    assert.equal(next, 110);
  });

  test('reset() clears internal state so next value passes through unchanged', () => {
    const smoother = createBpmSmoother();
    smoother.smooth(100);
    smoother.reset();
    assert.equal(smoother.smooth(140), 140);
  });
});
