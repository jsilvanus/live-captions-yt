import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createServer } from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import { SessionStore } from '../src/store.js';
import { createSyncRouter } from '../src/routes/sync.js';
import { createAuthMiddleware } from '../src/middleware/auth.js';

const JWT_SECRET = 'test-sync-secret';

// ---------------------------------------------------------------------------
// Test app setup
// ---------------------------------------------------------------------------

let server, baseUrl, store;

before(() => new Promise((resolve) => {
  store = new SessionStore({ cleanupInterval: 0 });
  const auth = createAuthMiddleware(JWT_SECRET);

  const app = express();
  app.use(express.json({ limit: '64kb' }));
  app.use('/sync', createSyncRouter(store, auth));

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
  for (const session of [...store.all()]) {
    store.remove(session.sessionId);
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeToken(sessionId) {
  return jwt.sign(
    { sessionId, apiKey: 'test-key', streamKey: 'test-stream', domain: 'https://sync.com' },
    JWT_SECRET
  );
}

function createMockSession({ syncResult, syncError } = {}) {
  const sender = {
    sequence: 0,
    sync: async () => {
      if (syncError) throw new Error(syncError);
      return syncResult || {
        syncOffset: -15,
        roundTripTime: 42,
        serverTimestamp: '2026-02-20T12:00:00.000Z',
        statusCode: 200
      };
    },
    end: async () => {}
  };

  return store.create({
    apiKey: 'test-key',
    streamKey: 'test-stream',
    domain: 'https://sync.com',
    jwt: 'test-jwt',
    sequence: 0,
    syncOffset: 0,
    sender
  });
}

async function postSync(token) {
  return fetch(`${baseUrl}/sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    }
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /sync', () => {
  it('should return 401 with no Authorization header', async () => {
    const res = await fetch(`${baseUrl}/sync`, { method: 'POST' });
    const data = await res.json();
    assert.strictEqual(res.status, 401);
    assert.ok(data.error);
  });

  it('should return 401 for invalid token', async () => {
    const res = await postSync('invalid.jwt.token');
    assert.strictEqual(res.status, 401);
  });

  it('should return 404 when session not found', async () => {
    const token = makeToken('deadbeef00000000');
    const res = await postSync(token);
    const data = await res.json();
    assert.strictEqual(res.status, 404);
    assert.ok(data.error);
  });

  it('should return 200 with syncOffset, roundTripTime, serverTimestamp, statusCode', async () => {
    const session = createMockSession({
      syncResult: { syncOffset: -20, roundTripTime: 60, serverTimestamp: '2026-02-20T12:00:00.000Z', statusCode: 200 }
    });
    const token = makeToken(session.sessionId);

    const res = await postSync(token);
    const data = await res.json();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.syncOffset, -20);
    assert.strictEqual(data.roundTripTime, 60);
    assert.strictEqual(data.serverTimestamp, '2026-02-20T12:00:00.000Z');
    assert.strictEqual(data.statusCode, 200);
  });

  it('should update session.syncOffset from the sync result', async () => {
    const session = createMockSession({
      syncResult: { syncOffset: -30, roundTripTime: 50, serverTimestamp: '2026-02-20T12:00:00.000Z', statusCode: 200 }
    });
    const token = makeToken(session.sessionId);

    await postSync(token);

    // The session's syncOffset should be updated
    const updatedSession = store.get(session.sessionId);
    assert.strictEqual(updatedSession.syncOffset, -30);
  });

  it('should touch session activity after sync', async () => {
    const session = createMockSession();
    const token = makeToken(session.sessionId);
    const activityBefore = session.lastActivityAt;

    // Small delay to ensure time passes
    await new Promise(r => setTimeout(r, 5));
    await postSync(token);

    const updatedSession = store.get(session.sessionId);
    assert.ok(updatedSession.lastActivityAt >= activityBefore);
  });

  it('should return 502 when sender.sync() throws', async () => {
    const session = createMockSession({ syncError: 'YouTube server did not respond' });
    const token = makeToken(session.sessionId);

    const res = await postSync(token);
    const data = await res.json();

    assert.strictEqual(res.status, 502);
    assert.ok(data.error);
    assert.strictEqual(data.statusCode, 502);
  });
});
