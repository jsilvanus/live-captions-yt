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
import { SecurityPolicy } from './security-policy.js';

const RECONNECT_DELAY_MS = 5_000;
const RECONNECT_DELAY_MAX_MS = 60_000;
// Fallback refresh in case a rules_updated SSE event is ever missed (proxy
// buffering, brief disconnect). The SSE push keeps this from mattering in
// the common case.
const SECURITY_POLICY_REFRESH_MS = 60_000;
const SECURED_COMMAND_TYPES = new Set(['tcp_send', 'atem_switch', 'obs_switch', 'http_request', 'model_call']);

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
    this._securityPolicy = new SecurityPolicy();
    this._policyFetchSeq = 0;
    this._es = null;
    this._destroyed = false;
    this._reconnectDelay = RECONNECT_DELAY_MS;
    this._reconnectTimer = null;
    this._securityPolicyTimer = setInterval(() => {
      if (!this._destroyed) this._fetchSecurityPolicy();
    }, SECURITY_POLICY_REFRESH_MS);
    this._securityPolicyTimer.unref?.();

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

  /**
   * Start the SSE connection. Also fires the first security-policy fetch
   * immediately, in parallel — it doesn't need an instanceId (the policy
   * endpoint resolves the instance from the bridge token alone), so it
   * doesn't have to wait on the SSE 'connected' event first. This shortens
   * the fail-closed window right after a (re)start to roughly one HTTP
   * round trip instead of "SSE connect, then a separate fetch after that".
   */
  start() {
    this._connect();
    this._fetchSecurityPolicy();
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
    if (this._securityPolicyTimer) clearInterval(this._securityPolicyTimer);
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
      // Extra refresh trigger on (re)connect, on top of start()'s immediate
      // fetch and the periodic/rules_updated ones — cheap, and covers a
      // rules_updated push that arrived while this bridge was disconnected.
      this._fetchSecurityPolicy();
    });

    es.addEventListener('rules_updated', () => {
      this._fetchSecurityPolicy();
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

    if (SECURED_COMMAND_TYPES.has(cmd.type)) {
      const blockReason = this._checkSecurity(cmd.type, cmd);
      if (blockReason) {
        await this._postStatus({ requestId: cmd.requestId, ok: false, error: blockReason });
        this.emit('command:error', { type: cmd.type, error: blockReason });
        return;
      }
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
      const { requestId, sourceUrl, endpoint, model, prompt, outputMode, headers = {}, payload } = cmd;
      try {
        const result = await this._modelCall({ sourceUrl, endpoint, model, prompt, outputMode, headers, payload });
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

  /**
   * Local defense-in-depth check, mirroring BridgeManager._checkSecurity()
   * on the backend (which already ran this before the command was ever put
   * on the SSE stream). Returns a block reason, or null if allowed. Never
   * throws — an error resolving/checking a target is treated as a block.
   */
  _checkSecurity(type, cmd) {
    try {
      for (const target of this._resolveIpTargets(type, cmd)) {
        const { allowed, reason } = this._securityPolicy.checkIp(target.host, target.port);
        if (!allowed) return `Blocked by local bridge security policy: ${reason}`;
      }
      if (type === 'tcp_send') {
        const { allowed, reason } = this._securityPolicy.checkCommand(cmd.payload ?? '');
        if (!allowed) return `Blocked by local bridge security policy: ${reason}`;
      }
      return null;
    } catch (err) {
      return `Blocked by local bridge security policy: ${err.message}`;
    }
  }

  /**
   * @returns {Array<{ host: string, port: number|null }>}  every target the
   *   command would connect to — model_call may both fetch a sourceUrl and
   *   POST to an endpoint, and both need to be covered.
   */
  _resolveIpTargets(type, cmd) {
    if (type === 'tcp_send' || type === 'obs_switch' || type === 'atem_switch') {
      if (!cmd.host) return [];
      return [{ host: cmd.host, port: cmd.port != null ? Number(cmd.port) : null }];
    }
    if (type === 'http_request' || type === 'model_call') {
      const urls = type === 'http_request' ? [cmd.url] : [cmd.endpoint, cmd.sourceUrl];
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

  /**
   * Fetch this bridge's security rules from the backend
   * (GET /production/bridge/security-rules/for-agent, authenticated by
   * bridge token — the instance is resolved from the token, no instanceId
   * needed) and cache them locally. A failure keeps using the last
   * known-good policy — see SecurityPolicy's fail-safe doc comment.
   *
   * Multiple fetches can be in flight at once (start(), the 'connected'
   * event, a rules_updated push, and the fallback timer can all trigger
   * one); a monotonic sequence number guards against a slower, older fetch
   * resolving after a newer one and clobbering it with stale data.
   */
  async _fetchSecurityPolicy() {
    const seq = ++this._policyFetchSeq;
    try {
      const url = `${this._backendUrl}/production/bridge/security-rules/for-agent?token=${encodeURIComponent(this._token)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      if (seq !== this._policyFetchSeq) return; // superseded by a newer fetch
      this._securityPolicy.update(body);
      this.emit('security-policy:updated');
    } catch (err) {
      this.emit('error', new Error(`Security policy fetch failed: ${err.message}`));
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
  async _modelCall({ sourceUrl, endpoint, model, prompt, outputMode, headers = {}, payload: payloadOverride }) {
    if (!endpoint) throw new Error('model_call requires an endpoint');

    let images;
    if (sourceUrl) {
      const imgRes = await fetch(sourceUrl);
      if (!imgRes.ok) throw new Error(`Source fetch failed: ${imgRes.status}`);
      const buf = Buffer.from(await imgRes.arrayBuffer());
      images = [buf.toString('base64')];
    }

    const body = payloadOverride ?? {
      ...(model ? { model } : {}),
      ...(prompt !== undefined ? { prompt } : {}),
      stream: false,
      ...(outputMode === 'json' ? { format: 'json' } : {}),
      ...(images ? { images } : {}),
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
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
