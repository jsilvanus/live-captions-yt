import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createServer } from 'node:http';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import jwt from 'jsonwebtoken';
import { createLocalAdapter } from 'lcyt-files/src/adapters/local.js';
import { initDb, createKey } from '../src/db.js';
import { SessionStore, makeSessionId } from '../src/store.js';
import { createCaptionsRouter } from '../src/routes/captions.js';
import { createAuthMiddleware } from '../src/middleware/auth.js';
import { createTranslationTarget } from '../src/db/translation-config.js';
import { createCaptionTarget } from '../src/db/caption-targets.js';

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

  describe('Phase 5: per-target translation routing', () => {
    // Regression coverage for docs/plans/plan_server_stt.md Phase 5's fan-out
    // change: a caption_targets row with an enabled translation_targets row
    // pointing at it (via caption_target_id) must receive that row's own
    // composed text; a target with no such routing must keep receiving
    // today's default composed text, completely unchanged.
    it('delivers routed text to a target with a matching translation_targets row, default text to an unrouted target', async () => {
      const routed = { url: 'https://example.test/routed-webhook', calls: [] };
      const unrouted = { url: 'https://example.test/unrouted-webhook', calls: [] };

      const origFetch = globalThis.fetch;
      globalThis.fetch = async (url, opts) => {
        // Only intercept the two webhook URLs — anything else (notably the
        // test harness's own postCaptions() call to the local server) must
        // go through to the real fetch, or caption_result never fires.
        if (url === routed.url || url === unrouted.url) {
          const body = JSON.parse(opts.body);
          (url === routed.url ? routed : unrouted).calls.push(body);
          return { ok: true, status: 200, json: async () => ({}) };
        }
        return origFetch(url, opts);
      };

      try {
        // caption_targets.id is a real FK target for translation_targets.caption_target_id
        // (enforced — confirmed by this test originally failing with
        // SQLITE_CONSTRAINT_FOREIGNKEY against made-up ids), so create real rows first.
        const routedTarget = createCaptionTarget(db, 'test-key', { type: 'generic', url: routed.url });
        assert.ok(routedTarget.ok, routedTarget.error);
        const unroutedTarget = createCaptionTarget(db, 'test-key', { type: 'generic', url: unrouted.url });
        assert.ok(unroutedTarget.ok, unroutedTarget.error);

        const session = store.create({
          apiKey: 'test-key',
          streamKey: 'test-stream',
          domain: 'https://test.com',
          jwt: 'test-jwt',
          sequence: 0,
          syncOffset: 0,
          extraTargets: [
            { id: routedTarget.target.id,   type: 'generic', url: routed.url },
            { id: unroutedTarget.target.id, type: 'generic', url: unrouted.url },
          ],
        });

        // Route Finnish translation delivery specifically to the routed target.
        const created = createTranslationTarget(db, 'test-key', {
          lang: 'fi-FI', target: 'captions', captionTargetId: routedTarget.target.id, showOriginal: false,
        });
        assert.ok(created.ok, created.error);

        const token = makeToken(session.sessionId);
        const eventPromise = waitForEvent(session, 'caption_result');
        await postCaptions(token, {
          captions: [{
            text: 'Hello world',
            captionLang: 'sv-SE',
            translations: { 'sv-SE': 'Hej varlden', 'fi-FI': 'Hei maailma' },
          }],
        });
        await eventPromise;
        // Fan-out is fire-and-forget after the primary result — give it a tick.
        await new Promise(r => setTimeout(r, 20));

        assert.strictEqual(routed.calls.length, 1);
        assert.strictEqual(routed.calls[0].captions[0].composedText, 'Hei maailma');

        assert.strictEqual(unrouted.calls.length, 1);
        assert.strictEqual(unrouted.calls[0].captions[0].composedText, 'Hej varlden');
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });
});

// ---------------------------------------------------------------------------
// POST /captions — backend caption-file formats (fileFormats wiring)
// ---------------------------------------------------------------------------

describe('POST /captions — backend file formats', () => {
  let fileServer, fileBaseUrl, filesDir;

  before(() => new Promise((resolve) => {
    createKey(db, { key: 'file-key', owner: 'File User', backend_file_enabled: 1 });
    filesDir = mkdtempSync(join(tmpdir(), 'lcyt-captions-files-'));
    const adapter = createLocalAdapter(filesDir);
    const auth = createAuthMiddleware(JWT_SECRET);

    const app = express();
    app.use(express.json({ limit: '64kb' }));
    app.use('/captions', createCaptionsRouter(store, auth, db, null, null, async () => adapter));

    fileServer = createServer(app);
    fileServer.listen(0, () => {
      fileBaseUrl = `http://localhost:${fileServer.address().port}`;
      resolve();
    });
  }));

  after(async () => {
    await new Promise(r => fileServer.close(r));
    rmSync(filesDir, { recursive: true, force: true });
  });

  function createFileSession() {
    const batchCalls = [];
    const session = store.create({
      apiKey: 'file-key',
      streamKey: 'file-stream',
      domain: 'https://test.com',
      jwt: 'test-jwt',
      sequence: 0,
      syncOffset: 0,
      sender: {
        sequence: 0,
        batchCalls,
        send: async () => ({ sequence: 1, timestamp: '2026-02-20T12:00:00.000', statusCode: 200, serverTimestamp: null }),
        sendBatch: async (c) => { batchCalls.push(c); return { sequence: c.length, count: c.length, statusCode: 200, serverTimestamp: null }; },
        end: async () => {},
      },
    });
    return session;
  }

  // The backend-file writes are fire-and-forget and go through append streams,
  // so a file can exist before its content is flushed. Poll until at least
  // `count` files with the extension have contents satisfying the predicate,
  // and return those contents (files from other tests in this suite won't
  // match the predicate and are ignored).
  async function waitForFiles(ext, count, ready, timeoutMs = 2000) {
    const keyDir = join(filesDir, 'file-key');
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      let names = [];
      try { names = readdirSync(keyDir).filter(n => n.endsWith(ext)); } catch {}
      const contents = names.map(n => readFileSync(join(keyDir, n), 'utf8')).filter(ready);
      if (contents.length >= count) return contents;
      if (Date.now() > deadline) throw new Error(`Timed out waiting for ${count} ready ${ext} file(s), saw ${contents.length}`);
      await new Promise(r => setTimeout(r, 25));
    }
  }

  it('writes session-relative VTT files when fileFormats requests vtt', async () => {
    const session = createFileSession();
    const token = jwt.sign(
      { sessionId: session.sessionId, apiKey: 'file-key', streamKey: 'file-stream', domain: 'https://test.com' },
      JWT_SECRET
    );

    const res = await fetch(`${fileBaseUrl}/captions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({
        captions: [{
          text: 'Hello world',
          time: 14000,
          translations: { 'fi-FI': 'Hei maailma' },
          fileFormats: { original: 'vtt', 'fi-FI': 'vtt' },
        }],
      }),
    });
    assert.strictEqual(res.status, 202);

    const contents = await waitForFiles('.vtt', 2, c => c.includes('-->'));
    for (const c of contents) {
      assert.ok(c.startsWith('WEBVTT\n\n'), 'file should start with WEBVTT header');
      assert.ok(c.includes('00:00:14.000 --> 00:00:17.000'), `cue should be session-relative, got:\n${c}`);
    }
    assert.ok(contents.some(c => c.includes('Hello world')));
    assert.ok(contents.some(c => c.includes('Hei maailma')));
  });

  it('defaults to plain-text youtube format when fileFormats is absent or invalid', async () => {
    const session = createFileSession();
    const token = jwt.sign(
      { sessionId: session.sessionId, apiKey: 'file-key', streamKey: 'file-stream', domain: 'https://test.com' },
      JWT_SECRET
    );

    const res = await fetch(`${fileBaseUrl}/captions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({
        captions: [{
          text: 'Plain line',
          time: 1000,
          translations: { 'sv-SE': 'Vanlig rad' },
          fileFormats: { 'sv-SE': 'evil/../format' },
        }],
      }),
    });
    assert.strictEqual(res.status, 202);

    const contents = await waitForFiles('.txt', 2, c => c.trim().length > 0);
    assert.ok(contents.some(c => c.includes('Plain line')));
    assert.ok(contents.some(c => c.includes('Vanlig rad')));
    for (const c of contents) {
      assert.ok(!c.includes('WEBVTT'));
      assert.ok(!c.includes('-->'));
    }
  });

  it('batch send keeps per-caption options and delivers one sendBatch to YouTube (plan_batch_options)', async () => {
    const session = createFileSession();
    const token = jwt.sign(
      { sessionId: session.sessionId, apiKey: 'file-key', streamKey: 'file-stream', domain: 'https://test.com' },
      JWT_SECRET
    );

    const res = await fetch(`${fileBaseUrl}/captions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({
        captions: [
          { text: 'Batch line one', time: 5000,  translations: { 'fi-FI': 'Erärivi yksi' },  fileFormats: { original: 'vtt', 'fi-FI': 'vtt' } },
          { text: 'Batch line two', time: 12000, translations: { 'fi-FI': 'Erärivi kaksi' }, fileFormats: { original: 'vtt', 'fi-FI': 'vtt' } },
        ],
      }),
    });
    assert.strictEqual(res.status, 202);

    // Both cues from this batch must land in each file (original + fi-FI),
    // with session-relative times taken from each caption's own `time`.
    const contents = await waitForFiles('.vtt', 2,
      c => c.includes('00:00:05.000 --> 00:00:08.000') && c.includes('00:00:12.000 --> 00:00:15.000'));
    assert.ok(contents.some(c => c.includes('Batch line one') && c.includes('Batch line two')));
    assert.ok(contents.some(c => c.includes('Erärivi yksi') && c.includes('Erärivi kaksi')));

    // YouTube delivery stays batched: exactly one sendBatch call with both captions.
    assert.strictEqual(session.sender.batchCalls.length, 1);
    const batch = session.sender.batchCalls[0];
    assert.strictEqual(batch.length, 2);
    assert.strictEqual(batch[0].text, 'Batch line one');
    assert.strictEqual(batch[1].text, 'Batch line two');
    // Per-caption timestamps survive (resolved from each caption's `time`)
    const t0 = new Date(batch[0].timestamp).getTime();
    const t1 = new Date(batch[1].timestamp).getTime();
    assert.strictEqual(t1 - t0, 7000);
    // Internal-only fields never leak into the YouTube payload
    assert.ok(!('fileFormats' in batch[0]));
    assert.ok(!('translations' in batch[0]));
  });
});
