// Persist RTMP relay settings to localStorage.
// All access is wrapped in try-catch (private browsing may throw).

const KEY_MODE         = 'lcyt-relay-mode';          // 'caption' | 'rtmp'
const KEY_TARGET_TYPE  = 'lcyt-relay-target-type';   // 'youtube' | 'generic' (slot 1 default)
const KEY_YT_KEY       = 'lcyt-relay-youtube-key';   // YouTube stream key for RTMP (slot 1 default)
const KEY_GENERIC_URL  = 'lcyt-relay-generic-url';   // base rtmp:// URL (slot 1 default)
const KEY_GENERIC_NAME = 'lcyt-relay-generic-name';  // RTMP stream name / key (slot 1 default)
const KEY_CAPTION_MODE = 'lcyt-relay-caption-mode';  // 'http' (slot 1 default)

// Per-slot keys (slots 1-4):
function slotKey(slot, field) { return `lcyt-relay-slot-${slot}-${field}`; }

/** @returns {'caption'|'rtmp'} */
export function getRelayMode() {
  try { return localStorage.getItem(KEY_MODE) || 'caption'; } catch { return 'caption'; }
}

/** @param {'caption'|'rtmp'} mode */
export function setRelayMode(mode) {
  try { localStorage.setItem(KEY_MODE, mode); } catch {}
}

// ─── Per-slot getters/setters ─────────────────────────────────────────────────

/** @param {number} slot 1-4 */
export function getSlotTargetType(slot) {
  if (slot === 1) {
    try { return localStorage.getItem(KEY_TARGET_TYPE) || 'youtube'; } catch { return 'youtube'; }
  }
  try { return localStorage.getItem(slotKey(slot, 'type')) || 'youtube'; } catch { return 'youtube'; }
}

/** @param {number} slot @param {'youtube'|'generic'} type */
export function setSlotTargetType(slot, type) {
  if (slot === 1) { try { localStorage.setItem(KEY_TARGET_TYPE, type); } catch {} return; }
  try { localStorage.setItem(slotKey(slot, 'type'), type); } catch {}
}

/** @param {number} slot */
export function getSlotYoutubeKey(slot) {
  if (slot === 1) { try { return localStorage.getItem(KEY_YT_KEY) || ''; } catch { return ''; } }
  try { return localStorage.getItem(slotKey(slot, 'yt-key')) || ''; } catch { return ''; }
}

/** @param {number} slot @param {string} key */
export function setSlotYoutubeKey(slot, key) {
  if (slot === 1) { try { localStorage.setItem(KEY_YT_KEY, key); } catch {} return; }
  try { localStorage.setItem(slotKey(slot, 'yt-key'), key); } catch {}
}

/** @param {number} slot */
export function getSlotGenericUrl(slot) {
  if (slot === 1) { try { return localStorage.getItem(KEY_GENERIC_URL) || ''; } catch { return ''; } }
  try { return localStorage.getItem(slotKey(slot, 'generic-url')) || ''; } catch { return ''; }
}

/** @param {number} slot @param {string} url */
export function setSlotGenericUrl(slot, url) {
  if (slot === 1) { try { localStorage.setItem(KEY_GENERIC_URL, url); } catch {} return; }
  try { localStorage.setItem(slotKey(slot, 'generic-url'), url); } catch {}
}

/** @param {number} slot */
export function getSlotGenericName(slot) {
  if (slot === 1) { try { return localStorage.getItem(KEY_GENERIC_NAME) || ''; } catch { return ''; } }
  try { return localStorage.getItem(slotKey(slot, 'generic-name')) || ''; } catch { return ''; }
}

/** @param {number} slot @param {string} name */
export function setSlotGenericName(slot, name) {
  if (slot === 1) { try { localStorage.setItem(KEY_GENERIC_NAME, name); } catch {} return; }
  try { localStorage.setItem(slotKey(slot, 'generic-name'), name); } catch {}
}

/** @param {number} slot */
export function getSlotCaptionMode(slot) {
  if (slot === 1) { try { return localStorage.getItem(KEY_CAPTION_MODE) || 'http'; } catch { return 'http'; } }
  try { return localStorage.getItem(slotKey(slot, 'caption-mode')) || 'http'; } catch { return 'http'; }
}

/** @param {number} slot @param {'http'|'cea708'} mode */
export function setSlotCaptionMode(slot, mode) {
  if (slot === 1) { try { localStorage.setItem(KEY_CAPTION_MODE, mode); } catch {} return; }
  try { localStorage.setItem(slotKey(slot, 'caption-mode'), mode); } catch {}
}

