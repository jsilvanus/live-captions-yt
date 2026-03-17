/**
 * Tests for GET /events — the authenticated SSE delivery-result stream.
 *
 * Covers:
 *   - 401 when no token is provided
 *   - 401 when an invalid/expired JWT is provided
 *   - 401 for a malformed Authorization header
 *   - 404 when the session does not exist
 *   - Token accepted via Authorization: Bearer header
 *   - Token accepted via ?token= query parameter
 *   - SSE headers set correctly (Content-Type, Cache-Control, X-Accel-Buffering)
 *   - 'connected' event emitted immediately on subscribe (includes sessionId + micHolder)
 *   - 'caption_result' event forwarded from session.emitter
 *   - 'caption_error' event forwarded from session.emitter
 *   - 'mic_state' event forwarded from session.emitter
 *   - 'session_closed' event ends the SSE stream
 *   - Client disconnect cleans up emitter listeners (no memory leak)
 *   - Integration: POST /captions → caption_result appears on /events stream
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import { EventEmitter } from 'node:events';
import { initDb, createKey } from '../src/db.js';
import { SessionStore } from '../src/store.js';
import { createEventsRouter } from '../src/routes/events.js';
import { createCaptionsRouter } from '../src/routes/captions.js';
import { createAuthMiddleware } from '../src/middleware/auth.js';
import { createLiveRouter } from '../src/routes/live.js';

const JWT_SECRET = 'test-events-secret';
const SSE_SETTLE_MS = 80; // time to wait for SSE connection to be registered

// ---------------------------------------------------------------------------
// Test app
// ---------------------------------------------------------------------------

let server, baseUrl, store, db;

before(() => new Promise((resolve) => {
  db = initDb(':memory:');
  createKey(db, { key: 'test-api-key', owner: 'Events Test' });

  store = new SessionStore({ cleanupInterval: 0 });
  const auth = createAuthMiddleware(JWT_SECRET);

  const app = express();
  app.use(express.json({ limit: '64kb' }));
  app.use('/events', createEventsRouter(store, JWT_SECRET));
  app.use('/captions', createCaptionsRouter(store, auth, db));
  app.use('/live', createLiveRouter(db, store, JWT_SECRET));

  server = createServer(app);
  server.listen(0, () => {
    baseUrl = `http://localhost:${server.address().port}`;
    resolve();
  });
}));

after(() => new Promise((resolve) => {
  store.stopCleanup();
  db.close();
  server.close(resolve);
}));

beforeEach(() => {
  for (const session of [...store.all()]) {
    store.remove(session.sessionId);
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(overrides = {}) {
  return store.create({
    apiKey: 'test-api-key',
    domain: 'https://test.example.com',
    jwt: 'unused',
    sequence: 0,
    syncOffset: 0,
    sender: null,
    extraTargets: [],
    ...overrides,
  });
}

function makeToken(sessionId) {
  return jwt.sign(
    { sessionId, apiKey: 'test-api-key', domain: 'https://test.example.com' },
    JWT_SECRET,
  );
}

/**
 * Collect up to `count` SSE events from a URL.
 * Resolves after `count` events or `timeout` ms.
 */
async function collectSseEvents(url, count = 1, timeout = 2000, headers = {}) {
  const events = [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  let res;
  try {
    res = await fetch(url, { signal: controller.signal, headers });
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') return events;
    throw err;
  }

  if (!res.ok && res.status !== 200) {
    clearTimeout(timer);
    return { status: res.status, json: await res.json().catch(() => null) };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (events.length < count) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const parts = buffer.split('\n\n');
      buffer = parts.pop();

      for (const part of parts) {
        if (!part.trim()) continue;
        const lines = part.split('\n');
        const eventType = lines.find(l => l.startsWith('event:'))?.slice(6).trim() ?? 'message';
        const dataLine = lines.find(l => l.startsWith('data:'));
        if (!dataLine) continue;
        const rawData = dataLine.slice(5).trim();
        try {
          events.push({ type: eventType, data: JSON.parse(rawData) });
        } catch {
          events.push({ type: eventType, data: rawData });
        }
        if (events.length >= count) break;
      }
    }
  } catch (err) {
    if (err.name !== 'AbortError') throw err;
  } finally {
    clearTimeout(timer);
    reader.cancel().catch(() => {});
  }

  return events;
}

