/**
 * Read-only fleet summary for the jobs panel (`GET /jobs` in lcyt-backend): the numbers of the
 * strip line (`fleet 3w · slots 5/8 · queue 2 · hetzner 1/5`). Ported from SaarnaVideo's
 * `src/lib/fleet-status.ts` (the jobs panel is a copied component, see lcyt-web's
 * `components/jobs-panel/README.md`).
 *
 * Credentials are the ones the runners already use (`FFFLEET_URL`/`COMPUTE_URL`, `FFFLEET_TOKEN`/
 * `COMPUTE_TOKEN`, or `FFFLEET_CLIENT_ID` + `FFFLEET_CLIENT_SECRET` through fffleet's token
 * provider). `/v1/capabilities` is required; `/v1/workers` and `/v1/pools` need an admin login and
 * are skipped on 401/403 or any failure. Nothing but numbers leaves this module.
 */

export const FLEET_TIMEOUT_MS = 1500;

/** Orchestrator address and credentials from the environment; null without a URL. */
export function fleetCredentials(env = process.env) {
  const url = (env.FFFLEET_URL || env.COMPUTE_URL || '').trim();
  if (!url) return null;
  return {
    url: url.replace(/\/+$/, ''),
    token: env.FFFLEET_TOKEN || env.COMPUTE_TOKEN || undefined,
    clientId: env.FFFLEET_CLIENT_ID || undefined,
    clientSecret: env.FFFLEET_CLIENT_SECRET || undefined,
  };
}

const providers = new Map();

async function authorization(cred, fetchFn, createTokenProvider, refresh) {
  if (cred.token) return { authorization: `Bearer ${cred.token}` };
  if (cred.clientId && cred.clientSecret) {
    const key = `${cred.url}|${cred.clientId}|${cred.clientSecret}`;
    let provider = providers.get(key);
    if (!provider) {
      const make = createTokenProvider || (await import('fffleet')).createTokenProvider;
      // No scope asked: the token carries all the client's scopes, so admin routes work when the client has admin.
      provider = make({ url: cred.url, clientId: cred.clientId, clientSecret: cred.clientSecret, fetch: fetchFn, timeoutMs: FLEET_TIMEOUT_MS });
      providers.set(key, provider);
    }
    return { authorization: `Bearer ${await provider.get({ refresh })}` };
  }
  return {};
}

async function getJson(cred, path, fetchFn, createTokenProvider) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetchFn(`${cred.url}${path}`, {
      headers: await authorization(cred, fetchFn, createTokenProvider, attempt > 0),
      signal: AbortSignal.timeout(FLEET_TIMEOUT_MS),
    });
    if (res.status === 401 && attempt === 0 && cred.clientId) continue; // expired token: log in once more
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }
}

/**
 * Summarises the orchestrator's answers into the strip's fleet block.
 * `workers` and `pools` are the admin-only lists (null when refused).
 */
export function summariseFleet(capabilities, workers, pools) {
  const sum = (values) => values.reduce((acc, v) => ({ total: acc.total + v.total, used: acc.used + v.used }), { total: 0, used: 0 });
  let slots = sum(Object.values(capabilities?.slots ?? {}));
  let count = capabilities?.workers;
  let draining;
  if (workers?.workers) {
    // Slots of a draining worker take no new work: they do not count as capacity.
    const list = workers.workers;
    count = list.length;
    draining = list.filter((w) => w.draining).length;
    slots = sum(list.filter((w) => !w.draining).map((w) => ({
      total: Object.values(w.slots ?? {}).reduce((a, b) => a + b, 0),
      used: Object.values(w.used ?? {}).reduce((a, b) => a + b, 0),
    })));
  }
  return {
    state: 'ok',
    workers: count,
    slotsUsed: slots.used,
    slotsTotal: slots.total,
    queued: capabilities?.queued,
    ...(draining ? { draining } : {}),
    ...(pools?.pools?.length ? { pools: pools.pools.map((p) => ({ name: p.name, instances: p.instances, max: p.max })) } : {}),
  };
}

/**
 * Asks the orchestrator. Returns null when no fleet is configured, `{ state: 'offline' }` when
 * `/v1/capabilities` does not answer, else the summary.
 */
export async function readFleet({ env = process.env, fetch: fetchFn = globalThis.fetch, createTokenProvider = null } = {}) {
  const cred = fleetCredentials(env);
  if (!cred) return null;
  const [caps, workers, pools] = await Promise.allSettled([
    getJson(cred, '/v1/capabilities', fetchFn, createTokenProvider),
    getJson(cred, '/v1/workers', fetchFn, createTokenProvider),
    getJson(cred, '/v1/pools', fetchFn, createTokenProvider),
  ]);
  if (caps.status === 'rejected') return { state: 'offline' };
  return summariseFleet(caps.value, workers.status === 'fulfilled' ? workers.value : null, pools.status === 'fulfilled' ? pools.value : null);
}
