import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { createServer } from 'node:http';
import express from 'express';
import {
  initDb,
  createKey,
  getKey,
  updateKey,
  formatKey,
  isRelayAllowed,
  getRelay,
  upsertRelay,
  deleteRelay,
} from '../src/db.js';
import { createKeysRouter } from '../src/routes/keys.js';
import { createRtmpRouter } from '../src/routes/rtmp.js';
import { createStreamRouter } from '../src/routes/stream.js';
import { createAuthMiddleware } from '../src/middleware/auth.js';
import { RtmpRelayManager } from '../src/rtmp-manager.js';
import jwt from 'jsonwebtoken';

const ADMIN_KEY = 'test-admin-key';
const JWT_SECRET = 'test-jwt-secret';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function adminHeaders() {
  return { 'Content-Type': 'application/json', 'X-Admin-Key': ADMIN_KEY };
}

function bearerHeaders(token) {
  return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };
}

// ---------------------------------------------------------------------------
// DB helpers for relay_allowed
// ---------------------------------------------------------------------------

describe('relay_allowed column', () => {
  let db;

  before(() => { db = initDb(':memory:'); });
  after(() => { db.close(); });

  it('defaults to false on createKey', () => {
    const k = createKey(db, { owner: 'Alice' });
    assert.strictEqual(k.relay_allowed, 0);
    assert.strictEqual(formatKey(k).relayAllowed, false);
  });

  it('can be set to true on createKey', () => {
    const k = createKey(db, { owner: 'Bob', relay_allowed: true });
    assert.strictEqual(k.relay_allowed, 1);
    assert.strictEqual(formatKey(k).relayAllowed, true);
  });

  it('isRelayAllowed returns false by default', () => {
    const k = createKey(db, { owner: 'Carol' });
    assert.strictEqual(isRelayAllowed(db, k.key), false);
  });

  it('isRelayAllowed returns true after updateKey', () => {
    const k = createKey(db, { owner: 'Dave' });
    updateKey(db, k.key, { relay_allowed: true });
    assert.strictEqual(isRelayAllowed(db, k.key), true);
  });

  it('isRelayAllowed returns false for unknown key', () => {
    assert.strictEqual(isRelayAllowed(db, 'no-such-key'), false);
  });
});

// ---------------------------------------------------------------------------
// DB helpers for rtmp_relays table
// ---------------------------------------------------------------------------

describe('rtmp_relays DB helpers', () => {
  let db;

  before(() => { db = initDb(':memory:'); });
  after(() => { db.close(); });

  it('getRelay returns null when no relay configured', () => {
    assert.strictEqual(getRelay(db, 'no-key'), null);
  });

  it('upsertRelay creates a relay', () => {
    const relay = upsertRelay(db, 'key-1', 'rtmp://a.example.com/live/xyz');
    assert.strictEqual(relay.apiKey, 'key-1');
    assert.strictEqual(relay.targetUrl, 'rtmp://a.example.com/live/xyz');
  });

  it('upsertRelay updates existing relay', () => {
    upsertRelay(db, 'key-2', 'rtmp://old.example.com/live/key');
    const updated = upsertRelay(db, 'key-2', 'rtmp://new.example.com/live/key');
    assert.strictEqual(updated.targetUrl, 'rtmp://new.example.com/live/key');
  });

  it('deleteRelay removes the relay', () => {
    upsertRelay(db, 'key-3', 'rtmp://del.example.com/live/key');
    const ok = deleteRelay(db, 'key-3');
    assert.strictEqual(ok, true);
    assert.strictEqual(getRelay(db, 'key-3'), null);
  });

  it('deleteRelay returns false for non-existent key', () => {
    assert.strictEqual(deleteRelay(db, 'ghost'), false);
  });
});

// ---------------------------------------------------------------------------
// PATCH /keys/:key — relay_allowed
// ---------------------------------------------------------------------------

