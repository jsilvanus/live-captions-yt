/**
 * Pure WebVTT helpers for caption-file post-processing.
 *
 * Used by the /file/:id download route to shift cue times on the fly
 * (?offsetMs=) so archived captions can be aligned to a VOD timeline
 * without touching the stored file.
 */

const CUE_TIME_RE = /(\d+):(\d{2}):(\d{2})\.(\d{3})|(\d{2}):(\d{2})\.(\d{3})/g;

/**
 * Format milliseconds as a WebVTT timestamp string (HH:MM:SS.mmm).
 * @param {number} ms
 * @returns {string}
 */
function formatVttTime(ms) {
  const hh = String(Math.floor(ms / 3600000)).padStart(2, '0');
  const mm = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0');
  const ss = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
  const msStr = String(ms % 1000).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${msStr}`;
}

/**
 * Shift every cue timing line in a WebVTT document by offsetMs.
 *
 * Only lines containing `-->` are touched; header, cue identifiers, and cue
 * text pass through unchanged. Handles both `HH:MM:SS.mmm` (any number of
 * hour digits) and short `MM:SS.mmm` cue times. Shifted times clamp at
 * 00:00:00.000 rather than going negative.
 *
 * @param {string} content   Full WebVTT document text
 * @param {number} offsetMs  Positive or negative shift in milliseconds
 * @returns {string}
 */
export function shiftVttContent(content, offsetMs) {
  if (!Number.isFinite(offsetMs) || offsetMs === 0) return content;
  return content
    .split('\n')
    .map((line) => {
      if (!line.includes('-->')) return line;
      return line.replace(CUE_TIME_RE, (_m, hh, mm, ss, ms, shortMm, shortSs, shortMs) => {
        const total = hh !== undefined
          ? Number(hh) * 3600000 + Number(mm) * 60000 + Number(ss) * 1000 + Number(ms)
          : Number(shortMm) * 60000 + Number(shortSs) * 1000 + Number(shortMs);
        return formatVttTime(Math.max(0, total + offsetMs));
      });
    })
    .join('\n');
}
