import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createServer } from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import { initDb, createKey } from '../src/db.js';
import { SessionStore, makeSessionId } from '../src/store.js';
import { createLiveRouter } from '../src/routes/live.js';

const JWT_SECRET = 'test-live-secret';

// ---------------------------------------------------------------------------
// Test app setup
// ---------------------------------------------------------------------------

let server, baseUrl, db, store;

function makeTestApp() {
  const testDb = initDb(':memory:');
  const testStore = new SessionStore({ cleanupInterval: 0 });

  const app = express();
  app.use(express.json({ limit: '64kb' }));
  app.use('/live', createLiveRouter(testDb, testStore, JWT_SECRET));

  return { app, db: testDb, store: testStore };
}

before(() => new Promise((resolve) => {
  const { app, db: testDb, store: testStore } = makeTestApp();
  db = testDb;
  store = testStore;

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

// Clean out sessions between tests
beforeEach(() => {
  for (const session of [...store.all()]) {
    store.remove(session.sessionId);
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function postLive(body) {
  return fetch(`${baseUrl}/live`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

async function getLive(token) {
  return fetch(`${baseUrl}/live`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
}

async function deleteLive(token) {
  return fetch(`${baseUrl}/live`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}` }
  });
}

// ---------------------------------------------------------------------------
// POST /live — Register session
// ---------------------------------------------------------------------------

describe('POST /live', () => {
  it('should return 400 if apiKey is missing', async () => {
    const res = await postLive({ domain: 'https://a.com' });
    const data = await res.json();
    assert.strictEqual(res.status, 400);
    assert.ok(data.error);
  });

  it('should return 400 if domain is missing', async () => {
    const res = await postLive({ apiKey: 'k' });
    const data = await res.json();
    assert.strictEqual(res.status, 400);
    assert.ok(data.error);
  });

  it('should return 401 for unknown API key', async () => {
    const res = await postLive({
      apiKey: 'unknown-api-key',
      domain: 'https://a.com'
    });
    const data = await res.json();
    assert.strictEqual(res.status, 401);
    assert.ok(data.error);
  });

  it('should return 401 for revoked API key', async () => {
    const { key } = createKey(db, { owner: 'Revoked' });
    // Revoke it directly via SQL
    db.prepare('UPDATE api_keys SET active = 0 WHERE key = ?').run(key);

    const res = await postLive({
      apiKey: key,
      domain: 'https://a.com'
    });
    const data = await res.json();
    assert.strictEqual(res.status, 401);
  });

  it('should return 200 with token, sessionId, sequence, syncOffset, startedAt for valid key (target-array mode, no streamKey)', async () => {
    const { key } = createKey(db, { owner: 'Valid User' });

    const res = await postLive({
      apiKey: key,
      domain: 'https://test.com',
      targets: [{ id: '1', type: 'youtube', streamKey: 'test-stream' }]
    });
    const data = await res.json();

    assert.strictEqual(res.status, 200);
    assert.ok(data.token, 'should have token');
    assert.ok(data.sessionId, 'should have sessionId');
    assert.strictEqual(typeof data.sequence, 'number');
    assert.strictEqual(typeof data.syncOffset, 'number');
    assert.ok(typeof data.startedAt === 'number' && data.startedAt > 0);
  });

  it('should return 200 with token for valid key with legacy streamKey', async () => {
    const { key } = createKey(db, { owner: 'Legacy User' });

    const res = await postLive({
      apiKey: key,
      streamKey: 'test-stream',
      domain: 'https://legacy-test.com'
    });
    const data = await res.json();

    assert.strictEqual(res.status, 200);
    assert.ok(data.token, 'should have token');
    assert.ok(data.sessionId, 'should have sessionId');
  });

  it('should store the session in the store (target-array mode)', async () => {
    const { key } = createKey(db, { owner: 'Store Test' });
    const domain = 'https://store-test.com';

    await postLive({ apiKey: key, domain });

    // Session ID uses empty string for streamKey in target-array mode
    const sessionId = makeSessionId(key, '', domain);
    assert.strictEqual(store.has(sessionId), true);
  });

  it('should store the session in the store (legacy streamKey mode)', async () => {
    const { key } = createKey(db, { owner: 'Store Legacy' });
    const domain = 'https://store-legacy.com';
    const streamKey = 'store-stream';

    await postLive({ apiKey: key, streamKey, domain });

    const sessionId = makeSessionId(key, streamKey, domain);
    assert.strictEqual(store.has(sessionId), true);
  });

  it('should be idempotent — re-registration returns same token', async () => {
    const { key } = createKey(db, { owner: 'Idempotent' });

    const res1 = await postLive({ apiKey: key, domain: 'https://i.com' });
    const data1 = await res1.json();

    const res2 = await postLive({ apiKey: key, domain: 'https://i.com' });
    const data2 = await res2.json();

    assert.strictEqual(data1.token, data2.token);
    assert.strictEqual(data1.sessionId, data2.sessionId);
  });

  it('should set Access-Control-Allow-Origin header to domain', async () => {
    const { key } = createKey(db, { owner: 'CORS Test' });
    const domain = 'https://cors-test.com';

    const res = await postLive({ apiKey: key, domain });
    assert.strictEqual(res.headers.get('Access-Control-Allow-Origin'), domain);
  });

  it('JWT payload should contain sessionId and apiKey, and must not expose streamKey or domain', async () => {
    const { key } = createKey(db, { owner: 'JWT Test' });
    const domain = 'https://jwt-test.com';

    const res = await postLive({ apiKey: key, domain });
    const data = await res.json();

    const payload = jwt.verify(data.token, JWT_SECRET);
    assert.strictEqual(payload.apiKey, key);
    assert.ok(payload.sessionId);
    assert.ok(payload.exp, 'JWT must have an expiry claim');
    assert.strictEqual(payload.streamKey, undefined, 'streamKey must not be in JWT payload');
    assert.strictEqual(payload.domain, undefined, 'domain must not be in JWT payload');
  });
});

// ---------------------------------------------------------------------------
// GET /live — Session status
// ---------------------------------------------------------------------------

describe('GET /live', () => {
  it('should return 401 if no Authorization header', async () => {
    const res = await fetch(`${baseUrl}/live`);
    const data = await res.json();
    assert.strictEqual(res.status, 401);
    assert.ok(data.error);
  });

  it('should return 401 for invalid token', async () => {
    const res = await getLive('invalid.jwt.token');
    const data = await res.json();
    assert.strictEqual(res.status, 401);
    assert.ok(data.error);
  });

  it('should return 404 if session not found', async () => {
    // Create a valid JWT for a non-existent session
    const token = jwt.sign(
      { sessionId: 'deadbeef00000000', apiKey: 'k' },
      JWT_SECRET
    );
    const res = await getLive(token);
    const data = await res.json();
    assert.strictEqual(res.status, 404);
    assert.ok(data.error);
  });

  it('should return 200 with sequence and syncOffset for valid session', async () => {
    const { key } = createKey(db, { owner: 'Get Status' });
    const regRes = await postLive({ apiKey: key, domain: 'https://gs.com' });
    const { token } = await regRes.json();

    const res = await getLive(token);
    const data = await res.json();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(typeof data.sequence, 'number');
    assert.strictEqual(typeof data.syncOffset, 'number');
  });
});

// ---------------------------------------------------------------------------
// DELETE /live — Remove session
// ---------------------------------------------------------------------------

describe('DELETE /live', () => {
  it('should return 401 if no Authorization header', async () => {
    const res = await fetch(`${baseUrl}/live`, { method: 'DELETE' });
    const data = await res.json();
    assert.strictEqual(res.status, 401);
    assert.ok(data.error);
  });

  it('should return 401 for invalid token', async () => {
    const res = await deleteLive('bad.token.here');
    const data = await res.json();
    assert.strictEqual(res.status, 401);
  });

  it('should return 404 if session not found', async () => {
    const token = jwt.sign(
      { sessionId: 'deadbeef00000001', apiKey: 'k' },
      JWT_SECRET
    );
    const res = await deleteLive(token);
    const data = await res.json();
    assert.strictEqual(res.status, 404);
  });

  it('should return 200 with removed=true and remove the session', async () => {
    const { key } = createKey(db, { owner: 'Delete Test' });
    const regRes = await postLive({ apiKey: key, domain: 'https://del.com' });
    const { token, sessionId } = await regRes.json();

    const res = await deleteLive(token);
    const data = await res.json();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.removed, true);
    assert.strictEqual(data.sessionId, sessionId);
    assert.strictEqual(store.has(sessionId), false);
  });
});
