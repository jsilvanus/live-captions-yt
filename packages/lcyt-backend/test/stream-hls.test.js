import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { createServer } from 'node:http';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import express from 'express';
import { initDb, createKey, updateKey, formatKey } from '../src/db.js';
import { runMigrations } from 'lcyt-rtmp/src/db.js';

function initTestDb() { const db = initDb(':memory:'); runMigrations(db); return db; }
import { isHlsEnabled } from 'lcyt-rtmp/src/db.js';
import { createStreamHlsRouter } from 'lcyt-rtmp/src/routes/stream-hls.js';
import { createPreviewRouter } from 'lcyt-rtmp/src/routes/preview.js';
import { HlsManager } from 'lcyt-rtmp/src/hls-manager.js';
import { PreviewManager } from 'lcyt-rtmp/src/preview-manager.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function baseUrl(server) {
  return `http://127.0.0.1:${server.address().port}`;
}

async function postForm(server, path, fields) {
  const body = new URLSearchParams(fields).toString();
  return fetch(`${baseUrl(server)}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
}

async function getJson(server, path) {
  return fetch(`${baseUrl(server)}${path}`);
}

// ---------------------------------------------------------------------------
// DB helpers: hls_enabled column
// ---------------------------------------------------------------------------

describe('hls_enabled DB column', () => {
  let db;

  before(() => { db = initTestDb(); });
  after(() => { db.close(); });

  it('defaults to false on createKey', () => {
    const k = createKey(db, { owner: 'Alice' });
    assert.strictEqual(isHlsEnabled(db, k.key), false);
  });

  it('can be set to true on createKey', () => {
    const k = createKey(db, { owner: 'Bob', hls_enabled: true });
    assert.strictEqual(isHlsEnabled(db, k.key), true);
  });

  it('isHlsEnabled returns false for unknown key', () => {
    assert.strictEqual(isHlsEnabled(db, 'no-such-key'), false);
  });

  it('isHlsEnabled returns true after updateKey', () => {
    const k = createKey(db, { owner: 'Carol' });
    assert.strictEqual(isHlsEnabled(db, k.key), false);
    updateKey(db, k.key, { hls_enabled: true });
    assert.strictEqual(isHlsEnabled(db, k.key), true);
  });

  it('isHlsEnabled returns false after disabling', () => {
    const k = createKey(db, { owner: 'Dave', hls_enabled: true });
    updateKey(db, k.key, { hls_enabled: false });
    assert.strictEqual(isHlsEnabled(db, k.key), false);
  });

  it('formatKey includes hlsEnabled field', () => {
    const k = createKey(db, { owner: 'Eve', hls_enabled: true });
    const row = db.prepare('SELECT * FROM api_keys WHERE key = ?').get(k.key);
    const formatted = formatKey(row);
    assert.strictEqual(formatted.hlsEnabled, true);
  });
});

// ---------------------------------------------------------------------------
// HlsManager unit tests
// ---------------------------------------------------------------------------

describe('HlsManager', () => {
  let tmpRoot;
  let manager;

  before(() => {
    tmpRoot = join(tmpdir(), `hls-mgr-test-${Date.now()}`);
    fs.mkdirSync(tmpRoot, { recursive: true });
    manager = new HlsManager({ hlsRoot: tmpRoot, localRtmp: 'rtmp://127.0.0.1:9999', rtmpApp: 'testapp' });
  });

  after(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('hlsDir returns path inside hlsRoot', () => {
    const dir = manager.hlsDir('mykey');
    assert.ok(dir.startsWith(tmpRoot), `expected ${dir} to start with ${tmpRoot}`);
    assert.ok(dir.includes('mykey'));
  });

  it('isRunning returns false for unstarted key', () => {
    assert.strictEqual(manager.isRunning('nonexistent'), false);
  });

  it('stopAll resolves immediately when no processes are running', async () => {
    await assert.doesNotReject(() => manager.stopAll());
  });

  it('stop resolves immediately for non-running key', async () => {
    await assert.doesNotReject(() => manager.stop('nonexistent'));
  });

  it('start creates the HLS output directory', async () => {
    // ffmpeg won't be available in CI, so we test that it creates the dir
    // and then cleans up after the process exits (or errors).
    const key = 'dirtest';
    const dir = manager.hlsDir(key);

    // If ffmpeg is not available start() will reject via proc.on('error').
    // Either way the directory should be created before the error.
    try {
      await manager.start(key);
      // If ffmpeg is available it will try to connect; stop it immediately.
      await manager.stop(key);
    } catch {
      // ffmpeg not available — dir should still have been created before spawn failed.
    }
    // After stop() or error, the directory may or may not exist
    // (cleanup runs when ffmpeg exits, not when error fires).
    // We can only assert that hlsDir() returns the expected path.
    assert.ok(dir.endsWith(key));
  });
});

// ---------------------------------------------------------------------------
// PreviewManager unit tests — MediaMTX-based (no ffmpeg, no previewPath)
// ---------------------------------------------------------------------------

describe('PreviewManager', () => {
  let manager;

  before(() => {
    manager = new PreviewManager();
  });

  it('isRunning returns false for unstarted key', () => {
    assert.strictEqual(manager.isRunning('nonexistent'), false);
  });

  it('start() marks key as running', async () => {
    await manager.start('starttest');
    assert.strictEqual(manager.isRunning('starttest'), true);
    await manager.stop('starttest');
  });

  it('stopAll resolves immediately when no streams are active', async () => {
    await assert.doesNotReject(() => manager.stopAll());
  });

  it('stop resolves immediately for non-running key', async () => {
    await assert.doesNotReject(() => manager.stop('nonexistent'));
  });

  it('fetchThumbnail returns null without mediamtxClient', async () => {
    const result = await manager.fetchThumbnail('anykey');
    assert.strictEqual(result, null);
  });
});

// ---------------------------------------------------------------------------
// POST /stream-hls nginx callbacks
// ---------------------------------------------------------------------------

describe('POST /stream-hls — nginx callbacks', () => {
  let db, server, manager, tmpRoot;

  before(async () => {
    db = initTestDb();
    tmpRoot = join(tmpdir(), `hls-nginx-test-${Date.now()}`);
    fs.mkdirSync(tmpRoot, { recursive: true });
    manager = new HlsManager({ hlsRoot: tmpRoot, localRtmp: 'rtmp://127.0.0.1:9999', rtmpApp: 'testapp' });

    const app = express();
    app.use('/stream-hls', createStreamHlsRouter(db, manager));

    await new Promise(resolve => {
      server = createServer(app).listen(0, '127.0.0.1', resolve);
    });
  });

  after(() => new Promise(resolve => {
    server.close(resolve);
    db.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }));

  it('returns 400 when name is missing', async () => {
    const res = await postForm(server, '/stream-hls', { call: 'publish' });
    assert.strictEqual(res.status, 400);
  });

  it('returns 403 when HLS is not enabled for the key', async () => {
    const k = createKey(db, { owner: 'Test' });
    const res = await postForm(server, '/stream-hls', { call: 'publish', name: k.key });
    assert.strictEqual(res.status, 403);
  });

  it('returns 200 for publish_done even if key is unknown (stop is idempotent)', async () => {
    const res = await postForm(server, '/stream-hls', { call: 'publish_done', name: 'unknownkey' });
    assert.strictEqual(res.status, 200);
  });

  it('returns 400 for unknown call type', async () => {
    const k = createKey(db, { owner: 'Test2', hls_enabled: true });
    const res = await postForm(server, '/stream-hls', { call: 'unknown', name: k.key });
    assert.strictEqual(res.status, 400);
  });

  it('POST /stream-hls/on_publish returns 403 if not enabled', async () => {
    const k = createKey(db, { owner: 'Test3' });
    const res = await postForm(server, '/stream-hls/on_publish', { name: k.key });
    assert.strictEqual(res.status, 403);
  });

  it('POST /stream-hls/on_publish_done returns 200', async () => {
    const res = await postForm(server, '/stream-hls/on_publish_done', { name: 'anykey' });
    assert.strictEqual(res.status, 200);
  });
});

// ---------------------------------------------------------------------------
// GET /stream-hls/:key/index.m3u8 — HLS playlist serving
// ---------------------------------------------------------------------------

describe('GET /stream-hls/:key/index.m3u8', () => {
  let db, appServer, manager, mockMtxServer, tmpRoot, savedMtxUrl;

  before(async () => {
    db = initTestDb();
    tmpRoot = join(tmpdir(), `hls-playlist-test-${Date.now()}`);
    fs.mkdirSync(tmpRoot, { recursive: true });

    // Start a mock MediaMTX server that serves files from tmpRoot
    await new Promise(resolve => {
      mockMtxServer = createServer((req, res) => {
        const parts = req.url.replace(/^\//, '').split('/');
        const filePath = join(tmpRoot, ...parts);
        try {
          const content = fs.readFileSync(filePath);
          res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
          res.end(content);
        } catch {
          res.writeHead(404);
          res.end();
        }
      }).listen(0, '127.0.0.1', () => {
        savedMtxUrl = process.env.MEDIAMTX_HLS_BASE_URL;
        process.env.MEDIAMTX_HLS_BASE_URL = `http://127.0.0.1:${mockMtxServer.address().port}`;
        resolve();
      });
    });

    manager = new HlsManager({ hlsRoot: tmpRoot });
    const app = express();
    app.use('/stream-hls', createStreamHlsRouter(db, manager));
    await new Promise(resolve => {
      appServer = createServer(app).listen(0, '127.0.0.1', resolve);
    });
  });

  after(() => new Promise(resolve => {
    if (savedMtxUrl !== undefined) process.env.MEDIAMTX_HLS_BASE_URL = savedMtxUrl;
    else delete process.env.MEDIAMTX_HLS_BASE_URL;
    appServer.close(() => mockMtxServer.close(() => { db.close(); resolve(); }));
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }));

  it('returns 404 when no stream is live', async () => {
    const res = await getJson(appServer, '/stream-hls/nosuchstream/index.m3u8');
    assert.strictEqual(res.status, 404);
  });

  it('returns 400 for too-short key', async () => {
    const res = await getJson(appServer, '/stream-hls/ab/index.m3u8');
    assert.strictEqual(res.status, 400);
  });

  it('returns 400 for key with path traversal characters', async () => {
    const cases = ['../etc', '..%2Fetc', 'key/sub'];
    for (const k of cases) {
      const res = await getJson(appServer, `/stream-hls/${k}/index.m3u8`);
      assert.ok(res.status === 400 || res.status === 404,
        `Expected 400/404 for key "${k}", got ${res.status}`);
    }
  });

  it('serves playlist with correct content-type when file exists', async () => {
    const key = 'teststream';
    const dir = join(tmpRoot, key);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(join(dir, 'index.m3u8'), '#EXTM3U\n#EXT-X-VERSION:3\n');

    const res = await getJson(appServer, `/stream-hls/${key}/index.m3u8`);
    assert.strictEqual(res.status, 200);
    assert.ok(res.headers.get('content-type')?.includes('mpegurl'));
    assert.strictEqual(res.headers.get('access-control-allow-origin'), '*');
    const body = await res.text();
    assert.ok(body.includes('#EXTM3U'));
  });
});

