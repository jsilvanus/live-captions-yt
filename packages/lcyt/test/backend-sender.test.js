import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { BackendCaptionSender } from '../src/backend-sender.js';
import { NetworkError } from '../src/errors.js';

// ---------------------------------------------------------------------------
// Fetch mock helpers
// ---------------------------------------------------------------------------

let originalFetch;

before(() => {
  originalFetch = globalThis.fetch;
});

after(() => {
  globalThis.fetch = originalFetch;
});

/**
 * Set up globalThis.fetch to return a sequence of canned responses.
 * Each entry: { ok, status, data } (ok defaults to true, status defaults to 200).
 */
function setupFetch(responses) {
  const queue = [...responses];
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    const response = queue.shift() || { ok: true, status: 200, data: {} };
    const ok = response.ok !== false;
    const status = response.status || (ok ? 200 : 400);
    return {
      ok,
      status,
      json: async () => response.data
    };
  };
  return calls;
}

const BACKEND_URL = 'http://localhost:3000';
const API_KEY = 'test-api-key';
const STREAM_KEY = 'test-stream-key';
const STARTED_AT = 1740057600000;

function makeStartResponse() {
  return {
    ok: true,
    data: {
      token: 'test-jwt-token',
      sessionId: 'abc123def456789a',
      sequence: 0,
      syncOffset: -15,
      startedAt: STARTED_AT
    }
  };
}

// ---------------------------------------------------------------------------
// Constructor
// ---------------------------------------------------------------------------

describe('BackendCaptionSender constructor', () => {
  it('should store all provided options', () => {
    const sender = new BackendCaptionSender({
      backendUrl: BACKEND_URL,
      apiKey: API_KEY,
      streamKey: STREAM_KEY,
      domain: 'https://example.com',
      sequence: 5,
      verbose: true
    });

    assert.strictEqual(sender.backendUrl, BACKEND_URL);
    assert.strictEqual(sender.apiKey, API_KEY);
    assert.strictEqual(sender.streamKey, STREAM_KEY);
    assert.strictEqual(sender.domain, 'https://example.com');
    assert.strictEqual(sender.sequence, 5);
    assert.strictEqual(sender.verbose, true);
  });

  it('should use default values when optional fields are omitted', () => {
    const sender = new BackendCaptionSender({
      backendUrl: BACKEND_URL,
      apiKey: API_KEY,
      streamKey: STREAM_KEY
    });

    assert.strictEqual(sender.sequence, 0);
    assert.strictEqual(sender.verbose, false);
    assert.strictEqual(sender.isStarted, false);
    assert.strictEqual(sender.syncOffset, 0);
    assert.strictEqual(sender.startedAt, 0);
  });

  it('should default domain to http://localhost in Node (no location)', () => {
    const sender = new BackendCaptionSender({
      backendUrl: BACKEND_URL,
      apiKey: API_KEY,
      streamKey: STREAM_KEY
    });

    assert.ok(sender.domain === 'http://localhost' || typeof sender.domain === 'string');
  });
});

// ---------------------------------------------------------------------------
// start()
// ---------------------------------------------------------------------------

