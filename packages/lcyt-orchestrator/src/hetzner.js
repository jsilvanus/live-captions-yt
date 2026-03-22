// Hetzner API client for burst VM lifecycle
// Uses environment variables:
// - HETZNER_API_TOKEN: required to enable operations
// - HETZNER_API_BASE_URL: optional base URL (for tests / mocks)
// - ORCHESTRATOR_BACKOFF_MS: base backoff ms for 429 handling (default 1000)
// - ORCHESTRATOR_HETZNER_TIMEOUT_MS: poll timeout (ms) default 120000

const DEFAULT_BASE = 'http://api.hetzner.mock/v1';

function missingTokenError() {
  return new Error('HETZNER_API_TOKEN not configured');
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function createHetznerClient() {
  const token = process.env.HETZNER_API_TOKEN;
  if (!token) throw missingTokenError();
  const base = process.env.HETZNER_API_BASE_URL || process.env.HETZNER_API_URL || DEFAULT_BASE;
  const baseBackoff = parseInt(process.env.ORCHESTRATOR_BACKOFF_MS || '1000', 10);

  async function req(path, opts = {}, attempt = 0) {
    const url = `${base.replace(/\/$/, '')}${path}`;
    const headers = Object.assign({}, opts.headers || {}, { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });
    const method = (opts.method || 'GET').toUpperCase();
    const body = opts.body ? JSON.stringify(opts.body) : undefined;

    try {
      const res = await fetch(url, { method, headers, body, signal: opts.signal });
      const txt = await res.text();
      let json = null;
      try { json = txt ? JSON.parse(txt) : null; } catch (e) { json = txt; }
      if (res.status === 429) {
        // rate-limited: respect backoff and retry with exponential backoff
        const backoff = baseBackoff * Math.pow(2, Math.min(attempt, 6));
        await sleep(backoff);
        return req(path, opts, attempt + 1);
      }
      if (!res.ok) {
        const err = new Error(`Hetzner API ${res.status} ${res.statusText}`);
        err.status = res.status;
        err.body = json;
        throw err;
      }
      return json;
    } catch (err) {
      // Network or parse error — for transient errors retry a few times
      if (attempt < 3) {
        const backoff = baseBackoff * Math.pow(2, attempt);
        await sleep(backoff);
        return req(path, opts, attempt + 1);
      }
      throw err;
    }
  }

  async function createBurstServer(snapshotId, serverType = 'cx31', networkId = null, name = null, userData = null) {
    const payload = { server: { name: name || `lcyt-burst-${Date.now().toString(36)}`, server_type: serverType } };
    if (snapshotId) payload.server.image = snapshotId;
    if (networkId) payload.server.networks = [networkId];
    if (userData) payload.server.user_data = userData;
    const json = await req('/servers', { method: 'POST', body: payload });
    // Hetzner returns { server: {...} }
    const server = json && json.server ? json.server : json;
    return { id: server.id || server.server_id || server.name || null, raw: server };
  }

  async function pollServerReady(serverId, timeoutMs = parseInt(process.env.ORCHESTRATOR_HETZNER_TIMEOUT_MS || '120000', 10), intervalMs = 2000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const json = await req(`/servers/${encodeURIComponent(serverId)}`);
      const server = json && json.server ? json.server : json;
      const status = server && (server.status || server.status && server.status.state || server.state) || server;
      // Accept either server.status.state or server.status
      const state = (server && server.status && server.status.state) || server.status || server.state || (server && server.server && server.server.status && server.server.status.state);
      if (state === 'running' || state === 'active') {
        return { id: serverId, ready: true, server };
      }
      await sleep(intervalMs);
    }
    return { id: serverId, ready: false };
  }

  async function deleteServer(serverId) {
    const json = await req(`/servers/${encodeURIComponent(serverId)}`, { method: 'DELETE' });
    return json;
  }

  return { createBurstServer, pollServerReady, deleteServer, _req: req, base };
}

export default { createHetznerClient };
