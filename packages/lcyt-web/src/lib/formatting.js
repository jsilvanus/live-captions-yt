/**
 * Shared formatting utilities.
 */

/**
 * Format an ISO timestamp string as a local time string (HH:MM:SS, 24-hour).
 * Returns '—' if the input is invalid.
 *
 * @param {string} isoString
 * @returns {string}
 */
export function formatTime(isoString) {
  try {
    return new Date(isoString).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return '—';
  }
}

/**
 * Convert a DSK template name to a URL-friendly slug.
 * Example: "Lower Third" → "lower-third"
 *
 * @param {string} name
 * @returns {string}
 */
export function templateSlug(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
