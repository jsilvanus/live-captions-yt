/**
 * BPM estimation via onset-novelty + autocorrelation.
 *
 * Pipeline:
 *   1. Slice PCM into overlapping frames, compute a magnitude spectrum per frame.
 *   2. Spectral flux (sum of positive frame-to-frame magnitude increases) gives
 *      an onset-novelty curve — it spikes on beats/transients.
 *   3. Autocorrelate the novelty curve; the lag with the strongest peak within
 *      the plausible BPM range is the tempo estimate.
 *   4. Confidence is the peak's prominence relative to the mean of the
 *      searched lag range (low prominence = ambiguous/noisy tempo).
 */

import { magnitudeSpectrum } from './fft.js';

const FRAME_SIZE = 1024;
const HOP_SIZE = 512;

/**
 * @param {Float32Array|Float64Array} pcm
 * @param {number} frameSize
 * @param {number} hopSize
 * @returns {Float64Array} novelty curve, one value per hop
 */
function computeNoveltyCurve(pcm, frameSize, hopSize) {
  const numFrames = Math.max(0, Math.floor((pcm.length - frameSize) / hopSize) + 1);
  if (numFrames < 2) return new Float64Array(0);

  let prevMag = null;
  const novelty = new Float64Array(numFrames - 1);
  for (let f = 0; f < numFrames; f++) {
    const start = f * hopSize;
    const frame = pcm.subarray(start, start + frameSize);
    const mag = magnitudeSpectrum(frame);
    if (prevMag) {
      let flux = 0;
      const len = Math.min(mag.length, prevMag.length);
      for (let i = 0; i < len; i++) {
        const diff = mag[i] - prevMag[i];
        if (diff > 0) flux += diff;
      }
      novelty[f - 1] = flux;
    }
    prevMag = mag;
  }
  return novelty;
}

/**
 * Autocorrelation of a 1D signal at a given lag (in samples of the signal,
 * not the original PCM).
 *
 * @param {Float64Array} signal
 * @param {number} lag
 * @returns {number}
 */
function autocorrelateAt(signal, lag) {
  let sum = 0;
  const n = signal.length - lag;
  if (n <= 0) return 0;
  for (let i = 0; i < n; i++) sum += signal[i] * signal[i + lag];
  return sum / n;
}

/**
 * Estimate BPM from a PCM frame.
 *
 * @param {Float32Array|Float64Array} pcm - mono PCM, normalised to [-1, 1]
 * @param {object} [opts]
 * @param {number} [opts.sampleRate=22050]
 * @param {number} [opts.bpmMin=40]
 * @param {number} [opts.bpmMax=200]
 * @returns {{ bpm: number, confidence: number }|null}
 */
export function detectBpm(pcm, { sampleRate = 22050, bpmMin = 40, bpmMax = 200 } = {}) {
  const novelty = computeNoveltyCurve(pcm, FRAME_SIZE, HOP_SIZE);
  if (novelty.length < 4) return null;

  // Remove DC offset so autocorrelation isn't dominated by mean novelty level.
  let mean = 0;
  for (let i = 0; i < novelty.length; i++) mean += novelty[i];
  mean /= novelty.length;
  for (let i = 0; i < novelty.length; i++) novelty[i] -= mean;

  const hopSeconds = HOP_SIZE / sampleRate;
  // lag (in novelty-curve samples) <-> BPM: bpm = 60 / (lag * hopSeconds)
  const minLag = Math.max(1, Math.floor(60 / (bpmMax * hopSeconds)));
  const maxLag = Math.min(novelty.length - 1, Math.ceil(60 / (bpmMin * hopSeconds)));
  if (maxLag <= minLag) return null;

  let bestLag = -1;
  let bestScore = -Infinity;
  let scoreSum = 0;
  let scoreCount = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const score = autocorrelateAt(novelty, lag);
    scoreSum += score;
    scoreCount++;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  if (bestLag < 0 || bestScore <= 0) return null;

  const bpm = 60 / (bestLag * hopSeconds);
  const avgScore = scoreCount > 0 ? scoreSum / scoreCount : 0;
  const prominence = avgScore > 0 ? (bestScore - avgScore) / bestScore : 0;
  const confidence = Math.max(0, Math.min(1, prominence));

  return { bpm: Math.round(bpm), confidence };
}

/**
 * Exponential moving average smoother for successive BPM estimates, mirroring
 * `createBpmSmoother` in lcyt-web's client-side detector.
 *
 * @param {number} [alpha=0.3]
 */
export function createBpmSmoother(alpha = 0.3) {
  let value = null;
  return {
    smooth(next) {
      value = value == null ? next : alpha * next + (1 - alpha) * value;
      return Math.round(value);
    },
    reset() { value = null; },
  };
}
