/**
 * Minimal radix-2 Cooley-Tukey FFT, real-input convenience wrapper, and a
 * Hann window helper. No external dependency — pure JS, operates on
 * power-of-two-length Float64Array buffers.
 */

/**
 * In-place iterative radix-2 Cooley-Tukey FFT.
 * `re`/`im` must have a power-of-two length.
 *
 * @param {Float64Array} re
 * @param {Float64Array} im
 */
export function fft(re, im) {
  const n = re.length;
  if (n <= 1) return;
  if ((n & (n - 1)) !== 0) {
    throw new Error(`fft: length must be a power of two, got ${n}`);
  }

  // Bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }

  // Iterative butterfly passes
  for (let len = 2; len <= n; len <<= 1) {
    const halfLen = len >> 1;
    const ang = -2 * Math.PI / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let j = 0; j < halfLen; j++) {
        const uRe = re[i + j];
        const uIm = im[i + j];
        const vRe = re[i + j + halfLen] * curRe - im[i + j + halfLen] * curIm;
        const vIm = re[i + j + halfLen] * curIm + im[i + j + halfLen] * curRe;
        re[i + j] = uRe + vRe;
        im[i + j] = uIm + vIm;
        re[i + j + halfLen] = uRe - vRe;
        im[i + j + halfLen] = uIm - vIm;
        const nextRe = curRe * wRe - curIm * wIm;
        const nextIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
        curIm = nextIm;
      }
    }
  }
}

/**
 * Round down to the nearest power of two (minimum 1).
 * @param {number} n
 */
export function prevPow2(n) {
  if (n < 1) return 1;
  return 1 << (31 - Math.clz32(n));
}

/**
 * Apply a Hann window in place to a real-valued frame.
 * @param {Float64Array} frame
 */
export function applyHannWindow(frame) {
  const n = frame.length;
  if (n <= 1) return frame;
  for (let i = 0; i < n; i++) {
    frame[i] *= 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
  }
  return frame;
}

/**
 * Compute the magnitude spectrum of a real-valued PCM frame.
 * Truncates input to the previous power-of-two length, applies a Hann
 * window, and returns the first half (n/2 + 1 bins) of |FFT|.
 *
 * @param {Float32Array|Float64Array} pcm
 * @returns {Float64Array} magnitude spectrum, length = pow2Len/2 + 1
 */
export function magnitudeSpectrum(pcm) {
  const len = prevPow2(pcm.length);
  const re = new Float64Array(len);
  const im = new Float64Array(len);
  for (let i = 0; i < len; i++) re[i] = pcm[i];
  applyHannWindow(re);
  fft(re, im);
  const half = len / 2 + 1;
  const mag = new Float64Array(half);
  for (let i = 0; i < half; i++) {
    mag[i] = Math.hypot(re[i], im[i]);
  }
  return mag;
}
