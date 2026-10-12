/**
 * Process ownership across instances (plan_multi_instance.md, L4).
 *
 * The RTMP relay, vertical crop and server-side STT managers keep what they started in their own
 * memory. With several backend instances on one database, `createOwnership()` gives them the pieces
 * `withOwnership()` (lcyt-rtmp `src/ownership.js`) needs:
 *
 *  - `claim(kind, key, { stillNeeded })`: take the lease `proc:<kind>:<key>` and renew it every
 *    `renewMs` while `stillNeeded()` is true; when it turns false the lease is given back. An
 *    instance that dies stops renewing, so the key becomes free after `ttlMs` and the next start
 *    on any instance takes over.
 *  - `ownerOf(kind, key)`: who holds the lease (cached for `cacheMs`; claims and releases on this
 *    instance drop the cache entry), with the holder's `INSTANCE_URL` from the instance registry.
 *  - `forward(owner, kind, method, args)`: one authenticated JSON POST to the holder's
 *    `/internal/cluster/call`, which runs the call there (`routes/cluster-internal.js`).
 *
 * The call is authenticated with an HMAC of `JWT_SECRET` (all instances share it, because session
 * tokens must work on any of them). The route is not under `/api` and must not be published by the
 * reverse proxy.
 *
 * Only built in shared mode (PostgreSQL); a single instance never creates it.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/** Bearer value for forwarded calls. */
export function clusterToken(secret) {
  return createHmac('sha256', String(secret)).update('lcyt-cluster-call-v1').digest('hex');
}

/** Constant-time check of the bearer value. */
export function verifyClusterToken(secret, given) {
  if (typeof given !== 'string' || !given) return false;
  const want = Buffer.from(clusterToken(secret));
  const got = Buffer.from(given);
  return want.length === got.length && timingSafeEqual(want, got);
}

/**
 * @param {{
 *   leases: ReturnType<import('./leases.js').createLeases>,
 *   registry: { peers: () => any[], list: () => Promise<any[]> },
 *   instanceId: string,
 *   secret: string,
 *   fetchImpl?: typeof fetch,
 *   ttlMs?: number, renewMs?: number, cacheMs?: number, timeoutMs?: number,
 *   log?: { warn?: Function, info?: Function }
 * }} opts
 */
export function createOwnership({
  leases, registry, instanceId, secret, fetchImpl = globalThis.fetch,
  ttlMs = 45_000, renewMs = 15_000, cacheMs = 3_000, timeoutMs = 15_000, log = console,
}) {
  const nameOf = (kind, key) => `proc:${kind}:${key}`;
  const warn = (m) => (log.warn || log.log || (() => {})).call(log, m);

  /** @type {Map<string, { timer: NodeJS.Timeout, stillNeeded: () => any }>} */
  const held = new Map();
  /** @type {Map<string, { at: number, value: any }>} */
  const cache = new Map();

  async function describe(holder) {
    if (!holder) return null;
    if (holder === instanceId) return { id: holder, url: null, self: true };
    let peer = registry.peers().find((p) => p.id === holder);
    if (!peer) peer = (await registry.list()).find((p) => p.id === holder);
    return { id: holder, url: peer?.url || null, self: false };
  }

  async function ownerOf(kind, key, { fresh = false } = {}) {
    const name = nameOf(kind, key);
    const hit = cache.get(name);
    if (!fresh && hit && Date.now() - hit.at < cacheMs) return hit.value;
    const value = await describe(await leases.holder(name));
    cache.set(name, { at: Date.now(), value });
    return value;
  }

  async function renew(name) {
    const entry = held.get(name);
    if (!entry) return;
    try {
      if (!(await entry.stillNeeded())) {
        await giveBack(name);
        return;
      }
      if (!(await leases.acquire(name, ttlMs))) {
        warn(`[ownership] lost the lease ${name}; another instance may start it too`);
      }
    } catch (err) {
      warn(`[ownership] renewing ${name} failed: ${err.message}`);
    }
  }

  async function giveBack(name) {
    const entry = held.get(name);
    if (entry) {
      clearInterval(entry.timer);
      held.delete(name);
    }
    cache.delete(name);
    await leases.release(name);
  }

  async function claim(kind, key, { stillNeeded = () => true } = {}) {
    const name = nameOf(kind, key);
    const ok = await leases.acquire(name, ttlMs);
    cache.delete(name);
    if (!ok) return { ok: false, owner: await ownerOf(kind, key, { fresh: true }) };
    const entry = held.get(name);
    if (entry) {
      entry.stillNeeded = stillNeeded;
    } else {
      const timer = setInterval(() => { void renew(name); }, renewMs);
      timer.unref?.();
      held.set(name, { timer, stillNeeded });
    }
    return { ok: true };
  }

  async function release(kind, key) {
    await giveBack(nameOf(kind, key));
  }

  async function forward(owner, kind, method, args) {
    if (!owner?.url) {
      throw Object.assign(
        new Error(`${kind} is owned by instance ${owner?.id ?? '?'}, which has no INSTANCE_URL`),
        { code: 'CLUSTER_NO_URL' },
      );
    }
    let res;
    try {
      res = await fetchImpl(`${owner.url.replace(/\/$/, '')}/internal/cluster/call`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${clusterToken(secret)}`,
          'x-cluster-from': instanceId,
        },
        body: JSON.stringify({ kind, method, args }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw Object.assign(new Error(`${kind} owner ${owner.id} is not reachable: ${err.message}`), { code: 'CLUSTER_UNREACHABLE' });
    }
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.ok) {
      throw Object.assign(new Error(body?.error?.message || `forwarded ${kind}.${method} failed (${res.status})`), {
        code: body?.error?.code || 'CLUSTER_FORWARD',
        remote: true,
      });
    }
    return body.result;
  }

  /** Give back every lease held here (graceful shutdown, after the managers stopped). */
  async function stop() {
    for (const name of [...held.keys()]) {
      await giveBack(name).catch(() => {});
    }
  }

  return { claim, release, ownerOf, forward, stop, held: () => [...held.keys()], instanceId };
}
