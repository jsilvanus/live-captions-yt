/**
 * lcyt-bridge core — SSE client + command dispatcher + status reporter.
 *
 * Connects to GET /production/bridge/commands?token=xxx on the LCYT backend.
 * Dispatches tcp_send commands to the TcpPool.
 * Reports results via POST /production/bridge/status.
 */

import { EventEmitter } from 'node:events';
import { TcpPool } from './tcp-pool.js';
import { AtemPool } from './atem-pool.js';
import { ObsPool } from './obs-pool.js';

const RECONNECT_DELAY_MS = 5_000;
const RECONNECT_DELAY_MAX_MS = 60_000;

export class Bridge extends EventEmitter {
  /**
   * @param {{ backendUrl: string, token: string }} config
   */
  constructor({ backendUrl, token }) {
    super();
    this._backendUrl = backendUrl.replace(/\/$/, '');
    this._token = token;
    this._tcpPool = new TcpPool();
    this._atemPool = new AtemPool();
    this._obsPool = new ObsPool();
    this._es = null;
    this._destroyed = false;
    this._reconnectDelay = RECONNECT_DELAY_MS;
    this._reconnectTimer = null;

    // Forward TCP pool events
    this._tcpPool.on('connected',    (key) => { this.emit('tcp:connected', key); });
    this._tcpPool.on('disconnected', (key) => { this.emit('tcp:disconnected', key); });
    this._tcpPool.on('error',        (key, err) => { this.emit('tcp:error', key, err); });

    // Forward ATEM pool events
    this._atemPool.on('atem:connected',    (host) => { this.emit('atem:connected', host); });
    this._atemPool.on('atem:disconnected', (host) => { this.emit('atem:disconnected', host); });
    this._atemPool.on('atem:error',        (host, err) => { this.emit('atem:error', host, err); });

    // Forward OBS pool events
    this._obsPool.on('obs:connected',    (key) => { this.emit('obs:connected', key); });
    this._obsPool.on('obs:disconnected', (key) => { this.emit('obs:disconnected', key); });
    this._obsPool.on('obs:error',        (key, err) => { this.emit('obs:error', key, err); });
  }

  /** Start the SSE connection. */
  start() {
    this._connect();
  }

  /** Trigger reconnect of all SSE and TCP connections. */
  reconnectAll() {
    if (this._es) { try { this._es.close(); } catch { /* ignore */ } }
    this._tcpPool.reconnectAll();
    this._connect();
  }

  /** Graceful shutdown. */
  destroy() {
    this._destroyed = true;
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    if (this._es) { try { this._es.close(); } catch { /* ignore */ } }
    this._tcpPool.destroy();
    this._atemPool.destroy();
    this._obsPool.destroy();
  }

  /** @returns {{ sse: boolean, tcp: Array<{ key: string, connected: boolean }>, atem: Array<{ host: string, connected: boolean }>, obs: Array<{ key: string, connected: boolean }> }} */
  status() {
    return {
      sse:  this._es?.readyState === 1 /* OPEN */,
      tcp:  this._tcpPool.status(),
      atem: this._atemPool.status(),
      obs:  this._obsPool.status(),
    };
  }

  // ---------------------------------------------------------------------------

  async _connect() {
    if (this._destroyed) return;

    // Dynamic import of eventsource — handles both ESM default and CJS shapes
    let EventSource;
    try {
      const mod = await import('eventsource');
      const candidate = mod.default ?? mod;
      // If the default export is the constructor, use it directly;
      // otherwise look for a named .EventSource property (CJS re-export).
      EventSource = typeof candidate === 'function'
        ? candidate
        : (candidate.EventSource ?? mod.EventSource);
      if (typeof EventSource !== 'function') {
        throw new Error('EventSource constructor not found in module exports');
      }
    } catch (e) {
      this.emit('error', new Error(`Cannot load eventsource: ${e.message}`));
      return;
    }

    const url = `${this._backendUrl}/production/bridge/commands?token=${encodeURIComponent(this._token)}`;
    this.emit('connecting', url);

    const es = new EventSource(url);
    this._es = es;

    es.onopen = () => {
      this._reconnectDelay = RECONNECT_DELAY_MS; // reset backoff on success
      this.emit('connected');
    };

    es.addEventListener('connected', () => {
      this.emit('connected');
    });

    es.addEventListener('command', (evt) => {
      this._handleCommand(evt.data);
    });

    es.onerror = (err) => {
      this.emit('disconnected');
      es.close();
      this._es = null;
      if (!this._destroyed) {
        this.emit('reconnecting', this._reconnectDelay);
        this._reconnectTimer = setTimeout(() => {
          this._reconnectTimer = null;
          this._reconnectDelay = Math.min(this._reconnectDelay * 2, RECONNECT_DELAY_MAX_MS);
          this._connect();
        }, this._reconnectDelay);
      }
    };
  }

