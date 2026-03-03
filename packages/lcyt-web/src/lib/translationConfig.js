const KEY_ENABLED    = 'lcyt:translation-enabled';
const KEY_TARGET     = 'lcyt:translation-target-lang';
const KEY_VENDOR     = 'lcyt:translation-vendor';
const KEY_API_KEY    = 'lcyt:translation-vendor-key';
const KEY_LIBRE_URL  = 'lcyt:translation-libre-url';
const KEY_LIBRE_KEY  = 'lcyt:translation-libre-key';

export const TRANSLATION_VENDORS = [
  { value: 'mymemory',       labelKey: 'settings.translation.vendors.mymemory' },
  { value: 'google',         labelKey: 'settings.translation.vendors.google' },
  { value: 'deepl',          labelKey: 'settings.translation.vendors.deepl' },
  { value: 'libretranslate', labelKey: 'settings.translation.vendors.libretranslate' },
];

export function getTranslationEnabled() {
  try { return localStorage.getItem(KEY_ENABLED) === '1'; } catch { return false; }
}

export function setTranslationEnabled(enabled) {
  try { localStorage.setItem(KEY_ENABLED, enabled ? '1' : '0'); } catch {}
}

export function getTranslationTargetLang() {
  return localStorage.getItem(KEY_TARGET) || 'en-US';
}

export function setTranslationTargetLang(lang) {
  try { localStorage.setItem(KEY_TARGET, lang); } catch {}
}

export function getTranslationVendor() {
  return localStorage.getItem(KEY_VENDOR) || 'mymemory';
}

export function setTranslationVendor(vendor) {
  try { localStorage.setItem(KEY_VENDOR, vendor); } catch {}
}

export function getTranslationApiKey() {
  return localStorage.getItem(KEY_API_KEY) || '';
}

export function setTranslationApiKey(key) {
  try { localStorage.setItem(KEY_API_KEY, key); } catch {}
}

export function getTranslationLibreUrl() {
  return localStorage.getItem(KEY_LIBRE_URL) || '';
}

export function setTranslationLibreUrl(url) {
  try { localStorage.setItem(KEY_LIBRE_URL, url); } catch {}
}

export function getTranslationLibreKey() {
  return localStorage.getItem(KEY_LIBRE_KEY) || '';
}

export function setTranslationLibreKey(key) {
  try { localStorage.setItem(KEY_LIBRE_KEY, key); } catch {}
}
