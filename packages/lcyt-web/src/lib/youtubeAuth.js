/**
 * YouTube OAuth2 via Google Identity Services (GIS).
 *
 * Users must create a Google Cloud project, enable YouTube Data API v3,
 * and create OAuth 2.0 credentials (Web application) with the app origin
 * as an allowed JavaScript origin.
 *
 * The client ID is stored in localStorage under 'lcyt:yt-client-id'.
 */

let _tokenClient = null;
let _accessToken = null;
let _tokenExpiry = 0;
let _gisLoaded = false;
let _loadPromise = null;

export function getYtClientId() {
  try { return localStorage.getItem('lcyt:yt-client-id') || ''; } catch { return ''; }
}

export function setYtClientId(id) {
  try { localStorage.setItem('lcyt:yt-client-id', id); } catch {}
}

/** Load the Google Identity Services script (once). */
function loadGis() {
  if (_gisLoaded) return Promise.resolve();
  if (_loadPromise) return _loadPromise;
  _loadPromise = new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) {
      _gisLoaded = true;
      resolve();
      return;
    }
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.defer = true;
    s.onload = () => { _gisLoaded = true; resolve(); };
    s.onerror = () => reject(new Error('Failed to load Google Identity Services'));
    document.head.appendChild(s);
  });
  return _loadPromise;
}

/**
 * Request an access token via OAuth2 popup.
 * Resolves with the token string; rejects on error or user cancel.
 */
export async function requestYouTubeToken() {
  const clientId = getYtClientId();
  if (!clientId) throw new Error('No YouTube OAuth Client ID configured');

  await loadGis();

  return new Promise((resolve, reject) => {
    _tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: 'https://www.googleapis.com/auth/youtube',
      callback: (response) => {
        if (response.error) {
          reject(new Error(response.error_description || response.error));
          return;
        }
        _accessToken = response.access_token;
        _tokenExpiry = Date.now() + (parseInt(response.expires_in, 10) || 3600) * 1000;
        resolve(_accessToken);
      },
      error_callback: (err) => {
        reject(new Error(err?.message || 'OAuth error'));
      },
    });
    _tokenClient.requestAccessToken({ prompt: '' });
  });
}

export function getYouTubeToken() {
  if (_accessToken && Date.now() < _tokenExpiry - 60_000) return _accessToken;
  return null;
}

export function revokeYouTubeToken() {
  if (!_accessToken) return;
  try {
    window.google?.accounts?.oauth2?.revoke(_accessToken, () => {});
  } catch {}
  _accessToken = null;
  _tokenExpiry = 0;
  _tokenClient = null;
}
