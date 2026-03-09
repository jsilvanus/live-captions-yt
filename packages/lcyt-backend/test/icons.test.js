import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, rmSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import express from 'express';
import jwt from 'jsonwebtoken';
import { initDb, createKey } from '../src/db.js';
import { SessionStore } from '../src/store.js';
import { createIconRouter } from '../src/routes/icons.js';
import { createAuthMiddleware } from '../src/middleware/auth.js';

const JWT_SECRET = 'test-icons-secret';
const API_KEY = 'test-icon-key';
const DOMAIN = 'https://icon-test.example.com';

const VALID_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const VALID_SVG_BASE64 = btoa('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect fill="red"/></svg>');
const INVALID_PNG_BASE64 = btoa('not a png at all');

let server, baseUrl, store, db, iconsDir;

before(() => new Promise((resolve) => {
  iconsDir = join(tmpdir(), `lcyt-icons-test-${Date.now()}`);
  mkdirSync(iconsDir, { recursive: true });

  db = initDb(':memory:');
  createKey(db, { key: API_KEY, owner: 'Test' });

  store = new SessionStore({ cleanupInterval: 0 });
  const auth = createAuthMiddleware(JWT_SECRET);

  const app = express();
  app.use('/icons', createIconRouter(db, auth, store, iconsDir));
  app.use(express.json({ limit: '64kb' }));

  server = createServer(app);
  server.listen(0, '127.0.0.1', () => {
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    resolve();
  });
}));

after(() => new Promise((resolve) => {
  server.close(() => {
    try { rmSync(iconsDir, { recursive: true, force: true }); } catch {}
    resolve();
  });
}));

beforeEach(() => {
  for (const session of [...store.all()]) store.remove(session.sessionId);
  // Clear icons for the test API key so tests start with a clean state
  db.prepare('DELETE FROM icons WHERE api_key = ?').run(API_KEY);
  db.prepare('DELETE FROM icons WHERE api_key LIKE ?').run('other-key%');
  // Clear the icons directory (recursive, including subdirectories)
  try { rmSync(iconsDir, { recursive: true, force: true }); } catch {}
  try { mkdirSync(iconsDir, { recursive: true }); } catch {}
});

function makeSession(suffix = Math.random().toString(36).slice(2)) {
  const domain = `${DOMAIN}/${suffix}`;
  const session = store.create({ apiKey: API_KEY, streamKey: '', domain, jwt: 'x', sender: null });
  return jwt.sign({ sessionId: session.sessionId, apiKey: API_KEY, domain }, JWT_SECRET);
}

async function postIcon(token, body) {
  return fetch(`${baseUrl}/icons`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /icons — upload', () => {
  it('returns 201 on valid PNG upload', async () => {
    const res = await postIcon(makeSession(), { filename: 'logo.png', mimeType: 'image/png', data: VALID_PNG_BASE64 });
    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.ok(body.ok);
    assert.ok(typeof body.id === 'number' && body.id > 0);
    assert.strictEqual(body.mimeType, 'image/png');
  });

  it('returns 201 on valid SVG upload', async () => {
    const res = await postIcon(makeSession(), { filename: 'icon.svg', mimeType: 'image/svg+xml', data: VALID_SVG_BASE64 });
    assert.strictEqual(res.status, 201);
  });

  it('returns 400 when filename is missing', async () => {
    const res = await postIcon(makeSession(), { mimeType: 'image/png', data: VALID_PNG_BASE64 });
    assert.strictEqual(res.status, 400);
  });

  it('returns 400 when mimeType is unsupported', async () => {
    const res = await postIcon(makeSession(), { filename: 'x.jpg', mimeType: 'image/jpeg', data: VALID_PNG_BASE64 });
    assert.strictEqual(res.status, 400);
  });

  it('returns 400 when data is missing', async () => {
    const res = await postIcon(makeSession(), { filename: 'logo.png', mimeType: 'image/png' });
    assert.strictEqual(res.status, 400);
  });

  it('returns 400 when PNG magic bytes are invalid', async () => {
    const res = await postIcon(makeSession(), { filename: 'fake.png', mimeType: 'image/png', data: INVALID_PNG_BASE64 });
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.ok(body.error.toLowerCase().includes('png'));
  });

  it('returns 400 when SVG content is not valid SVG', async () => {
    const res = await postIcon(makeSession(), { filename: 'fake.svg', mimeType: 'image/svg+xml', data: btoa('plaintext') });
    assert.strictEqual(res.status, 400);
  });

  it('returns 401 without Authorization', async () => {
    const res = await fetch(`${baseUrl}/icons`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: 'x.png', mimeType: 'image/png', data: VALID_PNG_BASE64 }),
    });
    assert.strictEqual(res.status, 401);
  });

  it('writes icon file to ICONS_DIR on upload', async () => {
    await postIcon(makeSession(), { filename: 'disk.png', mimeType: 'image/png', data: VALID_PNG_BASE64 });
    const files = readdirSync(iconsDir, { recursive: true });
    assert.ok(files.some(f => String(f).endsWith('.png')));
  });
});