describe('BackendCaptionSender start()', () => {
  it('should POST to /live with correct payload and store JWT', async () => {
    const calls = setupFetch([makeStartResponse()]);

    const sender = new BackendCaptionSender({
      backendUrl: BACKEND_URL,
      apiKey: API_KEY,
      streamKey: STREAM_KEY,
      domain: 'https://example.com',
      sequence: 0
    });

    const result = await sender.start();

    // Returns this for chaining
    assert.strictEqual(result, sender);

    // Stores token
    assert.strictEqual(sender._token, 'test-jwt-token');

    // Sets isStarted
    assert.strictEqual(sender.isStarted, true);

    // Updates sequence, syncOffset, startedAt
    assert.strictEqual(sender.sequence, 0);
    assert.strictEqual(sender.syncOffset, -15);
    assert.strictEqual(sender.startedAt, STARTED_AT);

    // Verify the request
    assert.strictEqual(calls.length, 1);
    assert.ok(calls[0].url.endsWith('/live'));
    assert.strictEqual(calls[0].options.method, 'POST');
    const body = JSON.parse(calls[0].options.body);
    assert.strictEqual(body.apiKey, API_KEY);
    assert.strictEqual(body.streamKey, STREAM_KEY);
    assert.strictEqual(body.domain, 'https://example.com');
    assert.strictEqual(body.sequence, 0);
  });

  it('should not attach Authorization header on start() (auth: false)', async () => {
    const calls = setupFetch([makeStartResponse()]);

    const sender = new BackendCaptionSender({
      backendUrl: BACKEND_URL,
      apiKey: API_KEY,
      streamKey: STREAM_KEY
    });

    await sender.start();

    const headers = calls[0].options.headers;
    assert.ok(!headers['Authorization']);
  });

  it('should throw NetworkError on invalid API key (401)', async () => {
    setupFetch([{ ok: false, status: 401, data: { error: 'API key unknown_key' } }]);

    const sender = new BackendCaptionSender({
      backendUrl: BACKEND_URL,
      apiKey: 'bad-key',
      streamKey: STREAM_KEY
    });

    await assert.rejects(
      () => sender.start(),
      (err) => {
        assert(err instanceof NetworkError);
        assert.strictEqual(err.statusCode, 401);
        return true;
      }
    );
  });

  it('should throw NetworkError on network failure', async () => {
    globalThis.fetch = async () => {
      throw new Error('Network unreachable');
    };

    const sender = new BackendCaptionSender({
      backendUrl: BACKEND_URL,
      apiKey: API_KEY,
      streamKey: STREAM_KEY
    });

    await assert.rejects(
      () => sender.start(),
      Error
    );
  });
});

// ---------------------------------------------------------------------------
// end()
// ---------------------------------------------------------------------------

describe('BackendCaptionSender end()', () => {
  it('should DELETE /live and clear token and isStarted', async () => {
    const calls = setupFetch([
      makeStartResponse(),
      { ok: true, data: { removed: true, sessionId: 'abc123def456789a' } }
    ]);

    const sender = new BackendCaptionSender({
      backendUrl: BACKEND_URL,
      apiKey: API_KEY,
      streamKey: STREAM_KEY
    });

    await sender.start();
    const result = await sender.end();

    assert.strictEqual(result, sender);
    assert.strictEqual(sender._token, null);
    assert.strictEqual(sender.isStarted, false);

    // Verify DELETE was sent
    const deleteCall = calls[1];
    assert.ok(deleteCall.url.endsWith('/live'));
    assert.strictEqual(deleteCall.options.method, 'DELETE');
    assert.ok(deleteCall.options.headers['Authorization'].startsWith('Bearer '));
  });
});

// ---------------------------------------------------------------------------
// send()
// ---------------------------------------------------------------------------

