/**
 * Tests for the HTTP routes defined in lcyt-mcp-http/src/server.js.
 *
 * To avoid importing server.js (which starts a persistent HTTP server that
 * would keep the test process alive), we replicate the route logic in a local
 * Express test app — the same pattern used by speech.test.js.
 *
 * Routes tested:
 *   POST   /mcp  — returns 400 when no session id and not an initialize request
 *                  returns 400 (via auth guard) when REQUIRE_API_KEY is set and no key provided
 *                  delegates to transport.handleRequest when session exists
 *   GET    /mcp  — returns 400 when Mcp-Session-Id is missing/unknown
 *   DELETE /mcp  — returns 400 when Mcp-Session-Id is missing/unknown
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

// ── Replication of the /mcp routes from server.js ──────────────────────────

const transports = new Map();

const app = express();
app.use(express.json());

function authenticate(req, res, requireApiKey) {
  if (requireApiKey) {
    res.status(401).json({ error: 'X-Api-Key header required' });
    return { ok: false };
  }
  return { ok: true, apiKey: null };
}

function makeMcpPostRoute(requireApiKey = false) {
  return async (req, res) => {
    const sessionId = req.headers['mcp-session-id'];
    let transport;

    if (sessionId && transports.has(sessionId)) {
      transport = transports.get(sessionId);
    } else if (!sessionId && isInitializeRequest(req.body)) {
      const auth = authenticate(req, res, requireApiKey);
      if (!auth.ok) return;
      // No real transport in this test — simulate session creation.
      res.status(200).json({ ok: true, initialized: true });
      return;
    } else {
      res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
        id: null,
      });
      return;
    }

    await transport.handleRequest(req, res, req.body);
  };
}

async function handleSessionRequest(req, res) {
  const sessionId = req.headers['mcp-session-id'];
  const transport = sessionId ? transports.get(sessionId) : undefined;
  if (!transport) {
    res.status(400).json({ error: 'Invalid or missing session ID' });
    return;
  }
  await transport.handleRequest(req, res);
}

app.post('/mcp-open', makeMcpPostRoute(false));
app.post('/mcp-gated', makeMcpPostRoute(true));
app.get('/mcp-open', handleSessionRequest);
app.delete('/mcp-open', handleSessionRequest);

// ── HTTP server lifecycle ─────────────────────────────────────────────────

let server;
let baseUrl;

before(
  () =>
    new Promise(resolve => {
      server = createServer(app);
      server.listen(0, '127.0.0.1', () => {
        const { port } = server.address();
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    })
);

after(
  () =>
    new Promise(resolve => {
      server.close(() => resolve());
    })
);

// ── Helpers ──────────────────────────────────────────────────────────────────

async function postJson(path, body = {}, headers = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

const INITIALIZE_BODY = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test-client', version: '1.0.0' },
  },
};

// ── POST /mcp — no session id, not initialize ─────────────────────────────────

describe('POST /mcp — bad request', () => {
  it('returns 400 when no Mcp-Session-Id header and not an initialize request', async () => {
    const res = await postJson('/mcp-open', { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error.message, 'Bad Request: No valid session ID provided');
  });

  it('returns 400 for an unknown Mcp-Session-Id', async () => {
    const res = await postJson('/mcp-open', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { 'mcp-session-id': 'does-not-exist' });
    assert.equal(res.status, 400);
  });
});

// ── POST /mcp — initialize ─────────────────────────────────────────────────────

describe('POST /mcp — initialize request', () => {
  it('starts a new session when no Mcp-Session-Id is provided', async () => {
    const res = await postJson('/mcp-open', INITIALIZE_BODY);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.initialized, true);
  });

  it('returns 401 when REQUIRE_API_KEY is set and no key provided', async () => {
    const res = await postJson('/mcp-gated', INITIALIZE_BODY);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error, 'X-Api-Key header required');
  });
});

describe('POST /mcp — known session', () => {
  it('delegates to transport.handleRequest for a known session', async () => {
    const fakeSessionId = 'test-session-001';
    let delegated = false;
    transports.set(fakeSessionId, {
      async handleRequest(req, res) {
        delegated = true;
        res.status(200).json({ ok: true });
      },
    });

    const res = await postJson('/mcp-open', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { 'mcp-session-id': fakeSessionId });
    assert.equal(res.status, 200);
    assert.equal(delegated, true);
    transports.delete(fakeSessionId);
  });
});

// ── GET /mcp / DELETE /mcp — session lookup ────────────────────────────────────

describe('GET /mcp — session guard', () => {
  it('returns 400 when Mcp-Session-Id is missing', async () => {
    const res = await fetch(`${baseUrl}/mcp-open`);
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, 'Invalid or missing session ID');
  });

  it('delegates to transport.handleRequest for a known session', async () => {
    const fakeSessionId = 'test-session-002';
    let delegated = false;
    transports.set(fakeSessionId, {
      async handleRequest(req, res) {
        delegated = true;
        res.status(200).end();
      },
    });

    const res = await fetch(`${baseUrl}/mcp-open`, { headers: { 'mcp-session-id': fakeSessionId } });
    assert.equal(res.status, 200);
    assert.equal(delegated, true);
    transports.delete(fakeSessionId);
  });
});

describe('DELETE /mcp — session guard', () => {
  it('returns 400 when Mcp-Session-Id is unknown', async () => {
    const res = await fetch(`${baseUrl}/mcp-open`, { method: 'DELETE', headers: { 'mcp-session-id': 'unknown' } });
    assert.equal(res.status, 400);
  });
});

// ── Session map isolation ─────────────────────────────────────────────────────

describe('transports map', () => {
  it('different sessions are independent', async () => {
    const id1 = 'session-a';
    const id2 = 'session-b';

    const calls = [];
    transports.set(id1, {
      async handleRequest(req, res) { calls.push('a'); res.json({ ok: true }); }
    });
    transports.set(id2, {
      async handleRequest(req, res) { calls.push('b'); res.json({ ok: true }); }
    });

    await postJson('/mcp-open', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { 'mcp-session-id': id1 });
    await postJson('/mcp-open', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { 'mcp-session-id': id2 });
    await postJson('/mcp-open', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { 'mcp-session-id': 'unknown' });

    assert.deepEqual(calls, ['a', 'b']);

    transports.delete(id1);
    transports.delete(id2);
  });
});
