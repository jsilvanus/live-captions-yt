import os from 'os';
import express from 'express';
import { Registry, Counter, Gauge, Histogram, collectDefaultMetrics } from 'prom-client';
import { createFfmpegRunner } from 'lcyt-backend/ffmpeg';
import { makeFifo, createFifoWriter } from 'lcyt-backend/ffmpeg/pipe-utils';

import createUploader from './uploader.js';
import { createS3UploadFn } from './s3-uploader.js';
import { createPerceptionJob } from './perception-job.js';

const DEFAULT_PORT = process.env.PORT || 5000;
const WORKER_ID = process.env.WORKER_ID || 'worker-0';
// Default execution backend for real (non-test) jobs. The worker daemon is the
// component that owns the Docker socket, so 'docker' is the sane default;
// 'local' is mainly useful for bare-metal workers or local dev without Docker.
const WORKER_FFMPEG_RUNNER = process.env.WORKER_FFMPEG_RUNNER || 'docker';

// Self-registration with the orchestrator. Unset by default — workers run
// standalone (or are addressed directly via WORKER_DAEMON_URL) unless an
// orchestrator is configured.
const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || null;
const ORCHESTRATOR_INTERNAL_TOKEN = process.env.ORCHESTRATOR_INTERNAL_TOKEN || process.env.BACKEND_INTERNAL_TOKEN || null;
const WORKER_MAX_JOBS = parseInt(process.env.WORKER_MAX_JOBS || '4', 10);
const WORKER_TYPE = process.env.WORKER_TYPE || 'warm';
const WORKER_PRIVATE_IP = process.env.WORKER_PRIVATE_IP || null;
const WORKER_REGISTER_INTERVAL_MS = parseInt(process.env.WORKER_REGISTER_INTERVAL_MS || '60000', 10);
const WORKER_REGISTER_MAX_BACKOFF_MS = parseInt(process.env.WORKER_REGISTER_MAX_BACKOFF_MS || '30000', 10);

// Translate a job plan (as forwarded by the orchestrator's POST /compute/jobs,
// or sent directly by a WorkerFfmpegRunner client) into createFfmpegRunner() opts.
// Plan fields are a superset of LocalFfmpegRunner/DockerFfmpegRunner constructor
// options so the same plan shape works regardless of which backend runs it.
function buildRunnerOpts(plan, jobId) {
  const runnerType = plan.runner === 'local' || plan.runner === 'spawn' ? 'local' : WORKER_FFMPEG_RUNNER;
  const args = Array.isArray(plan.args) ? plan.args : [];
  const opts = {
    runner: runnerType,
    args,
    name: plan.name || `lcyt-job-${jobId}`
  };
  if (runnerType === 'docker') {
    if (plan.image) opts.image = plan.image;
    if (plan.env) opts.env = plan.env;
    if (plan.volumes) opts.volumes = plan.volumes;
    if (plan.network) opts.network = plan.network;
    if (plan.cpus) opts.cpus = plan.cpus;
    if (plan.memory) opts.memory = plan.memory;
    if (plan.entrypoint) opts.entrypoint = plan.entrypoint;
    opts.pipeStdin = plan.stdin === 'pipe';
  } else {
    opts.cmd = plan.cmd || 'ffmpeg';
    opts.stdin = plan.stdin || 'ignore';
    if (plan.env) opts.env = plan.env;
  }
  return opts;
}

// Mirrors packages/plugins/lcyt-rtmp/src/rtmp-manager.js's SRT cue formatting so
// captions injected via the worker's FIFO use byte-identical timing/format to the
// in-process (non-worker) caption path.
function srtTime(ms) {
  if (!Number.isFinite(ms)) return '00:00:00,000';
  const clampedMs = Math.max(0, Math.round(ms));
  const hh = String(Math.floor(clampedMs / 3_600_000)).padStart(2, '0');
  const mm = String(Math.floor((clampedMs % 3_600_000) / 60_000)).padStart(2, '0');
  const ss = String(Math.floor((clampedMs % 60_000) / 1000)).padStart(2, '0');
  const ms3 = String(clampedMs % 1000).padStart(3, '0');
  return `${hh}:${mm}:${ss},${ms3}`;
}

