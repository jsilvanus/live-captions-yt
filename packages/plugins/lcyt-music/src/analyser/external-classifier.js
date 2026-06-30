/**
 * Optional external/ML classifier hook (Phase 4).
 *
 * When MUSIC_CLASSIFIER_URL is set, MusicManager posts raw PCM (as a WAV
 * body) here and uses the returned { label, confidence } in place of the
 * built-in spectral heuristic (analyser/spectral-detector.js), falling back
 * to that heuristic on error or timeout. Disabled by default — the
 * zero-dependency heuristic path is entirely unaffected when the env var
 * is unset.
 */

import { buildWav } from '../wav-encoder.js';

export const CLASSIFIER_TIMEOUT_MS = 3000;

/**
 * @param {Float32Array} pcm
 * @param {object} [opts]
 * @param {number} [opts.sampleRate=22050]
 * @param {number} [opts.timeoutMs=CLASSIFIER_TIMEOUT_MS]
 * @returns {Promise<{ label: 'music'|'speech'|'silence', confidence: number|null }>}
 */
export async function classifyExternal(pcm, { sampleRate = 22050, timeoutMs = CLASSIFIER_TIMEOUT_MS } = {}) {
  const url = process.env.MUSIC_CLASSIFIER_URL;
  if (!url) throw new Error('classifyExternal: MUSIC_CLASSIFIER_URL is not set');

  const wav = buildWav(pcm, sampleRate);

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'audio/wav' },
    body: wav,
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    throw new Error(`classifyExternal: classifier returned ${res.status}`);
  }

  const data = await res.json();
  if (!data || typeof data.label !== 'string') {
    throw new Error('classifyExternal: malformed response (missing label)');
  }

  return { label: data.label, confidence: typeof data.confidence === 'number' ? data.confidence : null };
}
