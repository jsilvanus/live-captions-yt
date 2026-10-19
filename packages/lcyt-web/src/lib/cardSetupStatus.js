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

/**
 * Named feeds, plus the Video slot when it is enabled. The main feed is always listed by
 * GET /feeds, so the enable switch (GET /ingestion/config) is what says whether it is in use.
 */
const feedsCheck = {
  path: () => '/feeds',
  count: j => (Array.isArray(j?.feeds) ? j.feeds.filter(f => !f.managed && !f.primary).length : null),
  also: [{ path: () => '/ingestion/config', count: j => (j?.video ? (j.video.enabled ? 1 : 0) : null) }],
};

/** The Devices card: cameras, mixers and encoders added together. */
const devicesCheck = {
  path: () => '/production/cameras',
  count: j => list(j),
  also: [
    { path: () => '/production/mixers', count: j => list(j) },
    { path: () => '/production/encoders', count: j => list(j) },
  ],
};

export const CARD_STATUS_CHECKS = {
  'caption-targets': { path: () => '/targets', count: j => list(j, 'targets') },
  feeds: feedsCheck,
  devices: devicesCheck,
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

/** Adds up the counts of one card's checks; a known count above zero wins over a failed request. */
function combineCounts(counts) {
  const known = counts.filter(c => c != null);
  if (known.length === 0) return null;
  const total = known.reduce((a, b) => a + b, 0);
  return total > 0 || known.length === counts.length ? total : null;
}

async function countAt(check, path, { backendUrl, token, fetchFn }) {
  try {
    const r = await fetchFn(`${backendUrl}/api/v1${path}`, { headers: { Authorization: `Bearer ${token}` } });
    return r.ok ? check.count(await r.json()) : null;
  } catch {
    return null;
  }
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
    const parts = [check, ...[].concat(check.also || [])];
    const counts = await Promise.all(parts.map(c => countAt(c, c.path(apiKey), { backendUrl, token, fetchFn })));
    const count = combineCounts(counts);
    result.set(id, { status: classifyCount(count), count });
  }));
  return result;
}