function buildSrtCue(seq, startMs, durationMs, text) {
  const endMs = startMs + durationMs;
  return `${seq}\n${srtTime(startMs)} --> ${srtTime(endMs)}\n${text}\n\n`;
}

function detectPrivateIp() {
  if (WORKER_PRIVATE_IP) return WORKER_PRIVATE_IP;
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '127.0.0.1';
}

async function registerWithOrchestrator(port) {
  const payload = {
    id: WORKER_ID,
    privateIp: detectPrivateIp(),
    maxJobs: WORKER_MAX_JOBS,
    port,
    type: WORKER_TYPE,
    version: process.env.npm_package_version || null
  };
  const headers = { 'Content-Type': 'application/json' };
  if (ORCHESTRATOR_INTERNAL_TOKEN) headers['X-Internal-Auth'] = ORCHESTRATOR_INTERNAL_TOKEN;
  const res = await fetch(`${ORCHESTRATOR_URL}/compute/workers/register`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`register failed: ${res.status} ${text}`);
  }
}

// Registers this worker with the orchestrator on startup (retrying with
// exponential backoff until it succeeds), then re-registers periodically so
// the worker re-joins automatically if the orchestrator restarts and loses
// its in-memory registry. No-op when ORCHESTRATOR_URL isn't set.
function startOrchestratorRegistration(port) {
  if (!ORCHESTRATOR_URL) return { stop: () => {} };

  let stopped = false;
  let timer = null;
  let backoffMs = 1000;

  async function attempt() {
    if (stopped) return;
    try {
      await registerWithOrchestrator(port);
      console.log(`registered with orchestrator ${ORCHESTRATOR_URL} as ${WORKER_ID}`);
      backoffMs = 1000;
      if (!stopped) {
        timer = setTimeout(attempt, WORKER_REGISTER_INTERVAL_MS);
        if (typeof timer.unref === 'function') timer.unref();
      }
    } catch (err) {
      console.error(`orchestrator registration failed, retrying in ${backoffMs}ms:`, err && err.message);
      if (!stopped) {
        timer = setTimeout(attempt, backoffMs);
        if (typeof timer.unref === 'function') timer.unref();
        backoffMs = Math.min(backoffMs * 2, WORKER_REGISTER_MAX_BACKOFF_MS);
      }
    }
  }

  attempt();

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    }
  };
}

