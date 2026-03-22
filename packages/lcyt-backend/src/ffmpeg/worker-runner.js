import { URL } from 'url';
import { EventEmitter } from 'events';

function _fetcher() {
  if (typeof fetch !== 'undefined') return fetch;
  // dynamic import of node-fetch if global fetch not present
  return async function fetchShim(...args) {
    const { default: nodeFetch } = await import('node-fetch');
    return nodeFetch(...args);
  };
}

export class WorkerFfmpegRunner extends EventEmitter {
  constructor({ baseUrl = process.env.WORKER_DAEMON_URL || 'http://127.0.0.1:5000', timeout = 5000 } = {}) {
    super();
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.timeout = timeout;
    this.jobId = null;
    this.workerId = null;
    this._fetchImpl = null;
  }

  async _fetch(path, opts = {}) {
    if (!this._fetchImpl) {
      this._fetchImpl = (typeof fetch !== 'undefined') ? fetch : (await import('node-fetch')).default;
    }
    const url = new URL(path, this.baseUrl).toString();
    return this._fetchImpl(url, opts);
  }

  /**
   * Start a remote worker job. Returns the RunnerHandle (this) — stdout/stderr are null.
   */
  async start(plan = {}) {
    const body = JSON.stringify(plan || {});
    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), this.timeout);
    try {
      const res = await this._fetch('/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: ac.signal,
      });
      if (!res.ok) {
        const err = new Error(`start failed: ${res.status}`);
        try { this.emit('error', err); } catch (e) {}
        throw err;
      }
      const json = await res.json();
      this.jobId = json.jobId;
      this.workerId = json.workerId;
      return this;
    } finally {
      clearTimeout(timeout);
    }
  }

  async stop(timeoutMs = 3000) {
    if (!this.jobId) return { ok: false, reason: 'no-job', timedOut: false };
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await this._fetch(`/jobs/${encodeURIComponent(this.jobId)}`, { method: 'DELETE', signal: ac.signal });
      if (!res.ok) throw new Error(`stop failed: ${res.status}`);
      this.jobId = null;
      // emit close to follow EventEmitter runner contract
      try { this.emit('close', { code: 0, signal: null }); } catch (e) {}
      return { ok: true, timedOut: false };
    } catch (err) {
      if (err.name === 'AbortError') return { ok: false, reason: 'timeout', timedOut: true };
      // emit error event for consumers
      try { this.emit('error', err); } catch (e) {}
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async writeCaption(captionObj) {
    if (!this.jobId) throw new Error('no active job');
    const body = JSON.stringify(captionObj || {});
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.timeout);
    try {
      const res = await this._fetch(`/jobs/${encodeURIComponent(this.jobId)}/caption`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
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
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.timeout);
    try {
      const res = await this._fetch('/stats', { signal: ac.signal });
      if (!res.ok) throw new Error(`stats failed: ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }
}
