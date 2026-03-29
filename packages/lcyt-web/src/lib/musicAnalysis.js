/**
 * Music analysis utilities for the browser (lcyt-web).
 *
 * Pure functions — no DOM, Web Audio, or Node.js dependencies — so they can
 * be unit-tested with Vitest and reused both in the useMusicDetector hook
 * and in future server-side code via a shared bundle.
 *
 * Two entry points:
 *
 *   classifyFromFrequency(freqData, sampleRate, opts?)
 *     → { label: 'music'|'speech'|'silence', confidence, features }
 *
 *   detectBpmFromPcm(pcm, sampleRate, opts?)
 *     → { bpm, confidence } | null
 *
 * ## Classification algorithm
 *
 * Uses hand-crafted spectral features computed from the Web Audio API's
 * AnalyserNode output (decibel-scale frequency bins).  No ML model required.
 *
 * Features used:
 *   - RMS energy         (converted from dB)
 *   - Spectral centroid  (center of mass of the frequency distribution)
 *   - Spectral flatness  (tonal = low; noisy/speech = high; music = low)
 *   - Zero-crossing rate (estimated from spectral spread)
 *   - Low-frequency energy ratio  (bass content)
 *
 * Decision rules:
 *   silence  → RMS < silenceThreshold
 *   music    → spectralFlatness < flatnessThreshold AND centroid < centroidThreshold
 *   speech   → everything else
 *
 * ## BPM detection algorithm
 *
 * Onset-autocorrelation method:
 *   1. Split PCM into short frames (~20 ms hop); compute RMS energy per frame.
 *   2. Compute a novelty function: first-order positive difference of the RMS envelope.
 *   3. Autocorrelate the novelty function over lags corresponding to 40–200 BPM.
 *   4. Pick the lag with the maximum autocorrelation; convert to BPM.
 *   5. Octave disambiguation: if the half-BPM peak is nearly as strong, prefer it.
 *   6. Apply EMA smoothing across calls (caller manages the smoother state).
 *
 * @module musicAnalysis
 */

// ─── Classification ──────────────────────────────────────────────────────────

/**
 * Default thresholds (tuned for typical broadcast audio at 44100 Hz).
 * All overridable via opts.
 */
const DEFAULT_CLASSIFY_OPTS = {
  /** Linear RMS below which audio is classified as silence. */
  silenceThreshold:  0.008,
  /**
   * Spectral flatness below which audio is considered tonal (music).
   * Range [0, 1]; pure tone → 0, white noise → 1.
   */
  flatnessThreshold: 0.55,
  /**
   * Normalised spectral centroid threshold (0–1 of Nyquist) below which
   * tonal audio is classified as music rather than high-pitched speech.
   * Music tends to have a lower centroid than speech.
   */
  centroidThreshold: 0.35,
};

/**
 * Classify a Web Audio API frequency bin array into music / speech / silence.
 *
 * @param {Float32Array} freqData  — output of AnalyserNode.getFloatFrequencyData()
 *                                   (dB values, typically −∞ to 0 dBFS)
 * @param {number}       sampleRate — AudioContext.sampleRate (e.g. 44100)
 * @param {object}       [opts]    — override default thresholds
 * @returns {{ label: 'music'|'speech'|'silence', confidence: number, features: object }}
 */
export function classifyFromFrequency(freqData, sampleRate, opts = {}) {
  const { silenceThreshold, flatnessThreshold, centroidThreshold } = {
    ...DEFAULT_CLASSIFY_OPTS,
    ...opts,
  };

  const n = freqData.length;
  if (!n) return { label: 'silence', confidence: 1, features: {} };

  // Convert dB bins to linear magnitude [0, 1]
  const mag = new Float32Array(n);
  let magSum = 0;
  for (let i = 0; i < n; i++) {
    // AnalyserNode reports −Infinity for bins below the noise floor; clamp safely
    const db   = isFinite(freqData[i]) ? freqData[i] : -144;
    const lin  = Math.pow(10, db / 20);
    mag[i] = lin;
    magSum += lin;
  }

  // ── RMS energy (proxy using linear magnitude mean) ──────────────────────
  const magMean = magSum / n;
  const rms     = magMean; // linear magnitude mean ≈ RMS in frequency domain

  if (rms < silenceThreshold) {
    return { label: 'silence', confidence: computeConfidence(0, silenceThreshold, rms), features: { rms } };
  }

  // ── Spectral centroid ────────────────────────────────────────────────────
  // Normalised to [0, 1] where 1 = Nyquist = sampleRate/2
  let weightedSum = 0;
  for (let i = 0; i < n; i++) {
    weightedSum += (i / n) * mag[i]; // i/n is the normalised frequency bin index
  }
  const centroid = magSum > 0 ? weightedSum / magSum : 0.5;

  // ── Spectral flatness (Wiener entropy) ──────────────────────────────────
  // geometric_mean / arithmetic_mean over linear magnitudes
  // Avoid log(0) by clamping small values
  const minMag = 1e-10;
  let logSum = 0;
  for (let i = 0; i < n; i++) {
    logSum += Math.log(Math.max(mag[i], minMag));
  }
  const geomMean = Math.exp(logSum / n);
  const flatness = magMean > 0 ? geomMean / magMean : 1;

  const features = { rms, centroid, flatness };

  // ── Decision rule ────────────────────────────────────────────────────────
  if (flatness < flatnessThreshold && centroid < centroidThreshold) {
    // Tonal + bass/mid-heavy → music
    const conf = (1 - flatness / flatnessThreshold) * 0.5 + 0.5;
    return { label: 'music', confidence: Math.min(conf, 1), features };
  }

  // Default: speech
  const conf = Math.min(flatness / flatnessThreshold, 1) * 0.5 + 0.4;
  return { label: 'speech', confidence: Math.min(conf, 1), features };
}

