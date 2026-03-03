import en from '../locales/en.js';
import fi from '../locales/fi.js';
import sv from '../locales/sv.js';

const LOCALES = { en, fi, sv };

export const LOCALE_CODES = ['en', 'fi', 'sv'];

const STORAGE_KEY = 'lcyt:lang';

export function getStoredLang() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && LOCALE_CODES.includes(stored)) return stored;
  } catch {}
  const browser = navigator.language?.slice(0, 2).toLowerCase();
  if (LOCALE_CODES.includes(browser)) return browser;
  return 'en';
}

export function storeLang(lang) {
  try { localStorage.setItem(STORAGE_KEY, lang); } catch {}
}

export function getMessages(lang) {
  return LOCALES[lang] || LOCALES.en;
}

// Nested dot-path accessor, e.g. translate(msgs, 'settings.title')
export function translate(messages, key) {
  const parts = key.split('.');
  let val = messages;
  for (const part of parts) {
    if (val == null) return key;
    val = val[part];
  }
  return typeof val === 'string' ? val : key;
}
