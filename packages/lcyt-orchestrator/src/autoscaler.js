// Periodic safety-net autoscaler: triggers burst VM provisioning when the
// pending job queue shows sustained pressure, independent of the immediate
// per-request trigger in index.js. Delegates actual provisioning to the
// caller-supplied createBurstServer callback so there is a single code path
// for talking to Hetzner.

export function startAutoscaler({ pendingJobsRef, createBurstServer, intervalMs = 15000, burstQueueLimit = 5 } = {}) {
  let stopped = false;
  let timer = null;

  function tick() {
    if (stopped) return;
    try {
      const pending = typeof pendingJobsRef === 'function' ? pendingJobsRef() : 0;
      if (pending >= burstQueueLimit && typeof createBurstServer === 'function') {
        console.log(`autoscaler: pending queue (${pending}) >= burstQueueLimit (${burstQueueLimit}), triggering burst provision`);
        createBurstServer();
      }
    } catch (err) {
      console.error('autoscaler tick error', err && err.message);
    } finally {
      if (!stopped) {
        timer = setTimeout(tick, intervalMs);
        if (typeof timer.unref === 'function') timer.unref();
      }
    }
  }

  timer = setTimeout(tick, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    }
  };
}

export default startAutoscaler;
