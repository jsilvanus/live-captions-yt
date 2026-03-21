"use strict";

const express = require("express");
const metrics = require('./metrics');
const app = express();
app.use(express.json());

// In-memory registries
const workers = new Map(); // workerId -> { id, privateIp, maxJobs, jobCount, lastSeen }
const jobs = new Map(); // jobId -> { id, type, apiKey, workerId }

// Pending burst provisioning queue: jobIds waiting for a burst VM to become available
const pendingJobs = [];
let concurrentBurstCreates = 0;
const MAX_CONCURRENT_BURST_CREATES = parseInt(process.env.MAX_CONCURRENT_BURST_CREATES || '2', 10);
const ORCHESTRATOR_MAX_PENDING_JOBS = parseInt(process.env.ORCHESTRATOR_MAX_PENDING_JOBS || '50', 10);

let hetznerClient = null;
if (process.env.HETZNER_API_TOKEN) {
  try {
    // Lazy import for compatibility with current project style
    const { createHetznerClient } = require('./hetzner.js');
    hetznerClient = createHetznerClient();
    // eslint-disable-next-line no-console
    console.log('hetzner client configured, base:', hetznerClient.base);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('hetzner client init failed:', err && err.message);
    hetznerClient = null;
  }
}

function now() {
  return Date.now();
}