/** @param {number} slot */
export function getSlotScale(slot) {
  try { return localStorage.getItem(slotKey(slot, 'scale')) || ''; } catch { return ''; }
}

/** @param {number} slot @param {string} scale */
export function setSlotScale(slot, scale) {
  try {
    if (scale) { localStorage.setItem(slotKey(slot, 'scale'), scale); }
    else { localStorage.removeItem(slotKey(slot, 'scale')); }
  } catch {}
}

/** @param {number} slot */
export function getSlotFps(slot) {
  try {
    const v = localStorage.getItem(slotKey(slot, 'fps'));
    return v ? parseInt(v, 10) : null;
  } catch { return null; }
}

/** @param {number} slot @param {number|null} fps */
export function setSlotFps(slot, fps) {
  try {
    if (fps != null) { localStorage.setItem(slotKey(slot, 'fps'), String(fps)); }
    else { localStorage.removeItem(slotKey(slot, 'fps')); }
  } catch {}
}

/** @param {number} slot */
export function getSlotVideoBitrate(slot) {
  try { return localStorage.getItem(slotKey(slot, 'video-bitrate')) || ''; } catch { return ''; }
}

/** @param {number} slot @param {string} bitrate */
export function setSlotVideoBitrate(slot, bitrate) {
  try {
    if (bitrate) { localStorage.setItem(slotKey(slot, 'video-bitrate'), bitrate); }
    else { localStorage.removeItem(slotKey(slot, 'video-bitrate')); }
  } catch {}
}

/** @param {number} slot */
export function getSlotAudioBitrate(slot) {
  try { return localStorage.getItem(slotKey(slot, 'audio-bitrate')) || ''; } catch { return ''; }
}

/** @param {number} slot @param {string} bitrate */
export function setSlotAudioBitrate(slot, bitrate) {
  try {
    if (bitrate) { localStorage.setItem(slotKey(slot, 'audio-bitrate'), bitrate); }
    else { localStorage.removeItem(slotKey(slot, 'audio-bitrate')); }
  } catch {}
}

/** Remove all localStorage keys for a slot. */
export function clearSlot(slot) {
  try {
    if (slot === 1) {
      [KEY_TARGET_TYPE, KEY_YT_KEY, KEY_GENERIC_URL, KEY_GENERIC_NAME, KEY_CAPTION_MODE]
        .forEach(k => localStorage.removeItem(k));
    } else {
      ['type', 'yt-key', 'generic-url', 'generic-name', 'caption-mode']
        .forEach(f => localStorage.removeItem(slotKey(slot, f)));
    }
    ['scale', 'fps', 'video-bitrate', 'audio-bitrate']
      .forEach(f => localStorage.removeItem(slotKey(slot, f)));
  } catch {}
}

// ─── Legacy (slot-1) aliases for backward compat ─────────────────────────────

/** @returns {'youtube'|'generic'} */
export function getRelayTargetType() { return getSlotTargetType(1); }
/** @param {'youtube'|'generic'} type */
export function setRelayTargetType(type) { setSlotTargetType(1, type); }
/** @returns {string} */
export function getRelayYoutubeKey() { return getSlotYoutubeKey(1); }
/** @param {string} key */
export function setRelayYoutubeKey(key) { setSlotYoutubeKey(1, key); }
/** @returns {string} */
export function getRelayGenericUrl() { return getSlotGenericUrl(1); }
/** @param {string} url */
export function setRelayGenericUrl(url) { setSlotGenericUrl(1, url); }
/** @returns {string} */
export function getRelayGenericName() { return getSlotGenericName(1); }
/** @param {string} name */
export function setRelayGenericName(name) { setSlotGenericName(1, name); }
/** @returns {'http'} */
export function getRelayCaptionMode() { return getSlotCaptionMode(1); }
/** @param {'http'} mode */
export function setRelayCaptionMode(mode) { setSlotCaptionMode(1, mode); }

// ─── Multi-slot helpers ────────────────────────────────────────────────────────

export const MAX_RELAY_SLOTS = 4;

/**
 * Get config for a specific slot.
 * @param {number} slot 1-4
 * @returns {{ slot, targetType, youtubeKey, genericUrl, genericName, captionMode, scale, fps, videoBitrate, audioBitrate }}
 */
