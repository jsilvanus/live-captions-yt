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
  isRelayActive,
  setRelayActive,
  getRelay,
  getRelays,
  getRelaySlot,
  upsertRelay,
  deleteRelay,
  deleteRelaySlot,
  deleteAllRelays,
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
// DB helpers for relay_active (user toggle)
// ---------------------------------------------------------------------------

describe('relay_active column', () => {
  let db;

  before(() => { db = initDb(':memory:'); });
  after(() => { db.close(); });

  it('defaults to false on createKey', () => {
    const k = createKey(db, { owner: 'ActiveA' });
    assert.strictEqual(isRelayActive(db, k.key), false);
    assert.strictEqual(formatKey(k).relayActive, false);
  });

  it('setRelayActive sets it to true', () => {
    const k = createKey(db, { owner: 'ActiveB' });
    const changed = setRelayActive(db, k.key, true);
    assert.strictEqual(changed, true);
    assert.strictEqual(isRelayActive(db, k.key), true);
  });

  it('setRelayActive sets it back to false', () => {
    const k = createKey(db, { owner: 'ActiveC' });
    setRelayActive(db, k.key, true);
    setRelayActive(db, k.key, false);
    assert.strictEqual(isRelayActive(db, k.key), false);
  });

  it('isRelayActive returns false for unknown key', () => {
    assert.strictEqual(isRelayActive(db, 'no-such-key'), false);
  });

  it('setRelayActive returns false for unknown key', () => {
    assert.strictEqual(setRelayActive(db, 'no-such-key', true), false);
  });
});

