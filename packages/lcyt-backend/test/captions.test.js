import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createServer } from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import { initDb, createKey } from '../src/db.js';
import { SessionStore, makeSessionId } from '../src/store.js';
import { createCaptionsRouter } from '../src/routes/captions.js';
import { createAuthMiddleware } from '../src/middleware/auth.js';

const JWT_SECRET = 'test-captions-secret';

// ---------------------------------------------------------------------------
// Test app setup
// ---------------------------------------------------------------------------

let server, baseUrl, store, db;

before(() => new Promise((resolve) => {
  db = initDb(':memory:');
  // Create the test API key with no limits so usage checks pass
  createKey(db, { key: 'test-key', owner: 'Test User' });

  store = new SessionStore({ cleanupInterval: 0 });
  const auth = createAuthMiddleware(JWT_SECRET);

  const app = express();
  app.use(express.json({ limit: '64kb' }));
  app.use('/captions', createCaptionsRouter(store, auth, db));

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

function makeToken(sessionId) {
  return jwt.sign(
    { sessionId, apiKey: 'test-key', streamKey: 'test-stream', domain: 'https://test.com' },
    JWT_SECRET
  );
}

function createMockSession({ sendError } = {}) {
  const sender = {
    sequence: 0,
    send: async (text, timestamp) => {
      if (sendError) throw new Error(sendError);
      sender.sequence = 1;
      return {
        sequence: 1,
        timestamp: timestamp instanceof Date
          ? timestamp.toISOString().slice(0, 23)
          : (timestamp || '2026-02-20T12:00:00.000'),
        statusCode: 200,
        serverTimestamp: '2026-02-20T12:00:00.000Z'
      };
    },
    sendBatch: async (captions) => {
      if (sendError) throw new Error(sendError);
      sender.sequence = captions.length;
      return {
        sequence: captions.length,
        count: captions.length,
        statusCode: 200,
        serverTimestamp: '2026-02-20T12:00:00.000Z'
      };
    },
    end: async () => {}
  };

  return store.create({
    apiKey: 'test-key',
    streamKey: 'test-stream',
    domain: 'https://test.com',
    jwt: 'test-jwt',
    sequence: 0,
    syncOffset: 0,
    sender
  });
}

async function postCaptions(token, body) {
  return fetch(`${baseUrl}/captions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(body)
  });
}

// Wait for a named event on a session emitter (with timeout)
function waitForEvent(session, eventName, timeout = 500) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for session emitter event: ${eventName}`)),
      timeout
    );
    session.emitter.once(eventName, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /captions', () => {
  it('should return 401 when no Authorization header', async () => {
    const res = await fetch(`${baseUrl}/captions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ captions: [{ text: 'Hello' }] })
    });
    assert.strictEqual(res.status, 401);
  });

  it('should return 401 for invalid token', async () => {
    const res = await postCaptions('bad.token', { captions: [{ text: 'Hello' }] });
    assert.strictEqual(res.status, 401);
  });

  it('should return 400 when captions is missing', async () => {
    const session = createMockSession();
    const token = makeToken(session.sessionId);

    const res = await postCaptions(token, {});
    const data = await res.json();
    assert.strictEqual(res.status, 400);
    assert.ok(data.error);
  });

  it('should return 400 when captions is empty array', async () => {
    const session = createMockSession();
    const token = makeToken(session.sessionId);

    const res = await postCaptions(token, { captions: [] });
    const data = await res.json();
    assert.strictEqual(res.status, 400);
    assert.ok(data.error);
  });

  it('should return 404 when session not found', async () => {
    const token = makeToken('deadbeef00000000');
    const res = await postCaptions(token, { captions: [{ text: 'Hello' }] });
    const data = await res.json();
    assert.strictEqual(res.status, 404);
    assert.ok(data.error);
  });

  it('should return 202 with ok and requestId for a single caption', async () => {
    const session = createMockSession();
    const token = makeToken(session.sessionId);

    const res = await postCaptions(token, { captions: [{ text: 'Hello world' }] });
    const data = await res.json();

    assert.strictEqual(res.status, 202);
    assert.strictEqual(data.ok, true);
    assert.strictEqual(typeof data.requestId, 'string');
    assert.ok(data.requestId.length > 0);
  });

  it('should emit caption_result with sequence and statusCode after single caption send', async () => {
    const session = createMockSession();
    const token = makeToken(session.sessionId);

    const eventPromise = waitForEvent(session, 'caption_result');
    const res = await postCaptions(token, { captions: [{ text: 'Hello world' }] });
    const data = await res.json();

    const event = await eventPromise;
    assert.strictEqual(event.requestId, data.requestId);
    assert.strictEqual(typeof event.sequence, 'number');
    assert.strictEqual(event.statusCode, 200);
    assert.ok('serverTimestamp' in event);
  });

  it('should return 202 and emit caption_result with count for batch captions', async () => {
    const session = createMockSession();
    const token = makeToken(session.sessionId);

    const eventPromise = waitForEvent(session, 'caption_result');
    const res = await postCaptions(token, {
      captions: [
        { text: 'Caption one' },
        { text: 'Caption two', timestamp: '2026-02-20T12:00:00.000' }
      ]
    });
    const data = await res.json();

    assert.strictEqual(res.status, 202);
    assert.strictEqual(data.ok, true);

    const event = await eventPromise;
    assert.strictEqual(event.requestId, data.requestId);
    assert.strictEqual(event.count, 2);
    assert.strictEqual(event.statusCode, 200);
  });

  it('should resolve relative time fields to absolute timestamps', async () => {
    const session = createMockSession();
    const token = makeToken(session.sessionId);

    const startedAt = session.startedAt;
    const relativeTime = 5000;

    let capturedTimestamp;
    const origSend = session.sender.send;
    session.sender.send = async (text, timestamp) => {
      capturedTimestamp = timestamp;
      return origSend(text, timestamp);
    };

    const eventPromise = waitForEvent(session, 'caption_result');
    await postCaptions(token, { captions: [{ text: 'Relative', time: relativeTime }] });
    await eventPromise; // wait for background send to complete

    assert.ok(capturedTimestamp instanceof Date);
    const expectedMs = startedAt + relativeTime + 0; // syncOffset = 0
    assert.ok(Math.abs(capturedTimestamp.getTime() - expectedMs) < 100);
  });

  it('should prefer timestamp over time when both provided', async () => {
    const session = createMockSession();
    const token = makeToken(session.sessionId);

    let capturedTimestamp;
    const origSend = session.sender.send;
    session.sender.send = async (text, timestamp) => {
      capturedTimestamp = timestamp;
      return origSend(text, timestamp);
    };

    const eventPromise = waitForEvent(session, 'caption_result');
    await postCaptions(token, {
      captions: [{ text: 'Both', timestamp: '2026-02-20T12:00:00.000', time: 5000 }]
    });
    await eventPromise;

    assert.strictEqual(capturedTimestamp, '2026-02-20T12:00:00.000');
  });

  it('should emit caption_error (not reject the HTTP request) when sender throws', async () => {
    const session = createMockSession({ sendError: 'YouTube connection failed' });
    const token = makeToken(session.sessionId);

    const eventPromise = waitForEvent(session, 'caption_error');
    const res = await postCaptions(token, { captions: [{ text: 'Fail' }] });
    const data = await res.json();

    // HTTP response is still 202 — error travels via SSE
    assert.strictEqual(res.status, 202);
    assert.strictEqual(data.ok, true);

    const event = await eventPromise;
    assert.strictEqual(event.requestId, data.requestId);
    assert.ok(event.error);
    assert.strictEqual(event.statusCode, 502);
  });
});