describe('GET /icons — list', () => {
  it('returns empty array when none uploaded', async () => {
    const token = makeSession();
    const res = await fetch(`${baseUrl}/icons`, { headers: { Authorization: `Bearer ${token}` } });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.icons));
    assert.strictEqual(body.icons.length, 0);
  });

  it('includes uploaded icon in the list', async () => {
    const token = makeSession();
    await postIcon(token, { filename: 'listed.png', mimeType: 'image/png', data: VALID_PNG_BASE64 });
    const res = await fetch(`${baseUrl}/icons`, { headers: { Authorization: `Bearer ${token}` } });
    const body = await res.json();
    const found = body.icons.find(ic => ic.filename === 'listed.png');
    assert.ok(found);
    assert.strictEqual(found.mimeType, 'image/png');
  });

  it('returns 401 without Authorization', async () => {
    const res = await fetch(`${baseUrl}/icons`);
    assert.strictEqual(res.status, 401);
  });
});

describe('GET /icons/:id — public serve', () => {
  let iconId;
  beforeEach(async () => {
    // Upload a fresh icon before each test so the outer beforeEach DB clear doesn't break us
    const token = makeSession('serve');
    const res = await postIcon(token, { filename: 'served.png', mimeType: 'image/png', data: VALID_PNG_BASE64 });
    const body = await res.json();
    iconId = body.id;
  });

  it('returns 200 with correct Content-Type', async () => {
    const res = await fetch(`${baseUrl}/icons/${iconId}`);
    assert.strictEqual(res.status, 200);
    assert.ok(res.headers.get('content-type').includes('image/png'));
  });

  it('sets Access-Control-Allow-Origin: *', async () => {
    const res = await fetch(`${baseUrl}/icons/${iconId}`);
    assert.strictEqual(res.headers.get('access-control-allow-origin'), '*');
  });

  it('sets Cache-Control: public', async () => {
    const res = await fetch(`${baseUrl}/icons/${iconId}`);
    assert.ok((res.headers.get('cache-control') || '').includes('public'));
  });

  it('returns 404 for unknown id', async () => {
    const res = await fetch(`${baseUrl}/icons/999999`);
    assert.strictEqual(res.status, 404);
  });

  it('returns 400 for non-numeric id', async () => {
    const res = await fetch(`${baseUrl}/icons/abc`);
    assert.strictEqual(res.status, 400);
  });

  it('returns valid PNG binary content', async () => {
    const res = await fetch(`${baseUrl}/icons/${iconId}`);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.strictEqual(buf[0], 0x89);
    assert.strictEqual(buf[1], 0x50);
  });

  it('does not require Authorization (public)', async () => {
    const res = await fetch(`${baseUrl}/icons/${iconId}`);
    assert.strictEqual(res.status, 200);
  });
});

describe('DELETE /icons/:id', () => {
  it('deletes icon and removes from list', async () => {
    const token = makeSession();
    const up = await postIcon(token, { filename: 'del.png', mimeType: 'image/png', data: VALID_PNG_BASE64 });
    const { id } = await up.json();

    const del = await fetch(`${baseUrl}/icons/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    assert.strictEqual(del.status, 200);
    assert.ok((await del.json()).ok);

    const list = await fetch(`${baseUrl}/icons`, { headers: { Authorization: `Bearer ${token}` } });
    assert.ok(!(await list.json()).icons.find(ic => ic.id === id));
  });

  it('returns 404 for icon owned by different key', async () => {
    const token1 = makeSession('owner');
    const up = await postIcon(token1, { filename: 'owned.png', mimeType: 'image/png', data: VALID_PNG_BASE64 });
    const { id } = await up.json();

    createKey(db, { key: 'other-key-icons', owner: 'Other' });
    const otherSess = store.create({ apiKey: 'other-key-icons', streamKey: '', domain: 'https://other.com', jwt: 'x', sender: null });
    const otherToken = jwt.sign({ sessionId: otherSess.sessionId, apiKey: 'other-key-icons', domain: 'https://other.com' }, JWT_SECRET);

    const del = await fetch(`${baseUrl}/icons/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${otherToken}` } });
    assert.strictEqual(del.status, 404);
  });

  it('returns 401 without Authorization', async () => {
    const res = await fetch(`${baseUrl}/icons/1`, { method: 'DELETE' });
    assert.strictEqual(res.status, 401);
  });

  it('returns 404 for unknown id', async () => {
    const token = makeSession();
    const res = await fetch(`${baseUrl}/icons/999999`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    assert.strictEqual(res.status, 404);
  });
});
