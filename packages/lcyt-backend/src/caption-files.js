/**
 * Pure caption-text utilities used by the captions send queue.
 *
 * File I/O (write, read, delete) has been moved to the lcyt-files plugin.
 * Only composition and formatting helpers remain here.
 */

/**
 * Compose the final caption text from the original + caption-target translation.
 * If showOriginal is true and a translation exists, produces "original<br>translated".
 * If showOriginal is false (or undefined) and translation exists, produces just the translation.
 * Falls back to original text when no translation is provided.
 *
 * @param {string} text
 * @param {string|null} captionLang
 * @param {object} translations
 * @param {boolean} showOriginal
 * @returns {string}
 */
export function composeCaptionText(text, captionLang, translations, showOriginal) {
  if (!captionLang || !translations || !translations[captionLang]) return text;
  const translated = translations[captionLang];
  if (translated === text) return text; // same language — no-op
  return showOriginal ? `${text}<br>${translated}` : translated;
}

/**
 * Format milliseconds as a WebVTT timestamp string (HH:MM:SS.mmm).
 * @param {number} ms
 * @returns {string}
 */
export function formatVttTime(ms) {
  const hh = String(Math.floor(ms / 3600000)).padStart(2, '0');
  const mm = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0');
  const ss = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
  const msStr = String(ms % 1000).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${msStr}`;
}

/**
 * Build a single WebVTT cue string.
 * @param {number} seq  1-based cue index
 * @param {number} startMs
 * @param {number} endMs
 * @param {string} text
 * @returns {string}
 */
export function buildVttCue(seq, startMs, endMs, text) {
  return `${seq}\n${formatVttTime(startMs)} --> ${formatVttTime(endMs)}\n${text}\n\n`;
}