  async _handleCommand(rawData) {
    let cmd;
    try {
      cmd = JSON.parse(rawData);
    } catch {
      this.emit('error', new Error(`Received non-JSON command: ${rawData}`));
      return;
    }

    if (cmd.type === 'tcp_send') {
      const { requestId, host, port, payload } = cmd;
      try {
        await this._tcpPool.send(host, Number(port), payload);
        await this._postStatus({ requestId, ok: true });
        this.emit('command:ok', { host, port, payload });
      } catch (err) {
        await this._postStatus({ requestId, ok: false, error: err.message });
        this.emit('command:error', { host, port, error: err.message });
      }
    } else if (cmd.type === 'atem_switch') {
      const { requestId, host, meIndex = 0, inputNumber } = cmd;
      try {
        await this._atemPool.switch(host, meIndex, inputNumber);
        await this._postStatus({ requestId, ok: true });
        this.emit('command:ok', { host, type: 'atem_switch', inputNumber });
      } catch (err) {
        await this._postStatus({ requestId, ok: false, error: err.message });
        this.emit('command:error', { host, type: 'atem_switch', error: err.message });
      }
    } else if (cmd.type === 'http_request') {
      const { requestId, method = 'GET', url, headers = {}, body } = cmd;
      try {
        const result = await this._httpRequest({ method, url, headers, body });
        await this._postStatus({ requestId, ok: true, status: result.status, body: result.body });
        this.emit('command:ok', { type: 'http_request', url, status: result.status });
      } catch (err) {
        await this._postStatus({ requestId, ok: false, error: err.message });
        this.emit('command:error', { type: 'http_request', url, error: err.message });
      }
    } else if (cmd.type === 'model_call') {
      // Local-model inference relay (plan/ai_model_registry): fetch the source
      // image (if any) from the backend ourselves — raw image bytes never
      // travel down the SSE command channel — then POST to the local model
      // endpoint (e.g. an Ollama /api/generate on this bridge's network).
      const { requestId, sourceUrl, endpoint, model, prompt, outputMode, headers = {} } = cmd;
      try {
        const result = await this._modelCall({ sourceUrl, endpoint, model, prompt, outputMode, headers });
        await this._postStatus({ requestId, ok: true, status: result.status, body: result.body });
        this.emit('command:ok', { type: 'model_call', endpoint, status: result.status });
      } catch (err) {
        await this._postStatus({ requestId, ok: false, error: err.message });
        this.emit('command:error', { type: 'model_call', endpoint, error: err.message });
      }
    } else if (cmd.type === 'obs_switch') {
      const { requestId, host, port, password, sceneName } = cmd;
      try {
        await this._obsPool.switch(host, Number(port), password, sceneName);
        await this._postStatus({ requestId, ok: true });
        this.emit('command:ok', { host, port, type: 'obs_switch', sceneName });
      } catch (err) {
        await this._postStatus({ requestId, ok: false, error: err.message });
        this.emit('command:error', { host, port, type: 'obs_switch', error: err.message });
      }
    } else {
      this.emit('error', new Error(`Unknown command type: ${cmd.type}`));
    }
  }

  async _postStatus(body) {
    try {
      await fetch(`${this._backendUrl}/production/bridge/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Bridge-Token': this._token,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      this.emit('error', new Error(`Status POST failed: ${err.message}`));
    }
  }

  async _httpRequest({ method, url, headers, body }) {
    const init = {
      method: method.toUpperCase(),
      headers: { ...headers },
    };
    if (body !== undefined && body !== null) {
      if (typeof body === 'object' && !Array.isArray(body)) {
        init.headers['Content-Type'] = init.headers['Content-Type'] || 'application/json';
        init.body = JSON.stringify(body);
      } else {
        init.body = String(body);
      }
    }
    const response = await fetch(url, init);
    const text = await response.text().catch(() => '');
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: response.status, body: parsed };
  }

  /**
   * Run a model inference call against a local (this network's) endpoint.
   * When sourceUrl is present, its bytes are fetched here and passed to the
   * model as a base64 `images` entry (Ollama vision convention).
   *
   * @param {{ sourceUrl?: string, endpoint: string, model?: string, prompt?: string, outputMode?: string, headers?: object }} opts
   * @returns {Promise<{ status: number, body: any }>}
   */
  async _modelCall({ sourceUrl, endpoint, model, prompt, outputMode, headers = {} }) {
    if (!endpoint) throw new Error('model_call requires an endpoint');

    let images;
    if (sourceUrl) {
      const imgRes = await fetch(sourceUrl);
      if (!imgRes.ok) throw new Error(`Source fetch failed: ${imgRes.status}`);
      const buf = Buffer.from(await imgRes.arrayBuffer());
      images = [buf.toString('base64')];
    }

    const payload = {
      ...(model ? { model } : {}),
      ...(prompt !== undefined ? { prompt } : {}),
      stream: false,
      ...(outputMode === 'json' ? { format: 'json' } : {}),
      ...(images ? { images } : {}),
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(payload),
    });
    const text = await response.text().catch(() => '');
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: response.status, body: parsed };
  }

  /** Send a periodic heartbeat to the backend. */
  startHeartbeat(intervalMs = 30_000) {
    const timer = setInterval(() => {
      if (this._destroyed) { clearInterval(timer); return; }
      this._postStatus({ type: 'heartbeat' });
    }, intervalMs);
    return timer;
  }
}