export function getSlotConfig(slot) {
  return {
    slot,
    targetType:   getSlotTargetType(slot),
    youtubeKey:   getSlotYoutubeKey(slot),
    genericUrl:   getSlotGenericUrl(slot),
    genericName:  getSlotGenericName(slot),
    captionMode:  getSlotCaptionMode(slot),
    scale:        getSlotScale(slot),
    fps:          getSlotFps(slot),
    videoBitrate: getSlotVideoBitrate(slot),
    audioBitrate: getSlotAudioBitrate(slot),
  };
}

/**
 * Get all configured slots (slots where either youtubeKey or genericUrl is set).
 * @returns {number[]} slot numbers that have configuration
 */
export function getConfiguredSlotNumbers() {
  const slots = [];
  for (let s = 1; s <= MAX_RELAY_SLOTS; s++) {
    const type = getSlotTargetType(s);
    const hasConfig = type === 'youtube'
      ? !!getSlotYoutubeKey(s).trim()
      : !!getSlotGenericUrl(s).trim();
    if (hasConfig) slots.push(s);
  }
  return slots;
}

/**
 * Find the next available slot number (1-4), or null if all are in use.
 * @returns {number|null}
 */
export function getNextAvailableSlot() {
  for (let s = 1; s <= MAX_RELAY_SLOTS; s++) {
    const type = getSlotTargetType(s);
    const hasConfig = type === 'youtube'
      ? !!getSlotYoutubeKey(s).trim()
      : !!getSlotGenericUrl(s).trim();
    if (!hasConfig) return s;
  }
  return null;
}

/**
 * Read all relay settings in one call (slot 1 for backward compat).
 * @returns {{ mode, targetType, youtubeKey, genericUrl, genericName, captionMode }}
 */
export function getAllRelayConfig() {
  return {
    mode:        getRelayMode(),
    targetType:  getRelayTargetType(),
    youtubeKey:  getRelayYoutubeKey(),
    genericUrl:  getRelayGenericUrl(),
    genericName: getRelayGenericName(),
    captionMode: getRelayCaptionMode(),
  };
}

/**
 * Build the RTMP base URL and stream name for a specific slot.
 * YouTube: base = rtmp://a.rtmp.youtube.com/live2, name = stream key
 * Generic: base = user-entered URL, name = user-entered name (optional)
 *
 * @param {number} slot 1-4
 * @returns {{ targetUrl: string|null, targetName: string|null }}
 */
export function buildSlotTarget(slot) {
  const type = getSlotTargetType(slot);
  if (type === 'youtube') {
    const key = getSlotYoutubeKey(slot).trim();
    if (!key) return { targetUrl: null, targetName: null };
    return {
      targetUrl:  'rtmp://a.rtmp.youtube.com/live2',
      targetName: key,
    };
  }
  const url  = getSlotGenericUrl(slot).trim();
  const name = getSlotGenericName(slot).trim();
  if (!url) return { targetUrl: null, targetName: null };
  return {
    targetUrl:  url,
    targetName: name || null,
  };
}

/**
 * Build the RTMP base URL and stream name from current settings (slot 1, legacy).
 * @returns {{ targetUrl: string|null, targetName: string|null }}
 */
export function buildRelayTarget() {
  return buildSlotTarget(1);
}

/**
 * Build a single display-friendly full RTMP URL string for a slot.
 * @param {number} slot
 * @returns {string|null}
 */
export function buildSlotTargetUrl(slot) {
  const { targetUrl, targetName } = buildSlotTarget(slot);
  if (!targetUrl) return null;
  return targetName ? `${targetUrl}/${targetName}` : targetUrl;
}

/**
 * Build a single display-friendly full RTMP URL string (slot 1, legacy).
 * @returns {string|null}
 */
export function buildRelayTargetUrl() {
  return buildSlotTargetUrl(1);
}

/**
 * Build the initial relay list by reading all configured slots from localStorage.
 * Used by SettingsModal and EmbedRtmpPage to populate their relay list state.
 * @returns {Array<{ slot, targetType, youtubeKey, genericUrl, genericName, captionMode }>}
 */
export function buildInitialRelayList() {
  const list = [];
  for (let s = 1; s <= MAX_RELAY_SLOTS; s++) {
    const cfg = getSlotConfig(s);
    const hasConfig = cfg.targetType === 'youtube'
      ? !!(cfg.youtubeKey ?? '').trim()
      : !!(cfg.genericUrl ?? '').trim();
    if (hasConfig) list.push({ ...cfg });
  }
  return list;
}
