import { URL } from 'url';
import { EventEmitter } from 'events';
import { LocalFfmpegRunner } from './local-runner.js';
import { DockerFfmpegRunner } from './docker-runner.js';

/**
 * Remote ffmpeg runner. Two dispatch modes:
 *
 * - Direct mode (default): talks straight to a single worker daemon at `baseUrl`
 *   (`WORKER_DAEMON_URL`), mirroring the worker daemon's `/jobs` API 1:1.
 * - Orchestrator mode: when `orchestratorUrl` (`COMPUTE_ORCHESTRATOR_URL`) is set,
 *   jobs are dispatched through the orchestrator's `/compute/jobs` API instead, so
 *   the orchestrator can pick a worker (or queue/burst-provision one). If the
 *   orchestrator itself is unreachable, `start()` falls back to running ffmpeg
 *   in-process via `fallbackRunner` (`ORCHESTRATOR_FALLBACK`, default `spawn`)
 *   rather than failing the job outright. Set `ORCHESTRATOR_FALLBACK=none` to
 *   disable the fallback and propagate the orchestrator error instead.
 */
export class WorkerFfmpegRunner extends EventEmitter {
  constructor({
    baseUrl = process.env.WORKER_DAEMON_URL || 'http://127.0.0.1:5000',
    orchestratorUrl = process.env.COMPUTE_ORCHESTRATOR_URL || null,
    internalToken = process.env.BACKEND_INTERNAL_TOKEN || null,
    workerAuthToken = process.env.WORKER_AUTH_TOKEN || process.env.BACKEND_INTERNAL_TOKEN || null,
    fallbackRunner = process.env.ORCHESTRATOR_FALLBACK || 'spawn',
    timeout = 5000,
    ...planOpts
  } = {}) {
    super();
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.orchestratorUrl = orchestratorUrl ? orchestratorUrl.replace(/\/$/, '') : null;
    this.internalToken = internalToken;
    this.workerAuthToken = workerAuthToken;
    this.fallbackRunner = fallbackRunner;
    this.timeout = timeout;
    // Any remaining constructor opts (cmd, args, image, env, ...) double as the
    // default job plan, so this runner can be used like Local/DockerFfmpegRunner
    // (opts at construction, no-arg start()) as well as with an explicit plan
    // passed to start(plan).
    this.planOpts = planOpts;

    this.jobId = null;
    this.workerId = null;
    this.workerUrl = null;
    this.viaOrchestrator = false;
    this.viaFallback = false;

    this._fetchImpl = null;
    this._fallback = null;
  }

  async _doFetch(url, opts = {}) {
    if (!this._fetchImpl) {
      this._fetchImpl = (typeof fetch !== 'undefined') ? fetch : (await import('node-fetch')).default;
    }
    return this._fetchImpl(url, opts);
  }

  /**
   * Start a job. Returns `this` (the RunnerHandle) so callers can attach
   * 'error'/'close' listeners the same way they would for Local/DockerFfmpegRunner.
   */
  async start(plan = {}) {
    const mergedPlan = Object.assign({}, this.planOpts, plan);
    if (this.orchestratorUrl) {
      try {
        return await this._startViaOrchestrator(mergedPlan);
      } catch (err) {
        return await this._startFallback(mergedPlan, err);
      }
    }
    return await this._startDirect(mergedPlan);
  }

