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
import { createUser } from '../src/db/users.js';
import { addMember } from '../src/db/project-members.js';
import { createProjectAccessMiddleware, requireProjectRole } from '../src/middleware/project-access.js';

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
// POST /file — create a file, attributing it to the acting session
// ---------------------------------------------------------------------------

describe('POST /file', () => {
  it('attributes the created file to the token session_id when mounted behind the legacy plain session middleware', async () => {
    // This suite mounts createFilesRouter behind createAuthMiddleware (see
    // `before()` above) — the legacy plain session-JWT middleware, which
    // sets req.session to the raw JWT payload and never populates req.auth
    // at all. registerCaptionFile()'s sessionId must still resolve from
    // req.session.sessionId in that case, not silently attribute the write
    // to no session (a regression a Copilot review caught: the handler
    // previously read only req.auth?.sessionId).
    const session = createMockSession();
    const token = makeToken(session.sessionId);
    const res = await fetch(`${baseUrl}/file`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'hello', filename: 'post-file-test.txt' }),
    });
    assert.strictEqual(res.status, 201);
    const body = await res.json();
    try {
      const row = db.prepare('SELECT session_id FROM caption_files WHERE id = ?').get(body.file.id);
      assert.strictEqual(row.session_id, session.sessionId);
    } finally {
      // GET /file below relies on a clean caption_files table per apiKey —
      // remove the row this test creates so it doesn't leak into later
      // list-count assertions regardless of describe-block ordering.
      db.prepare('DELETE FROM caption_files WHERE id = ?').run(body.file.id);
    }
  });

  it('returns 401 with no Authorization header', async () => {
    const res = await fetch(`${baseUrl}/file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'hello' }),
    });
    assert.strictEqual(res.status, 401);
  });
});

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

  // GET /file (list) reads apiKey directly off the JWT payload — it was never
  // actually load-bearing that the token's sessionId reference a *live*
  // /live session (see CONSIDER.md's icons.js/lcyt-files entry), so a
  // never-created sessionId no longer 404s here. This is a deliberate
  // behavior change from before the plan_project_roles.md Setup-tier
  // migration: only the token-based GET /file/:id download route (below)
  // still resolves through the live session store, since it independently
  // verifies its own raw JWT rather than going through `auth`.
  it('lists files for a valid apiKey even when the token references no live session', async () => {
    const token = makeToken('nonexistent-session');
    const res = await fetch(`${baseUrl}/file`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(data.files));
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

  // DELETE no longer checks live-session existence (see the GET /file
  // comment above) — a token whose sessionId was never created via
  // store.create() can still delete a real file it's authorized for
  // (matching apiKey), proof the dependency really was incidental.
  it('deletes a real file even when the token references no live session', async () => {
    const liveSession = createMockSession();
    const id = await registerTestFile(liveSession, { content: 'Delete me too' });

    const deadToken = makeToken('this-session-id-was-never-created');
    const res = await fetch(`${baseUrl}/file/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${deadToken}` }
    });
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.ok, true);
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

// ---------------------------------------------------------------------------
// GET/PUT/DELETE /file/storage-config
// ---------------------------------------------------------------------------
//
// Real production mounting (content.js) uses scopedAuth('file')/
// createProjectAccessMiddleware + requireProjectRole('setup'), not the plain
// session-only auth used above — matters here because PUT/DELETE now need a
// real userId with explicit owner/admin (plan_project_roles.md). Previously
// couldn't be gated at all without this migration (see CONSIDER.md). A
// separate server instance, since the rest of this file deliberately tests
// the plain-auth-mounted shape.

describe('GET/PUT/DELETE /file/storage-config', () => {
  const CONFIG_API_KEY = 'storage-config-test-key';
  let cfgDb, cfgServer, cfgBaseUrl, sessionToken, ownerToken;

  before(async () => {
    cfgDb = initDb(':memory:');
    createKey(cfgDb, { key: CONFIG_API_KEY, owner: 'ConfigUser' });

    const auth = createProjectAccessMiddleware(cfgDb, JWT_SECRET, { requiredScope: 'file' });
    const app = express();
    app.use(express.json({ limit: '64kb' }));
    app.use('/file', createFilesRouter(cfgDb, auth, null, JWT_SECRET, async () => null, () => {}, requireProjectRole(cfgDb, 'setup')));

    sessionToken = jwt.sign({ sessionId: 'cfg-session', apiKey: CONFIG_API_KEY }, JWT_SECRET);
    const owner = createUser(cfgDb, { email: 'storage-config-owner@example.com', passwordHash: 'x' });
    addMember(cfgDb, CONFIG_API_KEY, owner.id, 'owner');
    ownerToken = jwt.sign({ type: 'user', userId: owner.id, email: owner.email, projectId: CONFIG_API_KEY }, JWT_SECRET, { expiresIn: '1h' });

    await new Promise((resolve) => {
      cfgServer = createServer(app);
      cfgServer.listen(0, () => {
        cfgBaseUrl = `http://localhost:${cfgServer.address().port}`;
        resolve();
      });
    });
  });

  after(() => new Promise((resolve) => {
    cfgDb.close();
    cfgServer.close(resolve);
  }));

  function bearer(tok) {
    return { Authorization: `Bearer ${tok}`, 'X-Api-Key': CONFIG_API_KEY };
  }

  it('GET returns default (no config) for a fresh key, with just a session token', async () => {
    const res = await fetch(`${cfgBaseUrl}/file/storage-config`, { headers: bearer(sessionToken) });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.storageMode, 'default');
    assert.strictEqual(body.config, null);
  });

  it('PUT 403s for a session token with no explicit project role (setup tier required)', async () => {
    const res = await fetch(`${cfgBaseUrl}/file/storage-config`, {
      method: 'PUT',
      headers: { ...bearer(sessionToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ bucket: 'my-bucket' }),
    });
    assert.strictEqual(res.status, 403);
  });

  it('PUT 403s (feature not granted) for an owner without the files-custom-bucket feature', async () => {
    const res = await fetch(`${cfgBaseUrl}/file/storage-config`, {
      method: 'PUT',
      headers: { ...bearer(ownerToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ bucket: 'my-bucket' }),
    });
    assert.strictEqual(res.status, 403);
    const body = await res.json();
    assert.ok(body.error.toLowerCase().includes('custom storage'));
  });

  it('PUT sets S3 config once the files-custom-bucket feature is granted; GET reflects it masked', async () => {
    cfgDb.prepare(
      `INSERT INTO project_features (api_key, feature_code, enabled) VALUES (?, 'files-custom-bucket', 1)`
    ).run(CONFIG_API_KEY);

    const put = await fetch(`${cfgBaseUrl}/file/storage-config`, {
      method: 'PUT',
      headers: { ...bearer(ownerToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ bucket: 'my-bucket', region: 'us-east-1', access_key_id: 'ak', secret_access_key: 'shh' }),
    });
    assert.strictEqual(put.status, 200);
    assert.strictEqual((await put.json()).ok, true);

    // GET stays open to any project member (read-exempt) even without setup tier.
    const get = await fetch(`${cfgBaseUrl}/file/storage-config`, { headers: bearer(sessionToken) });
    assert.strictEqual(get.status, 200);
    const body = await get.json();
    assert.strictEqual(body.storageMode, 'custom-s3');
    assert.strictEqual(body.config.bucket, 'my-bucket');
  });

  it('DELETE 403s for a session token with no explicit project role (setup tier required)', async () => {
    const res = await fetch(`${cfgBaseUrl}/file/storage-config`, { method: 'DELETE', headers: bearer(sessionToken) });
    assert.strictEqual(res.status, 403);
  });

  it('DELETE reverts to default for an explicit owner', async () => {
    const res = await fetch(`${cfgBaseUrl}/file/storage-config`, { method: 'DELETE', headers: bearer(ownerToken) });
    assert.strictEqual(res.status, 200);
    assert.strictEqual((await res.json()).ok, true);

    const get = await fetch(`${cfgBaseUrl}/file/storage-config`, { headers: bearer(sessionToken) });
    const body = await get.json();
    assert.strictEqual(body.storageMode, 'default');
  });
});
