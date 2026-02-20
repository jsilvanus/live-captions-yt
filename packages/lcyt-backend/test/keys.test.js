import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createServer } from 'node:http';
import express from 'express';
import { initDb, createKey } from '../src/db.js';
import { createKeysRouter } from '../src/routes/keys.js';

const ADMIN_KEY = 'test-admin-key-secret';

// ---------------------------------------------------------------------------
// Test app setup
// ---------------------------------------------------------------------------

let server, baseUrl, db;
let savedAdminKey;

before(() => new Promise((resolve) => {
  db = initDb(':memory:');

  const app = express();
  app.use(express.json({ limit: '64kb' }));
  app.use('/keys', createKeysRouter(db));

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

beforeEach(() => {
  // Set a fresh admin key before each test
  savedAdminKey = process.env.ADMIN_KEY;
  process.env.ADMIN_KEY = ADMIN_KEY;

  // Clear all keys
  db.prepare('DELETE FROM api_keys').run();
});

// Restore env after each test (using after-each style via the test runner)
// Note: node:test doesn't have afterEach, so we handle cleanup in beforeEach

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function adminHeaders() {
  return {
    'Content-Type': 'application/json',
    'X-Admin-Key': ADMIN_KEY
  };
}

async function getKeys() {
  return fetch(`${baseUrl}/keys`, { headers: adminHeaders() });
}

async function postKey(body) {
  return fetch(`${baseUrl}/keys`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify(body)
  });
}

async function getKey(key) {
  return fetch(`${baseUrl}/keys/${key}`, { headers: adminHeaders() });
}

async function patchKey(key, body) {
  return fetch(`${baseUrl}/keys/${key}`, {
    method: 'PATCH',
    headers: adminHeaders(),
    body: JSON.stringify(body)
  });
}

async function deleteKeyReq(key, permanent = false) {
  const url = permanent ? `${baseUrl}/keys/${key}?permanent=true` : `${baseUrl}/keys/${key}`;
  return fetch(url, {
    method: 'DELETE',
    headers: adminHeaders()
  });
}

// ---------------------------------------------------------------------------
// Admin middleware tests
// ---------------------------------------------------------------------------

describe('Admin middleware', () => {
  it('should return 503 when ADMIN_KEY is not set', async () => {
    delete process.env.ADMIN_KEY;
    const res = await fetch(`${baseUrl}/keys`);
    const data = await res.json();
    assert.strictEqual(res.status, 503);
    assert.ok(data.error);
    process.env.ADMIN_KEY = ADMIN_KEY; // Restore
  });

  it('should return 401 when X-Admin-Key header is missing', async () => {
    const res = await fetch(`${baseUrl}/keys`);
    const data = await res.json();
    assert.strictEqual(res.status, 401);
    assert.ok(data.error);
  });

  it('should return 403 when X-Admin-Key does not match', async () => {
    const res = await fetch(`${baseUrl}/keys`, {
      headers: { 'X-Admin-Key': 'wrong-admin-key' }
    });
    const data = await res.json();
    assert.strictEqual(res.status, 403);
    assert.ok(data.error);
  });
});

// ---------------------------------------------------------------------------
// GET /keys — List all keys
// ---------------------------------------------------------------------------

describe('GET /keys', () => {
  it('should return empty list when no keys exist', async () => {
    const res = await getKeys();
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(data.keys, []);
  });

  it('should return all keys in the database', async () => {
    createKey(db, { owner: 'Alice' });
    createKey(db, { owner: 'Bob' });

    const res = await getKeys();
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.keys.length, 2);
  });

  it('should format keys with key, owner, active, expires, createdAt', async () => {
    createKey(db, { owner: 'Frank', expiresAt: '2026-12-31' });

    const res = await getKeys();
    const data = await res.json();
    const key = data.keys[0];

    assert.ok(key.key);
    assert.strictEqual(key.owner, 'Frank');
    assert.strictEqual(typeof key.active, 'boolean');
    assert.strictEqual(key.expires, '2026-12-31');
    assert.ok(key.createdAt);
  });
});

// ---------------------------------------------------------------------------
// POST /keys — Create a new key
// ---------------------------------------------------------------------------

describe('POST /keys', () => {
  it('should return 400 when owner is missing', async () => {
    const res = await postKey({ key: 'custom-key' });
    const data = await res.json();
    assert.strictEqual(res.status, 400);
    assert.ok(data.error);
  });

  it('should create key with auto-generated UUID when no key provided', async () => {
    const res = await postKey({ owner: 'Alice' });
    const data = await res.json();
    assert.strictEqual(res.status, 201);
    assert.ok(data.key);
    assert.match(data.key, /^[0-9a-f-]{36}$/);
    assert.strictEqual(data.owner, 'Alice');
    assert.strictEqual(data.active, true);
  });

  it('should create key with custom key value', async () => {
    const res = await postKey({ owner: 'Bob', key: 'my-custom-key-123' });
    const data = await res.json();
    assert.strictEqual(res.status, 201);
    assert.strictEqual(data.key, 'my-custom-key-123');
    assert.strictEqual(data.owner, 'Bob');
  });

  it('should create key with expiration date', async () => {
    const res = await postKey({ owner: 'Eve', expires: '2026-12-31' });
    const data = await res.json();
    assert.strictEqual(res.status, 201);
    assert.strictEqual(data.expires, '2026-12-31');
  });

  it('should create key without expiration (never expires)', async () => {
    const res = await postKey({ owner: 'Frank' });
    const data = await res.json();
    assert.strictEqual(res.status, 201);
    assert.strictEqual(data.expires, null);
  });
});

// ---------------------------------------------------------------------------
// GET /keys/:key — Get specific key
// ---------------------------------------------------------------------------

describe('GET /keys/:key', () => {
  it('should return 404 for non-existent key', async () => {
    const res = await getKey('does-not-exist');
    const data = await res.json();
    assert.strictEqual(res.status, 404);
    assert.ok(data.error);
  });

  it('should return key details for existing key', async () => {
    const { key } = createKey(db, { owner: 'Alice' });
    const res = await getKey(key);
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.key, key);
    assert.strictEqual(data.owner, 'Alice');
    assert.strictEqual(data.active, true);
  });
});