// ---------------------------------------------------------------------------
// Authentication — rejected cases
// ---------------------------------------------------------------------------

describe('GET /events — auth rejections', () => {
  it('returns 401 when no token is provided', async () => {
    const res = await fetch(`${baseUrl}/events`);
    assert.equal(res.status, 401);
    const data = await res.json();
    assert.ok(data.error);
  });

  it('returns 401 when Authorization header has wrong prefix', async () => {
    const res = await fetch(`${baseUrl}/events`, {
      headers: { Authorization: 'Token notabearer' },
    });
    assert.equal(res.status, 401);
  });

  it('returns 401 for an invalid JWT (wrong secret)', async () => {
    const badToken = jwt.sign({ sessionId: 'x' }, 'wrong-secret');
    const res = await fetch(`${baseUrl}/events`, {
      headers: { Authorization: `Bearer ${badToken}` },
    });
    assert.equal(res.status, 401);
    const data = await res.json();
    assert.ok(data.error);
  });

  it('returns 401 for an expired JWT', async () => {
    const expiredToken = jwt.sign({ sessionId: 'x' }, JWT_SECRET, { expiresIn: -1 });
    const res = await fetch(`${baseUrl}/events`, {
      headers: { Authorization: `Bearer ${expiredToken}` },
    });
    assert.equal(res.status, 401);
  });

  it('returns 401 for a malformed token string', async () => {
    const res = await fetch(`${baseUrl}/events`, {
      headers: { Authorization: 'Bearer not.a.jwt' },
    });
    assert.equal(res.status, 401);
  });
});

// ---------------------------------------------------------------------------
// Authentication — accepted via ?token= query param
// ---------------------------------------------------------------------------

describe('GET /events — ?token= query parameter', () => {
  it('accepts token via ?token= and opens SSE stream', async () => {
    const session = makeSession();
    const token = makeToken(session.sessionId);
    const url = `${baseUrl}/events?token=${encodeURIComponent(token)}`;

    const events = await collectSseEvents(url, 1, 1500);
    assert.ok(Array.isArray(events), 'should get events array');
    assert.ok(events.length >= 1);
    assert.equal(events[0].type, 'connected');
  });
});

// ---------------------------------------------------------------------------
// 404 — session not found
// ---------------------------------------------------------------------------

describe('GET /events — session not found', () => {
  it('returns 404 when the session does not exist in the store', async () => {
    const token = jwt.sign(
      { sessionId: 'non-existent-session-id', apiKey: 'test-api-key', domain: 'https://x.com' },
      JWT_SECRET,
    );
    const res = await fetch(`${baseUrl}/events`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 404);
    const data = await res.json();
    assert.ok(data.error);
  });
});

// ---------------------------------------------------------------------------
// SSE headers
// ---------------------------------------------------------------------------

describe('GET /events — SSE response headers', () => {
  it('sets Content-Type: text/event-stream', async () => {
    const session = makeSession();
    const token = makeToken(session.sessionId);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 500);

    let contentType;
    try {
      const res = await fetch(`${baseUrl}/events`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      contentType = res.headers.get('content-type');
      res.body?.cancel();
    } catch { /* AbortError */ }

    assert.ok(contentType?.includes('text/event-stream'), `got: ${contentType}`);
  });

  it('sets Cache-Control: no-cache', async () => {
    const session = makeSession();
    const token = makeToken(session.sessionId);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 500);

    let cacheControl;
    try {
      const res = await fetch(`${baseUrl}/events`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      cacheControl = res.headers.get('cache-control');
      res.body?.cancel();
    } catch { /* AbortError */ }

    assert.ok(cacheControl?.includes('no-cache'), `got: ${cacheControl}`);
  });

  it('sets X-Accel-Buffering: no', async () => {
    const session = makeSession();
    const token = makeToken(session.sessionId);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 500);

    let xAccel;
    try {
      const res = await fetch(`${baseUrl}/events`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      xAccel = res.headers.get('x-accel-buffering');
      res.body?.cancel();
    } catch { /* AbortError */ }

    assert.equal(xAccel, 'no');
  });
});

