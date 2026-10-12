/**
 * Leases: "exactly one instance runs this" for shared chores (rollups, backups, token refresh).
 *
 * A lease is a row `leases(name, owner, expires_at)`. It is taken with one conditional update
 * (same owner, or expired) and, when no row exists yet, one insert whose unique key makes
 * concurrent callers race to a single winner. Time is the caller's clock, so instances need
 * NTP-synchronised clocks (documented in DEPLOYMENT.md).
 *
 * A lease expires on its own: work under it must tolerate running twice if it outlives the TTL.
 *
 * With SQLite (one process by definition) `enforce` is off and every acquire succeeds without
 * touching the database, so single-instance installs behave exactly as before.
 */

/**
 * @param {import('../db/connection.js').Db} db
 * @param {{ instanceId: string, enforce?: boolean, now?: () => number }} opts
 */
export function createLeases(db, { instanceId, enforce = db.$dialect === 'postgres', now = Date.now }) {
  /**
   * Take or renew a lease. Resolves true when this owner holds it afterwards.
   * @param {string} name
   * @param {number} ttlMs
   * @param {string} [owner]  defaults to this instance; use a per-call owner to serialise callers inside one process
   */
  async function acquire(name, ttlMs, owner = instanceId) {
    if (!enforce) return true;
    const t = now();
    const expires = BigInt(t + ttlMs);
    const updated = await db.leases.updateMany({
      where: { name, OR: [{ owner }, { expires_at: { lte: BigInt(t) } }] },
      data: { owner, expires_at: expires },
    });
    if (updated.count > 0) return true;
    try {
      await db.leases.create({ data: { name, owner, expires_at: expires } });
      return true;
    } catch (err) {
      if (err?.code === 'P2002') return false; // someone else holds it (or just created it)
      throw err;
    }
  }

  /** Give a lease back early. Only the owner can. */
  async function release(name, owner = instanceId) {
    if (!enforce) return;
    await db.leases.deleteMany({ where: { name, owner } });
  }

  /** Who holds `name` right now, or null. */
  async function holder(name) {
    if (!enforce) return instanceId;
    const row = await db.leases.findUnique({ where: { name } });
    return row && Number(row.expires_at) > now() ? row.owner : null;
  }

  /**
   * Run `fn` only if the lease is won; the lease is released afterwards.
   * @returns {Promise<{ ran: boolean, value?: any }>}
   */
  async function withLease(name, ttlMs, fn, owner = instanceId) {
    if (!(await acquire(name, ttlMs, owner))) return { ran: false };
    try {
      return { ran: true, value: await fn() };
    } finally {
      await release(name, owner).catch(() => {});
    }
  }

  return { acquire, release, holder, withLease, enforce, instanceId };
}
