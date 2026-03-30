import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { createServer } from 'node:http';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import express from 'express';
import { initDb, createKey, updateKey } from '../src/db.js';
import { runMigrations } from 'lcyt-rtmp/src/db.js';

function initTestDb() { const db = initDb(':memory:'); runMigrations(db); return db; }
import { isRadioEnabled } from 'lcyt-rtmp/src/db.js';
import { createRadioRouter } from 'lcyt-rtmp/src/routes/radio.js';
import { RadioManager } from 'lcyt-rtmp/src/radio-manager.js';

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
// DB helpers: radio_enabled column
// ---------------------------------------------------------------------------

describe('radio_enabled DB column', () => {
  let db;

  before(() => { db = initTestDb(); });
  after(() => { db.close(); });

  it('defaults to false on createKey', () => {
    const k = createKey(db, { owner: 'Alice' });
    assert.strictEqual(isRadioEnabled(db, k.key), false);
  });

  it('can be set to true on createKey', () => {
    const k = createKey(db, { owner: 'Bob', radio_enabled: true });
    assert.strictEqual(isRadioEnabled(db, k.key), true);
  });

  it('isRadioEnabled returns false for unknown key', () => {
    assert.strictEqual(isRadioEnabled(db, 'no-such-key'), false);
  });

  it('isRadioEnabled returns true after updateKey', () => {
    const k = createKey(db, { owner: 'Carol' });
    assert.strictEqual(isRadioEnabled(db, k.key), false);
    updateKey(db, k.key, { radio_enabled: true });
    assert.strictEqual(isRadioEnabled(db, k.key), true);
  });

  it('isRadioEnabled returns false after disabling', () => {
    const k = createKey(db, { owner: 'Dave', radio_enabled: true });
    updateKey(db, k.key, { radio_enabled: false });
    assert.strictEqual(isRadioEnabled(db, k.key), false);
  });
});

// ---------------------------------------------------------------------------
// RadioManager unit tests — MediaMTX-based (no ffmpeg, no hlsDir)
// ---------------------------------------------------------------------------

describe('RadioManager', () => {
  let manager;

  before(() => {
    manager = new RadioManager();
  });

  it('isRunning returns false for unstarted key', () => {
    assert.strictEqual(manager.isRunning('not-started'), false);
  });

  it('start() marks key as running', async () => {
    await manager.start('mgr-start-test');
    assert.strictEqual(manager.isRunning('mgr-start-test'), true);
    await manager.stop('mgr-start-test');
  });

  it('stop resolves immediately if not running', async () => {
    await assert.doesNotReject(() => manager.stop('not-running'));
  });

  it('stopAll resolves immediately when no streams running', async () => {
    await assert.doesNotReject(() => manager.stopAll());
  });

  it('getInternalHlsUrl includes the key', () => {
    const url = manager.getInternalHlsUrl('mykey');
    assert.ok(url.includes('mykey'), `expected URL to include key, got: ${url}`);
  });
});

// ---------------------------------------------------------------------------
// POST /radio — nginx-rtmp single-URL callbacks
// ---------------------------------------------------------------------------

describe('POST /radio (nginx-rtmp single-URL callbacks)', () => {
  let db, server, manager;

  before(async () => {
    db = initTestDb();

    // Fake RadioManager to avoid spawning real ffmpeg
    manager = {
      _started: new Set(),
      _stopped: new Set(),
      start(key) { this._started.add(key); return Promise.resolve(); },
      stop(key)  { this._stopped.add(key); return Promise.resolve(); },
      isRunning(key) { return this._started.has(key) && !this._stopped.has(key); },
      hlsDir(key) { return `/tmp/hls/${key}`; },
      _hlsRoot: '/tmp/hls',
    };

    const app = express();
    app.use('/radio', createRadioRouter(db, manager));

    await new Promise(resolve => {
      server = createServer(app).listen(0, '127.0.0.1', resolve);
    });
  });

  after(() => new Promise(resolve => {
    server.close(resolve);
    db.close();
  }));

  it('returns 400 if name is missing', async () => {
    const res = await postForm(server, '/radio', { call: 'publish' });
    assert.strictEqual(res.status, 400);
  });

  it('returns 403 when radio is not enabled for the key', async () => {
    const k = createKey(db, { owner: 'NotEnabled', radio_enabled: false });
    const res = await postForm(server, '/radio', { call: 'publish', name: k.key });
    assert.strictEqual(res.status, 403);
  });

  it('returns 200 and starts HLS when radio is enabled (call=publish)', async () => {
    const k = createKey(db, { owner: 'Enabled', radio_enabled: true });
    const res = await postForm(server, '/radio', { call: 'publish', name: k.key });
    assert.strictEqual(res.status, 200);
    assert.ok(manager._started.has(k.key), 'start() should have been called');
  });

  it('returns 200 and stops HLS on call=publish_done', async () => {
    const k = createKey(db, { owner: 'Enabled2', radio_enabled: true });
    const res = await postForm(server, '/radio', { call: 'publish_done', name: k.key });
    assert.strictEqual(res.status, 200);
    assert.ok(manager._stopped.has(k.key), 'stop() should have been called');
  });

  it('returns 400 for unknown call type', async () => {
    const k = createKey(db, { owner: 'UnknownCall', radio_enabled: true });
    const res = await postForm(server, '/radio', { call: 'invalid', name: k.key });
    assert.strictEqual(res.status, 400);
  });
});

