/**
 * TCP connection pool.
 * Maintains persistent connections keyed by "host:port".
 * On close or error, schedules a reconnect automatically.
 */

import { createConnection } from 'node:net';
import { EventEmitter } from 'node:events';

const RECONNECT_DELAY_MS = 5_000;
const KEEPALIVE_INTERVAL_MS = 30_000;
const WRITE_TIMEOUT_MS = 10_000;

export class TcpPool extends EventEmitter {
  constructor() {
    super();
    /** @type {Map<string, { socket: import('net').Socket, connected: boolean, destroyed: boolean, timer: NodeJS.Timeout|null }>} */
    this._pool = new Map();
  }

  /**
   * Ensure a connection to host:port exists (idempotent).
   * @param {string} host
   * @param {number} port
   */
  ensure(host, port) {
    const key = `${host}:${port}`;
    if (this._pool.has(key)) return;
    this._open(host, port);
  }

  /**
   * Send data to host:port. Creates a connection if none exists.
   * @param {string} host
   * @param {number} port
   * @param {string} payload
   * @returns {Promise<void>}
   */
  async send(host, port, payload) {
    const key = `${host}:${port}`;
    let entry = this._pool.get(key);
    if (!entry) {
      this._open(host, port);
      entry = this._pool.get(key);
    }
    if (!entry.connected || !entry.socket) {
      throw new Error(`TCP ${key} is not connected`);
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error(`TCP write to ${key} timed out after ${WRITE_TIMEOUT_MS}ms`));
        }
      }, WRITE_TIMEOUT_MS);
      entry.socket.write(payload, 'utf8', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) return reject(new Error(`TCP write to ${key} failed: ${err.message}`));
        resolve();
      });
    });
  }

  /**
   * Return status of all connections.
   * @returns {Array<{ key: string, connected: boolean }>}
   */
  status() {
    return [...this._pool.entries()].map(([key, e]) => ({ key, connected: e.connected }));
  }

  /**
   * Reconnect all connections.
   */
  reconnectAll() {
    for (const [key, entry] of this._pool.entries()) {
      if (entry.timer) clearTimeout(entry.timer);
      try { entry.socket?.destroy(); } catch { /* ignore */ }
      const [host, port] = key.split(':');
      this._open(host, Number(port));
    }
  }

  /** Cleanly destroy all connections. */
  destroy() {
    for (const entry of this._pool.values()) {
      entry.destroyed = true;
      if (entry.timer) clearTimeout(entry.timer);
      try { entry.socket?.destroy(); } catch { /* ignore */ }
    }
    this._pool.clear();
  }

  // ---------------------------------------------------------------------------

  _open(host, port) {
    const key = `${host}:${port}`;
    const entry = { socket: null, connected: false, destroyed: false, timer: null };
    this._pool.set(key, entry);

    const socket = createConnection({ host, port }, () => {
      entry.connected = true;
      socket.setKeepAlive(true, KEEPALIVE_INTERVAL_MS);
      this.emit('connected', key);
    });

    socket.on('error', (err) => {
      entry.connected = false;
      this.emit('error', key, err);
    });

    socket.on('close', () => {
      entry.connected = false;
      entry.socket = null;
      this.emit('disconnected', key);
      if (!entry.destroyed) {
        entry.timer = setTimeout(() => {
          entry.timer = null;
          this._pool.delete(key);
          this._open(host, port);
        }, RECONNECT_DELAY_MS);
      }
    });

    entry.socket = socket;
  }
}
