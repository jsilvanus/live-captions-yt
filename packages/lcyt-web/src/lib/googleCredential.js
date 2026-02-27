/**
 * In-memory store for the Google service account credential.
 * Never persisted to disk or localStorage — cleared when the page closes.
 */

let credential = null;

export function setGoogleCredential(cred) {
  credential = cred;
  window.dispatchEvent(new CustomEvent('lcyt:stt-credential-changed'));
}

export function getGoogleCredential() {
  return credential;
}

export function clearGoogleCredential() {
  credential = null;
  window.dispatchEvent(new CustomEvent('lcyt:stt-credential-changed'));
}

/**
 * Build a signed RS256 JWT from a service account credential object.
 * Uses the Web Crypto API — works in all modern browsers.
 */
export async function buildJwt(cred, scope) {
  const now = Math.floor(Date.now() / 1000);

  const header  = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: cred.client_email,
    scope,
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };

  const b64url = (obj) =>
    btoa(JSON.stringify(obj))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');

  const signingInput = `${b64url(header)}.${b64url(payload)}`;

  // Strip PEM envelope and decode
  const pem = cred.private_key.replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
  const der  = Uint8Array.from(atob(pem), c => c.charCodeAt(0));

  const key = await crypto.subtle.importKey(
    'pkcs8',
    der.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const sig    = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  return `${signingInput}.${sigB64}`;
}

/**
 * Exchange a service account credential for a short-lived OAuth2 bearer token.
 * Returns { token, expires } where expires is a Unix timestamp (seconds).
 */
export async function fetchOAuthToken(cred, scope = 'https://www.googleapis.com/auth/cloud-platform') {
  const jwt = await buildJwt(cred, scope);

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });

  const data = await res.json();
  if (!data.access_token) {
    throw new Error(data.error_description || data.error || 'Failed to obtain OAuth2 token');
  }

  return {
    token:   data.access_token,
    expires: Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
  };
}
