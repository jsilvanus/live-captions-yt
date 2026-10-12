import { hostname } from 'node:os';

/**
 * Registry of running backend processes (`instances` table), for /health and, later, for
 * forwarding a request to the instance that owns something. Shared mode (PostgreSQL) only;
 * with SQLite there is exactly one process and nothing is written.
 */
export function createInstanceRegistry(db, {
  instanceId, url = null, enforce = db.$dialect === 'postgres', now = Date.now,
  heartbeatMs = 10_000, liveWithinMs = 30_000, pruneAfterMs = 120_000, log = console,
}) {
  const startedAt = now();
  let peers = [];
  let timer = null;

  async function beat() {
    const t = BigInt(now());
    const updated = await db.instances.updateMany({ where: { id: instanceId }, data: { heartbeat_at: t, url } });
    if (updated.count === 0) {
      try {
        await db.instances.create({ data: { id: instanceId, hostname: hostname(), url, started_at: BigInt(startedAt), heartbeat_at: t } });
      } catch (err) {
        if (err?.code !== 'P2002') throw err;
      }
    }
    await db.instances.deleteMany({ where: { heartbeat_at: { lt: BigInt(now() - pruneAfterMs) } } });
    peers = await list();
  }

  /** Instances with a recent heartbeat, oldest first. */
  async function list() {
    if (!enforce) return [{ id: instanceId, hostname: hostname(), url, startedAt, self: true }];
    const rows = await db.instances.findMany({
      where: { heartbeat_at: { gte: BigInt(now() - liveWithinMs) } },
      orderBy: { started_at: 'asc' },
    });
    return rows.map((r) => ({ id: r.id, hostname: r.hostname, url: r.url, startedAt: Number(r.started_at), self: r.id === instanceId }));
  }

  async function start() {
    if (!enforce) return;
    await beat();
    timer = setInterval(() => { beat().catch((err) => log.warn?.(`[cluster] instance heartbeat failed: ${err.message}`)); }, heartbeatMs);
    timer.unref?.();
  }

  async function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    if (!enforce) return;
    await db.instances.deleteMany({ where: { id: instanceId } }).catch(() => {});
  }

  return { start, stop, list, beat, peers: () => peers, enforce };
}
