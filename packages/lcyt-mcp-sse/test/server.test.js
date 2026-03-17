/**
 * Tests for the HTTP routes defined in lcyt-mcp-sse/src/server.js.
 *
 * To avoid importing server.js (which starts a persistent HTTP server that
 * would keep the test process alive), we replicate the route logic in a local
 * Express test app — the same pattern used by speech.test.js.
 *
 * Routes tested:
 *   POST /messages  — returns 404 when sessionId is not in the transports map
 *   GET  /sse       — returns 401 when REQUIRE_API_KEY is set and no key provided
 *                     returns 200 text/event-stream otherwise
 *   POST /messages  — delegates to transport.handlePostMessage when session exists
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';

// ── Replication of the POST /messages route ────────────────────────────────

const transports = new Map();

const app = express();
app.use(express.json());

// POST /messages — exact copy of the route logic from server.js
app.post('/messages', async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = transports.get(sessionId);
  if (!transport) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  await transport.handlePostMessage(req, res);
});

// GET /sse — auth guard logic from server.js (db=null path, REQUIRE_API_KEY flag)
function makeSseRoute(requireApiKey = false) {
  return (req, res) => {
    // db is null in tests, so `provided` is always null
    const provided = null;
    if (!provided && requireApiKey) {
      res.status(401).json({ error: 'X-Api-Key header required' });
      return;
    }
    // Minimal SSE response (no actual MCP handshake in this test)
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.status(200).end();
  };
}

app.get('/sse-open', makeSseRoute(false));
app.get('/sse-gated', makeSseRoute(true));

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

// ── POST /messages ────────────────────────────────────────────────────────────

describe('POST /messages — session not found', () => {
  it('returns 404 when sessionId query param is missing', async () => {
    const res = await postJson('/messages');
    assert.equal(res.status, 404);
  });

  it('returns 404 for an unknown sessionId', async () => {
    const res = await postJson('/messages?sessionId=does-not-exist');
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, 'Session not found');
  });
});

describe('POST /messages — known session', () => {
  it('delegates to transport.handlePostMessage for a known session', async () => {
    const fakeSessionId = 'test-session-001';
    let delegated = false;
    transports.set(fakeSessionId, {
      async handlePostMessage(req, res) {
        delegated = true;
        res.status(200).json({ ok: true });
      },
    });

    const res = await postJson(`/messages?sessionId=${fakeSessionId}`, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    assert.equal(res.status, 200);
    assert.equal(delegated, true);
    transports.delete(fakeSessionId);
  });
});

// ── GET /sse — auth guard ─────────────────────────────────────────────────────

describe('GET /sse — no API key required', () => {
  it('returns 200 with text/event-stream content-type when auth is not required', async () => {
    const res = await fetch(`${baseUrl}/sse-open`);
    assert.equal(res.status, 200);
    assert.ok(
      res.headers.get('content-type')?.startsWith('text/event-stream'),
      `expected text/event-stream, got ${res.headers.get('content-type')}`
    );
  });
});

describe('GET /sse — API key required', () => {
  it('returns 401 when X-Api-Key is missing and REQUIRE_API_KEY is set', async () => {
    const res = await fetch(`${baseUrl}/sse-gated`);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error, 'X-Api-Key header required');
  });
});

// ── Session map isolation ─────────────────────────────────────────────────────

describe('transports map', () => {
  it('different sessions are independent', async () => {
    const id1 = 'session-a';
    const id2 = 'session-b';

    const calls = [];
    transports.set(id1, {
      async handlePostMessage(req, res) { calls.push('a'); res.json({ ok: true }); }
    });
    transports.set(id2, {
      async handlePostMessage(req, res) { calls.push('b'); res.json({ ok: true }); }
    });

    await postJson(`/messages?sessionId=${id1}`, {});
    await postJson(`/messages?sessionId=${id2}`, {});
    await postJson('/messages?sessionId=unknown', {});

    assert.deepEqual(calls, ['a', 'b']);

    transports.delete(id1);
    transports.delete(id2);
  });
});
