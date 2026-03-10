/**
 * Device detection helpers.
 */

/**
 * Detect a mobile device via user-agent sniffing.
 * Used by AudioPanel to adjust speech recognition behaviour (e.g.
 * disabling interim results on mobile WebKit).
 *
 * Note: App.jsx uses a CSS media-query check (`matchMedia('(max-width:768px)')`)
 * for *layout* decisions — that is a separate concern and intentionally not unified
 * with this function.
 *
 * @returns {boolean}
 */
export function isMobileDevice() {
  return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}
