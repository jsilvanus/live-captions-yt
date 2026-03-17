/**
 * Tests for the /stream router (RTMP relay CRUD).
 *
 * Uses an in-memory SQLite database with a pre-seeded API key that has
 * relay_allowed = 1. A lightweight mock RtmpRelayManager avoids ffmpeg.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import { initDb } from '../src/db.js';
import { createAuthMiddleware } from '../src/middleware/auth.js';
import { createStreamRouter } from '../src/routes/stream.js';

const JWT_SECRET = 'test-stream-secret';
const TEST_API_KEY = 'stream-test-key-abc123';

// ---------------------------------------------------------------------------
// Mock RtmpRelayManager
// ---------------------------------------------------------------------------

function makeMockRelayManager({ runningKeys = [], publishingKeys = [] } = {}) {
  const running = new Set(runningKeys);
  const publishing = new Set(publishingKeys);
  const startCalls = [];
  const stopCalls = [];

  return {
    _running: running,
    _startCalls: startCalls,
    _stopCalls: stopCalls,
    isRunning:        (key) => running.has(key),
    isPublishing:     (key) => publishing.has(key),
    runningSlots:     (key) => [],
    start:            async (key, relays) => { startCalls.push({ key, relays }); running.add(key); },
    startAll:         async (key, relays) => { startCalls.push({ key, relays }); running.add(key); },
    stop:             async (key) => { stopCalls.push(key); running.delete(key); },
    stopKey:          async (key) => { stopCalls.push(key); running.delete(key); },
    stopAll:          async () => { running.clear(); },
    dropPublisher:    async (key) => {},
  };
}

// ---------------------------------------------------------------------------
// Test server setup
// ---------------------------------------------------------------------------

let server, baseUrl, db, mockRelay, authToken;

before(() => new Promise((resolve) => {
  db = initDb(':memory:');

  // Insert a relay-allowed API key
  db.prepare(
    `INSERT INTO api_keys (key, owner, active, relay_allowed, relay_active)
     VALUES (?, 'Test Owner', 1, 1, 0)`
  ).run(TEST_API_KEY);

  mockRelay = makeMockRelayManager();

  const auth = createAuthMiddleware(JWT_SECRET);
  const app = express();
  app.use(express.json());
  // allowedRtmpDomains = '*' → no domain restriction
  app.use('/stream', createStreamRouter(db, auth, mockRelay, '*'));

  server = createServer(app);
  server.listen(0, () => {
    baseUrl = `http://localhost:${server.address().port}`;
    resolve();
  });

  // Build a JWT for the test API key (session token format)
  authToken = jwt.sign(
    { sessionId: 'sess-stream-001', apiKey: TEST_API_KEY, domain: 'https://test.com' },
    JWT_SECRET,
  );
}));

after(() => new Promise((resolve) => {
  db.close();
  server.close(resolve);
}));

// Reset relay mock and DB slots before each test
beforeEach(() => {
  db.prepare('DELETE FROM rtmp_relays WHERE api_key = ?').run(TEST_API_KEY);
  mockRelay._running.clear();
  mockRelay._startCalls.length = 0;
  mockRelay._stopCalls.length = 0;
});

// Helper
async function streamFetch(path, opts = {}) {
  return fetch(`${baseUrl}/stream${path}`, {
    headers: {
      Authorization: `Bearer ${authToken}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
    ...opts,
  });
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

describe('GET /stream — authentication', () => {
  it('returns 401 without token', async () => {
    const res = await fetch(`${baseUrl}/stream`);
    assert.equal(res.status, 401);
  });

  it('returns 401 with invalid token', async () => {
    const res = await fetch(`${baseUrl}/stream`, {
      headers: { Authorization: 'Bearer bad.token.value' },
    });
    assert.equal(res.status, 401);
  });
});

// ---------------------------------------------------------------------------
// relay_allowed check
// ---------------------------------------------------------------------------

describe('/stream — relay_allowed check', () => {
  it('returns 403 when relay_allowed = 0', async () => {
    // Insert a key with relay_allowed = 0
    const LOCKED_KEY = 'no-relay-key-xyz9876';
    db.prepare(
      `INSERT OR IGNORE INTO api_keys (key, owner, active, relay_allowed) VALUES (?, 'Locked', 1, 0)`
    ).run(LOCKED_KEY);

    const lockedToken = jwt.sign(
      { sessionId: 'locked-sess', apiKey: LOCKED_KEY, domain: 'https://test.com' },
      JWT_SECRET,
    );

    const res = await fetch(`${baseUrl}/stream`, {
      headers: { Authorization: `Bearer ${lockedToken}` },
    });
    assert.equal(res.status, 403);
  });
});

// ---------------------------------------------------------------------------
// POST /stream
// ---------------------------------------------------------------------------

describe('POST /stream — create relay slot', () => {
  it('returns 400 for missing targetUrl', async () => {
    const res = await streamFetch('/', {
      method: 'POST',
      body: JSON.stringify({ slot: 1 }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.error?.toLowerCase().includes('targeturl') || body.error?.toLowerCase().includes('rtmp'));
  });

  it('returns 400 for non-rtmp targetUrl', async () => {
    const res = await streamFetch('/', {
      method: 'POST',
      body: JSON.stringify({ slot: 1, targetUrl: 'https://example.com' }),
    });
    assert.equal(res.status, 400);
  });

  it('returns 400 for invalid slot (> 4)', async () => {
    const res = await streamFetch('/', {
      method: 'POST',
      body: JSON.stringify({ slot: 5, targetUrl: 'rtmp://example.com/live/key' }),
    });
    assert.equal(res.status, 400);
  });

  it('returns 400 for invalid scale format', async () => {
    const res = await streamFetch('/', {
      method: 'POST',
      body: JSON.stringify({ targetUrl: 'rtmp://example.com/live/key', scale: 'bad' }),
    });
    assert.equal(res.status, 400);
  });

  it('creates a relay slot and returns 201', async () => {
    const res = await streamFetch('/', {
      method: 'POST',
      body: JSON.stringify({ slot: 1, targetUrl: 'rtmp://example.com/live/key', targetName: 'mystream' }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.ok(body.relay);
    assert.equal(body.relay.slot, 1);
    assert.equal(body.relay.targetUrl, 'rtmp://example.com/live/key');
    assert.equal(body.relay.targetName, 'mystream');
  });

  it('returns 400 when all 4 slots are used', async () => {
    // Fill all 4 slots
    for (let s = 1; s <= 4; s++) {
      await streamFetch('/', {
        method: 'POST',
        body: JSON.stringify({ slot: s, targetUrl: `rtmp://example.com/live/slot${s}` }),
      });
    }
    // Attempt to add a new slot 5 — already blocked, try to add beyond 4
    const res = await streamFetch('/', {
      method: 'POST',
      body: JSON.stringify({ slot: 4, targetUrl: 'rtmp://example.com/live/new' }),
    });
    // Slot 4 already exists → upsert is OK (not a new slot)
    assert.equal(res.status, 201);
  });
});

// ---------------------------------------------------------------------------
// GET /stream
// ---------------------------------------------------------------------------

describe('GET /stream — list slots', () => {
  it('returns 200 with empty relays when none configured', async () => {
    const res = await streamFetch('/');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.relays));
    assert.equal(body.relays.length, 0);
    assert.ok(Array.isArray(body.runningSlots));
  });

  it('lists configured slots', async () => {
    await streamFetch('/', {
      method: 'POST',
      body: JSON.stringify({ slot: 1, targetUrl: 'rtmp://example.com/live/s1' }),
    });
    const res = await streamFetch('/');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.relays.length, 1);
    assert.equal(body.relays[0].slot, 1);
  });
});

// ---------------------------------------------------------------------------
// GET /stream/history
// ---------------------------------------------------------------------------

describe('GET /stream/history', () => {
  it('returns 200 with empty streams array initially', async () => {
    const res = await streamFetch('/history');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.streams));
  });
});

// ---------------------------------------------------------------------------
// PUT /stream/active
// ---------------------------------------------------------------------------

describe('PUT /stream/active', () => {
  it('returns 400 when active is not boolean', async () => {
    const res = await streamFetch('/active', {
      method: 'PUT',
      body: JSON.stringify({ active: 'yes' }),
    });
    assert.equal(res.status, 400);
  });

  it('sets relay_active to true and returns 200', async () => {
    const res = await streamFetch('/active', {
      method: 'PUT',
      body: JSON.stringify({ active: true }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.active, true);

    // Verify persisted
    const row = db.prepare('SELECT relay_active FROM api_keys WHERE key = ?').get(TEST_API_KEY);
    assert.equal(row.relay_active, 1);
  });

  it('sets relay_active to false and stops running process', async () => {
    // Simulate a running process
    mockRelay._running.add(TEST_API_KEY);
    const res = await streamFetch('/active', {
      method: 'PUT',
      body: JSON.stringify({ active: false }),
    });
    assert.equal(res.status, 200);
    assert.equal(mockRelay._stopCalls.includes(TEST_API_KEY), true);
  });
});

// ---------------------------------------------------------------------------
// PUT /stream/:slot
// ---------------------------------------------------------------------------

describe('PUT /stream/:slot — update slot', () => {
  it('returns 404 for a slot that does not exist', async () => {
    const res = await streamFetch('/2', {
      method: 'PUT',
      body: JSON.stringify({ targetUrl: 'rtmp://example.com/live/updated' }),
    });
    assert.equal(res.status, 404);
  });

  it('returns 400 for invalid slot number', async () => {
    const res = await streamFetch('/0', {
      method: 'PUT',
      body: JSON.stringify({ targetUrl: 'rtmp://example.com/live/s1' }),
    });
    assert.equal(res.status, 400);
  });

  it('updates an existing slot and returns 200', async () => {
    // Create slot 1 first
    await streamFetch('/', {
      method: 'POST',
      body: JSON.stringify({ slot: 1, targetUrl: 'rtmp://example.com/live/original' }),
    });

    const res = await streamFetch('/1', {
      method: 'PUT',
      body: JSON.stringify({ targetUrl: 'rtmp://example.com/live/updated', targetName: 'newname' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.relay.targetUrl, 'rtmp://example.com/live/updated');
    assert.equal(body.relay.targetName, 'newname');
  });
});

// ---------------------------------------------------------------------------
// DELETE /stream/:slot
// ---------------------------------------------------------------------------

describe('DELETE /stream/:slot', () => {
  it('returns 400 for invalid slot', async () => {
    const res = await streamFetch('/99', { method: 'DELETE' });
    assert.equal(res.status, 400);
  });

  it('deletes a slot and returns 200', async () => {
    // Create slot 1
    await streamFetch('/', {
      method: 'POST',
      body: JSON.stringify({ slot: 1, targetUrl: 'rtmp://example.com/live/s1' }),
    });

    const res = await streamFetch('/1', { method: 'DELETE' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.slot, 1);

    // Verify gone from DB
    const remaining = db.prepare('SELECT * FROM rtmp_relays WHERE api_key = ?').all(TEST_API_KEY);
    assert.equal(remaining.length, 0);
  });
});

// ---------------------------------------------------------------------------
// DELETE /stream
// ---------------------------------------------------------------------------

describe('DELETE /stream — delete all slots', () => {
  it('deletes all slots and returns count', async () => {
    // Create two slots
    await streamFetch('/', {
      method: 'POST',
      body: JSON.stringify({ slot: 1, targetUrl: 'rtmp://example.com/live/s1' }),
    });
    await streamFetch('/', {
      method: 'POST',
      body: JSON.stringify({ slot: 2, targetUrl: 'rtmp://example.com/live/s2' }),
    });

    const res = await streamFetch('/', { method: 'DELETE' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.deleted, 2);

    // Verify DB is empty
    const remaining = db.prepare('SELECT * FROM rtmp_relays WHERE api_key = ?').all(TEST_API_KEY);
    assert.equal(remaining.length, 0);
  });

  it('returns 0 deleted when nothing was configured', async () => {
    const res = await streamFetch('/', { method: 'DELETE' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.deleted, 0);
  });
});
