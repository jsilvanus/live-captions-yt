/**
 * Exit-animation helpers for DSK graphics.
 *
 * Entry animations (CSS `animation` shorthand, e.g. "lcyt-fadeIn 0.5s") already play when a
 * DSK image first appears. These helpers derive the matching "exit" animation so an image
 * can play a mirrored transition before being removed from the DOM, instead of vanishing
 * instantly when a `<!-- graphics:... -->` metacode drops it from the active set.
 */

// Maps an entry preset to its natural reverse. Presets without an obvious reverse
// (pulse, blink, typewriter, the *Out presets themselves, slideInUp/Down — no
// slideOutUp/Down keyframes exist) fall back to DEFAULT_EXIT_PRESET.
const EXIT_PRESET_MAP = {
  'lcyt-fadeIn':       'lcyt-fadeOut',
  'lcyt-slideInLeft':  'lcyt-slideOutLeft',
  'lcyt-slideInRight': 'lcyt-slideOutRight',
  'lcyt-zoomIn':       'lcyt-zoomOut',
};

const DEFAULT_EXIT_PRESET = 'lcyt-fadeOut';

/**
 * Given a CSS animation shorthand string used for an element's entry, derive the matching
 * exit animation shorthand (same timing/easing/iterations/direction/fill, mirrored preset).
 *
 * @param {string} animation  e.g. "lcyt-slideInLeft 0.6s ease-out 0s 1 normal forwards"
 * @returns {string} the exit animation shorthand, or '' if no entry animation was given
 *   (callers should skip the exit animation and remove the element immediately).
 */
export function deriveExitAnimation(animation) {
  if (!animation || !animation.trim()) return '';
  const parts = animation.trim().split(/\s+/);
  const exitPreset = EXIT_PRESET_MAP[parts[0]] || DEFAULT_EXIT_PRESET;
  return [exitPreset, ...parts.slice(1)].join(' ');
}

/**
 * Total time (ms) an animation shorthand needs to finish — duration + delay — i.e. how long
 * to keep an exiting element mounted before it's safe to remove it from the DOM.
 * Falls back to 300ms when the shorthand is missing or unparseable.
 *
 * @param {string} animation
 * @returns {number} milliseconds
 */
export function getAnimationTotalMs(animation) {
  if (!animation || !animation.trim()) return 300;
  const parts = animation.trim().split(/\s+/);
  const duration = parseFloat(parts[1]);
  const delay = parseFloat(parts[3]);
  const durationMs = Number.isFinite(duration) ? duration * 1000 : 300;
  const delayMs = Number.isFinite(delay) ? delay * 1000 : 0;
  return Math.round(durationMs + delayMs);
}