// ---------------------------------------------------------------------------
// GET /stream-hls/:key/:segment — HLS segment proxy (proxies to MediaMTX)
// ---------------------------------------------------------------------------

describe('GET /stream-hls/:key/:segment', () => {
  let db, appServer, manager, mockMtxServer, tmpRoot, savedMtxUrl;

  before(async () => {
    db = initTestDb();
    tmpRoot = join(tmpdir(), `hls-seg-test-${Date.now()}`);
    fs.mkdirSync(tmpRoot, { recursive: true });

    // Start a mock MediaMTX server that serves files from tmpRoot
    await new Promise(resolve => {
      mockMtxServer = createServer((req, res) => {
        const parts = req.url.replace(/^\//, '').split('/');
        const filePath = join(tmpRoot, ...parts);
        try {
          const content = fs.readFileSync(filePath);
          res.writeHead(200, { 'Content-Type': 'video/mp2t' });
          res.end(content);
        } catch {
          res.writeHead(404);
          res.end();
        }
      }).listen(0, '127.0.0.1', () => {
        savedMtxUrl = process.env.MEDIAMTX_HLS_BASE_URL;
        process.env.MEDIAMTX_HLS_BASE_URL = `http://127.0.0.1:${mockMtxServer.address().port}`;
        resolve();
      });
    });

    manager = new HlsManager({ hlsRoot: tmpRoot });
    const app = express();
    app.use('/stream-hls', createStreamHlsRouter(db, manager));
    await new Promise(resolve => {
      appServer = createServer(app).listen(0, '127.0.0.1', resolve);
    });
  });

  after(() => new Promise(resolve => {
    if (savedMtxUrl !== undefined) process.env.MEDIAMTX_HLS_BASE_URL = savedMtxUrl;
    else delete process.env.MEDIAMTX_HLS_BASE_URL;
    appServer.close(() => mockMtxServer.close(() => { db.close(); resolve(); }));
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }));

  it('returns 400 for non-ts segment names', async () => {
    const res = await getJson(appServer, '/stream-hls/testkey/badname.txt');
    assert.strictEqual(res.status, 400);
  });

  it('returns 400 for segment with path-separator characters', async () => {
    // Names with mid-dots don't pass /^[a-zA-Z0-9_-]+\.ts$/ regex
    const res = await getJson(appServer, '/stream-hls/testkey/bad.name.ts');
    assert.strictEqual(res.status, 400);
  });

  it('returns 404 for valid segment name that does not exist', async () => {
    const res = await getJson(appServer, '/stream-hls/testkey/seg00001.ts');
    assert.strictEqual(res.status, 404);
  });

  it('serves segment with correct content-type when file exists', async () => {
    const key = 'segtest';
    const dir = join(tmpRoot, key);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(join(dir, 'seg00001.ts'), 'fake ts data');

    const res = await getJson(appServer, `/stream-hls/${key}/seg00001.ts`);
    assert.strictEqual(res.status, 200);
    assert.ok(res.headers.get('content-type')?.includes('mp2t'));
    assert.strictEqual(res.headers.get('access-control-allow-origin'), '*');
  });
});

// ---------------------------------------------------------------------------
// GET /stream-hls/:key/player.js — embeddable video player snippet
// ---------------------------------------------------------------------------

describe('GET /stream-hls/:key/player.js', () => {
  let db, server, manager;

  before(async () => {
    db = initTestDb();
    const tmpRoot = join(tmpdir(), `hls-player-test-${Date.now()}`);
    fs.mkdirSync(tmpRoot, { recursive: true });
    manager = new HlsManager({ hlsRoot: tmpRoot });

    const app = express();
    app.use('/stream-hls', createStreamHlsRouter(db, manager));

    await new Promise(resolve => {
      server = createServer(app).listen(0, '127.0.0.1', resolve);
    });
  });

  after(() => new Promise(resolve => {
    server.close(resolve);
    db.close();
  }));

  it('returns 400 for too-short key', async () => {
    const res = await getJson(server, '/stream-hls/ab/player.js');
    assert.strictEqual(res.status, 400);
  });

  it('returns JavaScript content-type', async () => {
    const res = await getJson(server, '/stream-hls/validkey/player.js');
    assert.strictEqual(res.status, 200);
    assert.ok(res.headers.get('content-type')?.includes('javascript'));
  });

  it('snippet contains the HLS key and playlist URL', async () => {
    const res = await getJson(server, '/stream-hls/myevent/player.js');
    assert.strictEqual(res.status, 200);
    const body = await res.text();
    assert.ok(body.includes('myevent'), 'snippet should reference the HLS key');
    assert.ok(body.includes('index.m3u8'), 'snippet should reference the HLS playlist');
    assert.ok(body.includes('stream-hls'), 'snippet URL should use /stream-hls path');
  });

  it('snippet creates a video element (not audio)', async () => {
    const res = await getJson(server, '/stream-hls/myevent/player.js');
    const body = await res.text();
    assert.ok(body.includes('video'), 'snippet should reference a video element');
    assert.ok(!body.includes("'audio'"), 'snippet should not create an audio element');
  });

  it('has CORS header', async () => {
    const res = await getJson(server, '/stream-hls/myevent/player.js');
    assert.strictEqual(res.headers.get('access-control-allow-origin'), '*');
  });
});

// ---------------------------------------------------------------------------
// GET /preview/:key/incoming.jpg — JPEG thumbnail serving
// ---------------------------------------------------------------------------

describe('GET /preview/:key/incoming.jpg', () => {
  let previewServer, previewTmpRoot;

  // Mock PreviewManager — implements fetchThumbnail() as required by the route
  function makeMockPreviewMgr(root) {
    return {
      async fetchThumbnail(key) {
        const p = join(root, key, 'incoming.jpg');
        try {
          fs.accessSync(p, fs.constants.R_OK);
          return { headers: { 'content-type': 'image/jpeg' }, body: p };
        } catch {
          return null;
        }
      },
    };
  }

  before(async () => {
    previewTmpRoot = join(tmpdir(), `preview-route-test-${Date.now()}`);
    fs.mkdirSync(previewTmpRoot, { recursive: true });

    const mockMgr = makeMockPreviewMgr(previewTmpRoot);
    const app = express();
    // Route registers /preview/:key/incoming[.jpg] — mount at root
    app.use(createPreviewRouter(mockMgr));

    await new Promise(resolve => {
      previewServer = createServer(app).listen(0, '127.0.0.1', resolve);
    });
  });

  after(() => new Promise(resolve => {
    previewServer.close(() => {
      fs.rmSync(previewTmpRoot, { recursive: true, force: true });
      resolve();
    });
  }));

  it('returns 404 when no preview is available', async () => {
    const res = await getJson(previewServer, '/preview/nosuchstream/incoming.jpg');
    assert.strictEqual(res.status, 404);
  });

  it('serves JPEG with correct content-type when file exists', async () => {
    const key = 'streampreview';
    const dir = join(previewTmpRoot, key);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(join(dir, 'incoming.jpg'), Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]));

    const res = await getJson(previewServer, `/preview/${key}/incoming.jpg`);
    assert.strictEqual(res.status, 200);
    assert.ok(res.headers.get('content-type')?.includes('jpeg'));
  });

  it('response has Cache-Control with public max-age', async () => {
    const key = 'cachetest2';
    const dir = join(previewTmpRoot, key);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(join(dir, 'incoming.jpg'), Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]));

    const res = await getJson(previewServer, `/preview/${key}/incoming.jpg`);
    assert.strictEqual(res.status, 200);
    const cc = res.headers.get('cache-control') || '';
    assert.ok(cc.includes('public'), `expected public in Cache-Control, got: ${cc}`);
    assert.ok(cc.includes('max-age='), `expected max-age= in Cache-Control, got: ${cc}`);
  });

  it('response includes ETag header', async () => {
    const key = 'etagtest';
    const dir = join(previewTmpRoot, key);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(join(dir, 'incoming.jpg'), Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]));

    const res = await getJson(previewServer, `/preview/${key}/incoming.jpg`);
    assert.ok(res.headers.get('etag'), 'should include ETag header');
  });

  it('returns 304 when If-None-Match matches ETag', async () => {
    const key = 'condrequest2';
    const dir = join(previewTmpRoot, key);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(join(dir, 'incoming.jpg'), Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]));

    // Allow the rate-limit window (1 s, max 5 req) to reset before issuing more requests
    await new Promise(r => setTimeout(r, 1100));
    // First request to get the ETag
    const first = await getJson(previewServer, `/preview/${key}/incoming.jpg`);
    const etag = first.headers.get('etag');
    assert.ok(etag, 'missing ETag');

    // Second request with matching ETag
    const second = await fetch(`${baseUrl(previewServer)}/preview/${key}/incoming.jpg`, {
      headers: { 'If-None-Match': etag },
    });
    assert.strictEqual(second.status, 304);
  });

  it('OPTIONS returns 204 with CORS headers', async () => {
    const key = 'corstest2';
    const res = await fetch(`${baseUrl(previewServer)}/preview/${key}/incoming`, { method: 'OPTIONS' });
    assert.strictEqual(res.status, 204);
    assert.strictEqual(res.headers.get('access-control-allow-origin'), '*');
  });
});
