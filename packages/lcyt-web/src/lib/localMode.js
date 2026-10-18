/**
 * Local install mode (backend /health lists 'local-mode'): a single-user install
 * with no login. Pages that only exist for multi-user installs are hidden, and
 * the web app signs in as the local admin on its own.
 */

export const LOCAL_MODE_FEATURE = 'local-mode';

// Sidebar and route prefixes that only make sense with user accounts.
// Assets and Projects stay visible: a local install needs its graphics library,
// and one local install can hold many projects.
const LOCAL_HIDDEN_PREFIXES = ['/admin', '/team', '/account'];

export function isLocalModeFeatures(features) {
  return Array.isArray(features) && features.includes(LOCAL_MODE_FEATURE);
}

/** Reads the feature list cached by the last /health probe. */
export function isLocalInstall() {
  try {
    return isLocalModeFeatures(JSON.parse(localStorage.getItem('lcyt.backend.features') || 'null'));
  } catch {
    return false;
  }
}

export function isHiddenInLocalMode(path) {
  return LOCAL_HIDDEN_PREFIXES.some(prefix => path === prefix || path.startsWith(`${prefix}/`));
}
