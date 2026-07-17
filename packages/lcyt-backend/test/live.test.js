import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import jwt from 'jsonwebtoken';
import { initDb, createKey, createCaptionTarget } from '../src/db.js';
import { SessionStore, makeSessionId } from '../src/store.js';
import { createLiveRouter } from '../src/routes/live.js';
import { runMigrations as runRtmpMigrations } from 'lcyt-rtmp/src/db.js';

const JWT_SECRET = 'test-live-secret';

// ---------------------------------------------------------------------------
// Test app setup
// ---------------------------------------------------------------------------

let server, baseUrl, db, store;

function makeTestApp({ db: customDb, store: customStore, mediamtxClient } = {}) {
  const testDb = customDb ?? initDb(':memory:');
  runRtmpMigrations(testDb); // POST /live checks rtmp_relays for the recordOnStart flag; idempotent
  const testStore = customStore ?? new SessionStore({ cleanupInterval: 0 });

  const app = express();
  app.use(express.json({ limit: '64kb' }));
  app.use('/live', createLiveRouter(testDb, testStore, JWT_SECRET, { mediamtxClient }));

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

  it('should allow loopback domains used by local dev clients', async () => {
    const { key } = createKey(db, { owner: 'Loopback' });

    const res = await postLive({
      apiKey: key,
      domain: 'http://127.0.0.1:5173'
    });
    const data = await res.json();

    assert.strictEqual(res.status, 200);
    assert.ok(data.token);
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

  it('should start and stop MediaMTX recording when recording is enabled', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'lcyt-live-recording-'));
    process.env.VIDEOS_STORAGE_DIR = join(tempDir, 'recordings');
    try {
      const { key } = createKey(db, { owner: 'Recording User' });
      const calls = [];
      const mediamtxClient = {
        async addPath(name, config) { calls.push(['add', name, config]); },
        async patchPath(name, config) { calls.push(['patch', name, config]); },
      };

      const { app } = makeTestApp({ db, store, mediamtxClient });
      const testServer = createServer(app);
      await new Promise((resolve) => testServer.listen(0, resolve));
      const address = testServer.address();
      const testBaseUrl = `http://localhost:${address.port}`;

      try {
        const startRes = await fetch(`${testBaseUrl}/live`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey: key, streamKey: 'recording-key', domain: 'https://recording.test', recordEnabled: true }),
        });
        assert.strictEqual(startRes.status, 200);
        const startBody = await startRes.json();
        const startPatch = calls.filter(([op, , config]) => op === 'patch' && config?.record === 'yes');
        assert.strictEqual(startPatch.length, 1);
        assert.strictEqual(startPatch[0][1], 'recording-key');
        assert.strictEqual(startPatch[0][2].record, 'yes');
        assert.strictEqual(startPatch[0][2].recordFormat, 'fmp4');
        assert.ok(startPatch[0][2].recordPath);

        const stopRes = await fetch(`${testBaseUrl}/live`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${startBody.token}` },
        });
        assert.strictEqual(stopRes.status, 200);
        const stopPatch = calls.filter(([op, , config]) => op === 'patch' && config?.record === 'no');
        assert.strictEqual(stopPatch.length, 1);
      } finally {
        await new Promise((resolve) => testServer.close(resolve));
      }
    } finally {
      delete process.env.VIDEOS_STORAGE_DIR;
      rmSync(tempDir, { recursive: true, force: true });
    }
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

// ---------------------------------------------------------------------------
// POST /live — targets: explicit override vs. saved-default resolution
// (plan/selfservice_config_backend §1's "Central design decision" section)
// ---------------------------------------------------------------------------

describe('POST /live — targets override-vs-default', () => {
  it('new session with targets omitted loads the project\'s saved enabled caption_targets', async () => {
    const { key } = createKey(db, { owner: 'DefaultLoad' });
    createCaptionTarget(db, key, { type: 'youtube', streamKey: 'saved-stream-key' });
    createCaptionTarget(db, key, { type: 'viewer', viewerKey: 'saved-viewer-key', enabled: false });
    const domain = 'https://default-load.com';

    const res = await postLive({ apiKey: key, domain });
    const { sessionId } = await res.json();
    assert.strictEqual(res.status, 200);

    const session = store.get(sessionId);
    // Only the enabled target should have been loaded — the disabled viewer target is excluded.
    assert.strictEqual(session.extraTargets.length, 1);
    assert.strictEqual(session.extraTargets[0].type, 'youtube');
  });

  it('new session with targets omitted and no saved targets gets an empty extraTargets array', async () => {
    const { key } = createKey(db, { owner: 'NoSavedTargets' });
    const domain = 'https://no-saved.com';

    const res = await postLive({ apiKey: key, domain });
    const { sessionId } = await res.json();
    const session = store.get(sessionId);
    assert.deepStrictEqual(session.extraTargets, []);
  });

  it('new session with an explicit empty targets array does NOT load saved defaults', async () => {
    const { key } = createKey(db, { owner: 'ExplicitEmptyOverride' });
    createCaptionTarget(db, key, { type: 'viewer', viewerKey: 'should-not-load' });
    const domain = 'https://explicit-empty.com';

    const res = await postLive({ apiKey: key, domain, targets: [] });
    const { sessionId } = await res.json();
    const session = store.get(sessionId);
    assert.deepStrictEqual(session.extraTargets, []);
  });

  it('new session with an explicit targets array overrides saved defaults', async () => {
    const { key } = createKey(db, { owner: 'ExplicitOverride' });
    createCaptionTarget(db, key, { type: 'viewer', viewerKey: 'saved-not-used' });
    const domain = 'https://explicit-override.com';

    const res = await postLive({ apiKey: key, domain, targets: [{ id: 'x', type: 'viewer', viewerKey: 'override-viewer-key' }] });
    const { sessionId } = await res.json();
    const session = store.get(sessionId);
    assert.strictEqual(session.extraTargets.length, 1);
    assert.strictEqual(session.extraTargets[0].viewerKey, 'override-viewer-key');
  });

  it('reconnecting (existing session) with targets omitted does NOT wipe the running session\'s targets', async () => {
    const { key } = createKey(db, { owner: 'ReconnectNoWipe' });
    const domain = 'https://reconnect-no-wipe.com';

    // First connect: explicit targets establish the running session's extraTargets.
    const first = await postLive({ apiKey: key, domain, targets: [{ id: 'a', type: 'viewer', viewerKey: 'still-here-key' }] });
    const { sessionId } = await first.json();
    assert.strictEqual(store.get(sessionId).extraTargets.length, 1);

    // Reconnect without a targets field at all — must not wipe to [].
    const second = await postLive({ apiKey: key, domain });
    assert.strictEqual(second.status, 200);
    const session = store.get(sessionId);
    assert.strictEqual(session.extraTargets.length, 1);
    assert.strictEqual(session.extraTargets[0].viewerKey, 'still-here-key');
  });

  it('reconnecting (existing session) with an explicit targets array still replaces the running targets', async () => {
    const { key } = createKey(db, { owner: 'ReconnectExplicit' });
    const domain = 'https://reconnect-explicit.com';

    const first = await postLive({ apiKey: key, domain, targets: [{ id: 'a', type: 'viewer', viewerKey: 'old-key' }] });
    const { sessionId } = await first.json();

    const second = await postLive({ apiKey: key, domain, targets: [{ id: 'b', type: 'viewer', viewerKey: 'new-key' }] });
    assert.strictEqual(second.status, 200);
    const session = store.get(sessionId);
    assert.strictEqual(session.extraTargets.length, 1);
    assert.strictEqual(session.extraTargets[0].viewerKey, 'new-key');
  });

  it('reconnecting with an explicit empty targets array clears the running session\'s targets', async () => {
    const { key } = createKey(db, { owner: 'ReconnectExplicitEmpty' });
    const domain = 'https://reconnect-explicit-empty.com';

    const first = await postLive({ apiKey: key, domain, targets: [{ id: 'a', type: 'viewer', viewerKey: 'to-be-cleared' }] });
    const { sessionId } = await first.json();
    assert.strictEqual(store.get(sessionId).extraTargets.length, 1);

    const second = await postLive({ apiKey: key, domain, targets: [] });
    assert.strictEqual(second.status, 200);
    assert.deepStrictEqual(store.get(sessionId).extraTargets, []);
  });
});