  async _startDirect(plan) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.timeout);
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (this.workerAuthToken) headers['X-Worker-Auth'] = this.workerAuthToken;
      const url = new URL('/jobs', this.baseUrl).toString();
      const res = await this._doFetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(plan || {}),
        signal: ac.signal,
      });
      if (!res.ok) {
        const err = new Error(`start failed: ${res.status}`);
        try { this.emit('error', err); } catch (e) {}
        throw err;
      }
      const json = await res.json();
      this.jobId = json.jobId;
      this.workerId = json.workerId || null;
      this.workerUrl = this.baseUrl;
      this.viaOrchestrator = false;
      return this;
    } finally {
      clearTimeout(timer);
    }
  }

  async _startViaOrchestrator(plan) {
    const id = plan.id || `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.timeout);
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (this.internalToken) headers['X-Internal-Auth'] = this.internalToken;
      const url = new URL('/compute/jobs', this.orchestratorUrl).toString();
      const res = await this._doFetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(Object.assign({}, plan, { id, type: plan.type || 'ffmpeg' })),
        signal: ac.signal,
      });

      if (res.status === 202) {
        // Queued — no worker assigned yet (orchestrator has no warm capacity and
        // may be burst-provisioning one). Treat as started; stop()/writeCaption()
        // still work since they address the job by id through the orchestrator.
        this.jobId = id;
        this.workerId = null;
        this.workerUrl = null;
        this.viaOrchestrator = true;
        return this;
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`orchestrator dispatch failed: ${res.status} ${text}`);
      }
      const json = await res.json();
      this.jobId = json.jobId || id;
      this.workerId = json.workerId || null;
      this.workerUrl = json.workerUrl || null;
      this.viaOrchestrator = true;
      return this;
    } finally {
      clearTimeout(timer);
    }
  }

  async _startFallback(plan, orchestratorErr) {
    if (!this.fallbackRunner || this.fallbackRunner === 'none') {
      try { this.emit('error', orchestratorErr); } catch (e) {}
      throw orchestratorErr;
    }
    console.error('orchestrator unreachable, falling back to', this.fallbackRunner, 'runner:', orchestratorErr && orchestratorErr.message);

    const delegate = this.fallbackRunner === 'docker' ? new DockerFfmpegRunner(plan) : new LocalFfmpegRunner(plan);
    await delegate.start();
    delegate.on('error', (err) => { try { this.emit('error', err); } catch (e) {} });
    delegate.on('close', (info) => { try { this.emit('close', info); } catch (e) {} });

    this._fallback = delegate;
    this.viaOrchestrator = false;
    this.viaFallback = true;
    return this;
  }

  async stop(timeoutMs = 3000) {
    if (this._fallback) return this._fallback.stop(timeoutMs);
    if (!this.jobId) return { ok: false, reason: 'no-job', timedOut: false };

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const headers = {};
      let url;
      if (this.viaOrchestrator) {
        if (this.internalToken) headers['X-Internal-Auth'] = this.internalToken;
        url = new URL(`/compute/jobs/${encodeURIComponent(this.jobId)}`, this.orchestratorUrl).toString();
      } else {
        if (this.workerAuthToken) headers['X-Worker-Auth'] = this.workerAuthToken;
        url = new URL(`/jobs/${encodeURIComponent(this.jobId)}`, this.baseUrl).toString();
      }
      const res = await this._doFetch(url, { method: 'DELETE', headers, signal: ac.signal });
      if (!res.ok) throw new Error(`stop failed: ${res.status}`);
      this.jobId = null;
      try { this.emit('close', { code: 0, signal: null }); } catch (e) {}
      return { ok: true, timedOut: false };
    } catch (err) {
      if (err.name === 'AbortError') return { ok: false, reason: 'timeout', timedOut: true };
      try { this.emit('error', err); } catch (e) {}
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async writeCaption(captionObj) {
    if (this._fallback) {
      // Local/Docker runners have no remote caption endpoint — captions for those
      // are injected via a FIFO writer owned directly by the caller (see
      // rtmp-manager.js), not through this Runner interface.
      throw new Error('writeCaption is unavailable while running via the orchestrator fallback runner');
    }
    if (!this.jobId) throw new Error('no active job');

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.timeout);
    try {
      const headers = { 'Content-Type': 'application/json' };
      let url;
      if (this.viaOrchestrator) {
        if (this.internalToken) headers['X-Internal-Auth'] = this.internalToken;
        url = new URL(`/compute/jobs/${encodeURIComponent(this.jobId)}/caption`, this.orchestratorUrl).toString();
      } else {
        if (this.workerAuthToken) headers['X-Worker-Auth'] = this.workerAuthToken;
        url = new URL(`/jobs/${encodeURIComponent(this.jobId)}/caption`, this.baseUrl).toString();
      }
      const res = await this._doFetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(captionObj || {}),
        signal: ac.signal,
      });
      if (!res.ok) return { ok: false, status: res.status };
      return await res.json();
    } catch (err) {
      if (err.name === 'AbortError') return { ok: false, reason: 'timeout' };
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async stats() {
    if (this._fallback) throw new Error('stats is unavailable while running via the orchestrator fallback runner');
    const base = this.workerUrl || this.baseUrl;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.timeout);
    try {
      const headers = {};
      if (this.workerAuthToken) headers['X-Worker-Auth'] = this.workerAuthToken;
      const url = new URL('/stats', base).toString();
      const res = await this._doFetch(url, { headers, signal: ac.signal });
      if (!res.ok) throw new Error(`stats failed: ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }
}
