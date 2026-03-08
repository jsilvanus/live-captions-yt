import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createServer } from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import { initDb, createKey } from '../src/db.js';
import { SessionStore } from '../src/store.js';
import { createStatsRouter } from '../src/routes/stats.js';
import { createAuthMiddleware } from '../src/middleware/auth.js';

const JWT_SECRET = 'test-stats-secret';

// ---------------------------------------------------------------------------
// Test app setup
// ---------------------------------------------------------------------------

let server, baseUrl, store, db;

before(() => new Promise((resolve) => {
  db = initDb(':memory:');
  createKey(db, { key: 'stats-test-key', owner: 'Stats User', email: 'stats@example.com' });

  store = new SessionStore({ cleanupInterval: 0 });
  const auth = createAuthMiddleware(JWT_SECRET);

  const app = express();
  app.use(express.json({ limit: '64kb' }));
  app.use('/stats', createStatsRouter(db, auth, store));

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

function makeToken(sessionId, apiKey = 'stats-test-key') {
  return jwt.sign(
    { sessionId, apiKey, streamKey: 'test-stream', domain: 'https://stats-test.com' },
    JWT_SECRET
  );
}

function createMockSession(apiKey = 'stats-test-key') {
  return store.create({
    apiKey,
    streamKey: 'test-stream',
    domain: 'https://stats-test.com',
    jwt: 'test-jwt',
    sequence: 5,
    syncOffset: 0,
    sender: { end: async () => {} }
  });
}

// ---------------------------------------------------------------------------
// GET /stats
// ---------------------------------------------------------------------------

describe('GET /stats', () => {
  it('should return 401 with no Authorization header', async () => {
    const res = await fetch(`${baseUrl}/stats`);
    const data = await res.json();
    assert.strictEqual(res.status, 401);
    assert.ok(data.error);
  });

  it('should return 401 for invalid token', async () => {
    const res = await fetch(`${baseUrl}/stats`, {
      headers: { 'Authorization': 'Bearer invalid.jwt.token' }
    });
    assert.strictEqual(res.status, 401);
  });

  it('should return stats for a valid JWT (session need not be in store)', async () => {
    // The stats route uses the API key from the JWT, not the session store
    const token = makeToken('any-session-id-not-in-store');
    const res = await fetch(`${baseUrl}/stats`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    // stats-test-key is in the DB, so returns 200 regardless of session store
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.apiKey, 'stats-test-key');
  });

  it('should return stats for a valid session', async () => {
    const session = createMockSession();
    const token = makeToken(session.sessionId);

    const res = await fetch(`${baseUrl}/stats`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.apiKey, 'stats-test-key');
    assert.strictEqual(data.owner, 'Stats User');
    assert.strictEqual(data.email, 'stats@example.com');
    assert.ok('usage' in data);
    assert.ok('lifetimeUsed' in data.usage);
    assert.ok('dailyUsed' in data.usage);
    assert.ok(Array.isArray(data.sessions));
    assert.ok(Array.isArray(data.captionErrors));
    assert.ok(Array.isArray(data.authEvents));
  });

  it('should return 404 for unknown API key', async () => {
    // Create a session for a non-existent key
    const ghostStore = new SessionStore({ cleanupInterval: 0 });
    const ghostSession = ghostStore.create({
      apiKey: 'nonexistent-key',
      streamKey: 'sk',
      domain: 'https://ghost.example.com',
      jwt: 'x',
      sequence: 0,
      syncOffset: 0,
      sender: null,
    });
    const token = makeToken(ghostSession.sessionId, 'nonexistent-key');

    // Wire a separate app with the real store (not ghostStore) to simulate mismatch
    const auth2 = createAuthMiddleware(JWT_SECRET);
    const app2 = express();
    app2.use(express.json());
    app2.use('/stats', createStatsRouter(db, auth2, ghostStore));
    const server2 = await new Promise(resolve => {
      const s = createServer(app2);
      s.listen(0, () => resolve(s));
    });
    const baseUrl2 = `http://localhost:${server2.address().port}`;

    try {
      const res = await fetch(`${baseUrl2}/stats`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      assert.strictEqual(res.status, 404);
      assert.ok(data.error);
    } finally {
      ghostStore.stopCleanup();
      await new Promise(resolve => server2.close(resolve));
    }
  });

  it('usage.dailyLimit and lifetimeLimit are null when not set', async () => {
    const session = createMockSession();
    const token = makeToken(session.sessionId);

    const res = await fetch(`${baseUrl}/stats`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.usage.dailyLimit, null);
    assert.strictEqual(data.usage.lifetimeLimit, null);
  });
});

// ---------------------------------------------------------------------------
// DELETE /stats
// ---------------------------------------------------------------------------

describe('DELETE /stats', () => {
  it('should return 401 with no Authorization header', async () => {
    const res = await fetch(`${baseUrl}/stats`, { method: 'DELETE' });
    assert.strictEqual(res.status, 401);
  });

  it('should anonymise the key and return ok', async () => {
    // Create a fresh key so we can erase it without affecting other tests
    createKey(db, { key: 'erase-test-key', owner: 'Erase User', email: 'erase@example.com' });
    const session = store.create({
      apiKey: 'erase-test-key',
      streamKey: 'sk',
      domain: 'https://erase.example.com',
      jwt: 'x',
      sequence: 0,
      syncOffset: 0,
      sender: { end: async () => {} }
    });
    const token = jwt.sign(
      { sessionId: session.sessionId, apiKey: 'erase-test-key', streamKey: 'sk', domain: 'https://erase.example.com' },
      JWT_SECRET
    );

    const res = await fetch(`${baseUrl}/stats`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.ok, true);
    assert.ok(typeof data.message === 'string');

    // Session should be removed from in-memory store
    assert.strictEqual(store.get(session.sessionId), undefined);
  });

  it('should return 404 for unknown API key', async () => {
    // Build a session pointing to a non-existent DB key
    const ghostStore = new SessionStore({ cleanupInterval: 0 });
    const ghostSession = ghostStore.create({
      apiKey: 'nonexistent-erase-key',
      streamKey: 'sk',
      domain: 'https://ghost2.example.com',
      jwt: 'x',
      sequence: 0,
      syncOffset: 0,
      sender: null,
    });
    const token = jwt.sign(
      { sessionId: ghostSession.sessionId, apiKey: 'nonexistent-erase-key', streamKey: 'sk', domain: 'https://ghost2.example.com' },
      JWT_SECRET
    );

    const auth2 = createAuthMiddleware(JWT_SECRET);
    const app2 = express();
    app2.use(express.json());
    app2.use('/stats', createStatsRouter(db, auth2, ghostStore));
    const server2 = await new Promise(resolve => {
      const s = createServer(app2);
      s.listen(0, () => resolve(s));
    });
    const baseUrl2 = `http://localhost:${server2.address().port}`;

    try {
      const res = await fetch(`${baseUrl2}/stats`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      assert.strictEqual(res.status, 404);
      assert.ok(data.error);
    } finally {
      ghostStore.stopCleanup();
      await new Promise(resolve => server2.close(resolve));
    }
  });
});
