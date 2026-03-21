import { createServer } from './hetzner.js';

// Simple autoscaler: given references to the orchestrator's worker and job maps,
// provision a burst VM when no capacity remains and queuedJobs exceed threshold.

export function startAutoscaler({ workersMap, jobsMap, intervalMs = 15000, burstQueueLimit = 5, maxCreates = 2 } = {}) {
  let creating = 0;
  let stopped = false;

  async function tick() {
    if (stopped) return;
    try {
      // compute total capacity
      let totalCapacity = 0;
      for (const w of workersMap.values()) {
        totalCapacity += (w.maxJobs || 0) - (w.jobCount || 0);
      }
      const queued = Math.max(0, jobsMap.size - totalCapacity);
      if (queued > 0 && queued >= burstQueueLimit && creating < maxCreates && !!process.env.HETZNER_API_TOKEN) {
        creating += 1;
        try {
          const name = `lcyt-burst-${Date.now().toString(36)}`;
          const server = await createServer({ name, server_type: process.env.HETZNER_SERVER_TYPE_BURST || 'cx31', image: process.env.HETZNER_SNAPSHOT_ID });
          // After creation, the worker will self-register; we just log the server info here.
          // In the real system, orchestrator would poll server status and wait for worker registration.
          // eslint-disable-next-line no-console
          console.log('autoscaler: created mock server', server.id);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('autoscaler: createServer failed', err.message || err);
        } finally {
          creating = Math.max(0, creating - 1);
        }
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('autoscaler tick error', err);
    } finally {
      if (!stopped) setTimeout(tick, intervalMs);
    }
  }

  setTimeout(tick, intervalMs);

  return {
    stop: () => { stopped = true; }
  };
}

export default startAutoscaler;
