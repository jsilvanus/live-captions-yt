const KEY_ENABLED    = 'lcyt:translation-enabled';
const KEY_TARGET     = 'lcyt:translation-target';
const KEY_VENDOR     = 'lcyt:translation-vendor';
const KEY_DEEPL_KEY  = 'lcyt:translation-deepl-key';
const KEY_LIBRE_URL  = 'lcyt:translation-libre-url';
const KEY_LIBRE_KEY  = 'lcyt:translation-libre-key';

function dispatch() {
  window.dispatchEvent(new CustomEvent('lcyt:translation-config-changed'));
}

export function getTranslationEnabled() {
  try { return localStorage.getItem(KEY_ENABLED) === '1'; } catch { return false; }
}

export function setTranslationEnabled(val) {
  try { localStorage.setItem(KEY_ENABLED, val ? '1' : '0'); } catch {}
  dispatch();
}

export function getTranslationTarget() {
  try { return localStorage.getItem(KEY_TARGET) || 'en-US'; } catch { return 'en-US'; }
}

export function setTranslationTarget(code) {
  try { localStorage.setItem(KEY_TARGET, code); } catch {}
  dispatch();
}

export function getTranslationVendor() {
  try { return localStorage.getItem(KEY_VENDOR) || 'google'; } catch { return 'google'; }
}

export function setTranslationVendor(vendor) {
  try { localStorage.setItem(KEY_VENDOR, vendor); } catch {}
  dispatch();
}

export function getDeepLKey() {
  try { return localStorage.getItem(KEY_DEEPL_KEY) || ''; } catch { return ''; }
}

export function setDeepLKey(key) {
  try { localStorage.setItem(KEY_DEEPL_KEY, key); } catch {}
  dispatch();
}

export function getLibreTranslateUrl() {
  try { return localStorage.getItem(KEY_LIBRE_URL) || ''; } catch { return ''; }
}

export function setLibreTranslateUrl(url) {
  try { localStorage.setItem(KEY_LIBRE_URL, url); } catch {}
  dispatch();
}

export function getLibreTranslateKey() {
  try { return localStorage.getItem(KEY_LIBRE_KEY) || ''; } catch { return ''; }
}

export function setLibreTranslateKey(key) {
  try { localStorage.setItem(KEY_LIBRE_KEY, key); } catch {}
  dispatch();
}
