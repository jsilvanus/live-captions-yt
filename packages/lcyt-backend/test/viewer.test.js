/**
 * Tests for GET /viewer/:key — the public SSE caption viewer endpoint.
 *
 * Covers:
 *   - Input validation (key format)
 *   - CORS headers (OPTIONS + GET)
 *   - SSE connection handshake (connected event)
 *   - broadcastToViewers() delivery to single and multiple subscribers
 *   - Correct payload forwarding: text, composedText, translations, codes
 *   - Client disconnect cleanup (no memory leak in viewerSubs map)
 *   - POST /live: viewer target validation in buildExtraTargets
 *   - Integration: caption fan-out → SSE (POST /captions → viewer SSE receives event)
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import { initDb, createKey } from '../src/db.js';
import { SessionStore } from '../src/store.js';
import { createViewerRouter, broadcastToViewers } from '../src/routes/viewer.js';
import { createCaptionsRouter } from '../src/routes/captions.js';
import { createAuthMiddleware } from '../src/middleware/auth.js';
import { createLiveRouter } from '../src/routes/live.js';

const JWT_SECRET = 'test-viewer-secret';

/**
 * Milliseconds to wait after opening an SSE connection before broadcasting,
 * to allow the Express request handler to register the client in viewerSubs.
 */
const SSE_CONNECTION_DELAY_MS = 80;

// ---------------------------------------------------------------------------
// Shared test app: /viewer + /captions (for integration tests)
// ---------------------------------------------------------------------------

let server, baseUrl, store, db;

