import { URL } from 'url';

function _fetcher() {
  if (typeof fetch !== 'undefined') return fetch;
  // dynamic import of node-fetch if global fetch not present
  return async function fetchShim(...args) {
    const { default: nodeFetch } = await import('node-fetch');
    return nodeFetch(...args);
  };
}

export class WorkerFfmpegRunner {
  constructor({ baseUrl = process.env.WORKER_DAEMON_URL || 'http://127.0.0.1:5000', timeout = 5000 } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.timeout = timeout;
    this.jobId = null;
    this.workerId = null;
  }

  async _fetch(path, opts = {}) {
    const fetchImpl = (typeof fetch !== 'undefined') ? fetch : (await import('node-fetch')).default;
    const url = new URL(path, this.baseUrl).toString();
    const res = await fetchImpl(url, opts);
    return res;
  }

  async start(plan = {}) {
    const body = JSON.stringify(plan || {});
    const res = await this._fetch('/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body
    });
    if (!res.ok) throw new Error(`start failed: ${res.status}`);
    const json = await res.json();
    this.jobId = json.jobId;
    this.workerId = json.workerId;
    return { jobId: this.jobId, workerId: this.workerId };
  }

  async stop() {
    if (!this.jobId) return { ok: false, reason: 'no-job' };
    const res = await this._fetch(`/jobs/${encodeURIComponent(this.jobId)}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`stop failed: ${res.status}`);
    this.jobId = null;
    return { ok: true };
  }

  async writeCaption(captionObj) {
    if (!this.jobId) throw new Error('no active job');
    const body = JSON.stringify(captionObj || {});
    const res = await this._fetch(`/jobs/${encodeURIComponent(this.jobId)}/caption`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body
    });
    if (!res.ok) throw new Error(`writeCaption failed: ${res.status}`);
    return await res.json();
  }

  async stats() {
    const res = await this._fetch('/stats');
    if (!res.ok) throw new Error(`stats failed: ${res.status}`);
    return await res.json();
  }
}