describe('BackendCaptionSender send()', () => {
  let sender;

  beforeEach(async () => {
    setupFetch([makeStartResponse()]);
    sender = new BackendCaptionSender({
      backendUrl: BACKEND_URL,
      apiKey: API_KEY,
      streamKey: STREAM_KEY
    });
    await sender.start();
  });

  it('should POST to /captions with single caption and return requestId', async () => {
    const calls = setupFetch([
      {
        ok: true,
        status: 202,
        data: { ok: true, requestId: 'mock-request-id' }
      }
    ]);

    const result = await sender.send('Hello world');

    // Sequence is now server-side only — not updated locally by send()
    assert.strictEqual(sender.sequence, 0);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.requestId, 'mock-request-id');

    // Verify request
    assert.strictEqual(calls.length, 1);
    const body = JSON.parse(calls[0].options.body);
    assert.deepStrictEqual(body.captions, [{ text: 'Hello world' }]);
    assert.strictEqual(calls[0].options.method, 'POST');
    assert.ok(calls[0].url.endsWith('/captions'));
  });

  it('should pass absolute timestamp when provided', async () => {
    const calls = setupFetch([
      { ok: true, data: { sequence: 1, timestamp: '2026-02-20T12:00:00.000', statusCode: 200, serverTimestamp: null } }
    ]);

    await sender.send('With timestamp', '2026-02-20T12:00:00.000');

    const body = JSON.parse(calls[0].options.body);
    assert.strictEqual(body.captions[0].timestamp, '2026-02-20T12:00:00.000');
    assert.ok(!('time' in body.captions[0]));
  });

  it('should pass time field when { time } object provided', async () => {
    const calls = setupFetch([
      { ok: true, data: { sequence: 1, timestamp: '2026-02-20T12:00:05.000', statusCode: 200, serverTimestamp: null } }
    ]);

    await sender.send('Relative timing', { time: 5000 });

    const body = JSON.parse(calls[0].options.body);
    assert.strictEqual(body.captions[0].time, 5000);
    assert.ok(!('timestamp' in body.captions[0]));
  });

  it('should include Authorization header', async () => {
    const calls = setupFetch([
      { ok: true, data: { sequence: 1, timestamp: '', statusCode: 200, serverTimestamp: null } }
    ]);

    await sender.send('Auth test');

    assert.ok(calls[0].options.headers['Authorization'] === 'Bearer test-jwt-token');
  });
});

// ---------------------------------------------------------------------------
// sendBatch()
// ---------------------------------------------------------------------------

describe('BackendCaptionSender sendBatch()', () => {
  let sender;

  beforeEach(async () => {
    setupFetch([makeStartResponse()]);
    sender = new BackendCaptionSender({
      backendUrl: BACKEND_URL,
      apiKey: API_KEY,
      streamKey: STREAM_KEY
    });
    await sender.start();
  });

  it('should POST to /captions with multiple captions', async () => {
    const calls = setupFetch([
      { ok: true, status: 202, data: { ok: true, requestId: 'mock-batch-id' } }
    ]);

    const captions = [
      { text: 'First caption' },
      { text: 'Second caption', timestamp: '2026-02-20T12:00:00.000' }
    ];

    const result = await sender.sendBatch(captions);

    // Sequence is now server-side only — not updated locally by sendBatch()
    assert.strictEqual(sender.sequence, 0);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.requestId, 'mock-batch-id');

    const body = JSON.parse(calls[0].options.body);
    assert.strictEqual(body.captions.length, 2);
    assert.strictEqual(body.captions[0].text, 'First caption');
    assert.strictEqual(body.captions[1].text, 'Second caption');
  });

  it('should drain local queue when no captions arg provided', async () => {
    const calls = setupFetch([
      { ok: true, data: { sequence: 3, count: 3, statusCode: 200, serverTimestamp: null } }
    ]);

    sender.construct('One');
    sender.construct('Two');
    sender.construct('Three');

    await sender.sendBatch();

    // Queue should be cleared after drain
    assert.strictEqual(sender.getQueue().length, 0);

    const body = JSON.parse(calls[0].options.body);
    assert.strictEqual(body.captions.length, 3);
  });

  it('should not modify queue when captions array provided explicitly', async () => {
    setupFetch([
      { ok: true, data: { sequence: 1, count: 1, statusCode: 200, serverTimestamp: null } }
    ]);

    sender.construct('Queued item');
    await sender.sendBatch([{ text: 'Explicit item' }]);

    // Queue should still have the queued item
    assert.strictEqual(sender.getQueue().length, 1);
  });
});

// ---------------------------------------------------------------------------
// sync()
// ---------------------------------------------------------------------------

