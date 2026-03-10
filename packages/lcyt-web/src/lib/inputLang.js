/**
 * Shared input-language helpers used by InputBar, ControlsPanel, and ActionsPanel.
 *
 * The input language is stored in localStorage under `lcyt:input-bar-lang`
 * and synced across components via the `lcyt:input-lang-changed` custom event.
 */

const STORAGE_KEY = 'lcyt:input-bar-lang';
const EVENT_NAME = 'lcyt:input-lang-changed';

/** Read the current input-bar language code from localStorage. */
export function readInputLang() {
  try { return localStorage.getItem(STORAGE_KEY) || ''; } catch { return ''; }
}

/** Write the input-bar language code and notify other components. */
export function writeInputLang(code) {
  try {
    if (code) localStorage.setItem(STORAGE_KEY, code);
    else localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new CustomEvent(EVENT_NAME));
  } catch {}
}

/** The custom event name components should listen for. */
export const INPUT_LANG_EVENT = EVENT_NAME;
