import { DEPS } from './constants.js';

/**
 * Mutates set. Returns array of auto-enabled codes.
 * @param {Set<string>} set
 * @returns {string[]}
 */
export function applyDeps(set) {
  const autoEnabled = [];
  for (const [code, deps] of Object.entries(DEPS)) {
    if (set.has(code)) {
      for (const dep of deps) {
        if (!set.has(dep)) {
          set.add(dep);
          autoEnabled.push(dep);
        }
      }
    }
  }
  return autoEnabled;
}
