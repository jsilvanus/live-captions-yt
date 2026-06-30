import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../src/analyser/spectral-detector.js';

function makeSilence(length = 4096) {
  return new Float64Array(length);
}

function makeTone(freq, sampleRate, length) {
  const pcm = new Float64Array(length);
  for (let i = 0; i < length; i++) {
    pcm[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate);
  }
  return pcm;
}

function makeNoise(length, seed = 1) {
  let s = seed;
  const pcm = new Float64Array(length);
  for (let i = 0; i < length; i++) {
    s = (s * 9301 + 49297) % 233280;
    pcm[i] = (s / 233280) * 2 - 1;
  }
  return pcm;
}

describe('classify', () => {
  test('classifies near-zero RMS as silence', () => {
    const result = classify(makeSilence());
    assert.equal(result.label, 'silence');
    assert.ok(result.confidence > 0);
  });

  test('silence confidence increases as RMS approaches zero', () => {
    const veryQuiet = classify(makeSilence(4096));
    const lessQuiet = new Float64Array(4096).fill(0.005);
    const result = classify(lessQuiet, { silenceThreshold: 0.01 });
    assert.ok(veryQuiet.confidence >= result.confidence);
  });

  test('a pure tone (tonal, low ZCR) classifies as music', () => {
    const pcm = makeTone(220, 22050, 4096);
    const result = classify(pcm, { sampleRate: 22050 });
    assert.equal(result.label, 'music');
    assert.ok(result.confidence > 0);
    assert.ok(result.features.flatness != null);
  });

  test('white noise (flat spectrum, high ZCR) classifies as speech', () => {
    const pcm = makeNoise(4096);
    const result = classify(pcm, { sampleRate: 22050 });
    assert.equal(result.label, 'speech');
  });

  test('returns features object with rms/flatness/zcr/centroid for non-silent input', () => {
    const pcm = makeTone(440, 22050, 4096);
    const result = classify(pcm, { sampleRate: 22050 });
    assert.ok(typeof result.features.rms === 'number');
    assert.ok(typeof result.features.flatness === 'number');
    assert.ok(typeof result.features.zcr === 'number');
    assert.ok(typeof result.features.centroid === 'number');
  });

  test('silence features are all null except rms', () => {
    const result = classify(makeSilence());
    assert.equal(result.features.flatness, null);
    assert.equal(result.features.zcr, null);
    assert.equal(result.features.centroid, null);
  });

  test('confidence is always clamped to [0, 1]', () => {
    const pcm = makeTone(330, 22050, 4096);
    const result = classify(pcm, { sampleRate: 22050 });
    assert.ok(result.confidence >= 0 && result.confidence <= 1);
  });

  test('custom thresholds change the silence boundary', () => {
    const pcm = new Float64Array(4096).fill(0.02);
    const lowThreshold = classify(pcm, { silenceThreshold: 0.01 });
    const highThreshold = classify(pcm, { silenceThreshold: 0.5 });
    assert.notEqual(lowThreshold.label, 'silence');
    assert.equal(highThreshold.label, 'silence');
  });
});
