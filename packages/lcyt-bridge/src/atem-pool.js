/**
 * AtemPool — manages persistent ATEM UDP connections for the bridge agent.
 *
 * ATEM devices communicate via a proprietary UDP protocol on port 9910,
 * managed by the atem-connection library. One connection is maintained per
 * ATEM host. The pool handles connect, reconnect on drop, and command dispatch.
 *
 * Emits:
 *   'atem:connected'    (host)
 *   'atem:disconnected' (host)
 *   'atem:error'        (host, err)
 *   'atem:state'        (host, state)   on connect and on every state change (tally lights)
 */

import { EventEmitter } from 'node:events';
import { Atem } from 'atem-connection';

const RECONNECT_DELAY_INITIAL_MS = 5_000;
const RECONNECT_DELAY_MAX_MS = 60_000;

export class AtemPool extends EventEmitter {
  constructor() {
    super();
    /** @type {Map<string, { atem: Atem, connected: boolean, destroyed: boolean, _reconnectTimer: NodeJS.Timeout|null, _reconnectDelay: number }>} */
    this._pool = new Map();
  }

  /**
   * Switch the program bus on an ATEM to the given input.
   * Opens a connection to the host if one does not exist yet.
   * Throws if not connected.
   *
   * @param {string} host         ATEM IP address
   * @param {number} meIndex      0-based M/E index (0 = M/E 1)
   * @param {number} inputNumber  1-based input number
   */
  async switch(host, meIndex, inputNumber) {
    let entry = this._pool.get(host);
    if (!entry) {
      entry = this._open(host);
    }
    if (!entry.connected) {
      throw new Error(`ATEM ${host} is not connected`);
    }
    // changeProgramInput(input, me) — input first, me second
    await entry.atem.changeProgramInput(inputNumber, meIndex);
  }

  /** Open a connection to the host if there is none yet (tally lights read state without switching). */
  connect(host) {
    if (!this._pool.has(host)) this._open(host);
  }

  /** The last known ATEM state of a host, or null while it is not connected. */
  state(host) {
    const entry = this._pool.get(host);
    return entry?.connected ? entry.atem.state ?? null : null;
  }

  /**
   * Disconnect all ATEM connections and clear the pool.
   */
  destroy() {
    for (const [host, entry] of this._pool) {
      entry.destroyed = true;
      if (entry._reconnectTimer) clearTimeout(entry._reconnectTimer);
      try { entry.atem.disconnect(); } catch { /* ignore */ }
    }
    this._pool.clear();
  }

  /**
   * Return status of all ATEM connections.
   * @returns {Array<{ host: string, connected: boolean }>}
   */
  status() {
    return [...this._pool.entries()].map(([host, entry]) => ({
      host,
      connected: entry.connected,
    }));
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  /**
   * Create an entry, open the ATEM connection, and add it to the pool.
   * @param {string} host
   * @returns {object} entry
   */
  _open(host) {
    const entry = {
      atem: new Atem(),
      connected: false,
      destroyed: false,
      _reconnectTimer: null,
      _reconnectDelay: RECONNECT_DELAY_INITIAL_MS,
    };

    this._pool.set(host, entry);

    entry.atem.on('connected', () => {
      entry.connected = true;
      entry._reconnectDelay = RECONNECT_DELAY_INITIAL_MS;
      console.info(`[atem-pool] Connected to ${host}`);
      this.emit('atem:connected', host);
      this.emit('atem:state', host, entry.atem.state);
    });

    entry.atem.on('stateChanged', () => {
      if (entry.connected) this.emit('atem:state', host, entry.atem.state);
    });

    entry.atem.on('disconnected', () => {
      entry.connected = false;
      this.emit('atem:disconnected', host);
      if (!entry.destroyed) {
        console.info(`[atem-pool] ${host} disconnected — reconnecting in ${entry._reconnectDelay}ms`);
        entry._reconnectTimer = setTimeout(() => {
          entry._reconnectTimer = null;
          entry._reconnectDelay = Math.min(entry._reconnectDelay * 2, RECONNECT_DELAY_MAX_MS);
          this._pool.delete(host);
          this._open(host);
        }, entry._reconnectDelay);
      }
    });

    entry.atem.on('error', (err) => {
      console.warn(`[atem-pool] ${host} error: ${err}`);
      this.emit('atem:error', host, err instanceof Error ? err : new Error(String(err)));
    });

    entry.atem.connect(host);
    return entry;
  }
}