export function createApp() {
  const app = express();
  app.use(express.json());

  const WORKER_AUTH_TOKEN = process.env.WORKER_AUTH_TOKEN || process.env.BACKEND_INTERNAL_TOKEN || null;

  function requireWorkerAuth(req, res, next) {
    if (!WORKER_AUTH_TOKEN) return next();
    const provided = req.headers['x-worker-auth'];
    if (!provided || provided !== WORKER_AUTH_TOKEN) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    return next();
  }

  // In-memory jobs map: jobId -> { id, plan, status, createdAt, startedAt, finishedAt, durationMs, proc?, captions: [] }
  const jobs = new Map();

  // Prometheus metrics (plan_metering_audit §4.3). Per-app registry so tests
  // creating multiple apps don't collide on metric registration.
  const promRegistry = new Registry();
  collectDefaultMetrics({ register: promRegistry });
  const jobsRunningGauge = new Gauge({
    name: 'worker_jobs_running',
    help: 'Jobs currently running',
    registers: [promRegistry],
    collect() {
      this.set(Array.from(jobs.values()).filter(j => j.status === 'running').length);
    },
  });
  void jobsRunningGauge;
  const jobsTotal = new Counter({ name: 'worker_jobs_total', help: 'Jobs by terminal status', labelNames: ['status'], registers: [promRegistry] });
  const jobDuration = new Histogram({
    name: 'worker_job_duration_seconds',
    help: 'Job wall-clock duration',
    buckets: [1, 10, 60, 300, 900, 3600, 14400],
    registers: [promRegistry],
  });

  function finishJob(record, status) {
    if (record.finishedAt) return; // already accounted
    record.finishedAt = Date.now();
    record.durationMs = record.finishedAt - (record.startedAt || record.createdAt);
    jobsTotal.inc({ status });
    jobDuration.observe(record.durationMs / 1000);
  }

  function makeJobId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
  }

  app.post('/jobs', requireWorkerAuth, async (req, res) => {
    const plan = req.body || {};
    // Reuse the caller-supplied id (the orchestrator always forwards its own job id
    // as plan.id) so that subsequent DELETE /jobs/:id and POST /jobs/:id/caption
    // calls from the orchestrator address the same record. Fall back to a generated
    // id for direct callers that don't supply one.
    const jobId = plan.id || makeJobId();
    const existing = jobs.get(jobId);
    if (existing && existing.status === 'running') {
      return res.status(409).json({ error: 'job already exists' });
    }

    const record = {
      id: jobId,
      plan,
      status: 'starting',
      createdAt: Date.now(),
      startedAt: null,
      finishedAt: null,
      durationMs: null,
      captions: [],
      workerId: WORKER_ID
    };
    jobs.set(jobId, record);

    // Perception jobs (plan_video_perception.md Phase 2 Stream B) are a
    // distinct job type dispatched to the same /jobs endpoint — no ffmpeg
    // subprocess, no fifo/uploader wiring, so they branch out early rather
    // than threading `plan.type` checks through the ffmpeg-specific code
    // below (which stays exactly as it was for the default/`ffmpeg` type).
    if (plan.type === 'perception') {
      try {
        const runner = createPerceptionJob(plan, jobId);
        runner.start();
        record.runner = runner;
        record.status = 'running';
        record.startedAt = Date.now();
      } catch (err) {
        record.status = 'error';
        record.error = err && err.message;
        jobs.delete(jobId);
        console.error(`perception job ${jobId} failed to start:`, err && err.message);
        return res.status(502).json({ error: 'failed to start job', message: err && err.message });
      }
      return res.json({ jobId, workerId: WORKER_ID });
    }

    // If in test mode, don't spawn a real process
    if (process.env.NODE_ENV === 'test') {
      record.status = 'running';
      record.startedAt = Date.now();
      return res.json({ jobId, workerId: WORKER_ID });
    }

    try {
      if (plan.fifoPath) {
        await makeFifo(plan.fifoPath);
        record._fifoWriter = createFifoWriter(plan.fifoPath, { timeoutMs: plan.fifoTimeoutMs || 250 });
      }

      const runner = createFfmpegRunner(buildRunnerOpts(plan, jobId));
      const handle = await runner.start();
      record.runner = runner;
      record.handle = handle;
      record.pid = handle && handle.proc ? handle.proc.pid : null;
      record.status = 'running';
      record.startedAt = Date.now();

      runner.on('error', (err) => {
        record.status = 'error';
        record.error = err && err.message;
        finishJob(record, 'error');
        console.error(`job ${jobId} ffmpeg error:`, err && err.message);
      });
      runner.on('close', (info) => {
        record.status = 'stopped';
        record.exitInfo = info;
        finishJob(record, 'stopped');
      });
    } catch (err) {
      record.status = 'error';
      record.error = err && err.message;
      jobs.delete(jobId);
      console.error(`job ${jobId} failed to start:`, err && err.message);
      return res.status(502).json({ error: 'failed to start job', message: err && err.message });
    }

    // Start uploader if job requests HLS/preview output
    try {
      const out = plan.hlsOutputPath || plan.previewOutputPath || null;
      if (out) {
        const uploadFn = createS3UploadFn({ baseKey: plan.hlsOutputUrl || '' });
        const up = createUploader({ watchDir: out, prefix: '', uploadFn });
        record._uploader = up.start();
      }
    } catch (e) { console.error('uploader wiring error', e); }

    return res.json({ jobId, workerId: WORKER_ID });
  });

  app.delete('/jobs/:id', requireWorkerAuth, async (req, res) => {
    const id = req.params.id;
    const record = jobs.get(id);
    if (!record) return res.status(404).json({ error: 'not found' });

    if (record.runner && typeof record.runner.stop === 'function') {
      try {
        await record.runner.stop();
      } catch (e) { console.error(`failed to stop job ${id}:`, e && e.message); }
    }

    if (record._fifoWriter && typeof record._fifoWriter.close === 'function') {
      try { await record._fifoWriter.close(); } catch (e) {}
    }

    if (record._uploader && typeof record._uploader.stop === "function") { try { record._uploader.stop(); } catch (e) {} }
    record.status = 'stopped';
    finishJob(record, 'stopped');
    jobs.delete(id);
    return res.json({ ok: true });
  });

  app.post('/jobs/:id/caption', requireWorkerAuth, async (req, res) => {
    const id = req.params.id;
    const record = jobs.get(id);
    if (!record) return res.status(404).json({ error: 'not found' });
    const caption = req.body || {};

    if (record._fifoWriter) {
      const seq = (record._srtSeq = (record._srtSeq || 0) + 1);
      const startMs = typeof caption.startMs === 'number' ? caption.startMs : Date.now() - record.createdAt;
      const durationMs = typeof caption.durationMs === 'number' ? caption.durationMs : (record.plan.cea708DelayMs || 4000);
      const cue = typeof caption.cue === 'string' ? caption.cue : buildSrtCue(seq, startMs, durationMs, String(caption.text || ''));
      try {
        const ok = await record._fifoWriter.write(cue);
        return res.json({ ok });
      } catch (e) {
        console.error(`caption write failed for job ${id}:`, e && e.message);
        return res.status(502).json({ error: 'caption write failed' });
      }
    }

    record.captions.push({ ts: Date.now(), caption });
    return res.json({ ok: true });
  });

  app.get('/stats', (req, res) => {
    const total = jobs.size;
    const running = Array.from(jobs.values()).filter(j => j.status === 'running').length;
    return res.json({ total, running, workerId: WORKER_ID });
  });

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', workerId: WORKER_ID, time: new Date().toISOString() });
  });

  app.get('/metrics', async (req, res) => {
    res.set('Content-Type', promRegistry.contentType);
    res.send(await promRegistry.metrics());
  });

  // Expose jobs - for debugging; not required but useful in tests
  app.get('/_jobs', (req, res) => {
    const out = Array.from(jobs.values()).map(j => ({ id: j.id, status: j.status, createdAt: j.createdAt, pid: j.pid }));
    res.json(out);
  });

  // Attach the in-memory store for callers who import the app (tests)
  app._jobsStore = jobs;
  return app;
}

export function startServer(port = DEFAULT_PORT) {
  const app = createApp();
  let registration = { stop: () => {} };
  const server = app.listen(port, () => {
    const boundPort = server.address().port;
    // eslint-disable-next-line no-console
    console.log(`lcyt-worker-daemon listening on ${boundPort}`);
    registration = startOrchestratorRegistration(boundPort);
  });

  return {
    app,
    server,
    stop: () => new Promise((resolve, reject) => {
      registration.stop();
      server.close(err => err ? reject(err) : resolve());
    })
  };
}

if (process.argv[1] && process.argv[1].endsWith('src/index.js')) {
  // direct run
  const port = process.env.PORT || DEFAULT_PORT;
  startServer(port);
}