describe('rtmp_relays DB helpers (fan-out)', () => {
  let db;

  before(() => { db = initDb(':memory:'); });
  after(() => { db.close(); });

  it('getRelaySlot returns null when no relay configured', () => {
    assert.strictEqual(getRelaySlot(db, 'no-key', 1), null);
  });

  it('getRelay (compat alias) returns null for slot 1 when no relay configured', () => {
    assert.strictEqual(getRelay(db, 'no-key'), null);
  });

  it('upsertRelay creates relay at slot 1 by default (via compat alias)', () => {
    const relay = upsertRelay(db, 'key-1', 1, 'rtmp://a.example.com/live/xyz');
    assert.strictEqual(relay.apiKey, 'key-1');
    assert.strictEqual(relay.slot, 1);
    assert.strictEqual(relay.targetUrl, 'rtmp://a.example.com/live/xyz');
  });

  it('upsertRelay creates relay at slot 2', () => {
    const relay = upsertRelay(db, 'key-1', 2, 'rtmp://b.example.com/live/xyz');
    assert.strictEqual(relay.slot, 2);
    assert.strictEqual(relay.targetUrl, 'rtmp://b.example.com/live/xyz');
  });

  it('getRelays returns all slots ordered by slot', () => {
    const relays = getRelays(db, 'key-1');
    assert.strictEqual(relays.length, 2);
    assert.strictEqual(relays[0].slot, 1);
    assert.strictEqual(relays[1].slot, 2);
  });

  it('upsertRelay updates existing relay slot', () => {
    upsertRelay(db, 'key-2', 1, 'rtmp://old.example.com/live/key');
    const updated = upsertRelay(db, 'key-2', 1, 'rtmp://new.example.com/live/key');
    assert.strictEqual(updated.targetUrl, 'rtmp://new.example.com/live/key');
  });

  it('deleteRelaySlot removes a specific slot', () => {
    upsertRelay(db, 'key-3', 1, 'rtmp://del.example.com/live/key');
    upsertRelay(db, 'key-3', 2, 'rtmp://del2.example.com/live/key');
    const ok = deleteRelaySlot(db, 'key-3', 1);
    assert.strictEqual(ok, true);
    assert.strictEqual(getRelaySlot(db, 'key-3', 1), null);
    assert.ok(getRelaySlot(db, 'key-3', 2)); // slot 2 still there
  });

  it('deleteAllRelays removes all slots for a key', () => {
    upsertRelay(db, 'key-4', 1, 'rtmp://x.example.com/live/1');
    upsertRelay(db, 'key-4', 2, 'rtmp://x.example.com/live/2');
    const count = deleteAllRelays(db, 'key-4');
    assert.strictEqual(count, 2);
    assert.strictEqual(getRelays(db, 'key-4').length, 0);
  });

  it('deleteRelay (compat alias) removes all slots and returns boolean', () => {
    upsertRelay(db, 'key-5', 1, 'rtmp://y.example.com/live/1');
    const ok = deleteRelay(db, 'key-5');
    assert.strictEqual(ok, true);
    assert.strictEqual(deleteRelay(db, 'ghost'), false);
  });

  it('upsertRelay rejects slot out of range', () => {
    assert.throws(() => upsertRelay(db, 'key-6', 5, 'rtmp://z.example.com/live/1'), /RangeError|slot must be/i);
    assert.throws(() => upsertRelay(db, 'key-6', 0, 'rtmp://z.example.com/live/1'), /RangeError|slot must be/i);
  });

  it('upsertRelay stores targetName and captionMode', () => {
    const relay = upsertRelay(db, 'key-7', 1, 'rtmp://base.example.com/live', { targetName: 'sk', captionMode: 'cea708' });
    assert.strictEqual(relay.targetName, 'sk');
    assert.strictEqual(relay.captionMode, 'cea708');
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

  it('isSlotRunning returns false for unknown key+slot', () => {
    const m = new RtmpRelayManager();
    assert.strictEqual(m.isSlotRunning('no-key', 1), false);
  });

  it('runningSlots returns empty array for unknown key', () => {
    const m = new RtmpRelayManager();
    assert.deepStrictEqual(m.runningSlots('no-key'), []);
  });

  it('stop is a no-op for unknown key', async () => {
    const m = new RtmpRelayManager();
    await assert.doesNotReject(() => m.stop('no-key'));
  });

  it('stopKey is a no-op for unknown key', async () => {
    const m = new RtmpRelayManager();
    await assert.doesNotReject(() => m.stopKey('no-key'));
  });

  it('stopAll resolves when no processes running', async () => {
    const m = new RtmpRelayManager();
    await assert.doesNotReject(() => m.stopAll());
  });

  it('dropPublisher is a no-op when RTMP_CONTROL_URL not set', async () => {
    const m = new RtmpRelayManager({ rtmpControlUrl: null });
    await assert.doesNotReject(() => m.dropPublisher('some-key'));
  });

  it('isPublishing returns false for unknown key', () => {
    const m = new RtmpRelayManager();
    assert.strictEqual(m.isPublishing('unknown-key'), false);
  });

  it('startedAt returns null for unknown key', () => {
    const m = new RtmpRelayManager();
    assert.strictEqual(m.startedAt('no-key'), null);
  });

  it('hasCea708 returns false for unknown key', () => {
    const m = new RtmpRelayManager();
    assert.strictEqual(m.hasCea708('no-key'), false);
  });

  it('writeCaption returns false when no process is running', () => {
    const m = new RtmpRelayManager();
    assert.strictEqual(m.writeCaption('no-key', 'hello'), false);
  });

  it('start() with empty relays is a no-op', async () => {
    const m = new RtmpRelayManager();
    await assert.doesNotReject(() => m.start('some-key', []));
    assert.strictEqual(m.isRunning('some-key'), false);
  });

  it('start() with empty relays resolves and stops any existing process', async () => {
    const m = new RtmpRelayManager();
    // Nothing running — should resolve without error
    await assert.doesNotReject(() => m.start('clean-key', []));
  });

  it('runningSlots reflects slots passed to start() (via meta, no real ffmpeg)', () => {
    const m = new RtmpRelayManager();
    // Manually inject meta to simulate a running process without real ffmpeg
    m._meta.set('fake-key', {
      slots: [{ slot: 1 }, { slot: 3 }],
      startedAt: new Date(),
      hasCea708: false,
      srtSeq: 0,
    });
    assert.deepStrictEqual(m.runningSlots('fake-key'), [1, 3]);
    assert.strictEqual(m.isSlotRunning('fake-key', 1), true);
    assert.strictEqual(m.isSlotRunning('fake-key', 2), false);
    assert.strictEqual(m.isSlotRunning('fake-key', 3), true);
  });

  it('startedAt returns the startedAt Date from meta', () => {
    const m = new RtmpRelayManager();
    const now = new Date();
    m._meta.set('dated-key', { slots: [], startedAt: now, hasCea708: false, srtSeq: 0 });
    assert.strictEqual(m.startedAt('dated-key'), now);
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

  it('marks key as publishing on call=publish', async () => {
    const k = createKey(db, { owner: 'MarkPub', relay_allowed: true });
    assert.strictEqual(relayManager.isPublishing(k.key), false);
    await postRtmp({ call: 'publish', app: 'stream', name: k.key });
    assert.strictEqual(relayManager.isPublishing(k.key), true);
  });

  it('unmarks key on call=publish_done', async () => {
    const k = createKey(db, { owner: 'MarkPubDone', relay_allowed: true });
    await postRtmp({ call: 'publish', app: 'stream', name: k.key });
    await postRtmp({ call: 'publish_done', app: 'stream', name: k.key });
    assert.strictEqual(relayManager.isPublishing(k.key), false);
  });

  it('does NOT start fan-out when relay_active=false even with slots configured', async () => {
    // relay_allowed=true but relay_active=false (default)
    const k = createKey(db, { owner: 'InactiveRelay', relay_allowed: true });
    upsertRelay(db, k.key, 1, 'rtmp://target.example.com/live');
    const startedKeys = [];
    relayManager._onStreamStarted = (apiKey) => startedKeys.push(apiKey);
    await postRtmp({ call: 'publish', app: 'stream', name: k.key });
    assert.strictEqual(startedKeys.length, 0, 'fan-out should NOT start when relay_active=false');
    relayManager._onStreamStarted = null;
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
// /stream CRUD — fan-out (up to 4 slots per key)
// ---------------------------------------------------------------------------

describe('/stream CRUD (fan-out)', () => {
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

  it('GET /stream returns empty relays when none configured', async () => {
    const res = await fetch(`${baseUrl}/stream`, { headers: bearerHeaders(token) });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.relays));
    assert.strictEqual(body.relays.length, 0);
    assert.ok(Array.isArray(body.runningSlots));
    assert.strictEqual(body.active, false, 'relay_active should default to false');
  });

  it('PUT /stream/active returns 400 when active is not a boolean', async () => {
    const res = await fetch(`${baseUrl}/stream/active`, {
      method: 'PUT',
      headers: bearerHeaders(token),
      body: JSON.stringify({ active: 'yes' }),
    });
    assert.strictEqual(res.status, 400);
  });

  it('PUT /stream/active sets relay active to true', async () => {
    const res = await fetch(`${baseUrl}/stream/active`, {
      method: 'PUT',
      headers: bearerHeaders(token),
      body: JSON.stringify({ active: true }),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.active, true);
    // GET /stream should reflect the new state
    const getRes = await fetch(`${baseUrl}/stream`, { headers: bearerHeaders(token) });
    const getBody = await getRes.json();
    assert.strictEqual(getBody.active, true);
  });

  it('PUT /stream/active sets relay active to false', async () => {
    const res = await fetch(`${baseUrl}/stream/active`, {
      method: 'PUT',
      headers: bearerHeaders(token),
      body: JSON.stringify({ active: false }),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.active, false);
  });

  it('POST /stream creates relay slot 1 with targetName and captionMode', async () => {
    const res = await fetch(`${baseUrl}/stream`, {
      method: 'POST',
      headers: bearerHeaders(token),
      body: JSON.stringify({ slot: 1, targetUrl: 'rtmp://target.example.com/live', targetName: 'mykey', captionMode: 'http' }),
    });
    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.strictEqual(body.relay.slot, 1);
    assert.strictEqual(body.relay.targetUrl, 'rtmp://target.example.com/live');
    assert.strictEqual(body.relay.targetName, 'mykey');
    assert.strictEqual(body.relay.captionMode, 'http');
  });

  it('POST /stream creates relay slot 2 (second target in fan-out)', async () => {
    const res = await fetch(`${baseUrl}/stream`, {
      method: 'POST',
      headers: bearerHeaders(token),
      body: JSON.stringify({ slot: 2, targetUrl: 'rtmp://target2.example.com/live', targetName: 'secondkey' }),
    });
    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.strictEqual(body.relay.slot, 2);
    assert.strictEqual(body.relay.targetUrl, 'rtmp://target2.example.com/live');
  });

  it('GET /stream returns all configured slots + runningSlots', async () => {
    const res = await fetch(`${baseUrl}/stream`, { headers: bearerHeaders(token) });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.relays));
    assert.strictEqual(body.relays.length, 2);
    assert.ok(Array.isArray(body.runningSlots));
  });

  it('GET /stream/history returns stream history array', async () => {
    const res = await fetch(`${baseUrl}/stream/history`, { headers: bearerHeaders(token) });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.streams));
  });

  it('PUT /stream/1 updates relay slot 1', async () => {
    const res = await fetch(`${baseUrl}/stream/1`, {
      method: 'PUT',
      headers: bearerHeaders(token),
      body: JSON.stringify({ targetUrl: 'rtmp://new.example.com/live/updated' }),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.relay.targetUrl, 'rtmp://new.example.com/live/updated');
    assert.strictEqual(body.relay.targetName, null);
  });

  it('PUT /stream/3 returns 404 when slot 3 not configured', async () => {
    const res = await fetch(`${baseUrl}/stream/3`, {
      method: 'PUT',
      headers: bearerHeaders(token),
      body: JSON.stringify({ targetUrl: 'rtmp://x.example.com/live/y' }),
    });
    assert.strictEqual(res.status, 404);
  });

  it('POST /stream returns 400 for invalid targetUrl', async () => {
    const res = await fetch(`${baseUrl}/stream`, {
      method: 'POST',
      headers: bearerHeaders(token),
      body: JSON.stringify({ slot: 3, targetUrl: 'https://not-rtmp.example.com' }),
    });
    assert.strictEqual(res.status, 400);
  });

  it('POST /stream returns 400 for slot out of range', async () => {
    const res = await fetch(`${baseUrl}/stream`, {
      method: 'POST',
      headers: bearerHeaders(token),
      body: JSON.stringify({ slot: 5, targetUrl: 'rtmp://x.example.com/live/y' }),
    });
    assert.strictEqual(res.status, 400);
  });

  it('DELETE /stream/2 removes slot 2 only', async () => {
    const res = await fetch(`${baseUrl}/stream/2`, {
      method: 'DELETE',
      headers: bearerHeaders(token),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.slot, 2);
    // Slot 1 should still exist
    const getRes = await fetch(`${baseUrl}/stream`, { headers: bearerHeaders(token) });
    const getBody = await getRes.json();
    assert.strictEqual(getBody.relays.length, 1);
    assert.strictEqual(getBody.relays[0].slot, 1);
  });

  it('DELETE /stream removes all relay configs', async () => {
    const res = await fetch(`${baseUrl}/stream`, {
      method: 'DELETE',
      headers: bearerHeaders(token),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    // All relays gone
    const getRes = await fetch(`${baseUrl}/stream`, { headers: bearerHeaders(token) });
    const getBody = await getRes.json();
    assert.strictEqual(getBody.relays.length, 0);
  });

  it('GET /stream returns 403 for key without relay_allowed', async () => {
    const k2 = createKey(db, { owner: 'NoStream' });
    const t2 = jwt.sign({ sessionId: 'fake2', apiKey: k2.key }, JWT_SECRET, { expiresIn: '1h' });
    const res = await fetch(`${baseUrl}/stream`, { headers: bearerHeaders(t2) });
    assert.strictEqual(res.status, 403);
  });
});
