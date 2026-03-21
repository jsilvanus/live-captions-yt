import express from 'express';
import { spawn } from 'child_process';

import path from 'path';
import createUploader from './uploader.js';
import { createS3UploadFn } from './s3-uploader.js';

const DEFAULT_PORT = process.env.PORT || 5000;
const WORKER_ID = process.env.WORKER_ID || 'worker-0';

export function createApp() {
  const app = express();
  app.use(express.json());

  // In-memory jobs map: jobId -> { id, plan, status, createdAt, proc?, captions: [] }
  const jobs = new Map();

  function makeJobId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
  }

  app.post('/jobs', (req, res) => {
    const plan = req.body || {};
    const jobId = makeJobId();
    const record = {
      id: jobId,
      plan,
      status: 'starting',
      createdAt: Date.now(),
      captions: []
    };

    // If in test mode, don't spawn a real process
    if (process.env.NODE_ENV === 'test') {
      record.status = 'running';
      record.workerId = WORKER_ID;
      jobs.set(jobId, record);
    return res.json({ jobId, workerId: WORKER_ID });
    }

    // Spawn a placeholder long-running process. Prefer 'sleep' on unix-like, otherwise fallback to a node infinite loop.
    let proc;
    if (process.platform !== 'win32') {
      // 'sleep' with a very long time (3600s) is a simple placeholder; process may be killed by delete.
      proc = spawn('sleep', ['3600'], { stdio: 'ignore', detached: true });
    } else {
      // Windows: spawn a node child that never exits
      proc = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore', detached: true });
    }

    record.proc = proc;
    record.pid = proc.pid;
    record.status = 'running';
    record.workerId = WORKER_ID;
    jobs.set(jobId, record);
    // Start uploader if job requests HLS/preview output
    try {
      const out = plan.hlsOutputPath || plan.previewOutputPath || null;
      if (out) {
        const uploadFn = createS3UploadFn({ baseKey: plan.hlsOutputUrl || '' });
        const up = createUploader({ watchDir: out, prefix: '', uploadFn });
        record._uploader = up.start();
      }
    } catch (e) { console.error('uploader wiring error', e); }



    // Detach so it continues if parent exits unexpectedly; keep a handle so we can kill it later
    try { proc.unref(); } catch (_) {}

    res.json({ jobId, workerId: WORKER_ID });
  });

  app.delete('/jobs/:id', (req, res) => {
    const id = req.params.id;
    const record = jobs.get(id);
    if (!record) return res.status(404).json({ error: 'not found' });

    if (record.proc && !record.proc.killed) {
      try {
        record.proc.kill();
      } catch (e) {}
    }

    if (record._uploader && typeof record._uploader.stop === "function") { try { record._uploader.stop(); } catch (e) {} }
    record.status = 'stopped';
    jobs.delete(id);
    return res.json({ ok: true });
  });

  app.post('/jobs/:id/caption', (req, res) => {
    const id = req.params.id;
    const record = jobs.get(id);
    if (!record) return res.status(404).json({ error: 'not found' });
    const caption = req.body || {};
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
  const server = app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`lcyt-worker-daemon listening on ${port}`);
  });

  return {
    app,
    server,
    stop: () => new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()))
  };
}

if (process.argv[1] && process.argv[1].endsWith('src/index.js')) {
  // direct run
  const port = process.env.PORT || DEFAULT_PORT;
  startServer(port);
}