// ---------------------------------------------------------------------------
// 'connected' event
// ---------------------------------------------------------------------------

describe('GET /events — connected event', () => {
  it('sends a "connected" event immediately after subscribing', async () => {
    const session = makeSession();
    const token = makeToken(session.sessionId);

    const events = await collectSseEvents(
      `${baseUrl}/events`,
      1,
      1500,
      { Authorization: `Bearer ${token}` },
    );

    assert.ok(Array.isArray(events));
    assert.equal(events[0].type, 'connected');
    assert.equal(events[0].data.sessionId, session.sessionId);
  });

  it('connected event includes micHolder: null when no mic is held', async () => {
    const session = makeSession();
    const token = makeToken(session.sessionId);

    const events = await collectSseEvents(
      `${baseUrl}/events`,
      1,
      1500,
      { Authorization: `Bearer ${token}` },
    );

    assert.equal(events[0].data.micHolder, null);
  });

  it('connected event includes micHolder from session when a mic is held', async () => {
    const session = makeSession();
    session.micHolder = 'client-abc'; // set after creation; store.create() always initialises to null
    const token = makeToken(session.sessionId);

    const events = await collectSseEvents(
      `${baseUrl}/events`,
      1,
      1500,
      { Authorization: `Bearer ${token}` },
    );

    assert.equal(events[0].data.micHolder, 'client-abc');
  });
});

// ---------------------------------------------------------------------------
// Event forwarding — caption_result, caption_error, mic_state
// ---------------------------------------------------------------------------

describe('GET /events — event forwarding', () => {
  it('forwards "caption_result" emitted on session.emitter', async () => {
    const session = makeSession();
    const token = makeToken(session.sessionId);

    // connected + caption_result = 2 events
    const ssePromise = collectSseEvents(
      `${baseUrl}/events`,
      2,
      2000,
      { Authorization: `Bearer ${token}` },
    );

    await new Promise(r => setTimeout(r, SSE_SETTLE_MS));

    session.emitter.emit('caption_result', {
      requestId: 'rq-1',
      sequence: 5,
      statusCode: 200,
      serverTimestamp: '2026-01-01T12:00:00.000',
    });

    const events = await ssePromise;
    const resultEvent = events.find(e => e.type === 'caption_result');
    assert.ok(resultEvent, 'should receive caption_result event');
    assert.equal(resultEvent.data.requestId, 'rq-1');
    assert.equal(resultEvent.data.sequence, 5);
    assert.equal(resultEvent.data.statusCode, 200);
  });

  it('forwards "caption_error" emitted on session.emitter', async () => {
    const session = makeSession();
    const token = makeToken(session.sessionId);

    const ssePromise = collectSseEvents(
      `${baseUrl}/events`,
      2,
      2000,
      { Authorization: `Bearer ${token}` },
    );

    await new Promise(r => setTimeout(r, SSE_SETTLE_MS));

    session.emitter.emit('caption_error', {
      requestId: 'rq-err',
      error: 'YouTube rejected',
      statusCode: 400,
    });

    const events = await ssePromise;
    const errEvent = events.find(e => e.type === 'caption_error');
    assert.ok(errEvent, 'should receive caption_error event');
    assert.equal(errEvent.data.requestId, 'rq-err');
    assert.equal(errEvent.data.statusCode, 400);
  });

  it('forwards "mic_state" emitted on session.emitter', async () => {
    const session = makeSession();
    const token = makeToken(session.sessionId);

    const ssePromise = collectSseEvents(
      `${baseUrl}/events`,
      2,
      2000,
      { Authorization: `Bearer ${token}` },
    );

    await new Promise(r => setTimeout(r, SSE_SETTLE_MS));

    session.emitter.emit('mic_state', { holder: 'client-xyz' });

    const events = await ssePromise;
    const micEvent = events.find(e => e.type === 'mic_state');
    assert.ok(micEvent, 'should receive mic_state event');
    assert.equal(micEvent.data.holder, 'client-xyz');
  });
});