// ---------------------------------------------------------------------------
// POST /radio/on_publish and /radio/on_publish_done — separate-URL style
// ---------------------------------------------------------------------------

describe('POST /radio/on_publish and /radio/on_publish_done', () => {
  let db, server, manager;

  before(async () => {
    db = initTestDb();

    manager = {
      _started: new Set(),
      _stopped: new Set(),
      start(key) { this._started.add(key); return Promise.resolve(); },
      stop(key)  { this._stopped.add(key); return Promise.resolve(); },
      isRunning(key) { return false; },
      hlsDir(key) { return `/tmp/hls/${key}`; },
      _hlsRoot: '/tmp/hls',
    };

    const app = express();
    app.use('/radio', createRadioRouter(db, manager));

    await new Promise(resolve => {
      server = createServer(app).listen(0, '127.0.0.1', resolve);
    });
  });

  after(() => new Promise(resolve => {
    server.close(resolve);
    db.close();
  }));

  it('POST /radio/on_publish starts enabled key', async () => {
    const k = createKey(db, { owner: 'PubA', radio_enabled: true });
    const res = await postForm(server, '/radio/on_publish', { name: k.key });
    assert.strictEqual(res.status, 200);
    assert.ok(manager._started.has(k.key));
  });

  it('POST /radio/on_publish denies disabled key', async () => {
    const k = createKey(db, { owner: 'PubB', radio_enabled: false });
    const res = await postForm(server, '/radio/on_publish', { name: k.key });
    assert.strictEqual(res.status, 403);
  });

  it('POST /radio/on_publish_done stops the stream', async () => {
    const k = createKey(db, { owner: 'PubC', radio_enabled: true });
    const res = await postForm(server, '/radio/on_publish_done', { name: k.key });
    assert.strictEqual(res.status, 200);
    assert.ok(manager._stopped.has(k.key));
  });
});

// ---------------------------------------------------------------------------
// GET /radio/:key/index.m3u8 — HLS playlist proxy (proxies to MediaMTX)
// ---------------------------------------------------------------------------

