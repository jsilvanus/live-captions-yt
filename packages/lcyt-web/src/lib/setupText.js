import { getMessages, translate } from './i18n.js';

/**
 * Translate `setupWizard.*` keys with `{name}` placeholders. Falls back to
 * English for a key missing in the current language, then to the key itself.
 *
 * @param {string} lang
 * @returns {(key: string, params?: Record<string, string|number>) => string}
 */
export function makeSetupT(lang) {
  const messages = getMessages(lang);
  const english = getMessages('en');
  return function t(key, params) {
    const full = `setupWizard.${key}`;
    let text = translate(messages, full);
    if (text === full) text = translate(english, full);
    if (text === full) return key;
    if (!params) return text;
    return text.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m));
  };
}

/** True when a key exists in English (used for optional text such as help lines). */
export function hasSetupText(key) {
  const full = `setupWizard.${key}`;
  return translate(getMessages('en'), full) !== full;
}
