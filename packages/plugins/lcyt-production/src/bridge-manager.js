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
import { checkIpAllowed, checkCommandAllowed } from './bridge-security.js';

const COMMAND_TIMEOUT_MS = 10_000;
// Local inference on modest hardware can legitimately take 30–120s — a 10s
// timeout would make bridge-relayed Ollama unusable (plan/ai_model_registry).
const MODEL_CALL_TIMEOUT_MS = 120_000;
const HEARTBEAT_INTERVAL_MS = 20_000;

export class BridgeManager {
  /**
   * @param {import('lcyt-backend/db').Db} db
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
   * @returns {Promise<object|null>}
   */
  async authenticate(token) {
    if (!token) return null;
    return (await this._db.prod_bridge_instances.findUnique({ where: { token } })) ?? null;
  }

  /**
   * Register a new SSE connection from a bridge. Kicks any existing connection
   * for the same instance (handles crash-reconnect without manual intervention).
   *
   * @param {string} instanceId
   * @param {object} res  Express response object for the SSE stream
   * @returns {Promise<void>}  resolves once the DB status row is updated (the SSE stream itself is set up synchronously)
   */
  async connect(instanceId, res) {
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
      try { res.write(': heartbeat\n\n'); } catch { this.disconnect(instanceId).catch(() => {}); }
    }, HEARTBEAT_INTERVAL_MS);

    this._connections.set(instanceId, { res, instanceId, heartbeatTimer });

    // Handle client disconnect
    res.on('close', () => { this.disconnect(instanceId).catch((err) => console.warn(`[bridge] disconnect update failed: ${err.message}`)); });

    console.info(`[bridge] Instance ${instanceId} connected`);

    // Update DB status
    await this._db.prod_bridge_instances.updateMany({
      where: { id: instanceId },
      data: { status: 'connected', last_seen: this._db.$util.sqlNow() },
    });
  }

  /**
   * Deregister a bridge connection (called on SSE close or kick).
   * @param {string} instanceId
   */
  async disconnect(instanceId) {
    const conn = this._connections.get(instanceId);
    if (!conn) return;
    clearInterval(conn.heartbeatTimer);
    this._connections.delete(instanceId);
    await this._db.prod_bridge_instances.updateMany({ where: { id: instanceId }, data: { status: 'disconnected' } });
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
   * Send a command to the bridge and await its status response.
   *
   * If `command.type` is set, the command object is sent as-is (with `requestId`
   * added). This allows typed commands such as `{ type: 'atem_switch', host, port, meIndex, inputNumber }`.
   *
   * If `command.type` is absent, falls back to the legacy `tcp_send` shape for
   * backward compatibility: `{ type: 'tcp_send', host, port, payload }`.
   *
   * @param {string} instanceId
   * @param {{ type?: string, host?: string, port?: number, payload?: string, [key: string]: any }} command
   * @param {{ timeoutMs?: number }} [opts] — per-call timeout override;
   *   defaults to 120s for `model_call` (local inference is slow), 10s otherwise
   * @returns {Promise<{ ok: boolean, error?: string }>}
   */
  async sendCommand(instanceId, command, opts = {}) {
    const conn = this._connections.get(instanceId);
    if (!conn) {
      throw new Error(`Bridge ${instanceId} is not connected`);
    }

    const blockReason = await this._checkSecurity(instanceId, command.type ?? 'tcp_send', command);
    if (blockReason) {
      throw new Error(blockReason);
    }

    const requestId = randomUUID();
    const timeoutMs = opts.timeoutMs
      ?? (command.type === 'model_call' ? MODEL_CALL_TIMEOUT_MS : COMMAND_TIMEOUT_MS);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(requestId);
        reject(new Error('Bridge command timed out'));
      }, timeoutMs);

      this._pending.set(requestId, { resolve, reject, timer });

      const event = command.type
        ? { ...command, requestId }
        : { type: 'tcp_send', requestId, host: command.host, port: command.port, payload: command.payload };

      this._write(conn.res, 'command', event);
    });
  }

  /**
   * Called by POST /bridge/status when the bridge reports a result.
   * Resolves or rejects the matching pending Promise.
   *
   * @param {string} instanceId
   * @param {{ requestId?: string, type?: string, ok?: boolean, error?: string }} body
   * @returns {Promise<void>}  resolves once last_seen is updated (a pending command is settled synchronously)
   */
  async receiveStatus(instanceId, body) {
    this._settlePending(body);

    // Update last_seen on every POST (heartbeats and results)
    await this._db.prod_bridge_instances.updateMany({
      where: { id: instanceId },
      data: { last_seen: this._db.$util.sqlNow() },
    });
  }

  _settlePending(body) {
    if (!body.requestId) return; // heartbeat or informational

    const pending = this._pending.get(body.requestId);
    if (!pending) return; // timed out or duplicate

    clearTimeout(pending.timer);
    this._pending.delete(body.requestId);

    if (body.ok) {
      // Pass response payload fields through (e.g. http_request/model_call
      // report { status, body }) — callers like Ollama discovery need them.
      const { requestId, ok, error, type, ...rest } = body;
      pending.resolve({ ok: true, ...rest });
    } else {
      pending.reject(new Error(body.error || 'Bridge relay failed'));
    }
  }

  /**
   * Notify a connected bridge that its security rules changed, so it
   * refetches GET .../security-rules/for-agent promptly instead of waiting
   * out its periodic fallback poll — useful for an operator revoking
   * something mid-show. No-op if the bridge isn't currently connected (it
   * will pick up the change on its next connect-time fetch regardless).
   * @param {string} instanceId
   */
  broadcastRulesUpdated(instanceId) {
    const conn = this._connections.get(instanceId);
    if (!conn) return;
    this._write(conn.res, 'rules_updated', {});
  }

  /**
   * Tell a connected bridge that its tally lights changed, so it refetches
   * GET /tally/bridge/lights. No-op if the bridge isn't connected (it fetches
   * on connect anyway).
   * @param {string} instanceId
   */
  broadcastTallyUpdated(instanceId) {
    const conn = this._connections.get(instanceId);
    if (!conn) return;
    this._write(conn.res, 'tally_updated', {});
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  /**
   * Enforce this bridge's IP/command security policy (bridge-security.js)
   * before a command is ever written to the SSE stream — the authoritative
   * check; lcyt-bridge's security-policy.js duplicates this locally as a
   * second, defense-in-depth layer. Never throws — any error is turned into
   * a block reason, since a caller that awaits sendCommand()'s documented
   * Promise contract must never see a synchronous exception out of it.
   * @returns {Promise<string|null>}  a block reason, or null if allowed
   */
  async _checkSecurity(instanceId, type, command) {
    try {
      for (const target of this._resolveIpTargets(type, command)) {
        const { allowed, reason } = await checkIpAllowed(this._db, instanceId, target.host, target.port);
        if (!allowed) return `Blocked by bridge security policy: ${reason}`;
      }
      if (type === 'tcp_send') {
        const { allowed, reason } = await checkCommandAllowed(this._db, instanceId, command.payload ?? '');
        if (!allowed) return `Blocked by bridge security policy: ${reason}`;
      }
      return null;
    } catch (err) {
      return `Blocked by bridge security policy: ${err.message}`;
    }
  }

  /**
   * @returns {Array<{ host: string, port: number|null }>}  every target the
   *   command would connect to (model_call may fetch both a sourceUrl and
   *   POST to an endpoint — both need to be covered, not just the one the
   *   command is nominally "for"). A target that's missing/unparseable is
   *   simply omitted — that's a validation failure the bridge itself will
   *   surface, not a security-policy concern.
   */
  _resolveIpTargets(type, command) {
    if (type === 'tcp_send' || type === 'obs_switch' || type === 'atem_switch') {
      if (!command.host) return [];
      return [{ host: command.host, port: command.port != null ? Number(command.port) : null }];
    }
    if (type === 'light_set') {
      // The lamp the bridge will talk to: a tally-ma host:port, or a webhook URL.
      const out = command.output;
      if (!out) return [];
      if (out.type === 'tally-ma' && out.host) return [{ host: out.host, port: out.port != null ? Number(out.port) : 21324 }];
      if (out.type === 'webhook' && out.url) return this._resolveIpTargets('http_request', { url: out.url });
      return [];
    }
    if (type === 'http_request' || type === 'model_call') {
      const urls = type === 'http_request'
        ? [command.url]
        : [command.endpoint, command.sourceUrl]; // model_call: POST target + optional image-fetch source
      const targets = [];
      for (const raw of urls) {
        if (!raw) continue;
        try {
          const u = new URL(raw);
          const port = Number(u.port) || (u.protocol === 'https:' ? 443 : 80);
          targets.push({ host: u.hostname.replace(/^\[|\]$/g, ''), port });
        } catch { /* unparseable — not a security-policy concern, skip */ }
      }
      return targets;
    }
    return [];
  }

  _write(res, event, data) {
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch (err) {
      console.warn(`[bridge] SSE write failed: ${err.message}`);
    }
  }
}