describe('GET /radio/:key/index.m3u8', () => {
  let db, appServer, manager, mockMtxServer, tmpRoot, savedMtxUrl;

  before(async () => {
    db = initTestDb();
    tmpRoot = join(tmpdir(), `radio-hls-test-${Date.now()}`);
    fs.mkdirSync(tmpRoot, { recursive: true });

    // Start a mock MediaMTX server that serves files from tmpRoot
    await new Promise(resolve => {
      mockMtxServer = createServer((req, res) => {
        // req.url: /<key>/<file>
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

    manager = new RadioManager();
    const app = express();
    app.use('/radio', createRadioRouter(db, manager));
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
    const res = await getJson(appServer, '/radio/nosuchstream/index.m3u8');
    assert.strictEqual(res.status, 404);
  });

  it('returns 400 for too-short key', async () => {
    const res = await getJson(appServer, '/radio/ab/index.m3u8');
    assert.strictEqual(res.status, 400);
  });

  it('returns 400 for key with path traversal characters', async () => {
    const cases = ['../etc', '..%2Fetc', 'key/sub'];
    for (const k of cases) {
      const res = await getJson(appServer, `/radio/${k}/index.m3u8`);
      assert.ok(res.status === 400 || res.status === 404,
        `Expected 400/404 for key "${k}", got ${res.status}`);
    }
  });

  it('serves playlist with correct content-type when file exists', async () => {
    const key = 'teststream';
    const dir = join(tmpRoot, key);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(join(dir, 'index.m3u8'), '#EXTM3U\n#EXT-X-VERSION:3\n');

    const res = await getJson(appServer, `/radio/${key}/index.m3u8`);
    assert.strictEqual(res.status, 200);
    assert.ok(res.headers.get('content-type')?.includes('mpegurl'));
    assert.strictEqual(res.headers.get('access-control-allow-origin'), '*');
    const body = await res.text();
    assert.ok(body.includes('#EXTM3U'));
  });
});

// ---------------------------------------------------------------------------
// GET /radio/:key/:segment — HLS segment proxy (proxies to MediaMTX)
// ---------------------------------------------------------------------------

describe('GET /radio/:key/:segment', () => {
  let db, appServer, manager, mockMtxServer, tmpRoot, savedMtxUrl;

  before(async () => {
    db = initTestDb();
    tmpRoot = join(tmpdir(), `radio-seg-test-${Date.now()}`);
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

    manager = new RadioManager();
    const app = express();
    app.use('/radio', createRadioRouter(db, manager));
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
    const res = await getJson(appServer, '/radio/testkey/badname.txt');
    assert.strictEqual(res.status, 400);
  });

  it('returns 400 for segment with path-separator characters', async () => {
    // Names with dots or slashes don't pass the /^[a-zA-Z0-9_-]+\.ts$/ regex
    const res = await getJson(appServer, '/radio/testkey/bad.name.ts');
    assert.strictEqual(res.status, 400);
  });

  it('returns 404 for valid segment name that does not exist', async () => {
    const res = await getJson(appServer, '/radio/testkey/seg00001.ts');
    assert.strictEqual(res.status, 404);
  });

  it('serves segment with correct content-type when file exists', async () => {
    const key = 'segtest';
    const dir = join(tmpRoot, key);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(join(dir, 'seg00001.ts'), 'fake ts data');

    const res = await getJson(appServer, `/radio/${key}/seg00001.ts`);
    assert.strictEqual(res.status, 200);
    assert.ok(res.headers.get('content-type')?.includes('mp2t'));
    assert.strictEqual(res.headers.get('access-control-allow-origin'), '*');
  });
});

// ---------------------------------------------------------------------------
// GET /radio/:key/player.js — embeddable player snippet
// ---------------------------------------------------------------------------

describe('GET /radio/:key/player.js', () => {
  let db, server, manager;

  before(async () => {
    db = initTestDb();
    const tmpRoot = join(tmpdir(), `radio-player-test-${Date.now()}`);
    fs.mkdirSync(tmpRoot, { recursive: true });
    manager = new RadioManager({ hlsRoot: tmpRoot });

    const app = express();
    app.use('/radio', createRadioRouter(db, manager));

    await new Promise(resolve => {
      server = createServer(app).listen(0, '127.0.0.1', resolve);
    });
  });

  after(() => new Promise(resolve => {
    server.close(resolve);
    db.close();
  }));

  it('returns 400 for too-short key', async () => {
    const res = await getJson(server, '/radio/ab/player.js');
    assert.strictEqual(res.status, 400);
  });

  it('returns JavaScript content-type', async () => {
    const res = await getJson(server, '/radio/validkey/player.js');
    assert.strictEqual(res.status, 200);
    assert.ok(res.headers.get('content-type')?.includes('javascript'));
  });

  it('snippet contains the radio key and HLS URL', async () => {
    const res = await getJson(server, '/radio/myevent/player.js');
    assert.strictEqual(res.status, 200);
    const body = await res.text();
    assert.ok(body.includes('myevent'), 'snippet should reference the radio key');
    assert.ok(body.includes('index.m3u8'), 'snippet should reference the HLS playlist');
  });

  it('snippet creates an audio element', async () => {
    const res = await getJson(server, '/radio/myevent/player.js');
    const body = await res.text();
    assert.ok(body.includes('audio'), 'snippet should reference an audio element');
    assert.ok(body.includes('function'), 'snippet should define a function');
  });

  it('has CORS header', async () => {
    const res = await getJson(server, '/radio/myevent/player.js');
    assert.strictEqual(res.headers.get('access-control-allow-origin'), '*');
  });
});
