import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createServer } from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import { SessionStore, makeSessionId } from '../src/store.js';
import { createCaptionsRouter } from '../src/routes/captions.js';
import { createAuthMiddleware } from '../src/middleware/auth.js';

const JWT_SECRET = 'test-captions-secret';

// ---------------------------------------------------------------------------
// Mock sender factory
// ---------------------------------------------------------------------------

function makeMockSender({ sendResult, sendBatchResult, sendError } = {}) {
  const calls = { send: [], sendBatch: [] };
  return {
    calls,
    sequence: 0,
    send: async (text, timestamp) => {
      calls.send.push({ text, timestamp });
      if (sendError) throw new Error(sendError);
      const result = sendResult || {
        sequence: 1,
        timestamp: timestamp instanceof Date ? timestamp.toISOString() : (timestamp || '2026-02-20T12:00:00.000'),
        statusCode: 200,
        serverTimestamp: '2026-02-20T12:00:00.000Z'
      };
      this_sender.sequence = result.sequence;
      return result;
    },
    sendBatch: async (captions) => {
      calls.sendBatch.push(captions);
      if (sendError) throw new Error(sendError);
      const result = sendBatchResult || {
        sequence: captions.length,
        count: captions.length,
        statusCode: 200,
        serverTimestamp: '2026-02-20T12:00:00.000Z'
      };
      this_sender.sequence = result.sequence;
      return result;
    },
    end: async () => {}
  };
}

// ---------------------------------------------------------------------------
// Test app setup
// ---------------------------------------------------------------------------

let server, baseUrl, store;

before(() => new Promise((resolve) => {
  store = new SessionStore({ cleanupInterval: 0 });
  const auth = createAuthMiddleware(JWT_SECRET);

  const app = express();
  app.use(express.json({ limit: '64kb' }));
  app.use('/captions', createCaptionsRouter(store, auth));

  server = createServer(app);
  server.listen(0, () => {
    baseUrl = `http://localhost:${server.address().port}`;
    resolve();
  });
}));

after(() => new Promise((resolve) => {
  store.stopCleanup();
  server.close(resolve);
}));

beforeEach(() => {
  // Clear all sessions
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
      return {
        sequence: captions.length,
        count: captions.length,
        statusCode: 200,
        serverTimestamp: '2026-02-20T12:00:00.000Z'
      };
    },
    end: async () => {}
  };

  const session = store.create({
    apiKey: 'test-key',
    streamKey: 'test-stream',
    domain: 'https://test.com',
    jwt: 'test-jwt',
    sequence: 0,
    syncOffset: 0,
    sender
  });

  // Attach the real sender ref for sequence updates
  sender._session = session;

  return session;
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

  it('should send single caption and return sequence, timestamp, statusCode', async () => {
    const session = createMockSession();
    const token = makeToken(session.sessionId);

    const res = await postCaptions(token, { captions: [{ text: 'Hello world' }] });
    const data = await res.json();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(typeof data.sequence, 'number');
    assert.ok(data.timestamp || data.timestamp === '');
    assert.strictEqual(data.statusCode, 200);
    assert.ok('serverTimestamp' in data);
  });

  it('should send batch captions and return sequence, count, statusCode', async () => {
    const session = createMockSession();
    const token = makeToken(session.sessionId);

    const res = await postCaptions(token, {
      captions: [
        { text: 'Caption one' },
        { text: 'Caption two', timestamp: '2026-02-20T12:00:00.000' }
      ]
    });
    const data = await res.json();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.count, 2);
    assert.strictEqual(data.statusCode, 200);
    assert.ok('serverTimestamp' in data);
  });

  it('should resolve relative time fields to absolute timestamps', async () => {
    const session = createMockSession();
    const token = makeToken(session.sessionId);

    // session.startedAt is set in store.create, session.syncOffset is 0
    const startedAt = session.startedAt;
    const relativeTime = 5000;

    // We need to verify the sender receives a Date for the timestamp
    let capturedTimestamp;
    const origSend = session.sender.send;
    session.sender.send = async (text, timestamp) => {
      capturedTimestamp = timestamp;
      return origSend(text, timestamp);
    };

    await postCaptions(token, {
      captions: [{ text: 'Relative', time: relativeTime }]
    });

    // The route should have resolved time → new Date(startedAt + relativeTime + syncOffset)
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

    await postCaptions(token, {
      captions: [{ text: 'Both', timestamp: '2026-02-20T12:00:00.000', time: 5000 }]
    });

    // timestamp should be used as-is (not resolved via time)
    assert.strictEqual(capturedTimestamp, '2026-02-20T12:00:00.000');
  });

  it('should return 502 when sender throws', async () => {
    const session = createMockSession({ sendError: 'YouTube connection failed' });
    const token = makeToken(session.sessionId);

    const res = await postCaptions(token, { captions: [{ text: 'Fail' }] });
    const data = await res.json();
    assert.strictEqual(res.status, 502);
    assert.ok(data.error);
  });
});
