import express from 'express';
import * as metrics from './metrics.js';
import { createHetznerClient } from './hetzner.js';
import { startAutoscaler } from './autoscaler.js';

const DEFAULT_PORT = process.env.PORT || 4000;

export function createApp() {
  const app = express();
  app.use(express.json());

  const BACKEND_INTERNAL_TOKEN = process.env.BACKEND_INTERNAL_TOKEN || null;
  const WORKER_DEFAULT_PORT = parseInt(process.env.WORKER_DEFAULT_PORT || '5000', 10);
  const HEARTBEAT_INTERVAL_MS = parseInt(process.env.HEARTBEAT_INTERVAL_MS || '10000', 10);
  const HEARTBEAT_MAX_MISSES = parseInt(process.env.HEARTBEAT_MAX_MISSES || '3', 10);
  const BURST_COOLDOWN_MS = parseInt(process.env.BURST_COOLDOWN_MS || '300000', 10);
  const MAX_CONCURRENT_BURST_CREATES = parseInt(process.env.MAX_CONCURRENT_BURST_CREATES || '2', 10);
  const ORCHESTRATOR_MAX_PENDING_JOBS = parseInt(process.env.ORCHESTRATOR_MAX_PENDING_JOBS || '50', 10);
  const AUTOSCALER_INTERVAL_MS = parseInt(process.env.AUTOSCALER_INTERVAL_MS || '15000', 10);
  const AUTOSCALER_BURST_QUEUE_LIMIT = parseInt(process.env.AUTOSCALER_BURST_QUEUE_LIMIT || '5', 10);

  function requireInternalAuth(req, res, next) {
    if (!BACKEND_INTERNAL_TOKEN) return next();
    const provided = req.headers['x-internal-auth'];
    if (!provided || provided !== BACKEND_INTERNAL_TOKEN) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    return next();
  }

  // workerId -> { id, privateIp, port, maxJobs, jobCount, lastSeen, status, missCount, type, serverId, idleSince, createdAt }
  const workers = new Map();
  // jobId -> { id, type, apiKey, workerId, plan, pending }
  const jobs = new Map();
  const pendingJobs = [];
  let concurrentBurstCreates = 0;

  // Burst VM lifetime accounting (plan_metering_audit §4.3): "how many burst
  // servers, for how long" — the number Hetzner bills. History ring feeds the
  // backend's rollup poller and the Admin live panel.
  const BURST_HISTORY_LIMIT = 200;
  const burstHistory = [];
  let burstVmSecondsTotal = 0;

  function refreshWorkerGauges() {
    metrics.set('active_workers', workers.size);
    metrics.set('burst_vms_active', Array.from(workers.values()).filter(w => w.type === 'burst').length);
  }

  function refreshPendingGauge() {
    metrics.set('orchestrator_jobs_pending', pendingJobs.length);
  }

  function recordBurstDestroyed(worker) {
    const lifetimeSeconds = Math.max(0, (now() - (worker.createdAt || now())) / 1000);
    burstVmSecondsTotal += lifetimeSeconds;
    metrics.inc('burst_vm_seconds_total', lifetimeSeconds);
    burstHistory.push({
      id: worker.id,
      serverId: worker.serverId || null,
      createdAt: worker.createdAt || null,
      destroyedAt: now(),
      lifetimeSeconds: Math.round(lifetimeSeconds),
    });
    if (burstHistory.length > BURST_HISTORY_LIMIT) burstHistory.shift();
  }

  let hetznerClient = null;
  if (process.env.HETZNER_API_TOKEN) {
    try {
      hetznerClient = createHetznerClient();
      console.log('hetzner client configured, base:', hetznerClient.base);
    } catch (err) {
      console.warn('hetzner client init failed:', err && err.message);
      hetznerClient = null;
    }
  }

  function now() { return Date.now(); }
  function buildWorkerUrl(w) { return `http://${w.privateIp}:${w.port || WORKER_DEFAULT_PORT}`; }

  async function callWorker(worker, method, path, body) {
    const url = `${buildWorkerUrl(worker)}${path}`;
    const headers = { 'Content-Type': 'application/json' };
    if (BACKEND_INTERNAL_TOKEN) headers['X-Worker-Auth'] = BACKEND_INTERNAL_TOKEN;
    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`worker ${worker.id} ${method} ${path} -> ${res.status} ${text}`);
    }
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) return res.json();
    return null;
  }

  function pickWorker() {
    for (const w of workers.values()) {
      if (w.status === 'degraded') continue;
      if ((w.jobCount || 0) < (w.maxJobs || 0)) return w;
    }
    return null;
  }

  function dispatchPendingJobs() {
    let assignedAny = true;
    while (assignedAny) {
      assignedAny = false;
      if (pendingJobs.length === 0) break;
      const w = pickWorker();
      if (!w) break;
      const jobId = pendingJobs.shift();
      refreshPendingGauge();
      const job = jobs.get(jobId);
      if (!job) continue;
      w.jobCount = (w.jobCount || 0) + 1;
      w.idleSince = null;
      job.workerId = w.id;
      job.pending = false;
      workers.set(w.id, w);
      jobs.set(jobId, job);
      assignedAny = true;
      console.log(`assigned pending job ${jobId} -> worker ${w.id}`);
      callWorker(w, 'POST', '/jobs', job.plan || { id: jobId, type: job.type })
        .catch(err => console.error('dispatch failed for queued job', jobId, err && err.message));
    }
  }

  function maybeCreateBurstServer() {
    if (!hetznerClient || concurrentBurstCreates >= MAX_CONCURRENT_BURST_CREATES) return;
    concurrentBurstCreates += 1;
    (async () => {
      try {
        const snapshot = process.env.HETZNER_SNAPSHOT_ID || null;
        const serverType = process.env.HETZNER_SERVER_TYPE_BURST || 'cx31';
        const name = `lcyt-burst-${Date.now().toString(36)}`;
        console.log('creating burst server', { name, serverType, snapshot });
        const server = await hetznerClient.createBurstServer(snapshot, serverType, null, name, null);
        metrics.inc('burst_vm_created_total', 1);
        const poll = await hetznerClient.pollServerReady(server.id);
        if (poll && poll.ready) console.log('burst server ready', server.id);
        else console.error('burst server did not become ready', server.id);
      } catch (err) {
        console.error('burst create failed', err && err.message);
      } finally {
        concurrentBurstCreates = Math.max(0, concurrentBurstCreates - 1);
      }
    })();
  }

  app.post('/compute/workers/register', requireInternalAuth, (req, res) => {
    const { id, privateIp, maxJobs, port, type, serverId, version } = req.body || {};
    if (!id || !privateIp || typeof maxJobs !== 'number') {
      return res.status(400).json({ error: 'missing id, privateIp, or maxJobs' });
    }
    const existing = workers.get(id);
    const record = {
      id, privateIp,
      port: typeof port === 'number' ? port : WORKER_DEFAULT_PORT,
      maxJobs: Math.max(0, Math.floor(maxJobs) || 0),
      jobCount: existing ? existing.jobCount : 0,
      lastSeen: now(),
      status: 'healthy',
      missCount: 0,
      type: type || (existing && existing.type) || 'warm',
      serverId: serverId || (existing && existing.serverId) || null,
      version: version || null,
      idleSince: existing ? existing.idleSince : now(),
      createdAt: existing?.createdAt || now()
    };
    workers.set(id, record);
    refreshWorkerGauges();
    dispatchPendingJobs();
    return res.status(200).json({ ok: true });
  });

  app.get('/compute/workers', (req, res) => {
    const arr = Array.from(workers.values()).map(w => ({
      id: w.id, privateIp: w.privateIp, port: w.port, maxJobs: w.maxJobs, jobCount: w.jobCount,
      lastSeen: w.lastSeen, status: w.status, type: w.type
    }));
    res.json({ workers: arr });
  });

  app.delete('/compute/workers/:id', requireInternalAuth, async (req, res) => {
    const id = req.params.id;
    const worker = workers.get(id);
    if (!worker) return res.status(404).json({ error: 'worker not found' });

    if (req.query.mark === 'degraded') {
      worker.status = 'degraded';
      workers.set(id, worker);
      return res.status(200).json({ ok: true, status: 'degraded' });
    }

    const destroy = req.query.destroy === 'true';
    workers.delete(id);
    refreshWorkerGauges();
    if (worker.type === 'burst') recordBurstDestroyed(worker);

    if (destroy && hetznerClient && worker.serverId) {
      try {
        await hetznerClient.deleteServer(worker.serverId);
        metrics.inc('burst_vm_destroyed_total', 1);
      } catch (err) {
        console.error('failed to destroy hetzner server', worker.serverId, err && err.message);
      }
    }
    return res.status(200).json({ ok: true, destroyed: !!destroy });
  });

  app.get('/compute/jobs', (req, res) => {
    const arr = Array.from(jobs.values()).map(j => ({
      id: j.id, type: j.type, apiKey: j.apiKey, workerId: j.workerId, pending: !!j.pending
    }));
    res.json({ jobs: arr });
  });

  app.post('/compute/jobs', requireInternalAuth, async (req, res) => {
    const plan = req.body || {};
    const { id, type, apiKey } = plan;
    if (!id || !type) return res.status(400).json({ error: 'missing id or type' });
    if (jobs.has(id)) return res.status(409).json({ error: 'job already exists' });

    const assigned = pickWorker();
    if (!assigned) {
      metrics.inc('hetzner_rate_limit_backoff_total', 1);
      if (pendingJobs.length >= ORCHESTRATOR_MAX_PENDING_JOBS) {
        return res.status(503).json({ error: 'pending queue full' });
      }
      jobs.set(id, { id, type, apiKey: apiKey || null, workerId: null, plan, pending: true });
      pendingJobs.push(id);
      refreshPendingGauge();

      maybeCreateBurstServer();

      if (!hetznerClient) {
        return res.status(503).json({ retryAfterMs: 5000 });
      }
      return res.status(202).json({ queued: true, pendingJobs: pendingJobs.length });
    }

    assigned.jobCount = (assigned.jobCount || 0) + 1;
    assigned.lastSeen = now();
    assigned.idleSince = null;
    workers.set(assigned.id, assigned);
    jobs.set(id, { id, type, apiKey: apiKey || null, workerId: assigned.id, plan, pending: false });

    try {
      await callWorker(assigned, 'POST', '/jobs', plan);
    } catch (err) {
      console.error('worker dispatch failed', err && err.message);
      assigned.jobCount = Math.max(0, (assigned.jobCount || 0) - 1);
      assigned.missCount = (assigned.missCount || 0) + 1;
      if (assigned.missCount >= HEARTBEAT_MAX_MISSES) assigned.status = 'degraded';
      workers.set(assigned.id, assigned);
      jobs.delete(id);
      return res.status(502).json({ error: 'worker dispatch failed' });
    }

    return res.status(200).json({ jobId: id, workerId: assigned.id, workerUrl: buildWorkerUrl(assigned) });
  });

  app.delete('/compute/jobs/:jobId', requireInternalAuth, async (req, res) => {
    const jobId = req.params.jobId;
    const job = jobs.get(jobId);
    if (!job) return res.status(404).json({ error: 'job not found' });

    const worker = workers.get(job.workerId);
    if (worker) {
      try {
        await callWorker(worker, 'DELETE', `/jobs/${encodeURIComponent(jobId)}`);
      } catch (err) {
        console.error('failed to stop job on worker', jobId, err && err.message);
      }
      worker.jobCount = Math.max(0, (worker.jobCount || 0) - 1);
      worker.lastSeen = now();
      if (worker.jobCount === 0) worker.idleSince = now();
      workers.set(worker.id, worker);
    } else {
      const idx = pendingJobs.indexOf(jobId);
      if (idx >= 0) pendingJobs.splice(idx, 1);
      refreshPendingGauge();
    }
    jobs.delete(jobId);
    refreshWorkerGauges();
    dispatchPendingJobs();
    return res.status(200).json({ ok: true });
  });

  app.post('/compute/jobs/:jobId/caption', requireInternalAuth, async (req, res) => {
    const jobId = req.params.jobId;
    const job = jobs.get(jobId);
    if (!job) return res.status(404).json({ error: 'job not found' });
    const worker = workers.get(job.workerId);
    if (!worker) return res.status(500).json({ error: 'assigned worker missing' });
    try {
      await callWorker(worker, 'POST', `/jobs/${encodeURIComponent(jobId)}/caption`, req.body || {});
    } catch (err) {
      console.error('caption forward failed', jobId, err && err.message);
      return res.status(502).json({ error: 'caption forward failed' });
    }
    return res.status(200).json({ ok: true, jobId, workerId: worker.id });
  });

  app.get('/compute/health', (req, res) => {
    const workerCount = workers.size;
    const jobCount = jobs.size;
    const workerList = Array.from(workers.values()).map(w => ({ id: w.id, jobCount: w.jobCount, maxJobs: w.maxJobs, status: w.status }));
    res.json({ ok: true, workerCount, jobCount, workers: workerList, timestamp: now() });
  });

  // Burst-VM accounting for the backend's rollup poller and the Admin live
  // panel: active burst workers, recently destroyed ones, and running totals.
  app.get('/compute/burst/history', (req, res) => {
    const all = metrics.getAll();
    const active = Array.from(workers.values())
      .filter(w => w.type === 'burst')
      .map(w => ({ id: w.id, serverId: w.serverId || null, createdAt: w.createdAt || null, jobCount: w.jobCount || 0 }));
    res.json({
      active,
      history: burstHistory.slice(),
      totals: {
        created: all.burst_vm_created_total,
        destroyed: all.burst_vm_destroyed_total,
        vmSecondsTotal: burstVmSecondsTotal,
      },
    });
  });

  app.get('/metrics', async (req, res) => {
    res.set('Content-Type', metrics.registry.contentType);
    res.send(await metrics.metricsText());
  });

  app.get('/', (req, res) => res.send('lcyt-orchestrator running'));

  let heartbeatTimer = null;
  function heartbeatTick() {
    return (async () => {
      for (const worker of Array.from(workers.values())) {
        try {
          const res = await fetch(`${buildWorkerUrl(worker)}/health`, { method: 'GET' });
          if (!res.ok) throw new Error(`status ${res.status}`);
          worker.missCount = 0;
          worker.status = 'healthy';
          worker.lastSeen = now();
        } catch (err) {
          worker.missCount = (worker.missCount || 0) + 1;
          if (worker.missCount >= HEARTBEAT_MAX_MISSES && worker.status !== 'degraded') {
            console.error(`worker ${worker.id} marked degraded after ${worker.missCount} missed heartbeats`);
          }
          if (worker.missCount >= HEARTBEAT_MAX_MISSES) worker.status = 'degraded';
        }
        workers.set(worker.id, worker);
      }

      for (const worker of Array.from(workers.values())) {
        if (worker.type === 'burst' && (worker.jobCount || 0) === 0 && worker.idleSince && (now() - worker.idleSince) > BURST_COOLDOWN_MS) {
          console.log(`reaping idle burst worker ${worker.id}`);
          workers.delete(worker.id);
          refreshWorkerGauges();
          recordBurstDestroyed(worker);
          if (hetznerClient && worker.serverId) {
            try {
              await hetznerClient.deleteServer(worker.serverId);
              metrics.inc('burst_vm_destroyed_total', 1);
            } catch (err) {
              console.error('failed to destroy idle burst server', worker.serverId, err && err.message);
            }
          }
        }
      }

      dispatchPendingJobs();
    })();
  }

  function startHeartbeat() {
    if (heartbeatTimer) return;
    heartbeatTimer = setInterval(() => { heartbeatTick().catch(err => console.error('heartbeat tick error', err)); }, HEARTBEAT_INTERVAL_MS);
    if (typeof heartbeatTimer.unref === 'function') heartbeatTimer.unref();
  }
  function stopHeartbeat() {
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
  }

  let autoscalerHandle = null;
  function startAutoscalerLoop() {
    if (autoscalerHandle || !hetznerClient) return;
    autoscalerHandle = startAutoscaler({
      pendingJobsRef: () => pendingJobs.length,
      createBurstServer: maybeCreateBurstServer,
      intervalMs: AUTOSCALER_INTERVAL_MS,
      burstQueueLimit: AUTOSCALER_BURST_QUEUE_LIMIT
    });
  }
  function stopAutoscalerLoop() {
    if (autoscalerHandle) { autoscalerHandle.stop(); autoscalerHandle = null; }
  }

  app._workersStore = workers;
  app._jobsStore = jobs;
  app._startHeartbeat = startHeartbeat;
  app._stopHeartbeat = stopHeartbeat;
  app._heartbeatTick = heartbeatTick;
  app._startAutoscaler = startAutoscalerLoop;
  app._stopAutoscaler = stopAutoscalerLoop;

  startHeartbeat();
  startAutoscalerLoop();

  return app;
}

export function startServer(port = DEFAULT_PORT) {
  const app = createApp();
  const server = app.listen(port, () => {
    console.log(`lcyt-orchestrator listening on ${port}`);
  });

  return {
    app,
    server,
    stop: () => new Promise((resolve, reject) => {
      app._stopHeartbeat();
      app._stopAutoscaler();
      server.close(err => err ? reject(err) : resolve());
    })
  };
}

if (process.argv[1] && process.argv[1].endsWith('src/index.js')) {
  const port = process.env.PORT || DEFAULT_PORT;
  startServer(port);
}

export default createApp;