// ---------------------------------------------------------------------------
// PATCH /keys/:key — Update key
// ---------------------------------------------------------------------------

describe('PATCH /keys/:key', () => {
  it('should return 404 for non-existent key', async () => {
    const res = await patchKey('does-not-exist', { owner: 'X' });
    const data = await res.json();
    assert.strictEqual(res.status, 404);
    assert.ok(data.error);
  });

  it('should update owner', async () => {
    const { key } = createKey(db, { owner: 'Old Name' });
    const res = await patchKey(key, { owner: 'New Name' });
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.owner, 'New Name');
  });

  it('should update expires', async () => {
    const { key } = createKey(db, { owner: 'Expires Test' });
    const res = await patchKey(key, { expires: '2027-06-30' });
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.expires, '2027-06-30');
  });

  it('should update both owner and expires', async () => {
    const { key } = createKey(db, { owner: 'Old', expiresAt: '2026-01-01' });
    const res = await patchKey(key, { owner: 'New', expires: '2027-01-01' });
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.owner, 'New');
    assert.strictEqual(data.expires, '2027-01-01');
  });

  it('should clear expiration when expires is null', async () => {
    const { key } = createKey(db, { owner: 'Has Expiry', expiresAt: '2026-12-31' });
    const res = await patchKey(key, { expires: null });
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.expires, null);
  });
});

// ---------------------------------------------------------------------------
// DELETE /keys/:key — Revoke or permanently delete
// ---------------------------------------------------------------------------

describe('DELETE /keys/:key', () => {
  it('should return 404 for non-existent key', async () => {
    const res = await deleteKeyReq('does-not-exist');
    const data = await res.json();
    assert.strictEqual(res.status, 404);
    assert.ok(data.error);
  });

  it('should soft-delete (revoke) by default', async () => {
    const { key } = createKey(db, { owner: 'To Revoke' });
    const res = await deleteKeyReq(key);
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.key, key);
    assert.strictEqual(data.revoked, true);

    // Key still exists but is inactive
    const row = db.prepare('SELECT * FROM api_keys WHERE key = ?').get(key);
    assert.ok(row);
    assert.strictEqual(row.active, 0);
  });

  it('should permanently delete when permanent=true', async () => {
    const { key } = createKey(db, { owner: 'To Delete' });
    const res = await deleteKeyReq(key, true);
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.key, key);
    assert.strictEqual(data.deleted, true);

    // Key should be gone
    const row = db.prepare('SELECT * FROM api_keys WHERE key = ?').get(key);
    assert.strictEqual(row, undefined);
  });
});
