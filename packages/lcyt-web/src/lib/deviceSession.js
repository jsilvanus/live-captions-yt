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

function stripTrailingSlash(url) {
  return typeof url === 'string' ? url.replace(/\/$/, '') : url;
}

/**
 * Resolve a kiosk page's backend URL + Authorization header. Backend URL
 * priority: an explicit ?server= URL param (an intentionally crafted
 * capability link) wins, then a persisted device session's own backendUrl
 * (the natural case: the operator already ran /device-login in this tab),
 * then the page's legacy localStorage override (pre-device-login mechanism,
 * kept for back-compat with any capability URL that relies on it being set
 * by hand).
 *
 * The device token is a bearer credential for the specific backend it was
 * issued against — it must never be sent to a *different* origin. So the
 * Authorization header is only attached when the resolved backendUrl is
 * that same origin: either no ?server= override was given at all (the
 * device's own backendUrl wins by priority above), or the override happens
 * to name the identical URL. A ?server= pointing anywhere else (a crafted
 * or accidental capability link) still resolves that URL as backendUrl —
 * kiosk pages with no device session at all rely on exactly that — but the
 * token itself is withheld, so it can never leak to an arbitrary origin.
 * @param {string} legacyStorageKey  the page's own pre-existing localStorage key
 */
export function resolveKioskConnection(legacyStorageKey) {
  const device = readDeviceSession();
  const params = new URLSearchParams(window.location.search);
  const explicitServer = params.get('server');
  const backendUrl = explicitServer
    || device?.backendUrl
    || localStorage.getItem(legacyStorageKey)
    || '';
  const deviceMatchesBackend = Boolean(device)
    && (!explicitServer || stripTrailingSlash(explicitServer) === stripTrailingSlash(device.backendUrl));
  const authHeaders = deviceMatchesBackend ? { Authorization: `Bearer ${device.token}` } : {};
  return { backendUrl, authHeaders, device: deviceMatchesBackend ? device : null };
}