// POST /compute/workers/register
// Body: { id, privateIp, maxJobs }
app.post("/compute/workers/register", (req, res) => {
  const { id, privateIp, maxJobs } = req.body || {};
  if (!id || !privateIp || typeof maxJobs !== "number") {
    return res.status(400).json({ error: "missing id, privateIp, or maxJobs" });
  }

  const existing = workers.get(id);
  const record = {
    id,
    privateIp,
    maxJobs: Math.max(0, Math.floor(maxJobs) || 0),
    jobCount: existing ? existing.jobCount : 0,
    lastSeen: now()
  };
  workers.set(id, record);
  metrics.set && metrics.set('active_workers', workers.size);

  // If there are pending jobs queued for burst servers, assign as much as this worker can handle
  try {
    while ((record.jobCount || 0) < (record.maxJobs || 0) && pendingJobs.length > 0) {
      const jobId = pendingJobs.shift();
      if (!jobId) break;
      // assign job
      record.jobCount = (record.jobCount || 0) + 1;
      workers.set(record.id, record);
      jobs.set(jobId, { id: jobId, type: 'burst', apiKey: null, workerId: record.id });
      // eslint-disable-next-line no-console
      console.log(`assigned pending job ${jobId} -> worker ${record.id}`);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('error assigning pending jobs on register', err && err.message);
  }

  return res.status(200).json({ ok: true });
});

// GET /compute/workers
app.get("/compute/workers", (req, res) => {
  const arr = Array.from(workers.values()).map(w => ({
    id: w.id,
    privateIp: w.privateIp,
    maxJobs: w.maxJobs,
    jobCount: w.jobCount,
    lastSeen: w.lastSeen
  }));
  res.json({ workers: arr });
});

// POST /compute/jobs
// Body: { id, type, apiKey }
// Assign to first ready worker (jobCount < maxJobs)
app.post("/compute/jobs", (req, res) => {
  const { id, type, apiKey } = req.body || {};
  if (!id || !type) return res.status(400).json({ error: "missing id or type" });
  if (jobs.has(id)) return res.status(409).json({ error: "job already exists" });

  // Find first ready worker in insertion order
  let assigned = null;
  for (const [wid, w] of workers) {
    if ((w.maxJobs || 0) > (w.jobCount || 0)) {
      assigned = w;
      break;
    }
  }

  if (!assigned) {
    // No warm capacity. Try to queue for burst VM creation if configured.
    metrics.inc && metrics.inc('hetzner_rate_limit_backoff_total', 1);

    // If hetzner is configured, try to provision a burst server in background and enqueue job
    if (hetznerClient) {
      if (pendingJobs.length >= ORCHESTRATOR_MAX_PENDING_JOBS) {
        return res.status(503).json({ error: 'pending queue full' });
      }

      // Enqueue the job pending a burst VM
      pendingJobs.push(id);
      // Kick off a create if we have capacity
      if (concurrentBurstCreates < MAX_CONCURRENT_BURST_CREATES) {
        concurrentBurstCreates += 1;
        (async () => {
          try {
            const snapshot = process.env.HETZNER_SNAPSHOT_ID || null;
            const serverType = process.env.HETZNER_SERVER_TYPE_BURST || 'cx31';
            const name = `lcyt-burst-${Date.now().toString(36)}`;
            // eslint-disable-next-line no-console
            console.log('creating burst server', { name, serverType, snapshot });
            const server = await hetznerClient.createBurstServer(snapshot, serverType, null, name, null);
            // start polling in background
            (async () => {
              try {
                const poll = await hetznerClient.pollServerReady(server.id);
                if (poll && poll.ready) {
                  // server is ready - log and wait for worker to register
                  // eslint-disable-next-line no-console
                  console.log('burst server ready', server.id);
                } else {
                  // eslint-disable-next-line no-console
                  console.error('burst server did not become ready', server.id);
                }
              } catch (pollErr) {
                // eslint-disable-next-line no-console
                console.error('error while polling server', pollErr && pollErr.message);
              }
            })();
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error('burst create failed', err && err.message);
          } finally {
            concurrentBurstCreates = Math.max(0, concurrentBurstCreates - 1);
          }
        })();
      }

      // Store the job in pending map (jobs not yet assigned)
      jobs.set(id, { id, type, apiKey: apiKey || null, workerId: null, pending: true });
      return res.status(202).json({ queued: true, pendingJobs: pendingJobs.length });
    }

    // No hetzner configured -> tell caller to retry
    return res.status(503).json({ retryAfterMs: 5000 });
  }

  // Assign job
  assigned.jobCount = (assigned.jobCount || 0) + 1;
  assigned.lastSeen = now();
  workers.set(assigned.id, assigned);

  jobs.set(id, { id, type, apiKey: apiKey || null, workerId: assigned.id });

  const workerUrl = `http://${assigned.privateIp}:3000`;
  return res.status(200).json({ workerId: assigned.id, workerUrl });
});

// DELETE /compute/jobs/:jobId
// Decrements jobCount on assigned worker
app.delete("/compute/jobs/:jobId", (req, res) => {
  const jobId = req.params.jobId;
  if (!jobs.has(jobId)) return res.status(404).json({ error: "job not found" });

  const job = jobs.get(jobId);
  const worker = workers.get(job.workerId);
  if (worker) {
    worker.jobCount = Math.max(0, (worker.jobCount || 0) - 1);
    worker.lastSeen = now();
    workers.set(worker.id, worker);
  }

  jobs.delete(jobId);
  metrics.set && metrics.set('active_workers', workers.size);
  return res.status(200).json({ ok: true });
});

// POST /compute/jobs/:jobId/caption
// Body: arbitrary caption payload. Stubbed: do not call external worker APIs.
app.post("/compute/jobs/:jobId/caption", (req, res) => {
  const jobId = req.params.jobId;
  if (!jobs.has(jobId)) return res.status(404).json({ error: "job not found" });

  const job = jobs.get(jobId);
  const worker = workers.get(job.workerId);
  if (!worker) return res.status(500).json({ error: "assigned worker missing" });

  // Stubbed behaviour: accept caption and return success without external calls.
  // In a real system you'd POST to workerUrl; for local dev we avoid network calls.

  return res.status(200).json({ ok: true, jobId, workerId: worker.id });
});

// GET /compute/health
app.get("/compute/health", (req, res) => {
  const workerCount = workers.size;
  const jobCount = jobs.size;
  const workerList = Array.from(workers.values()).map(w => ({ id: w.id, jobCount: w.jobCount, maxJobs: w.maxJobs }));
  res.json({ ok: true, workerCount, jobCount, workers: workerList, timestamp: now() });
});

// Prometheus metrics endpoint (simple text exposition)
app.get('/metrics', (req, res) => {
  const m = metrics.getAll ? metrics.getAll() : {};
  const lines = [];
  for (const k in m) {
    lines.push(`# HELP ${k} autogenerated metric`);
    lines.push(`# TYPE ${k} counter`);
    lines.push(`${k} ${m[k]}`);
  }
  res.set('Content-Type', 'text/plain');
  res.send(lines.join('\n'));
});

// Simple ping for root
app.get("/", (req, res) => res.send("lcyt-orchestrator running"));

const PORT = process.env.PORT || 4000;

if (require.main === module) {
  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`lcyt-orchestrator listening on ${PORT}`);
  });
}

module.exports = app;
