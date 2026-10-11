/**
 * "Configured vs enabled" for Setup Hub cards: enabling a feature switches a
 * card on; this tells whether anything has actually been set up behind it
 * (a caption target, a camera, a relay destination, …).
 *
 * Only cards whose list endpoint says something meaningful when empty are
 * checked; everything else is 'unknown' (no badge). Pure apart from the
 * injected fetch, so it is unit-testable.
 */

const list = (json, key) => {
  const arr = key ? json?.[key] : json;
  return Array.isArray(arr) ? arr.length : null;
};

export const CARD_STATUS_CHECKS = {
  'caption-targets': { path: () => '/targets', count: j => list(j, 'targets') },
  cameras:  { path: () => '/production/cameras', count: j => list(j) },
  mixers:   { path: () => '/production/mixers', count: j => list(j) },
  encoders: { path: () => '/production/encoders', count: j => list(j) },
  bridges:  { path: () => '/production/bridge/instances', count: j => list(j) },
  egress:   { path: () => '/stream', count: j => list(j, 'relays') },
  'broadcast-platforms': {
    path: () => '/platforms',
    count: j => (Array.isArray(j?.credentials) ? j.credentials.filter(c => !c.revokedAt).length : null),
  },
  viewports: { path: apiKey => `/dsk/${encodeURIComponent(apiKey)}/viewports`, count: j => list(j, 'viewports') },
};

/** @param {number|null} count @returns {'configured'|'empty'|'unknown'} */
export function classifyCount(count) {
  if (count == null) return 'unknown';
  return count > 0 ? 'configured' : 'empty';
}

/**
 * @param {{
 *   backendUrl: string, token: string, apiKey: string,
 *   cardIds: Iterable<string>,
 *   fetchFn?: typeof fetch,
 * }} opts
 * @returns {Promise<Map<string, {status: 'configured'|'empty'|'unknown', count: number|null}>>}
 */
export async function loadCardStatuses({ backendUrl, token, apiKey, cardIds, fetchFn = fetch }) {
  const result = new Map();
  await Promise.all([...cardIds].map(async id => {
    const check = CARD_STATUS_CHECKS[id];
    if (!check || !backendUrl || !token) { result.set(id, { status: 'unknown', count: null }); return; }
    try {
      const r = await fetchFn(`${backendUrl}${check.path(apiKey)}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) { result.set(id, { status: 'unknown', count: null }); return; }
      const count = check.count(await r.json());
      result.set(id, { status: classifyCount(count), count });
    } catch {
      result.set(id, { status: 'unknown', count: null });
    }
  }));
  return result;
}
