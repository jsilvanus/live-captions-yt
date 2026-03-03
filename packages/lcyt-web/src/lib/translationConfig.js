const KEY_ENABLED       = 'lcyt:translation-enabled';
const KEY_TARGET        = 'lcyt:translation-target-lang';
const KEY_VENDOR        = 'lcyt:translation-vendor';
const KEY_API_KEY       = 'lcyt:translation-vendor-key';
const KEY_LIBRE_URL     = 'lcyt:translation-libre-url';
const KEY_LIBRE_KEY     = 'lcyt:translation-libre-key';
const KEY_SHOW_ORIGINAL = 'lcyt:translation-show-original';

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
  try { return localStorage.getItem(KEY_TARGET) || 'en-US'; } catch { return 'en-US'; }
}

export function setTranslationTargetLang(lang) {
  try { localStorage.setItem(KEY_TARGET, lang); } catch {}
}

export function getTranslationVendor() {
  try { return localStorage.getItem(KEY_VENDOR) || 'mymemory'; } catch { return 'mymemory'; }
}

export function setTranslationVendor(vendor) {
  try { localStorage.setItem(KEY_VENDOR, vendor); } catch {}
}

export function getTranslationApiKey() {
  try { return localStorage.getItem(KEY_API_KEY) || ''; } catch { return ''; }
}

export function setTranslationApiKey(key) {
  try { localStorage.setItem(KEY_API_KEY, key); } catch {}
}

export function getTranslationLibreUrl() {
  try { return localStorage.getItem(KEY_LIBRE_URL) || ''; } catch { return ''; }
}

export function setTranslationLibreUrl(url) {
  try { localStorage.setItem(KEY_LIBRE_URL, url); } catch {}
}

export function getTranslationLibreKey() {
  try { return localStorage.getItem(KEY_LIBRE_KEY) || ''; } catch { return ''; }
}

export function setTranslationLibreKey(key) {
  try { localStorage.setItem(KEY_LIBRE_KEY, key); } catch {}
}

export function getTranslationShowOriginal() {
  try { return localStorage.getItem(KEY_SHOW_ORIGINAL) === '1'; } catch { return false; }
}

export function setTranslationShowOriginal(enabled) {
  try { localStorage.setItem(KEY_SHOW_ORIGINAL, enabled ? '1' : '0'); } catch {}
}
