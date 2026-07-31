/**
 * Signed OAuth `state` parameter.
 *
 * The callback route is unauthenticated by necessity — the provider redirects
 * the operator's browser straight to it, carrying none of our session. That
 * makes `state` the *only* thing binding the returning code to a project, so
 * it cannot be a bare api_key query param: anyone could then attach their own
 * YouTube channel to someone else's project just by editing the URL.
 *
 * Instead it is an HMAC-signed, short-TTL envelope over
 * `{ apiKey, platform, nonce, exp }`. Verification checks the signature in
 * constant time, the expiry, and that the platform matches the route the
 * callback arrived on.
 *
 * Signed with JWT_SECRET rather than a new secret: it is already required to
 * exist, already the trust root for every session token in the system, and
 * adding a fourth secret to configure would buy nothing here.
 *
 * See plan_broadcast_platform_sync.md § "Security considerations".
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** How long a consent round-trip may take. Long enough to pick an account, short enough to be useless if leaked. */
export const STATE_TTL_MS = 10 * 60 * 1000;

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

function sign(payloadB64, secret) {
  return createHmac('sha256', secret).update(payloadB64).digest('base64url');
}

/**
 * @param {{ apiKey: string, platform: string }} claims
 * @param {string} secret
 * @param {{ now?: number, ttlMs?: number }} [opts]
 * @returns {string} `<payload>.<signature>`, URL-safe
 */
export function createState({ apiKey, platform }, secret, { now = Date.now(), ttlMs = STATE_TTL_MS } = {}) {
  if (!apiKey || !platform) throw new TypeError('createState requires apiKey and platform');
  if (!secret) throw new TypeError('createState requires a signing secret');
  const payload = b64url(JSON.stringify({
    apiKey,
    platform,
    // Makes two states issued in the same millisecond distinct, so a state is
    // never guessable from another one the same operator saw.
    nonce: randomBytes(9).toString('base64url'),
    exp: now + ttlMs,
  }));
  return `${payload}.${sign(payload, secret)}`;
}

/**
 * Verify and decode. Returns null for anything untrustworthy rather than
 * throwing — a callback with bad state is a redirect to an error page, not a
 * stack trace.
 *
 * @param {string} state
 * @param {string} secret
 * @param {{ platform?: string, now?: number }} [opts] `platform` pins the state
 *   to the route it arrived on, so a state minted for one provider can't be
 *   replayed against another's callback.
 * @returns {{ apiKey: string, platform: string, exp: number }|null}
 */
export function verifyState(state, secret, { platform, now = Date.now() } = {}) {
  if (typeof state !== 'string' || !secret) return null;
  const dot = state.indexOf('.');
  if (dot <= 0) return null;

  const payloadB64 = state.slice(0, dot);
  const provided = state.slice(dot + 1);
  const expected = sign(payloadB64, secret);

  // Compare in constant time. Length is checked first because timingSafeEqual
  // throws on a mismatch, and the length itself is not a secret.
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let claims;
  try {
    claims = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (!claims || typeof claims.apiKey !== 'string' || typeof claims.platform !== 'string') return null;
  if (typeof claims.exp !== 'number' || claims.exp <= now) return null;
  if (platform && claims.platform !== platform) return null;

  return claims;
}
