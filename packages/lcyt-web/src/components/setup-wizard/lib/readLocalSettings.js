import { KEYS, relaySlotKey } from '../../../lib/storageKeys.js';
import { MAX_RELAY_SLOTS } from './constants.js';

/**
 * Read current localStorage settings into a normalised LocalSettings object.
 * Returns safe defaults when keys are absent.
 *
 * @returns {LocalSettings}
 */
export function readLocalSettings() {
  function get(key, fallback = '') {
    try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
  }
  function getJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch { return fallback; }
  }

  // Caption targets
  const targets = getJson(KEYS.targets.list, []);

  // Translation
  const translationVendor      = get(KEYS.translation.vendor,       'mymemory');
  const translationVendorKey   = get(KEYS.translation.vendorKey,    '');
  const translationLibreUrl    = get(KEYS.translation.libreUrl,     '');
  const translationLibreKey    = get(KEYS.translation.libreKey,     '');
  const translationShowOriginal = get(KEYS.translation.showOriginal, 'false') === 'true';
  const translationList        = getJson(KEYS.translation.list,     []);

  // Relay slots — using canonical in-memory field names (targetType, youtubeKey);
  // storage keys use legacy names ('type', 'ytKey') for backward compatibility.
  const relayList = [];
  for (let s = 1; s <= MAX_RELAY_SLOTS; s++) {
    const targetType   = get(relaySlotKey(s, 'type'),         'youtube');
    const youtubeKey   = get(relaySlotKey(s, 'ytKey'),        '');
    const genericUrl   = get(relaySlotKey(s, 'genericUrl'),   '');
    const genericName  = get(relaySlotKey(s, 'genericName'),  '');
    const captionMode  = get(relaySlotKey(s, 'captionMode'),  'http');
    const scale        = get(relaySlotKey(s, 'scale'),        '');
    const fpsRaw       = get(relaySlotKey(s, 'fps'),          '');
    const fps          = fpsRaw ? parseInt(fpsRaw, 10) : null;
    const videoBitrate = get(relaySlotKey(s, 'videoBitrate'), '');
    const audioBitrate = get(relaySlotKey(s, 'audioBitrate'), '');

    const hasConfig = targetType === 'youtube' ? !!youtubeKey.trim() : !!genericUrl.trim();
    if (hasConfig) {
      relayList.push({ slot: s, active: false, targetType, youtubeKey, genericUrl, genericName, captionMode, scale, fps, videoBitrate, audioBitrate });
    }
  }

  return {
    targets,
    translationVendor,
    translationVendorKey,
    translationLibreUrl,
    translationLibreKey,
    translationShowOriginal,
    translationList,
    relayList,
  };
}