describe('PATCH /keys/:key relay_allowed', () => {
  let db, server, baseUrl;

  before(() => new Promise((resolve) => {
    db = initDb(':memory:');
    const app = express();
    app.use(express.json());
    app.use('/keys', createKeysRouter(db));
    server = createServer(app);
    server.listen(0, () => {
      baseUrl = `http://localhost:${server.address().port}`;
      resolve();
    });
    process.env.ADMIN_KEY = ADMIN_KEY;
  }));

  after(() => new Promise((resolve) => {
    db.close();
    server.close(resolve);
  }));

  it('should set relay_allowed via PATCH', async () => {
    const k = createKey(db, { owner: 'Relay-Test' });
    const res = await fetch(`${baseUrl}/keys/${k.key}`, {
      method: 'PATCH',
      headers: adminHeaders(),
      body: JSON.stringify({ relay_allowed: true }),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.relayAllowed, true);
  });

  it('should unset relay_allowed via PATCH', async () => {
    const k = createKey(db, { owner: 'Relay-Test2', relay_allowed: true });
    const res = await fetch(`${baseUrl}/keys/${k.key}`, {
      method: 'PATCH',
      headers: adminHeaders(),
      body: JSON.stringify({ relay_allowed: false }),
    });
    const body = await res.json();
    assert.strictEqual(body.relayAllowed, false);
  });
});

// ---------------------------------------------------------------------------
// RtmpRelayManager unit tests
// ---------------------------------------------------------------------------

describe('RtmpRelayManager', () => {
  it('isRunning returns false for unknown key', () => {
    const m = new RtmpRelayManager();
    assert.strictEqual(m.isRunning('no-key'), false);
  });

  it('stop is a no-op for unknown key', async () => {
    const m = new RtmpRelayManager();
    await assert.doesNotReject(() => m.stop('no-key'));
  });

  it('stopAll resolves when no processes running', async () => {
    const m = new RtmpRelayManager();
    await assert.doesNotReject(() => m.stopAll());
  });
});

// ---------------------------------------------------------------------------
// POST /rtmp — nginx-rtmp callback (form-encoded body)
// ---------------------------------------------------------------------------

describe('POST /rtmp (nginx-rtmp callbacks)', () => {
  let db, server, baseUrl, relayManager;

  before(() => new Promise((resolve) => {
    db = initDb(':memory:');
    relayManager = new RtmpRelayManager();
    const app = express();
    // Note: createRtmpRouter registers express.urlencoded() internally,
    // so no additional body parser is needed here.
    app.use('/rtmp', createRtmpRouter(db, relayManager));
    server = createServer(app);
    server.listen(0, () => {
      baseUrl = `http://localhost:${server.address().port}`;
      resolve();
    });
  }));

  after(() => new Promise((resolve) => {
    db.close();
    server.close(resolve);
  }));

  function postRtmp(fields) {
    const body = new URLSearchParams(fields).toString();
    return fetch(`${baseUrl}/rtmp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  }

  it('returns 400 when name is missing', async () => {
    const res = await postRtmp({ call: 'publish', app: 'stream' });
    assert.strictEqual(res.status, 400);
  });

  it('returns 403 when relay not allowed (call=publish)', async () => {
    const k = createKey(db, { owner: 'NoRelay' });
    const res = await postRtmp({ call: 'publish', app: 'stream', name: k.key });
    assert.strictEqual(res.status, 403);
  });

  it('returns 200 when relay_allowed (no relay configured)', async () => {
    const k = createKey(db, { owner: 'WithRelay', relay_allowed: true });
    const res = await postRtmp({ call: 'publish', app: 'stream', name: k.key });
    assert.strictEqual(res.status, 200);
  });

  it('returns 200 for call=publish_done even for unknown key', async () => {
    const res = await postRtmp({ call: 'publish_done', app: 'stream', name: 'ghost-key' });
    assert.strictEqual(res.status, 200);
  });

  it('returns 400 for unknown call type', async () => {
    const k = createKey(db, { owner: 'BadCall', relay_allowed: true });
    const res = await postRtmp({ call: 'unknown', app: 'stream', name: k.key });
    assert.strictEqual(res.status, 400);
  });

  it('rejects wrong app name when RTMP_APPLICATION is set', async () => {
    const k = createKey(db, { owner: 'WrongApp', relay_allowed: true });
    const saved = process.env.RTMP_APPLICATION;
    process.env.RTMP_APPLICATION = 'expected-app';
    try {
      const res = await postRtmp({ call: 'publish', app: 'wrong-app', name: k.key });
      assert.strictEqual(res.status, 403);
    } finally {
      if (saved === undefined) delete process.env.RTMP_APPLICATION;
      else process.env.RTMP_APPLICATION = saved;
    }
  });

  it('accepts correct app name when RTMP_APPLICATION is set', async () => {
    const k = createKey(db, { owner: 'RightApp', relay_allowed: true });
    const saved = process.env.RTMP_APPLICATION;
    process.env.RTMP_APPLICATION = 'live';
    try {
      const res = await postRtmp({ call: 'publish_done', app: 'live', name: k.key });
      assert.strictEqual(res.status, 200);
    } finally {
      if (saved === undefined) delete process.env.RTMP_APPLICATION;
      else process.env.RTMP_APPLICATION = saved;
    }
  });
});

// ---------------------------------------------------------------------------
// /stream CRUD
// ---------------------------------------------------------------------------

describe('/stream CRUD', () => {
  let db, server, baseUrl, relayManager;
  let apiKey, token;

  before(() => new Promise((resolve) => {
    db = initDb(':memory:');
    relayManager = new RtmpRelayManager();
    const auth = createAuthMiddleware(JWT_SECRET);
    const app = express();
    app.use(express.json());
    app.use('/stream', createStreamRouter(db, auth, relayManager));
    server = createServer(app);
    server.listen(0, () => {
      baseUrl = `http://localhost:${server.address().port}`;

      // Create a key with relay_allowed=true
      const k = createKey(db, { owner: 'StreamUser', relay_allowed: true });
      apiKey = k.key;
      // Issue a JWT that auth middleware will accept
      token = jwt.sign({ sessionId: 'fake-session', apiKey }, JWT_SECRET, { expiresIn: '1h' });

      resolve();
    });
  }));

  after(() => new Promise((resolve) => {
    db.close();
    server.close(resolve);
  }));

  it('GET /stream returns 404 when no relay configured', async () => {
    const res = await fetch(`${baseUrl}/stream`, { headers: bearerHeaders(token) });
    assert.strictEqual(res.status, 404);
  });

  it('POST /stream creates relay config', async () => {
    const res = await fetch(`${baseUrl}/stream`, {
      method: 'POST',
      headers: bearerHeaders(token),
      body: JSON.stringify({ targetUrl: 'rtmp://target.example.com/live/key' }),
    });
    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.strictEqual(body.relay.targetUrl, 'rtmp://target.example.com/live/key');
  });

  it('GET /stream returns relay config after POST', async () => {
    const res = await fetch(`${baseUrl}/stream`, { headers: bearerHeaders(token) });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(body.relay);
    assert.strictEqual(typeof body.running, 'boolean');
  });

  it('PUT /stream updates relay target', async () => {
    const res = await fetch(`${baseUrl}/stream`, {
      method: 'PUT',
      headers: bearerHeaders(token),
      body: JSON.stringify({ targetUrl: 'rtmp://new.example.com/live/updated' }),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.relay.targetUrl, 'rtmp://new.example.com/live/updated');
  });

  it('POST /stream returns 400 for invalid targetUrl', async () => {
    const res = await fetch(`${baseUrl}/stream`, {
      method: 'POST',
      headers: bearerHeaders(token),
      body: JSON.stringify({ targetUrl: 'https://not-rtmp.example.com' }),
    });
    assert.strictEqual(res.status, 400);
  });

  it('DELETE /stream removes relay config', async () => {
    const res = await fetch(`${baseUrl}/stream`, {
      method: 'DELETE',
      headers: bearerHeaders(token),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
  });

  it('GET /stream returns 403 for key without relay_allowed', async () => {
    const k2 = createKey(db, { owner: 'NoStream' });
    const t2 = jwt.sign({ sessionId: 'fake2', apiKey: k2.key }, JWT_SECRET, { expiresIn: '1h' });
    const res = await fetch(`${baseUrl}/stream`, { headers: bearerHeaders(t2) });
    assert.strictEqual(res.status, 403);
  });

  it('PUT /stream returns 404 when no relay configured', async () => {
    // relay was deleted in previous test
    const res = await fetch(`${baseUrl}/stream`, {
      method: 'PUT',
      headers: bearerHeaders(token),
      body: JSON.stringify({ targetUrl: 'rtmp://x.example.com/live/y' }),
    });
    assert.strictEqual(res.status, 404);
  });
});