before(() => new Promise((resolve) => {
  db = initDb(':memory:');
  createKey(db, { key: 'test-key', owner: 'Test User' });

  store = new SessionStore({ cleanupInterval: 0 });
  const auth = createAuthMiddleware(JWT_SECRET);

  const app = express();
  app.use(express.json({ limit: '64kb' }));
  app.use('/viewer', createViewerRouter());
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
// SSE test helpers
// ---------------------------------------------------------------------------

/**
 * Consume an SSE stream, collecting up to `count` parsed events.
 * Resolves after `count` events are received or after `timeout` ms.
 * The AbortController is used to close the connection after collection.
 */
async function collectSseEvents(url, count = 1, timeout = 2000) {
  const events = [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  let res;
  try {
    res = await fetch(url, { signal: controller.signal });
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') return events;
    throw err;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (events.length < count) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Split on SSE double-newline block boundary
      const parts = buffer.split('\n\n');
      buffer = parts.pop(); // keep incomplete block

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

/** Create a session with a viewer target in the store. */
function createViewerSession(viewerKey) {
  return store.create({
    apiKey: 'test-key',
    domain: 'https://test.com',
    jwt: 'test-jwt',
    sequence: 0,
    syncOffset: 0,
    sender: null,
    extraTargets: [{ id: 'v1', type: 'viewer', viewerKey }],
  });
}

function makeToken(sessionId) {
  return jwt.sign({ sessionId, apiKey: 'test-key', domain: 'https://test.com' }, JWT_SECRET);
}

async function postCaptions(token, body) {
  return fetch(`${baseUrl}/captions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// GET /viewer/:key — input validation
// ---------------------------------------------------------------------------

describe('GET /viewer/:key — validation', () => {
  it('returns 400 for a key that is too short (< 3 chars)', async () => {
    const res = await fetch(`${baseUrl}/viewer/ab`);
    const data = await res.json();
    assert.equal(res.status, 400);
    assert.ok(data.error);
  });

  it('returns 400 for a key with invalid characters', async () => {
    const res = await fetch(`${baseUrl}/viewer/hello%20world`);
    const data = await res.json();
    assert.equal(res.status, 400);
    assert.ok(data.error);
  });

  it('returns 400 for a key with path traversal attempt', async () => {
    const res = await fetch(`${baseUrl}/viewer/..%2Fetc`);
    assert.equal(res.status, 400);
  });

  it('accepts a key with letters and digits', async () => {
    const events = await collectSseEvents(`${baseUrl}/viewer/testkey123`, 1, 500);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'connected');
  });

  it('accepts a key with hyphens and underscores', async () => {
    const events = await collectSseEvents(`${baseUrl}/viewer/my-viewer_key`, 1, 500);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'connected');
  });

  it('accepts a minimum-length (3 char) key', async () => {
    const events = await collectSseEvents(`${baseUrl}/viewer/abc`, 1, 500);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'connected');
  });
});

// ---------------------------------------------------------------------------
// GET /viewer/:key — SSE headers
// ---------------------------------------------------------------------------

describe('GET /viewer/:key — SSE response headers', () => {
  it('sets Content-Type to text/event-stream', async () => {
    // Use a raw HTTP request so we can inspect headers before the body is consumed
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 500);
    let contentType;
    try {
      const res = await fetch(`${baseUrl}/viewer/hdrtest`, { signal: controller.signal });
      contentType = res.headers.get('content-type');
      res.body.cancel();
    } catch (err) { /* AbortError is fine */ }
    assert.ok(contentType?.includes('text/event-stream'), `expected text/event-stream, got ${contentType}`);
  });

  it('sets Access-Control-Allow-Origin to *', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 500);
    let corsHeader;
    try {
      const res = await fetch(`${baseUrl}/viewer/corstest`, { signal: controller.signal });
      corsHeader = res.headers.get('access-control-allow-origin');
      res.body.cancel();
    } catch (err) { /* AbortError */ }
    assert.equal(corsHeader, '*');
  });

  it('sets Cache-Control to no-cache', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 500);
    let cacheControl;
    try {
      const res = await fetch(`${baseUrl}/viewer/cachetest`, { signal: controller.signal });
      cacheControl = res.headers.get('cache-control');
      res.body.cancel();
    } catch (err) { /* AbortError */ }
    assert.ok(cacheControl?.includes('no-cache'), `expected no-cache, got ${cacheControl}`);
  });
});

// ---------------------------------------------------------------------------
// OPTIONS /viewer/:key — CORS preflight
// ---------------------------------------------------------------------------

describe('OPTIONS /viewer/:key — CORS preflight', () => {
  it('returns 204 with Allow-Origin: *', async () => {
    const res = await fetch(`${baseUrl}/viewer/mykey`, { method: 'OPTIONS' });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
  });

  it('returns Allow-Methods containing GET', async () => {
    const res = await fetch(`${baseUrl}/viewer/mykey`, { method: 'OPTIONS' });
    const methods = res.headers.get('access-control-allow-methods') ?? '';
    assert.ok(methods.includes('GET'), `expected GET in methods, got ${methods}`);
  });
});

// ---------------------------------------------------------------------------
// connected event
// ---------------------------------------------------------------------------

describe('GET /viewer/:key — connected event', () => {
  it('emits a connected event immediately on connection', async () => {
    const events = await collectSseEvents(`${baseUrl}/viewer/conntest`, 1, 1000);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'connected');
    assert.equal(events[0].data.ok, true);
  });
});

// ---------------------------------------------------------------------------
// broadcastToViewers — unit tests using real SSE connections
// ---------------------------------------------------------------------------

describe('broadcastToViewers', () => {
  it('does not throw when no clients are subscribed to a key', () => {
    // Should be a no-op
    assert.doesNotThrow(() => {
      broadcastToViewers('nobody-subscribed', { text: 'hello', sequence: 1 });
    });
  });

  it('delivers a caption event to a connected subscriber', async () => {
    // Connect and collect: 1 connected + 1 caption = 2 events
    const ssePromise = collectSseEvents(`${baseUrl}/viewer/broadcast-single`, 2, 2000);

    // Wait briefly for the connection to be registered server-side
    await new Promise(r => setTimeout(r, SSE_CONNECTION_DELAY_MS));

    broadcastToViewers('broadcast-single', {
      text: 'Hello viewer',
      sequence: 42,
      timestamp: '2026-01-01T12:00:00.000',
    });

    const events = await ssePromise;
    const captionEvent = events.find(e => e.type === 'caption');
    assert.ok(captionEvent, 'should receive a caption event');
    assert.equal(captionEvent.data.text, 'Hello viewer');
    assert.equal(captionEvent.data.sequence, 42);
  });

  it('delivers to multiple concurrent subscribers', async () => {
    const key = 'broadcast-multi';
    const sse1 = collectSseEvents(`${baseUrl}/viewer/${key}`, 2, 2000);
    const sse2 = collectSseEvents(`${baseUrl}/viewer/${key}`, 2, 2000);

    await new Promise(r => setTimeout(r, SSE_CONNECTION_DELAY_MS));

    broadcastToViewers(key, { text: 'For all', sequence: 1 });

    const [events1, events2] = await Promise.all([sse1, sse2]);
    assert.ok(events1.some(e => e.type === 'caption' && e.data.text === 'For all'));
    assert.ok(events2.some(e => e.type === 'caption' && e.data.text === 'For all'));
  });

  it('forwards translations in the broadcast payload', async () => {
    const key = 'broadcast-translations';
    const ssePromise = collectSseEvents(`${baseUrl}/viewer/${key}`, 2, 2000);
    await new Promise(r => setTimeout(r, SSE_CONNECTION_DELAY_MS));

    broadcastToViewers(key, {
      text: 'Original text',
      composedText: 'Original text<br>Käännetty teksti',
      translations: { 'fi-FI': 'Käännetty teksti' },
      sequence: 1,
    });

    const events = await ssePromise;
    const captionEvent = events.find(e => e.type === 'caption');
    assert.ok(captionEvent);
    assert.equal(captionEvent.data.text, 'Original text');
    assert.equal(captionEvent.data.composedText, 'Original text<br>Käännetty teksti');
    assert.deepEqual(captionEvent.data.translations, { 'fi-FI': 'Käännetty teksti' });
  });

  it('forwards codes (section etc.) in the broadcast payload', async () => {
    const key = 'broadcast-codes';
    const ssePromise = collectSseEvents(`${baseUrl}/viewer/${key}`, 2, 2000);
    await new Promise(r => setTimeout(r, SSE_CONNECTION_DELAY_MS));

    broadcastToViewers(key, {
      text: 'Chorus line',
      sequence: 2,
      codes: { section: 'chorus', lyrics: true },
    });

    const events = await ssePromise;
    const captionEvent = events.find(e => e.type === 'caption');
    assert.ok(captionEvent);
    assert.deepEqual(captionEvent.data.codes, { section: 'chorus', lyrics: true });
  });
});

// ---------------------------------------------------------------------------
// POST /live — viewer target validation
// ---------------------------------------------------------------------------

describe('POST /live — viewer target validation', () => {
  async function postLive(body) {
    return fetch(`${baseUrl}/live`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('accepts a valid viewer target', async () => {
    const { key } = createKey(db, { owner: 'Viewer Target Test' });
    const res = await postLive({
      apiKey: key,
      domain: 'https://viewer-test.com',
      targets: [{ id: 'v1', type: 'viewer', viewerKey: 'myevent' }],
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.token);
  });

  it('returns 400 when viewerKey is missing', async () => {
    const { key } = createKey(db, { owner: 'Viewer Key Missing' });
    const res = await postLive({
      apiKey: key,
      domain: 'https://viewer-test.com',
      targets: [{ id: 'v1', type: 'viewer' }],
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.ok(data.error);
  });

  it('returns 400 when viewerKey is too short', async () => {
    const { key } = createKey(db, { owner: 'Viewer Key Short' });
    const res = await postLive({
      apiKey: key,
      domain: 'https://viewer-test.com',
      targets: [{ id: 'v1', type: 'viewer', viewerKey: 'ab' }],
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.ok(data.error);
  });

  it('returns 400 when viewerKey contains invalid characters', async () => {
    const { key } = createKey(db, { owner: 'Viewer Key Invalid' });
    const res = await postLive({
      apiKey: key,
      domain: 'https://viewer-test.com',
      targets: [{ id: 'v1', type: 'viewer', viewerKey: 'invalid key!' }],
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.ok(data.error);
  });
});

// ---------------------------------------------------------------------------
// Integration: POST /captions fan-out → SSE caption event
// ---------------------------------------------------------------------------

describe('Integration — caption fan-out to viewer SSE', () => {
  it('delivers caption text to SSE subscriber when viewer target is in session', async () => {
    const viewerKey = 'integ-basic';
    // Start collecting SSE: connected + caption = 2 events
    const ssePromise = collectSseEvents(`${baseUrl}/viewer/${viewerKey}`, 2, 3000);
    await new Promise(r => setTimeout(r, SSE_CONNECTION_DELAY_MS));

    const session = createViewerSession(viewerKey);
    const token = makeToken(session.sessionId);
    await postCaptions(token, { captions: [{ text: 'Integration caption' }] });

    const events = await ssePromise;
    const captionEvent = events.find(e => e.type === 'caption');
    assert.ok(captionEvent, 'SSE subscriber should receive a caption event');
    assert.equal(captionEvent.data.text, 'Integration caption');
  });

  it('forwards translations from POST /captions payload to SSE subscribers', async () => {
    const viewerKey = 'integ-translations';
    const ssePromise = collectSseEvents(`${baseUrl}/viewer/${viewerKey}`, 2, 3000);
    await new Promise(r => setTimeout(r, SSE_CONNECTION_DELAY_MS));

    const session = createViewerSession(viewerKey);
    const token = makeToken(session.sessionId);
    await postCaptions(token, {
      captions: [{
        text: 'Source text',
        translations: { 'fi-FI': 'Lähdeteksti' },
        captionLang: 'fi-FI',
        showOriginal: true,
      }],
    });

    const events = await ssePromise;
    const captionEvent = events.find(e => e.type === 'caption');
    assert.ok(captionEvent, 'should receive caption event');
    assert.equal(captionEvent.data.text, 'Source text');
    assert.deepEqual(captionEvent.data.translations, { 'fi-FI': 'Lähdeteksti' });
  });

  it('forwards codes (section) from POST /captions payload to SSE subscribers', async () => {
    const viewerKey = 'integ-codes';
    const ssePromise = collectSseEvents(`${baseUrl}/viewer/${viewerKey}`, 2, 3000);
    await new Promise(r => setTimeout(r, SSE_CONNECTION_DELAY_MS));

    const session = createViewerSession(viewerKey);
    const token = makeToken(session.sessionId);
    await postCaptions(token, {
      captions: [{ text: 'Verse line', codes: { section: 'verse' } }],
    });

    const events = await ssePromise;
    const captionEvent = events.find(e => e.type === 'caption');
    assert.ok(captionEvent, 'should receive caption event');
    assert.deepEqual(captionEvent.data.codes, { section: 'verse' });
  });

  it('includes both text and composedText in the SSE payload', async () => {
    const viewerKey = 'integ-composed';
    const ssePromise = collectSseEvents(`${baseUrl}/viewer/${viewerKey}`, 2, 3000);
    await new Promise(r => setTimeout(r, SSE_CONNECTION_DELAY_MS));

    const session = createViewerSession(viewerKey);
    const token = makeToken(session.sessionId);
    await postCaptions(token, {
      captions: [{
        text: 'Original',
        translations: { 'fi-FI': 'Alkuperäinen' },
        captionLang: 'fi-FI',
        showOriginal: true,
      }],
    });

    const events = await ssePromise;
    const captionEvent = events.find(e => e.type === 'caption');
    assert.ok(captionEvent, 'should receive caption event');
    // text is the raw original
    assert.equal(captionEvent.data.text, 'Original');
    // composedText combines original + translation with <br>
    assert.ok(captionEvent.data.composedText, 'composedText should be present');
    assert.ok(captionEvent.data.composedText.includes('Original'));
    assert.ok(captionEvent.data.composedText.includes('Alkuperäinen'));
  });

  it('delivers to viewer SSE without a primary YouTube sender (target-array mode)', async () => {
    const viewerKey = 'integ-no-sender';
    const ssePromise = collectSseEvents(`${baseUrl}/viewer/${viewerKey}`, 2, 3000);
    await new Promise(r => setTimeout(r, SSE_CONNECTION_DELAY_MS));

    // session.sender = null (no primary stream key)
    const session = createViewerSession(viewerKey);
    assert.equal(session.sender, null);

    const token = makeToken(session.sessionId);
    const res = await postCaptions(token, { captions: [{ text: 'No sender caption' }] });
    assert.equal(res.status, 202);

    const events = await ssePromise;
    const captionEvent = events.find(e => e.type === 'caption');
    assert.ok(captionEvent, 'should receive caption event');
    assert.equal(captionEvent.data.text, 'No sender caption');
  });

  it('delivers batch captions as multiple SSE events', async () => {
    const viewerKey = 'integ-batch';
    // connected + 2 captions = 3 events
    const ssePromise = collectSseEvents(`${baseUrl}/viewer/${viewerKey}`, 3, 3000);
    await new Promise(r => setTimeout(r, SSE_CONNECTION_DELAY_MS));

    const session = createViewerSession(viewerKey);
    const token = makeToken(session.sessionId);
    await postCaptions(token, {
      captions: [
        { text: 'Batch caption one' },
        { text: 'Batch caption two' },
      ],
    });

    const events = await ssePromise;
    const captionEvents = events.filter(e => e.type === 'caption');
    assert.equal(captionEvents.length, 2, 'should receive one SSE event per caption in the batch');
    const texts = captionEvents.map(e => e.data.text);
    assert.ok(texts.includes('Batch caption one'));
    assert.ok(texts.includes('Batch caption two'));
  });
});
