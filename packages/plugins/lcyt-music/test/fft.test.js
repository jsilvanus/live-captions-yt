import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fft, prevPow2, applyHannWindow, magnitudeSpectrum } from '../src/analyser/fft.js';

describe('fft', () => {
  test('throws on non-power-of-two length', () => {
    const re = new Float64Array(5);
    const im = new Float64Array(5);
    assert.throws(() => fft(re, im), /power of two/);
  });

  test('no-op on length <= 1', () => {
    const re = new Float64Array([3]);
    const im = new Float64Array([0]);
    fft(re, im);
    assert.equal(re[0], 3);
    assert.equal(im[0], 0);
  });

  test('DC-only signal produces energy only in bin 0', () => {
    const n = 8;
    const re = new Float64Array(n).fill(1);
    const im = new Float64Array(n);
    fft(re, im);
    assert.ok(Math.abs(re[0] - n) < 1e-9);
    for (let i = 1; i < n; i++) {
      assert.ok(Math.abs(re[i]) < 1e-9);
      assert.ok(Math.abs(im[i]) < 1e-9);
    }
  });

  test('single sinusoid produces a peak at the matching bin', () => {
    const n = 64;
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    const k = 5; // bin index
    for (let i = 0; i < n; i++) re[i] = Math.cos((2 * Math.PI * k * i) / n);
    fft(re, im);
    const mags = [];
    for (let i = 0; i < n / 2; i++) mags.push(Math.hypot(re[i], im[i]));
    const maxIdx = mags.indexOf(Math.max(...mags));
    assert.equal(maxIdx, k);
  });
});

describe('prevPow2', () => {
  test('returns 1 for n < 1', () => {
    assert.equal(prevPow2(0), 1);
    assert.equal(prevPow2(-5), 1);
  });

  test('returns exact power of two unchanged', () => {
    assert.equal(prevPow2(8), 8);
    assert.equal(prevPow2(1024), 1024);
  });

  test('rounds down to nearest power of two', () => {
    assert.equal(prevPow2(9), 8);
    assert.equal(prevPow2(1023), 512);
    assert.equal(prevPow2(15), 8);
  });
});

describe('applyHannWindow', () => {
  test('zeroes the first and last sample', () => {
    const frame = new Float64Array(8).fill(1);
    applyHannWindow(frame);
    assert.ok(Math.abs(frame[0]) < 1e-9);
    assert.ok(Math.abs(frame[frame.length - 1]) < 1e-9);
  });

  test('leaves the midpoint near full amplitude', () => {
    const frame = new Float64Array(9).fill(1);
    applyHannWindow(frame);
    assert.ok(frame[4] > 0.9);
  });

  test('returns the frame unchanged for length <= 1', () => {
    const frame = new Float64Array([5]);
    const result = applyHannWindow(frame);
    assert.equal(result[0], 5);
  });
});

describe('magnitudeSpectrum', () => {
  test('returns half+1 length spectrum for power-of-two input', () => {
    const pcm = new Float64Array(64);
    const mag = magnitudeSpectrum(pcm);
    assert.equal(mag.length, 33);
  });

  test('truncates non-power-of-two input', () => {
    const pcm = new Float64Array(100);
    const mag = magnitudeSpectrum(pcm); // prevPow2(100) = 64 -> 33 bins
    assert.equal(mag.length, 33);
  });

  test('silent input yields a near-zero spectrum', () => {
    const pcm = new Float64Array(64);
    const mag = magnitudeSpectrum(pcm);
    for (const v of mag) assert.ok(v < 1e-9);
  });
});