function computeConfidence(low, high, value) {
  if (high <= low) return 1;
  return Math.min(1, (high - value) / (high - low));
}

// ─── BPM Detection ──────────────────────────────────────────────────────────

const DEFAULT_BPM_OPTS = {
  /** Seconds per RMS energy frame (hop size). */
  frameSec:        0.020,
  /** Minimum BPM to consider. */
  bpmMin:          40,
  /** Maximum BPM to consider. */
  bpmMax:          200,
  /** Minimum autocorrelation peak height relative to zero-lag, to emit a result. */
  minConfidence:   0.15,
};

/**
 * Estimate BPM from a time-domain PCM buffer (Web Audio getFloatTimeDomainData output).
 *
 * @param {Float32Array} pcm         — normalised PCM samples, [-1, 1]
 * @param {number}       sampleRate  — e.g. 44100
 * @param {object}       [opts]
 * @returns {{ bpm: number, confidence: number } | null}
 *   Returns null when the buffer is too short or confidence is below threshold.
 */
export function detectBpmFromPcm(pcm, sampleRate, opts = {}) {
  const { frameSec, bpmMin, bpmMax, minConfidence } = { ...DEFAULT_BPM_OPTS, ...opts };

  const frameSize = Math.round(frameSec * sampleRate);
  const numFrames = Math.floor(pcm.length / frameSize);

  if (numFrames < 4) return null; // not enough data

  // ── Step 1: RMS energy per frame ─────────────────────────────────────────
  const energy = new Float32Array(numFrames);
  for (let f = 0; f < numFrames; f++) {
    const start = f * frameSize;
    let sq = 0;
    for (let i = start; i < start + frameSize; i++) {
      sq += pcm[i] * pcm[i];
    }
    energy[f] = Math.sqrt(sq / frameSize);
  }

  // ── Step 2: Onset novelty function (positive first-order difference) ──────
  const novelty = new Float32Array(numFrames);
  for (let f = 1; f < numFrames; f++) {
    const diff = energy[f] - energy[f - 1];
    novelty[f] = diff > 0 ? diff : 0;
  }

  // ── Step 3: Autocorrelate over lag range corresponding to bpmMin–bpmMax ──
  // Lag in frames for a given BPM:
  //   lagFrames = floor(60 / bpm / frameSec)
  const lagMin = Math.floor(60 / bpmMax / frameSec);
  const lagMax = Math.floor(60 / bpmMin / frameSec);

  if (lagMin >= numFrames || lagMax < 1) return null;

  let bestLag  = lagMin;
  let bestCorr = -Infinity;
  let zeroCorr = 0;

  // Zero-lag autocorrelation as normalisation baseline
  for (let f = 0; f < numFrames; f++) zeroCorr += novelty[f] * novelty[f];
  if (zeroCorr === 0) return null;

  for (let lag = lagMin; lag <= Math.min(lagMax, numFrames - 1); lag++) {
    let corr = 0;
    const count = numFrames - lag;
    for (let f = 0; f < count; f++) {
      corr += novelty[f] * novelty[f + lag];
    }
    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag  = lag;
    }
  }

  const confidence = bestCorr / zeroCorr;
  if (confidence < minConfidence) return null;

  const bpmRaw = 60 / (bestLag * frameSec);

  // ── Step 4: Octave disambiguation ─────────────────────────────────────────
  // Check if the half-BPM candidate (double the lag) is nearly as strong.
  const doubleLag = bestLag * 2;
  if (doubleLag < numFrames) {
    let doubleCorr = 0;
    const count = numFrames - doubleLag;
    for (let f = 0; f < count; f++) {
      doubleCorr += novelty[f] * novelty[f + doubleLag];
    }
    // If the double-lag correlation is ≥ 80% of the best, prefer the lower BPM
    if (doubleCorr / zeroCorr >= confidence * 0.8 && bpmRaw > bpmMax * 0.67) {
      const bpmHalf = bpmRaw / 2;
      if (bpmHalf >= bpmMin) {
        return { bpm: Math.round(bpmHalf), confidence: doubleCorr / zeroCorr };
      }
    }
  }

  return { bpm: Math.round(bpmRaw), confidence };
}

// ─── EMA smoother (stateful helper for callers) ──────────────────────────────

/**
 * Create a simple exponential moving average smoother for BPM values.
 *
 * @param {number} [alpha=0.3]  — smoothing coefficient (0=constant, 1=no smoothing)
 * @returns {{ smooth: (bpm: number) => number, reset: () => void }}
 */
export function createBpmSmoother(alpha = 0.3) {
  let current = null;
  return {
    smooth(bpm) {
      if (current === null) { current = bpm; return bpm; }
      current = current + alpha * (bpm - current);
      return Math.round(current);
    },
    reset() { current = null; },
  };
}