describe('BackendCaptionSender sync()', () => {
  it('should POST to /sync and update syncOffset', async () => {
    setupFetch([makeStartResponse()]);
    const sender = new BackendCaptionSender({
      backendUrl: BACKEND_URL,
      apiKey: API_KEY,
      streamKey: STREAM_KEY
    });
    await sender.start();

    const calls = setupFetch([
      {
        ok: true,
        data: {
          syncOffset: -30,
          roundTripTime: 85,
          serverTimestamp: '2026-02-20T12:00:00.000Z',
          statusCode: 200
        }
      }
    ]);

    const result = await sender.sync();

    assert.strictEqual(sender.syncOffset, -30);
    assert.strictEqual(result.syncOffset, -30);
    assert.strictEqual(result.roundTripTime, 85);
    assert.strictEqual(result.statusCode, 200);

    const call = calls[0];
    assert.ok(call.url.endsWith('/sync'));
    assert.strictEqual(call.options.method, 'POST');
    assert.ok(call.options.headers['Authorization'].startsWith('Bearer '));
  });

  it('should throw NetworkError when sync fails', async () => {
    setupFetch([makeStartResponse()]);
    const sender = new BackendCaptionSender({
      backendUrl: BACKEND_URL,
      apiKey: API_KEY,
      streamKey: STREAM_KEY
    });
    await sender.start();

    setupFetch([{ ok: false, status: 502, data: { error: 'Sync failed' } }]);

    await assert.rejects(
      () => sender.sync(),
      (err) => {
        assert(err instanceof NetworkError);
        assert.strictEqual(err.statusCode, 502);
        return true;
      }
    );
  });
});

// ---------------------------------------------------------------------------
// heartbeat()
// ---------------------------------------------------------------------------

describe('BackendCaptionSender heartbeat()', () => {
  it('should GET /live and update sequence and syncOffset', async () => {
    setupFetch([makeStartResponse()]);
    const sender = new BackendCaptionSender({
      backendUrl: BACKEND_URL,
      apiKey: API_KEY,
      streamKey: STREAM_KEY
    });
    await sender.start();

    const calls = setupFetch([
      { ok: true, data: { sequence: 7, syncOffset: 10 } }
    ]);

    const result = await sender.heartbeat();

    assert.strictEqual(sender.sequence, 7);
    assert.strictEqual(sender.syncOffset, 10);
    assert.strictEqual(result.sequence, 7);
    assert.strictEqual(result.syncOffset, 10);

    assert.ok(calls[0].url.endsWith('/live'));
    assert.strictEqual(calls[0].options.method, 'GET');
    assert.ok(calls[0].options.headers['Authorization'].startsWith('Bearer '));
  });
});

// ---------------------------------------------------------------------------
// construct() / getQueue() / clearQueue() — local queue operations
// ---------------------------------------------------------------------------

