/**
 * OBS WebSocket v5 client — shared abstraction for both direct and bridged connections.
 *
 * Wraps obs-websocket-js with connection lifecycle management, auto-reconnect,
 * and RPC call helpers. Used by:
 *   - OBS adapter (direct non-bridged connections)
 *   - ObsPool in lcyt-bridge (pooled bridged connections)
 *
 * This module owns all OBS protocol details, so new OBS features (scene list,
 * get current scene, etc.) are implemented once here.
 */

import OBSWebSocket from 'obs-websocket-js';
import { EventEmitter } from 'node:events';

const RECONNECT_DELAY_INITIAL_MS = 5_000;
const RECONNECT_DELAY_MAX_MS = 60_000;
const CONNECT_TIMEOUT_MS = 3_000;

/**
 * OBSClient — manages a single persistent WebSocket connection to OBS.
 *
 * Lifecycle: create via new OBSClient(config), call connect(), use call() methods,
 * call disconnect() on cleanup.
 *
 * Emits:
 *   'connected'    - connection established and authenticated
 *   'disconnected' - connection lost
 *   'error'        - connection or RPC error
 */
export class OBSClient extends EventEmitter {
  /**
   * @param {{ host: string, port?: number, password?: string }}
   */
  constructor({ host, port = 4455, password = '' }) {
    super();
    this.host = host;
    this.port = port;
    this.password = password;

    this._ws = null;
    this._connected = false;
    this._destroyed = false;
    this._reconnectTimer = null;
    this._reconnectDelay = RECONNECT_DELAY_INITIAL_MS;
  }

  /** @returns {boolean} */
  get connected() {
    return this._connected;
  }

  /**
   * Establish connection (or return immediately if already connected).
   * Emits 'connected' when ready, 'error' if fatal.
   * Does NOT throw — reconnect happens automatically in background.
   *
   * @returns {Promise<void>} resolves after initial connect attempt
   */
  async connect() {
    if (this._connected || this._ws) {
      return; // already connected or connecting
    }

    if (this._destroyed) {
      throw new Error('OBSClient is destroyed');
    }

    return this._openConnection();
  }

  /**
   * Make an OBS WebSocket v5 RPC call.
   * Throws if not connected.
   *
   * @param {string} method - RPC method name (e.g., 'SetCurrentProgramScene')
   * @param {object} params - method parameters
   * @returns {Promise<any>} response data
   */
  async call(method, params) {
    if (!this._connected || !this._ws) {
      throw new Error(`OBS ${this.host}:${this.port} is not connected`);
    }
    return this._ws.call(method, params);
  }

  /**
   * Close connection and prevent reconnect.
   * @returns {Promise<void>}
   */
  async disconnect() {
    this._destroyed = true;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this._ws) {
      try {
        this._ws.disconnect();
      } catch {
        /* ignore */
      }
      this._ws = null;
    }
    this._connected = false;
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  async _openConnection() {
    if (this._destroyed) return;

    this._ws = new OBSWebSocket();

    this._ws.on('Connected', () => {
      this._connected = true;
      this._reconnectDelay = RECONNECT_DELAY_INITIAL_MS;
      this.emit('connected');
    });

    this._ws.on('Disconnected', () => {
      this._connected = false;
      this.emit('disconnected');
      if (!this._destroyed) {
        // Reconnect with exponential backoff
        this._reconnectTimer = setTimeout(() => {
          this._reconnectTimer = null;
          this._reconnectDelay = Math.min(this._reconnectDelay * 2, RECONNECT_DELAY_MAX_MS);
          this._ws = null;
          this._openConnection();
        }, this._reconnectDelay);
      }
    });

    this._ws.on('error', (err) => {
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
    });

    // Attempt connection with timeout
    return new Promise((resolve) => {
      this._ws
        .connect(
          {
            address: `${this.host}:${this.port}`,
            password: this.password || undefined,
          },
          { rpcVersion: '1' }
        )
        .catch(() => {
          // Connection error will be handled by 'Disconnected' event
        });

      // Return after timeout (connection attempt may still be pending)
      setTimeout(() => resolve(), CONNECT_TIMEOUT_MS);
    });
  }
}
