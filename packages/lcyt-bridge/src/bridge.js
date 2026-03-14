/**
 * lcyt-bridge core — SSE client + command dispatcher + status reporter.
 *
 * Connects to GET /production/bridge/commands?token=xxx on the LCYT backend.
 * Dispatches tcp_send commands to the TcpPool.
 * Reports results via POST /production/bridge/status.
 */

import { EventEmitter } from 'node:events';
import { TcpPool } from './tcp-pool.js';

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
    this._es = null;
    this._destroyed = false;
    this._reconnectDelay = RECONNECT_DELAY_MS;
    this._reconnectTimer = null;

    // Forward TCP pool events
    this._tcpPool.on('connected',    (key) => { this.emit('tcp:connected', key); });
    this._tcpPool.on('disconnected', (key) => { this.emit('tcp:disconnected', key); });
    this._tcpPool.on('error',        (key, err) => { this.emit('tcp:error', key, err); });
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
  }

  /** @returns {{ sse: boolean, tcp: Array<{ key: string, connected: boolean }> }} */
  status() {
    return {
      sse: this._es?.readyState === 1 /* OPEN */,
      tcp: this._tcpPool.status(),
    };
  }

  // ---------------------------------------------------------------------------

  async _connect() {
    if (this._destroyed) return;

    // Dynamic import of eventsource (CommonJS package)
    let EventSource;
    try {
      const mod = await import('eventsource');
      EventSource = mod.default ?? mod.EventSource;
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

  /** Send a periodic heartbeat to the backend. */
  startHeartbeat(intervalMs = 30_000) {
    const timer = setInterval(() => {
      if (this._destroyed) { clearInterval(timer); return; }
      this._postStatus({ type: 'heartbeat' });
    }, intervalMs);
    return timer;
  }
}
