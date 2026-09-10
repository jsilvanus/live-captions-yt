/**
 * Reads the device-role JWT persisted by DeviceLoginPage.jsx into
 * sessionStorage['lcyt-device'] — the credential capability-URL kiosk pages
 * (CameraStreamPage.jsx, LcytMixerPage.jsx) that have no login flow of their
 * own can optionally pick up, if the same browser tab already logged in via
 * /device-login. Returns null when absent, malformed, or tokenless.
 */
export function readDeviceSession() {
  try {
    const raw = sessionStorage.getItem('lcyt-device');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.token ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Resolve a kiosk page's backend URL + Authorization header. Priority:
 * an explicit ?server= URL param (an intentionally crafted capability link)
 * wins, then a persisted device session's own backendUrl (the natural case:
 * the operator already ran /device-login in this tab), then the page's
 * legacy localStorage override (pre-device-login mechanism, kept for
 * back-compat with any capability URL that relies on it being set by hand).
 * @param {string} legacyStorageKey  the page's own pre-existing localStorage key
 */
export function resolveKioskConnection(legacyStorageKey) {
  const device = readDeviceSession();
  const params = new URLSearchParams(window.location.search);
  const backendUrl = params.get('server')
    || device?.backendUrl
    || localStorage.getItem(legacyStorageKey)
    || '';
  const authHeaders = device ? { Authorization: `Bearer ${device.token}` } : {};
  return { backendUrl, authHeaders, device };
}
