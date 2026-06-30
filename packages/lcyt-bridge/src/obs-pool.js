/**
 * ObsPool — manages persistent OBS WebSocket connections for the bridge agent.
 *
 * OBS Studio 28+ exposes a WebSocket v5 interface on port 4455 (configurable).
 * The obs-websocket-js library handles the WebSocket handshake, authentication,
 * and JSON-RPC v2 request/response multiplexing. One connection is maintained
 * per OBS instance (host:port:password). The pool handles connect, reconnect
 * on drop, and scene-switch dispatch.
 *
 * Emits:
 *   'obs:connected'    (key)
 *   'obs:disconnected' (key)
 *   'obs:error'        (key, err)
 */

import { EventEmitter } from 'node:events';
import OBSWebSocket from 'obs-websocket-js';

const RECONNECT_DELAY_INITIAL_MS = 5_000;
const RECONNECT_DELAY_MAX_MS = 60_000;
const CONNECT_TIMEOUT_MS = 3_000;

export class ObsPool extends EventEmitter {
  constructor() {
    super();
    /**
     * Map keyed by "host:port:password" (safe key that includes all connection params).
     * @type {Map<string, { obs: OBSWebSocket, connected: boolean, destroyed: boolean, _reconnectTimer: NodeJS.Timeout|null, _reconnectDelay: number }>}
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
    if (!entry.connected) {
      throw new Error(`OBS ${host}:${port} is not connected`);
    }
    // SetCurrentProgramScene RPC call
    await entry.obs.call('SetCurrentProgramScene', { sceneName });
  }

  /**
   * Disconnect all OBS connections and clear the pool.
   */
  destroy() {
    for (const [key, entry] of this._pool) {
      entry.destroyed = true;
      if (entry._reconnectTimer) clearTimeout(entry._reconnectTimer);
      try {
        entry.obs.disconnect();
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
      connected: entry.connected,
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
   * Create an entry, open the OBS WebSocket connection, and add it to the pool.
   * @param {string} host
   * @param {number} port
   * @param {string} password
   * @param {string} key
   * @returns {Promise<object>} entry
   */
  async _open(host, port, password, key) {
    const entry = {
      obs: new OBSWebSocket(),
      connected: false,
      destroyed: false,
      _reconnectTimer: null,
      _reconnectDelay: RECONNECT_DELAY_INITIAL_MS,
    };

    this._pool.set(key, entry);

    entry.obs.on('Connected', () => {
      entry.connected = true;
      entry._reconnectDelay = RECONNECT_DELAY_INITIAL_MS;
      console.info(`[obs-pool] Connected to ${host}:${port}`);
      this.emit('obs:connected', key);
    });

    entry.obs.on('Disconnected', () => {
      entry.connected = false;
      this.emit('obs:disconnected', key);
      if (!entry.destroyed) {
        console.info(
          `[obs-pool] ${host}:${port} disconnected — reconnecting in ${entry._reconnectDelay}ms`
        );
        entry._reconnectTimer = setTimeout(() => {
          entry._reconnectTimer = null;
          entry._reconnectDelay = Math.min(
            entry._reconnectDelay * 2,
            RECONNECT_DELAY_MAX_MS
          );
          this._pool.delete(key);
          this._open(host, port, password, key);
        }, entry._reconnectDelay);
      }
    });

    entry.obs.on('error', (err) => {
      console.warn(`[obs-pool] ${host}:${port} error: ${err}`);
      this.emit(
        'obs:error',
        key,
        err instanceof Error ? err : new Error(String(err))
      );
    });

    // Establish connection with timeout
    return new Promise((resolve) => {
      entry.obs
        .connect(
          {
            address: `${host}:${port}`,
            password: password || undefined,
          },
          { rpcVersion: '1' }
        )
        .catch(() => {
          // Connection error is ok — we'll retry on 'Disconnected' event
        });

      // Return entry after timeout (connection may still be pending)
      setTimeout(() => resolve(entry), CONNECT_TIMEOUT_MS);
    });
  }
}
