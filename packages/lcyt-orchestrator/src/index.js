"use strict";

const express = require("express");
const app = express();
app.use(express.json());

// In-memory registries
const workers = new Map(); // workerId -> { id, privateIp, maxJobs, jobCount, lastSeen }
const jobs = new Map(); // jobId -> { id, type, apiKey, workerId }

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
