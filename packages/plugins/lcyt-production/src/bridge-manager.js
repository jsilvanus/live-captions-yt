/**
 * BridgeManager — manages SSE connections from lcyt-bridge agents.
 *
 * Each bridge authenticates with a token (looked up in prod_bridge_instances).
 * Commands are pushed as SSE events; results arrive via POST /bridge/status.
 *
 * Command round-trip:
 *   backend → SSE event { type:'tcp_send', requestId, host, port, payload }
 *   bridge  → POST /bridge/status { requestId, ok, error? }
 *   backend → resolves the pending Promise
 */

import { randomUUID } from 'node:crypto';

const COMMAND_TIMEOUT_MS = 10_000;
const HEARTBEAT_INTERVAL_MS = 20_000;

export class BridgeManager {
  /**
   * @param {import('better-sqlite3').Database} db
   */
  constructor(db) {
    this._db = db;
    /** @type {Map<string, { res: object, instanceId: string, heartbeatTimer: NodeJS.Timeout }>} */
    this._connections = new Map(); // instanceId → connection
    /** @type {Map<string, { resolve: Function, reject: Function, timer: NodeJS.Timeout }>} */
    this._pending = new Map(); // requestId → pending callback
  }

  /**
   * Authenticate a bridge token. Returns the BridgeInstance row or null.
   * @param {string} token
   * @returns {object|null}
   */
  authenticate(token) {
    if (!token) return null;
    return this._db
      .prepare('SELECT * FROM prod_bridge_instances WHERE token = ?')
      .get(token) ?? null;
  }

  /**
   * Register a new SSE connection from a bridge. Kicks any existing connection
   * for the same instance (handles crash-reconnect without manual intervention).
   *
   * @param {string} instanceId
   * @param {object} res  Express response object for the SSE stream
   */
  connect(instanceId, res) {
    // Kick existing connection if present
    const existing = this._connections.get(instanceId);
    if (existing) {
      console.info(`[bridge] Instance ${instanceId} reconnected — kicking previous connection`);
      clearInterval(existing.heartbeatTimer);
      try { existing.res.end(); } catch { /* already closed */ }
    }

    // Set up SSE headers
    res.set({
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
      'X-Accel-Buffering': 'no', // nginx: disable buffering for SSE
    });
    res.flushHeaders();

    // Send an initial connected event
    this._write(res, 'connected', { instanceId });

    // Heartbeat to keep the SSE stream alive through proxies
    const heartbeatTimer = setInterval(() => {
      try { res.write(': heartbeat\n\n'); } catch { this.disconnect(instanceId); }
    }, HEARTBEAT_INTERVAL_MS);

    this._connections.set(instanceId, { res, instanceId, heartbeatTimer });

    // Update DB status
    this._db.prepare(
      "UPDATE prod_bridge_instances SET status = 'connected', last_seen = datetime('now') WHERE id = ?"
    ).run(instanceId);

    // Handle client disconnect
    res.on('close', () => this.disconnect(instanceId));

    console.info(`[bridge] Instance ${instanceId} connected`);
  }

  /**
   * Deregister a bridge connection (called on SSE close or kick).
   * @param {string} instanceId
   */
  disconnect(instanceId) {
    const conn = this._connections.get(instanceId);
    if (!conn) return;
    clearInterval(conn.heartbeatTimer);
    this._connections.delete(instanceId);
    this._db.prepare(
      "UPDATE prod_bridge_instances SET status = 'disconnected' WHERE id = ?"
    ).run(instanceId);
    console.info(`[bridge] Instance ${instanceId} disconnected`);
  }

  /**
   * @param {string} instanceId
   * @returns {boolean}
   */
  isConnected(instanceId) {
    return this._connections.has(instanceId);
  }

  /**
   * Send a TCP relay command to the bridge and await its status response.
   *
   * @param {string} instanceId
   * @param {{ host: string, port: number, payload: string }} command
   * @returns {Promise<{ ok: boolean, error?: string }>}
   */
  sendCommand(instanceId, command) {
    const conn = this._connections.get(instanceId);
    if (!conn) {
      return Promise.reject(new Error(`Bridge ${instanceId} is not connected`));
    }

    const requestId = randomUUID();

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(requestId);
        reject(new Error('Bridge command timed out'));
      }, COMMAND_TIMEOUT_MS);

      this._pending.set(requestId, { resolve, reject, timer });

      this._write(conn.res, 'command', {
        type: 'tcp_send',
        requestId,
        host: command.host,
        port: command.port,
        payload: command.payload,
      });
    });
  }

  /**
   * Called by POST /bridge/status when the bridge reports a result.
   * Resolves or rejects the matching pending Promise.
   *
   * @param {string} instanceId
   * @param {{ requestId?: string, type?: string, ok?: boolean, error?: string }} body
   */
  receiveStatus(instanceId, body) {
    // Update last_seen on every POST (heartbeats and results)
    this._db.prepare(
      "UPDATE prod_bridge_instances SET last_seen = datetime('now') WHERE id = ?"
    ).run(instanceId);

    if (!body.requestId) return; // heartbeat or informational

    const pending = this._pending.get(body.requestId);
    if (!pending) return; // timed out or duplicate

    clearTimeout(pending.timer);
    this._pending.delete(body.requestId);

    if (body.ok) {
      pending.resolve({ ok: true });
    } else {
      pending.reject(new Error(body.error || 'Bridge relay failed'));
    }
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  _write(res, event, data) {
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch (err) {
      console.warn(`[bridge] SSE write failed: ${err.message}`);
    }
  }
}