// ---------------------------------------------------------------------------
// session_closed — stream ends
// ---------------------------------------------------------------------------

describe('GET /events — session_closed ends the stream', () => {
  it('emits "session_closed" event and closes the response', async () => {
    const session = makeSession();
    const token = makeToken(session.sessionId);

    // connected + session_closed = 2 events, then stream ends
    const ssePromise = collectSseEvents(
      `${baseUrl}/events`,
      2,
      2000,
      { Authorization: `Bearer ${token}` },
    );

    await new Promise(r => setTimeout(r, SSE_SETTLE_MS));

    session.emitter.emit('session:closed');

    const events = await ssePromise;
    const closedEvent = events.find(e => e.type === 'session_closed');
    assert.ok(closedEvent, 'should receive session_closed event');
  });
});

// ---------------------------------------------------------------------------
// Listener cleanup on client disconnect
// ---------------------------------------------------------------------------

describe('GET /events — listener cleanup on disconnect', () => {
  it('removes emitter listeners after the SSE client disconnects', async () => {
    const session = makeSession();
    const token = makeToken(session.sessionId);

    const controller = new AbortController();
    const fetchPromise = fetch(`${baseUrl}/events`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });

    // Wait for connection to be established
    await new Promise(r => setTimeout(r, SSE_SETTLE_MS * 2));

    const listenersBefore = session.emitter.listenerCount('caption_result');
    assert.ok(listenersBefore >= 1, 'should have listener before disconnect');

    // Abort the client connection
    controller.abort();
    try { await fetchPromise; } catch { /* AbortError */ }

    // Give the server time to process the close event
    await new Promise(r => setTimeout(r, SSE_SETTLE_MS));

    const listenersAfter = session.emitter.listenerCount('caption_result');
    assert.equal(listenersAfter, 0, 'all listeners should be removed after client disconnect');
  });
});

// ---------------------------------------------------------------------------
// Integration: POST /captions → caption_result on /events
// ---------------------------------------------------------------------------

describe('Integration — POST /captions → caption_result on /events', () => {
  it('delivers a caption_result SSE event after POST /captions in viewer-only session', async () => {
    // Create a session with a viewer target (no YouTube sender) so caption
    // delivery is purely internal and doesn't require network access.
    const session = store.create({
      apiKey: 'test-api-key',
      domain: 'https://test.example.com',
      jwt: 'unused',
      sequence: 0,
      syncOffset: 0,
      sender: null,
      extraTargets: [{ id: 'v1', type: 'viewer', viewerKey: 'integration-events-test' }],
    });

    const token = makeToken(session.sessionId);

    // connected + caption_result = 2 events
    const ssePromise = collectSseEvents(
      `${baseUrl}/events`,
      2,
      3000,
      { Authorization: `Bearer ${token}` },
    );

    await new Promise(r => setTimeout(r, SSE_SETTLE_MS));

    const captionRes = await fetch(`${baseUrl}/captions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ captions: [{ text: 'Integration test caption' }] }),
    });
    assert.equal(captionRes.status, 202);

    const events = await ssePromise;
    const resultEvent = events.find(e => e.type === 'caption_result');
    assert.ok(resultEvent, 'should receive caption_result after POST /captions');
  });
});
