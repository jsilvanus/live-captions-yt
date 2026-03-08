import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createServer } from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import { SessionStore } from '../src/store.js';
import { createMicRouter } from '../src/routes/mic.js';
import { createAuthMiddleware } from '../src/middleware/auth.js';

const JWT_SECRET = 'test-mic-secret';

// ---------------------------------------------------------------------------
// Test app setup
// ---------------------------------------------------------------------------

let server, baseUrl, store;

before(() => new Promise((resolve) => {
  store = new SessionStore({ cleanupInterval: 0 });
  const auth = createAuthMiddleware(JWT_SECRET);

  const app = express();
  app.use(express.json({ limit: '64kb' }));
  app.use('/mic', createMicRouter(store, auth));

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
    { sessionId, apiKey: 'mic-test-key', streamKey: 'test-stream', domain: 'https://mic-test.com' },
    JWT_SECRET
  );
}

function createMockSession() {
  return store.create({
    apiKey: 'mic-test-key',
    streamKey: 'test-stream',
    domain: 'https://mic-test.com',
    jwt: 'test-jwt',
    sequence: 0,
    syncOffset: 0,
    sender: null,
  });
}

async function postMic(token, body) {
  return fetch(`${baseUrl}/mic`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /mic', () => {
  it('should return 401 with no Authorization header', async () => {
    const res = await fetch(`${baseUrl}/mic`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'claim', clientId: 'client-1' }),
    });
    const data = await res.json();
    assert.strictEqual(res.status, 401);
    assert.ok(data.error);
  });

  it('should return 401 for invalid token', async () => {
    const res = await postMic('invalid.jwt.token', { action: 'claim', clientId: 'c1' });
    assert.strictEqual(res.status, 401);
  });

  it('should return 404 when session not found', async () => {
    const token = makeToken('deadbeef-nonexistent');
    const res = await postMic(token, { action: 'claim', clientId: 'c1' });
    const data = await res.json();
    assert.strictEqual(res.status, 404);
    assert.ok(data.error);
  });

  it('should return 400 when clientId is missing', async () => {
    const session = createMockSession();
    const token = makeToken(session.sessionId);
    const res = await postMic(token, { action: 'claim' });
    const data = await res.json();
    assert.strictEqual(res.status, 400);
    assert.ok(data.error.includes('clientId'));
  });

  it('should return 400 when action is invalid', async () => {
    const session = createMockSession();
    const token = makeToken(session.sessionId);
    const res = await postMic(token, { action: 'hold', clientId: 'c1' });
    const data = await res.json();
    assert.strictEqual(res.status, 400);
    assert.ok(data.error.includes('action'));
  });

  it('claim: sets holder and returns ok with holder', async () => {
    const session = createMockSession();
    const token = makeToken(session.sessionId);

    const res = await postMic(token, { action: 'claim', clientId: 'client-alpha' });
    const data = await res.json();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.ok, true);
    assert.strictEqual(data.holder, 'client-alpha');

    // Verify in-memory session is updated
    const updatedSession = store.get(session.sessionId);
    assert.strictEqual(updatedSession.micHolder, 'client-alpha');
  });

  it('claim: overwrites existing holder (soft lock is advisory)', async () => {
    const session = createMockSession();
    const token = makeToken(session.sessionId);

    await postMic(token, { action: 'claim', clientId: 'client-alpha' });
    const res = await postMic(token, { action: 'claim', clientId: 'client-beta' });
    const data = await res.json();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.holder, 'client-beta');
  });

  it('release: clears holder when requester is the current holder', async () => {
    const session = createMockSession();
    const token = makeToken(session.sessionId);

    // First claim
    await postMic(token, { action: 'claim', clientId: 'client-gamma' });

    // Then release
    const res = await postMic(token, { action: 'release', clientId: 'client-gamma' });
    const data = await res.json();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.ok, true);
    assert.strictEqual(data.holder, null);
  });

  it('release: is a no-op when requester is not the current holder', async () => {
    const session = createMockSession();
    const token = makeToken(session.sessionId);

    // client-delta holds the mic
    await postMic(token, { action: 'claim', clientId: 'client-delta' });

    // client-other tries to release — should be ignored
    const res = await postMic(token, { action: 'release', clientId: 'client-other' });
    const data = await res.json();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.holder, 'client-delta');
  });

  it('release: is a no-op when no one holds the mic', async () => {
    const session = createMockSession();
    const token = makeToken(session.sessionId);

    const res = await postMic(token, { action: 'release', clientId: 'client-nobody' });
    const data = await res.json();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.ok, true);
    assert.strictEqual(data.holder, null);
  });

  it('emits mic_state event after claim', async () => {
    const session = createMockSession();
    const token = makeToken(session.sessionId);

    const emittedEvents = [];
    session.emitter.on('mic_state', (payload) => emittedEvents.push(payload));

    await postMic(token, { action: 'claim', clientId: 'event-client' });

    assert.strictEqual(emittedEvents.length, 1);
    assert.strictEqual(emittedEvents[0].holder, 'event-client');
  });

  it('emits mic_state event after release', async () => {
    const session = createMockSession();
    const token = makeToken(session.sessionId);

    await postMic(token, { action: 'claim', clientId: 'release-client' });

    const emittedEvents = [];
    session.emitter.on('mic_state', (payload) => emittedEvents.push(payload));

    await postMic(token, { action: 'release', clientId: 'release-client' });

    assert.strictEqual(emittedEvents.length, 1);
    assert.strictEqual(emittedEvents[0].holder, null);
  });
});
