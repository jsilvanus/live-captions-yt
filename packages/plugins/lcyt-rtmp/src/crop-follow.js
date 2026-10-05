/**
 * Crop auto-follow geometry (plan_perception_completion.md Phase 4): where the vertical crop window should sit to keep
 * the people the detector sees in frame, and a smoother so it moves like a camera operator, not like a jittery tracker.
 * Pure; the controller in lcyt-backend feeds it detections and applies the result with CropManager.applyPosition().
 *
 * Coordinates: subject boxes are normalised 0..1 of the source frame. The crop window is `cropW` wide inside a source
 * `inW` wide, and `xNorm` is its left edge as a fraction of the travel range (inW - cropW), the same convention as
 * crop presets and /crop/position.
 */

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/**
 * Horizontal centre (0..1 of the source width) the window should aim at, or null with no people.
 * Preferred roles (a person the Tracker identified, e.g. "preacher") win; otherwise everyone is framed together if
 * the group fits the window, else the biggest, most confident person.
 *
 * @param {Array<{ label?: string, bbox?: {x:number,y:number,w:number,h:number}, role?: string, confidence?: number }>} subjects
 * @param {{ windowFrac: number, preferRoles?: string[] }} opts  windowFrac = cropW / inW
 * @returns {number|null}
 */
export function targetCenter(subjects, { windowFrac, preferRoles = [] }) {
  const people = (subjects || []).filter((s) => s.label === 'person' && s.bbox && s.bbox.w > 0);
  if (!people.length) return null;
  const prefer = new Set(preferRoles.map((r) => r.toLowerCase()));
  const preferred = people.filter((s) => s.role && prefer.has(String(s.role).toLowerCase()));
  const pool = preferred.length ? preferred : people;
  const left = Math.min(...pool.map((s) => s.bbox.x));
  const right = Math.max(...pool.map((s) => s.bbox.x + s.bbox.w));
  if (right - left <= windowFrac * 0.9) return (left + right) / 2;
  const main = pool.reduce((a, b) => (a.bbox.w * a.bbox.h * (a.confidence ?? 1) >= b.bbox.w * b.bbox.h * (b.confidence ?? 1) ? a : b));
  return main.bbox.x + main.bbox.w / 2;
}

/** The `xNorm` that centres the window on `center` (0..1 of the source width), clamped to the travel range. */
export function xNormForCenter(center, { inW, cropW }) {
  const travel = inW - cropW;
  if (travel <= 0) return 0;
  return clamp01((center * inW - cropW / 2) / travel);
}

/**
 * Smoothing: exponential moving average, a dead band (small drifts are ignored) and a minimum time between moves.
 * `next()` returns the xNorm to apply, or null for "leave the window where it is".
 *
 * @param {{ alpha?: number, deadband?: number, minIntervalMs?: number }} [opts]
 */
export function createFollowSmoother({ alpha = 0.35, deadband = 0.03, minIntervalMs = 700 } = {}) {
  let smoothed = null;
  let applied = null;
  let lastAt = -Infinity;
  return {
    /** @param {number} currentXNorm where the window is now  @param {number|null} targetXNorm  @param {number} now ms */
    next(currentXNorm, targetXNorm, now) {
      if (targetXNorm == null) return null;
      if (applied === null) applied = currentXNorm;
      smoothed = smoothed === null ? targetXNorm : smoothed + alpha * (targetXNorm - smoothed);
      if (now - lastAt < minIntervalMs) return null;
      if (Math.abs(smoothed - applied) < deadband) return null;
      applied = smoothed; lastAt = now;
      return applied;
    },
    /** Someone moved the window by hand (preset, free move): re-anchor to where it is. */
    reset() { smoothed = null; applied = null; },
  };
}
