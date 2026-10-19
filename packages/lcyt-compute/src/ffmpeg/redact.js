/**
 * Secret values for a fleet job's `redact` list. fffleet replaces each listed value by `***` in
 * stderr tails and job events (4-512 characters, at most 10 values per spec).
 * Stream keys and ingest keys go here; the spec itself keeps them, so ffmpeg still gets them.
 */
export const REDACT_MAX_VALUES = 10;

/**
 * Distinct candidate values that fffleet accepts, in order. Non-strings, values outside 4-512
 * characters and duplicates are dropped; the list is capped at REDACT_MAX_VALUES.
 * @param {...(string|null|undefined|Array<string|null|undefined>)} candidates
 * @returns {string[]}
 */
export function redactList(...candidates) {
  const out = [];
  for (const c of candidates.flat(Infinity)) {
    if (typeof c !== 'string' || c.length < 4 || c.length > 512 || out.includes(c)) continue;
    out.push(c);
  }
  return out.slice(0, REDACT_MAX_VALUES);
}

/**
 * The secret-bearing parts of an output URL: a password, the last path segment (an RTMP stream
 * key, `.../live2/<key>`) and query values. Unparseable input gives an empty list.
 * @param {string} url
 * @returns {string[]}
 */
export function secretsOfUrl(url) {
  let u;
  try { u = new URL(String(url)); } catch { return []; }
  const parts = [];
  if (u.password) parts.push(decodeSafe(u.password));
  const segments = u.pathname.split('/').filter(Boolean);
  if (segments.length) parts.push(decodeSafe(segments.at(-1)));
  for (const v of u.searchParams.values()) parts.push(v);
  return parts;
}

function decodeSafe(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}
