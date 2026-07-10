import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createServer } from 'node:http';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import express from 'express';
import jwt from 'jsonwebtoken';
import { initDb, createKey, registerCaptionFile } from '../src/db.js';
import { SessionStore } from '../src/store.js';
import { createFilesRouter } from 'lcyt-files';
import { createLocalAdapter } from 'lcyt-files/src/adapters/local.js';
import { createAuthMiddleware } from '../src/middleware/auth.js';

const JWT_SECRET = 'test-files-secret';

// ---------------------------------------------------------------------------
// Resolve the base directory for test files.
// The test script sets FILES_DIR=/tmp/lcyt-files-test so this resolves correctly.
// ---------------------------------------------------------------------------
const FILES_BASE_DIR = resolve(process.env.FILES_DIR || '/data/files');

// ---------------------------------------------------------------------------
// Test app setup
// ---------------------------------------------------------------------------

let server, baseUrl, store, db, resolveStorage;

before(async () => {
  db = initDb(':memory:');
  createKey(db, { key: 'files-test-key', owner: 'File User', backend_file_enabled: 1 });

  // Ensure the base directory exists for the test suite
  await mkdir(FILES_BASE_DIR, { recursive: true });

  const storage = createLocalAdapter(FILES_BASE_DIR);
  // Wrap the adapter as an async resolver (no per-key config in tests — always use global)
  resolveStorage = async (_apiKey) => storage;
  store = new SessionStore({ cleanupInterval: 0 });
  const auth = createAuthMiddleware(JWT_SECRET);

  const app = express();
  app.use(express.json({ limit: '64kb' }));
  app.use('/file', createFilesRouter(db, auth, store, JWT_SECRET, resolveStorage));

  await new Promise((resolve) => {
    server = createServer(app);
    server.listen(0, () => {
      baseUrl = `http://localhost:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  store.stopCleanup();
  db.close();
  await new Promise(r => server.close(r));
  // Clean up any test files created under FILES_BASE_DIR/files_test_key/
  const safe = 'files_test_key';
  await rm(join(FILES_BASE_DIR, safe), { recursive: true, force: true });
});

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
    { sessionId, apiKey: 'files-test-key', streamKey: 'test-stream', domain: 'https://files-test.com' },
    JWT_SECRET
  );
}

function createMockSession() {
  return store.create({
    apiKey: 'files-test-key',
    streamKey: 'test-stream',
    domain: 'https://files-test.com',
    jwt: 'test-jwt',
    sequence: 0,
    syncOffset: 0,
    sender: null,
  });
}

/**
 * Register a caption file in the DB and write a corresponding file to disk.
 * The `filename` stored in DB is the full path (as the new adapter stores it).
 * Returns the DB row id.
 */
async function registerTestFile(session, { content = 'Hello caption', lang = 'original', format = 'youtube', type = 'caption' } = {}) {
  const safe = session.apiKey.replace(/[^a-zA-Z0-9-]/g, '_').slice(0, 40);
  const dir = join(FILES_BASE_DIR, safe);
  await mkdir(dir, { recursive: true });

  const filename = `2026-01-01-${Date.now()}-${lang}.txt`;
  const filepath = join(dir, filename);
  await writeFile(filepath, content, 'utf8');

  // Store the full filepath as `filename` — matches what writeToBackendFile stores via openAppend()
  const fileId = registerCaptionFile(db, {
    apiKey: session.apiKey,
    sessionId: session.sessionId,
    filename: filepath,
    lang,
    format,
    type,
  });
  return fileId;
}

// ---------------------------------------------------------------------------
// GET /file — list files
// ---------------------------------------------------------------------------

describe('GET /file', () => {
  it('should return 401 with no Authorization header', async () => {
    const res = await fetch(`${baseUrl}/file`);
    const data = await res.json();
    assert.strictEqual(res.status, 401);
    assert.ok(data.error);
  });

  it('should return 401 for invalid token', async () => {
    const res = await fetch(`${baseUrl}/file`, {
      headers: { 'Authorization': 'Bearer invalid.token' }
    });
    assert.strictEqual(res.status, 401);
  });

  it('should return 404 when session not found', async () => {
    const token = makeToken('nonexistent-session');
    const res = await fetch(`${baseUrl}/file`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    assert.strictEqual(res.status, 404);
    assert.ok(data.error);
  });

  it('should return an empty files array when no files exist', async () => {
    const session = createMockSession();
    const token = makeToken(session.sessionId);

    const res = await fetch(`${baseUrl}/file`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();

    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(data.files));
    assert.strictEqual(data.files.length, 0);
  });

  it('should return registered files for the session key', async () => {
    const session = createMockSession();
    const token = makeToken(session.sessionId);

    await registerTestFile(session, { content: 'Caption one', lang: 'original' });
    await registerTestFile(session, { content: 'Caption two', lang: 'fi-FI' });

    const res = await fetch(`${baseUrl}/file`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();

    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(data.files));
    assert.ok(data.files.length >= 2);

    const file = data.files[0];
    assert.ok('id' in file);
    assert.ok('filename' in file);
    assert.ok('lang' in file);
    assert.ok('format' in file);
    assert.ok('createdAt' in file);
  });

  it('should strip the directory prefix from filenames in list response', async () => {
    const session = createMockSession();
    const token = makeToken(session.sessionId);

    await registerTestFile(session, { content: 'test', lang: 'original' });

    const res = await fetch(`${baseUrl}/file`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    // filename should be the bare name, not an absolute path
    assert.ok(!data.files[0].filename.startsWith('/'));
  });
});

// ---------------------------------------------------------------------------
// GET /file/:id — download a file
// ---------------------------------------------------------------------------

describe('GET /file/:id', () => {
  it('should return 401 with no auth', async () => {
    const res = await fetch(`${baseUrl}/file/1`);
    const data = await res.json();
    assert.strictEqual(res.status, 401);
    assert.ok(data.error);
  });

  it('should return 401 for invalid token', async () => {
    const res = await fetch(`${baseUrl}/file/1`, {
      headers: { 'Authorization': 'Bearer invalid.token' }
    });
    assert.strictEqual(res.status, 401);
  });

  it('should return 404 when session not found (token with unknown sessionId)', async () => {
    const orphanToken = jwt.sign(
      { sessionId: 'orphan-session', apiKey: 'files-test-key', streamKey: 'sk', domain: 'https://x.com' },
      JWT_SECRET
    );
    const res = await fetch(`${baseUrl}/file/999`, {
      headers: { 'Authorization': `Bearer ${orphanToken}` }
    });
    const data = await res.json();
    assert.strictEqual(res.status, 404);
    assert.ok(data.error);
  });

  it('should return 400 for a non-numeric file id', async () => {
    const session = createMockSession();
    const token = makeToken(session.sessionId);

    const res = await fetch(`${baseUrl}/file/not-a-number`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    assert.strictEqual(res.status, 400);
    assert.ok(data.error.includes('Invalid file id'));
  });

  it('should return 404 for a file id that does not exist in the DB', async () => {
    const session = createMockSession();
    const token = makeToken(session.sessionId);

    const res = await fetch(`${baseUrl}/file/99999`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    assert.strictEqual(res.status, 404);
    assert.ok(data.error);
  });

  it('should stream file content with correct headers', async () => {
    const session = createMockSession();
    const token = makeToken(session.sessionId);

    const id = await registerTestFile(session, { content: 'Caption content here', lang: 'original', format: 'youtube' });

    const res = await fetch(`${baseUrl}/file/${id}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    assert.strictEqual(res.status, 200);
    const contentType = res.headers.get('Content-Type');
    assert.ok(contentType.includes('text/plain'));

    const body = await res.text();
    assert.strictEqual(body, 'Caption content here');
  });

  it('should serve vtt files with text/vtt content type', async () => {
    const session = createMockSession();
    const token = makeToken(session.sessionId);

    const safe = session.apiKey.replace(/[^a-zA-Z0-9-]/g, '_').slice(0, 40);
    const dir = join(FILES_BASE_DIR, safe);
    await mkdir(dir, { recursive: true });
    const filename = `2026-01-01-${Date.now()}-original.vtt`;
    const filepath = join(dir, filename);
    await writeFile(filepath, 'WEBVTT\n\n1\n00:00:00.000 --> 00:00:02.000\nHello\n', 'utf8');

    const fileId = registerCaptionFile(db, {
      apiKey: session.apiKey,
      sessionId: session.sessionId,
      filename: filepath,
      lang: 'original',
      format: 'vtt',
      type: 'caption',
    });

    const res = await fetch(`${baseUrl}/file/${fileId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    assert.strictEqual(res.status, 200);
    const contentType = res.headers.get('Content-Type');
    assert.ok(contentType.includes('text/vtt'));
  });

  it('should accept ?token= query param instead of Authorization header', async () => {
    const session = createMockSession();
    const token = makeToken(session.sessionId);
    const id = await registerTestFile(session, { content: 'Query token test' });

    const res = await fetch(`${baseUrl}/file/${id}?token=${token}`);
    assert.strictEqual(res.status, 200);
    const body = await res.text();
    assert.strictEqual(body, 'Query token test');
  });

  it('should return 404 when file exists in DB but not in storage', async () => {
    const session = createMockSession();
    const token = makeToken(session.sessionId);

    // Register a file in DB that doesn't actually exist on disk
    const fileId = registerCaptionFile(db, {
      apiKey: session.apiKey,
      sessionId: session.sessionId,
      filename: '/nonexistent/path/ghost.txt',
      lang: 'original',
      format: 'youtube',
      type: 'captions',
    });

    const res = await fetch(`${baseUrl}/file/${fileId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    assert.strictEqual(res.status, 404);
  });

  // Helper for the offsetMs tests: register a real .vtt file on disk + in DB
  async function registerVttFile(session, content) {
    const safe = session.apiKey.replace(/[^a-zA-Z0-9-]/g, '_').slice(0, 40);
    const dir = join(FILES_BASE_DIR, safe);
    await mkdir(dir, { recursive: true });
    const filepath = join(dir, `2026-01-01-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-original.vtt`);
    await writeFile(filepath, content, 'utf8');
    return registerCaptionFile(db, {
      apiKey: session.apiKey,
      sessionId: session.sessionId,
      filename: filepath,
      lang: 'original',
      format: 'vtt',
      type: 'caption',
    });
  }

  const VTT_DOC = 'WEBVTT\n\n1\n00:00:14.000 --> 00:00:17.000\nHello\n\n2\n00:01:14.500 --> 00:01:17.500\nWorld\n';

  it('should shift vtt cue times with ?offsetMs=', async () => {
    const session = createMockSession();
    const token = makeToken(session.sessionId);
    const fileId = await registerVttFile(session, VTT_DOC);

    const res = await fetch(`${baseUrl}/file/${fileId}?offsetMs=2500`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    assert.strictEqual(res.status, 200);
    const body = await res.text();
    assert.ok(body.includes('00:00:16.500 --> 00:00:19.500'));
    assert.ok(body.includes('00:01:17.000 --> 00:01:20.000'));
    assert.ok(body.includes('Hello'));
    assert.strictEqual(res.headers.get('Content-Length'), String(Buffer.byteLength(body)));
  });

  it('should clamp negative offsetMs shifts at zero', async () => {
    const session = createMockSession();
    const token = makeToken(session.sessionId);
    const fileId = await registerVttFile(session, VTT_DOC);

    const res = await fetch(`${baseUrl}/file/${fileId}?offsetMs=-15000`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    assert.strictEqual(res.status, 200);
    const body = await res.text();
    assert.ok(body.includes('00:00:00.000 --> 00:00:02.000'));
  });

  it('should serve vtt unchanged for offsetMs=0', async () => {
    const session = createMockSession();
    const token = makeToken(session.sessionId);
    const fileId = await registerVttFile(session, VTT_DOC);

    const res = await fetch(`${baseUrl}/file/${fileId}?offsetMs=0`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    assert.strictEqual(res.status, 200);
    const body = await res.text();
    assert.strictEqual(body, VTT_DOC);
  });

  it('should return 400 for offsetMs on a non-vtt file', async () => {
    const session = createMockSession();
    const token = makeToken(session.sessionId);
    const id = await registerTestFile(session, { content: 'plain text', format: 'youtube' });

    const res = await fetch(`${baseUrl}/file/${id}?offsetMs=1000`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    assert.strictEqual(res.status, 400);
    assert.ok(data.error.includes('vtt'));
  });

  it('should return 400 for a non-numeric or out-of-range offsetMs', async () => {
    const session = createMockSession();
    const token = makeToken(session.sessionId);
    const fileId = await registerVttFile(session, VTT_DOC);

    for (const bad of ['abc', '1.5', '90000000000']) {
      const res = await fetch(`${baseUrl}/file/${fileId}?offsetMs=${bad}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      assert.strictEqual(res.status, 400, `offsetMs=${bad} should be rejected`);
    }
  });
});

// ---------------------------------------------------------------------------
// DELETE /file/:id
// ---------------------------------------------------------------------------

describe('DELETE /file/:id', () => {
  it('should return 401 with no auth', async () => {
    const res = await fetch(`${baseUrl}/file/1`, { method: 'DELETE' });
    const data = await res.json();
    assert.strictEqual(res.status, 401);
    assert.ok(data.error);
  });

  it('should return 400 for a non-numeric id', async () => {
    const session = createMockSession();
    const token = makeToken(session.sessionId);

    const res = await fetch(`${baseUrl}/file/not-a-number`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    assert.strictEqual(res.status, 400);
    assert.ok(data.error.includes('Invalid file id'));
  });

  it('should return 404 when session is not found', async () => {
    const token = makeToken('missing-session-id');
    const res = await fetch(`${baseUrl}/file/1`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    assert.strictEqual(res.status, 404);
    assert.ok(data.error);
  });

  it('should return 404 for unknown file id', async () => {
    const session = createMockSession();
    const token = makeToken(session.sessionId);

    const res = await fetch(`${baseUrl}/file/99999`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    assert.strictEqual(res.status, 404);
    assert.ok(data.error);
  });

  it('should delete the DB record and disk file, returning ok', async () => {
    const session = createMockSession();
    const token = makeToken(session.sessionId);

    const id = await registerTestFile(session, { content: 'Delete me' });

    const res = await fetch(`${baseUrl}/file/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.ok, true);

    // File should no longer be listed
    const listRes = await fetch(`${baseUrl}/file`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const listData = await listRes.json();
    const ids = listData.files.map(f => f.id);
    assert.ok(!ids.includes(id), 'Deleted file should not appear in list');
  });
});
