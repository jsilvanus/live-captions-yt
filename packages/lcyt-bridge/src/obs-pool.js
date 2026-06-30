/**
 * ObsPool — manages a pool of persistent OBS WebSocket connections for the bridge agent.
 *
 * One connection is maintained per OBS instance (host:port:password).
 * Uses the shared OBSClient from lcyt-production for connection management.
 * The pool handles reuse, lifecycle, and dispatch.
 *
 * Emits:
 *   'obs:connected'    (key)
 *   'obs:disconnected' (key)
 *   'obs:error'        (key, err)
 */

import { EventEmitter } from 'node:events';
import { OBSClient } from 'lcyt-production';

export class ObsPool extends EventEmitter {
  constructor() {
    super();
    /**
     * Map keyed by "host:port:password" (safe key that includes all connection params).
     * @type {Map<string, { client: OBSClient, key: string }>}
     */
    this._pool = new Map();
  }

  /**
   * Switch the OBS program scene to the named scene.
   * Opens a connection to the host if one does not exist yet.
   * Throws if not connected.
   *
   * @param {string} host       OBS IP address or hostname
   * @param {number} port       OBS WebSocket port (default 4455)
   * @param {string} password   OBS WebSocket password
   * @param {string} sceneName  OBS scene name to switch to
   */
  async switch(host, port, password, sceneName) {
    const key = this._makeKey(host, port, password);
    let entry = this._pool.get(key);
    if (!entry) {
      entry = await this._open(host, port, password, key);
    }
    if (!entry.client.connected) {
      throw new Error(`OBS ${host}:${port} is not connected`);
    }
    // SetCurrentProgramScene RPC call via shared OBSClient
    await entry.client.call('SetCurrentProgramScene', { sceneName });
  }

  /**
   * Disconnect all OBS connections and clear the pool.
   */
  async destroy() {
    for (const [key, entry] of this._pool) {
      try {
        await entry.client.disconnect();
      } catch {
        /* ignore */
      }
    }
    this._pool.clear();
  }

  /**
   * Return status of all OBS connections.
   * @returns {Array<{ key: string, connected: boolean }>}
   */
  status() {
    return [...this._pool.entries()].map(([key, entry]) => ({
      key,
      connected: entry.client.connected,
    }));
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  /**
   * Create a safe key for a connection (includes password so different auth creds are separate entries).
   * @param {string} host
   * @param {number} port
   * @param {string} password
   * @returns {string}
   */
  _makeKey(host, port, password) {
    return `${host}:${port}:${Buffer.from(password).toString('base64')}`;
  }

  /**
   * Create an entry with a shared OBSClient and add it to the pool.
   * @param {string} host
   * @param {number} port
   * @param {string} password
   * @param {string} key
   * @returns {Promise<object>} entry
   */
  async _open(host, port, password, key) {
    const client = new OBSClient({ host, port, password });
    const entry = { client, key };

    this._pool.set(key, entry);

    client.on('connected', () => {
      console.info(`[obs-pool] Connected to ${host}:${port}`);
      this.emit('obs:connected', key);
    });

    client.on('disconnected', () => {
      this.emit('obs:disconnected', key);
    });

    client.on('error', (err) => {
      console.warn(`[obs-pool] ${host}:${port} error: ${err}`);
      this.emit('obs:error', key, err instanceof Error ? err : new Error(String(err)));
    });

    // Initiate connection (non-blocking; auto-reconnect handled by OBSClient)
    await client.connect().catch(() => {
      // Errors are emitted via events
    });

    return entry;
  }
}
