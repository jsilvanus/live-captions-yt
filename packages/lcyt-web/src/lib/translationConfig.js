const KEY_VENDOR        = 'lcyt:translation-vendor';
const KEY_API_KEY       = 'lcyt:translation-vendor-key';
const KEY_LIBRE_URL     = 'lcyt:translation-libre-url';
const KEY_LIBRE_KEY     = 'lcyt:translation-libre-key';
const KEY_SHOW_ORIGINAL = 'lcyt:translation-show-original';
const KEY_TRANSLATIONS  = 'lcyt:translations';

// Legacy keys kept for one-time migration
const _KEY_ENABLED_LEGACY = 'lcyt:translation-enabled';
const _KEY_TARGET_LEGACY  = 'lcyt:translation-target-lang';

export const TRANSLATION_VENDORS = [
  { value: 'mymemory',       labelKey: 'settings.translation.vendors.mymemory' },
  { value: 'google',         labelKey: 'settings.translation.vendors.google' },
  { value: 'deepl',          labelKey: 'settings.translation.vendors.deepl' },
  { value: 'libretranslate', labelKey: 'settings.translation.vendors.libretranslate' },
];

/** Targets a translation can write to. */
export const TRANSLATION_TARGETS = [
  { value: 'captions',      labelKey: 'settings.translation.targets.captions' },
  { value: 'file',          labelKey: 'settings.translation.targets.file' },
  { value: 'backend-file',  labelKey: 'settings.translation.targets.backendFile' },
];

/** File formats for file / backend-file targets. */
export const CAPTION_FORMATS = [
  { value: 'youtube', labelKey: 'settings.translation.formats.youtube' },
  { value: 'vtt',     labelKey: 'settings.translation.formats.vtt' },
];

/**
 * Load the list of configured translations from localStorage.
 * Migrates from the legacy single-translation settings on first call.
 *
 * Each entry:
 *   { id: string, enabled: boolean, lang: string, target: 'captions'|'file'|'backend-file', format?: 'youtube'|'vtt' }
 *
 * @returns {Array}
 */
export function getTranslations() {
  try {
    const raw = localStorage.getItem(KEY_TRANSLATIONS);
    if (raw) return JSON.parse(raw);

    // One-time migration from legacy single-translation settings
    const legacyEnabled = localStorage.getItem(_KEY_ENABLED_LEGACY) === '1';
    const legacyLang    = localStorage.getItem(_KEY_TARGET_LEGACY) || 'en-US';
    if (legacyEnabled && legacyLang) {
      const migrated = [{ id: crypto.randomUUID(), enabled: true, lang: legacyLang, target: 'captions' }];
      localStorage.setItem(KEY_TRANSLATIONS, JSON.stringify(migrated));
      localStorage.removeItem(_KEY_ENABLED_LEGACY);
      localStorage.removeItem(_KEY_TARGET_LEGACY);
      return migrated;
    }
    return [];
  } catch { return []; }
}

export function setTranslations(list) {
  try { localStorage.setItem(KEY_TRANSLATIONS, JSON.stringify(list)); } catch {}
}

/** Convenience: returns only enabled translations. */
export function getEnabledTranslations() {
  return getTranslations().filter(t => t.enabled);
}

/** Returns the single enabled translation whose target is 'captions', or null. */
export function getCaptionTranslation() {
  return getEnabledTranslations().find(t => t.target === 'captions') ?? null;
}

// ─── Legacy single-translation compat shims (still used by AudioPanel during transition) ───

export function getTranslationEnabled() {
  return getEnabledTranslations().length > 0;
}

export function getTranslationTargetLang() {
  return getCaptionTranslation()?.lang ?? 'en-US';
}

export function getTranslationShowOriginal() {
  try { return localStorage.getItem(KEY_SHOW_ORIGINAL) === '1'; } catch { return false; }
}

export function setTranslationShowOriginal(enabled) {
  try { localStorage.setItem(KEY_SHOW_ORIGINAL, enabled ? '1' : '0'); } catch {}
}

// ─── Vendor settings (global) ────────────────────────────────────────────────

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
