/**
 * Manages manually-activated caption codes from the ActionsPanel.
 * Codes are persisted in localStorage and broadcast via a custom DOM event.
 *
 * Supported codes (lang is handled separately via lcyt:input-bar-lang):
 *   section, speaker, lyrics (boolean), no-translate (boolean)
 */

const KEY = 'lcyt:active-codes';

/**
 * Read currently active codes.
 * @returns {{ section?: string, speaker?: string, lyrics?: boolean, 'no-translate'?: boolean }}
 */
export function getActiveCodes() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
}

/**
 * Set a code value. Pass null/undefined/'' to remove the code.
 * @param {string} codeKey
 * @param {*} value
 */
export function setActiveCode(codeKey, value) {
  try {
    const codes = getActiveCodes();
    if (value === null || value === undefined || value === '') {
      delete codes[codeKey];
    } else {
      codes[codeKey] = value;
    }
    localStorage.setItem(KEY, JSON.stringify(codes));
    window.dispatchEvent(new CustomEvent('lcyt:active-codes-changed'));
  } catch {}
}

/**
 * Remove a code from the active set.
 * @param {string} codeKey
 */
export function clearActiveCode(codeKey) {
  setActiveCode(codeKey, null);
}

/**
 * Clear all active codes.
 */
export function clearAllActiveCodes() {
  try {
    localStorage.removeItem(KEY);
    window.dispatchEvent(new CustomEvent('lcyt:active-codes-changed'));
  } catch {}
}
