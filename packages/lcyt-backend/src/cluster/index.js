import { getInstanceId } from './instance.js';
import { createLeases } from './leases.js';
import { createInstanceRegistry } from './instances.js';
import { startPgBus } from './pg-bus.js';

export { getInstanceId } from './instance.js';
export { createLeases } from './leases.js';

/**
 * Multi-instance coordination for this process (plan: multi-instance L1).
 *
 * Shared mode = PostgreSQL. Then the process registers itself, can take leases, and relays its
 * EventBus events to the other instances (and receives theirs). With SQLite (single process) none
 * of that runs: leases always succeed, the registry lists only this process and the bus stays local,
 * so a single-instance install behaves exactly as before.
 *
 * @param {object} opts
 * @param {import('../db/connection.js').Db} opts.db
 * @param {import('lcyt/event-bus').EventBus} opts.eventBus
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {{ info?:Function, warn?:Function }} [opts.log]
 */
export async function startCluster({ db, eventBus, env = process.env, log = console }) {
  const instanceId = getInstanceId(env);
  const shared = db.$dialect === 'postgres';
  const leases = createLeases(db, { instanceId, enforce: shared });
  const registry = createInstanceRegistry(db, {
    instanceId, url: (env.INSTANCE_URL || '').trim() || null, enforce: shared, log,
  });

  let bus = null;
  if (shared && env.DATABASE_URL) {
    await registry.start();
    bus = startPgBus({ eventBus, db, connectionString: env.DATABASE_URL, instanceId, channel: env.CLUSTER_BUS_CHANNEL || 'lcyt_bus', log });
    await bus.ready;
    log.info?.(`[cluster] instance ${instanceId} running in shared mode`);
  }

  return {
    instanceId,
    shared,
    leases,
    registry,
    /** Live instances as of the last heartbeat (this process only when not shared). */
    peers: () => (shared ? registry.peers() : [{ id: instanceId, self: true }]),
    busStats: () => bus?.stats() ?? null,
    async stop() {
      await bus?.stop();
      await registry.stop();
    },
  };
}
