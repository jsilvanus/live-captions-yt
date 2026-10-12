/**
 * Periodic chores that must run on one instance only (backups, retention cleanups, rollup compaction).
 *
 * The lease is kept (not released) for most of the interval, so an instance that ticks a little
 * later sees it still held and skips; the next interval is won by whichever instance ticks first.
 * With SQLite the lease always succeeds, so a single instance runs every tick as before.
 *
 * @param {{ acquire: (name: string, ttlMs: number) => Promise<boolean> }} leases
 * @param {string} name
 * @param {() => number} getIntervalMs
 * @param {() => Promise<void>|void} fn
 * @param {{ warn?: Function }} [log]
 */
export function leasedChore(leases, name, getIntervalMs, fn, log = console) {
  return async () => {
    const ttl = Math.max(30_000, Math.floor(getIntervalMs() * 0.8));
    let won = true;
    try { won = await leases.acquire(`chore:${name}`, ttl); } catch (err) { log.warn?.(`[cluster] lease ${name}: ${err.message}`); }
    if (won) await fn();
  };
}
