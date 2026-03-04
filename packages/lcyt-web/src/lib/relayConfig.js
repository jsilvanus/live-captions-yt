// Persist RTMP relay settings to localStorage.
// All access is wrapped in try-catch (private browsing may throw).

const KEY_MODE         = 'lcyt-relay-mode';          // 'caption' | 'rtmp'
const KEY_TARGET_TYPE  = 'lcyt-relay-target-type';   // 'youtube' | 'generic'
const KEY_YT_KEY       = 'lcyt-relay-youtube-key';   // YouTube stream key for RTMP
const KEY_GENERIC_URL  = 'lcyt-relay-generic-url';   // base rtmp:// URL (without stream name/key)
const KEY_GENERIC_NAME = 'lcyt-relay-generic-name';  // RTMP stream name / key for generic target
const KEY_CAPTION_MODE = 'lcyt-relay-caption-mode';  // 'http' | 'cea708' (placeholder)

/** @returns {'caption'|'rtmp'} */
export function getRelayMode() {
  try { return localStorage.getItem(KEY_MODE) || 'caption'; } catch { return 'caption'; }
}

/** @param {'caption'|'rtmp'} mode */
export function setRelayMode(mode) {
  try { localStorage.setItem(KEY_MODE, mode); } catch {}
}

/** @returns {'youtube'|'generic'} */
export function getRelayTargetType() {
  try { return localStorage.getItem(KEY_TARGET_TYPE) || 'youtube'; } catch { return 'youtube'; }
}

/** @param {'youtube'|'generic'} type */
export function setRelayTargetType(type) {
  try { localStorage.setItem(KEY_TARGET_TYPE, type); } catch {}
}

/** @returns {string} */
export function getRelayYoutubeKey() {
  try { return localStorage.getItem(KEY_YT_KEY) || ''; } catch { return ''; }
}

/** @param {string} key */
export function setRelayYoutubeKey(key) {
  try { localStorage.setItem(KEY_YT_KEY, key); } catch {}
}

/** @returns {string} Base RTMP URL (application URL, without stream name) */
export function getRelayGenericUrl() {
  try { return localStorage.getItem(KEY_GENERIC_URL) || ''; } catch { return ''; }
}

/** @param {string} url */
export function setRelayGenericUrl(url) {
  try { localStorage.setItem(KEY_GENERIC_URL, url); } catch {}
}

/** @returns {string} RTMP stream name / key for generic target */
export function getRelayGenericName() {
  try { return localStorage.getItem(KEY_GENERIC_NAME) || ''; } catch { return ''; }
}

/** @param {string} name */
export function setRelayGenericName(name) {
  try { localStorage.setItem(KEY_GENERIC_NAME, name); } catch {}
}

/** @returns {'http'|'cea708'} */
export function getRelayCaptionMode() {
  try { return localStorage.getItem(KEY_CAPTION_MODE) || 'http'; } catch { return 'http'; }
}

/** @param {'http'|'cea708'} mode */
export function setRelayCaptionMode(mode) {
  try { localStorage.setItem(KEY_CAPTION_MODE, mode); } catch {}
}

/**
 * Read all relay settings in one call.
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
 * Build the RTMP base URL and stream name from current settings.
 * YouTube: base = rtmp://a.rtmp.youtube.com/live2, name = stream key
 * Generic: base = user-entered URL, name = user-entered name (optional)
 *
 * @returns {{ targetUrl: string|null, targetName: string|null }}
 */
export function buildRelayTarget() {
  const type = getRelayTargetType();
  if (type === 'youtube') {
    const key = getRelayYoutubeKey().trim();
    if (!key) return { targetUrl: null, targetName: null };
    return {
      targetUrl:  'rtmp://a.rtmp.youtube.com/live2',
      targetName: key,
    };
  }
  const url  = getRelayGenericUrl().trim();
  const name = getRelayGenericName().trim();
  if (!url) return { targetUrl: null, targetName: null };
  return {
    targetUrl:  url,
    targetName: name || null,
  };
}

/**
 * Build a single display-friendly full RTMP URL string.
 * @returns {string|null}
 */
export function buildRelayTargetUrl() {
  const { targetUrl, targetName } = buildRelayTarget();
  if (!targetUrl) return null;
  return targetName ? `${targetUrl}/${targetName}` : targetUrl;
}
