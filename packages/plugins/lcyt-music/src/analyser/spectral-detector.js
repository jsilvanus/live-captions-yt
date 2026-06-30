/**
 * Heuristic music / speech / silence classifier.
 *
 * Not a trained ML model — a hand-crafted feature classifier using RMS
 * energy, spectral flatness (tonal vs. noise-like), and zero-crossing rate
 * (consonant/fricative density). Mirrors the heuristic already used by the
 * client-side `classifyFromFrequency` in lcyt-web, but operates on raw PCM
 * decoded from HLS segments instead of an AnalyserNode.
 *
 * Rationale for the decision rule:
 *  - Silence: RMS energy below `silenceThreshold`.
 *  - Otherwise, music tends to have a tonal (peaky) spectrum -> LOW spectral
 *    flatness, and a more periodic/sustained waveform -> LOWER zero-crossing
 *    rate than speech, which is rich in noise-like fricatives/sibilants
 *    (HIGH flatness, HIGH zcr).
 *  - When both indicators agree, confidence is high; when they disagree,
 *    confidence drops toward the midpoint.
 */

import { magnitudeSpectrum } from './fft.js';

const EPS = 1e-12;

/**
 * @param {Float32Array|Float64Array} pcm - mono PCM samples, normalised to [-1, 1]
 * @returns {number}
 */
function computeRms(pcm) {
  if (pcm.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i];
  return Math.sqrt(sum / pcm.length);
}

/**
 * @param {Float32Array|Float64Array} pcm
 * @returns {number} crossings per sample, in [0, 1]
 */
function computeZcr(pcm) {
  if (pcm.length < 2) return 0;
  let crossings = 0;
  for (let i = 1; i < pcm.length; i++) {
    if ((pcm[i] >= 0) !== (pcm[i - 1] >= 0)) crossings++;
  }
  return crossings / (pcm.length - 1);
}

/**
 * Wiener entropy / spectral flatness: geometric mean / arithmetic mean of
 * the magnitude spectrum. Near 0 = tonal (peaky), near 1 = noise-like (flat).
 *
 * @param {Float64Array} mag
 * @returns {number}
 */
function computeSpectralFlatness(mag) {
  if (mag.length === 0) return 0;
  let logSum = 0;
  let sum = 0;
  for (let i = 0; i < mag.length; i++) {
    const v = mag[i] + EPS;
    logSum += Math.log(v);
    sum += v;
  }
  const geoMean = Math.exp(logSum / mag.length);
  const arithMean = sum / mag.length;
  return arithMean > 0 ? geoMean / arithMean : 0;
}

/**
 * @param {Float64Array} mag
 * @param {number} sampleRate
 * @returns {number} centroid frequency in Hz
 */
function computeSpectralCentroid(mag, sampleRate) {
  const len = (mag.length - 1) * 2;
  let weighted = 0;
  let total = 0;
  for (let i = 0; i < mag.length; i++) {
    const freq = (i * sampleRate) / len;
    weighted += freq * mag[i];
    total += mag[i];
  }
  return total > 0 ? weighted / total : 0;
}

/**
 * Classify a PCM frame into music / speech / silence.
 *
 * @param {Float32Array|Float64Array} pcm - mono PCM, normalised to [-1, 1]
 * @param {object} [opts]
 * @param {number} [opts.sampleRate=22050]
 * @param {number} [opts.silenceThreshold=0.01]
 * @param {number} [opts.flatnessThreshold=0.4]
 * @param {number} [opts.zcrThreshold=0.15]
 * @returns {{ label: 'music'|'speech'|'silence', confidence: number, features: object }}
 */
export function classify(pcm, {
  sampleRate = 22050,
  silenceThreshold = 0.01,
  flatnessThreshold = 0.4,
  zcrThreshold = 0.15,
} = {}) {
  const rms = computeRms(pcm);

  if (rms < silenceThreshold) {
    const confidence = silenceThreshold > 0
      ? Math.min(1, (silenceThreshold - rms) / silenceThreshold + 0.5)
      : 1;
    return {
      label: 'silence',
      confidence: Math.max(0, Math.min(1, confidence)),
      features: { rms, flatness: null, zcr: null, centroid: null },
    };
  }

  const mag = magnitudeSpectrum(pcm);
  const flatness = computeSpectralFlatness(mag);
  const zcr = computeZcr(pcm);
  const centroid = computeSpectralCentroid(mag, sampleRate);

  const flatnessVote = flatness > flatnessThreshold ? 1 : -1; // +1 speech, -1 music
  const zcrVote = zcr > zcrThreshold ? 1 : -1;

  const flatnessDist = Math.min(1, Math.abs(flatness - flatnessThreshold) / Math.max(flatnessThreshold, EPS));
  const zcrDist = Math.min(1, Math.abs(zcr - zcrThreshold) / Math.max(zcrThreshold, EPS));

  const agree = flatnessVote === zcrVote;
  const label = (flatnessVote + zcrVote) >= 0 ? 'speech' : 'music';
  const confidence = agree
    ? Math.min(1, 0.6 + 0.2 * (flatnessDist + zcrDist))
    : Math.max(0.4, 0.5 + 0.1 * (flatnessDist - zcrDist));

  return {
    label,
    confidence: Math.max(0, Math.min(1, confidence)),
    features: { rms, flatness, zcr, centroid },
  };
}