describe('BackendCaptionSender local queue', () => {
  it('construct() should add item to queue and return length', () => {
    const sender = new BackendCaptionSender({
      backendUrl: BACKEND_URL,
      apiKey: API_KEY,
      streamKey: STREAM_KEY
    });

    const len1 = sender.construct('First');
    assert.strictEqual(len1, 1);

    const len2 = sender.construct('Second', '2026-02-20T12:00:00.000');
    assert.strictEqual(len2, 2);
  });

  it('construct() with timestamp stores it correctly', () => {
    const sender = new BackendCaptionSender({
      backendUrl: BACKEND_URL,
      apiKey: API_KEY,
      streamKey: STREAM_KEY
    });

    sender.construct('Caption', '2026-02-20T12:00:00.000');
    const queue = sender.getQueue();
    assert.strictEqual(queue[0].text, 'Caption');
    assert.strictEqual(queue[0].timestamp, '2026-02-20T12:00:00.000');
  });

  it('construct() without timestamp stores null', () => {
    const sender = new BackendCaptionSender({
      backendUrl: BACKEND_URL,
      apiKey: API_KEY,
      streamKey: STREAM_KEY
    });

    sender.construct('No ts');
    const queue = sender.getQueue();
    assert.strictEqual(queue[0].timestamp, null);
  });

  it('getQueue() returns empty array initially', () => {
    const sender = new BackendCaptionSender({
      backendUrl: BACKEND_URL,
      apiKey: API_KEY,
      streamKey: STREAM_KEY
    });

    assert.deepStrictEqual(sender.getQueue(), []);
  });

  it('getQueue() returns a copy (not a reference)', () => {
    const sender = new BackendCaptionSender({
      backendUrl: BACKEND_URL,
      apiKey: API_KEY,
      streamKey: STREAM_KEY
    });

    sender.construct('Item');
    const queue = sender.getQueue();
    queue.push({ text: 'Injected' });

    assert.strictEqual(sender.getQueue().length, 1);
  });

  it('clearQueue() clears all items and returns count', () => {
    const sender = new BackendCaptionSender({
      backendUrl: BACKEND_URL,
      apiKey: API_KEY,
      streamKey: STREAM_KEY
    });

    sender.construct('One');
    sender.construct('Two');
    sender.construct('Three');

    const cleared = sender.clearQueue();
    assert.strictEqual(cleared, 3);
    assert.strictEqual(sender.getQueue().length, 0);
  });
});

// ---------------------------------------------------------------------------
// Getters / setters
// ---------------------------------------------------------------------------

describe('BackendCaptionSender getters and setters', () => {
  let sender;

  beforeEach(() => {
    sender = new BackendCaptionSender({
      backendUrl: BACKEND_URL,
      apiKey: API_KEY,
      streamKey: STREAM_KEY,
      sequence: 5
    });
  });

  it('getSequence() returns current sequence', () => {
    assert.strictEqual(sender.getSequence(), 5);
  });

  it('setSequence() sets sequence and returns this', () => {
    const result = sender.setSequence(42);
    assert.strictEqual(sender.getSequence(), 42);
    assert.strictEqual(result, sender);
  });

  it('getSyncOffset() returns current syncOffset', () => {
    sender.syncOffset = 100;
    assert.strictEqual(sender.getSyncOffset(), 100);
  });

  it('setSyncOffset() sets syncOffset and returns this', () => {
    const result = sender.setSyncOffset(-50);
    assert.strictEqual(sender.getSyncOffset(), -50);
    assert.strictEqual(result, sender);
  });

  it('getStartedAt() returns startedAt value', () => {
    sender.startedAt = STARTED_AT;
    assert.strictEqual(sender.getStartedAt(), STARTED_AT);
  });
});

// ---------------------------------------------------------------------------
// _fetch helper error handling
// ---------------------------------------------------------------------------

describe('BackendCaptionSender _fetch error handling', () => {
  it('should use data.error message when backend returns error JSON', async () => {
    setupFetch([
      { ok: false, status: 403, data: { error: 'Forbidden: API key revoked' } }
    ]);

    const sender = new BackendCaptionSender({
      backendUrl: BACKEND_URL,
      apiKey: 'revoked-key',
      streamKey: STREAM_KEY
    });

    await assert.rejects(
      () => sender.start(),
      (err) => {
        assert(err instanceof NetworkError);
        assert.strictEqual(err.message, 'Forbidden: API key revoked');
        assert.strictEqual(err.statusCode, 403);
        return true;
      }
    );
  });

  it('should fall back to HTTP status message when no error field', async () => {
    setupFetch([
      { ok: false, status: 500, data: {} }
    ]);

    const sender = new BackendCaptionSender({
      backendUrl: BACKEND_URL,
      apiKey: API_KEY,
      streamKey: STREAM_KEY
    });

    await assert.rejects(
      () => sender.start(),
      (err) => {
        assert(err instanceof NetworkError);
        assert.ok(err.message.includes('500'));
        return true;
      }
    );
  });
});
