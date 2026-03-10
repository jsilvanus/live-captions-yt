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
