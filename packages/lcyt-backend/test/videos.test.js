import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import express from 'express';
import { initDb } from '../src/db/schema.js';
import { createVideosRouter, rewritePlaylistReferences } from '../src/routes/videos.js';

function auth(req, res, next) {
  req.session = { apiKey: 'demo-key' };
  next();
}

describe('videos router', () => {
  let server;
  let baseUrl;
  let tempDir;
  let db;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'lcyt-videos-'));
    process.env.VIDEOS_STORAGE_DIR = join(tempDir, 'recordings');
    db = initDb(join(tempDir, 'backend.db'));
    db.prepare('INSERT INTO api_keys (key, owner) VALUES (?, ?)').run('demo-key', 'demo');
    const app = express();
    app.use(express.json());
    app.use('/videos', createVideosRouter(auth, db));
    server = createServer(app);
    return new Promise((resolve) => server.listen(0, () => {
      const address = server.address();
      baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    }));
  });

  afterEach(() => {
    return new Promise((resolve) => {
      server.close(() => {
        rmSync(tempDir, { recursive: true, force: true });
        delete process.env.VIDEOS_STORAGE_DIR;
        resolve();
      });
    });
  });

  it('lists and creates persisted videos', async () => {
    let res = await fetch(`${baseUrl}/videos`);
    assert.equal(res.status, 200);
    let body = await res.json();
    assert.deepEqual(body.videos, []);

    res = await fetch(`${baseUrl}/videos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Demo recording' }),
    });
    assert.equal(res.status, 201);
    body = await res.json();
    const createdVideoId = body.video.id;
    assert.equal(body.video.title, 'Demo recording');
    assert.equal(body.video.status, 'recording');
    assert.ok(body.video.playbackUrl.includes('/playlist.m3u8'));

    res = await fetch(`${baseUrl}/videos/${createdVideoId}`);
    assert.equal(res.status, 200);
    body = await res.json();
    assert.equal(body.video.id, createdVideoId);
    assert.equal(body.video.title, 'Demo recording');
  });

  it('rewrites playlist references for backend-served relative assets', () => {
    const playlistBody = '#EXTM3U\n#EXTINF:1.0,placeholder\nsegment0.ts\n./sub/clip.ts\nhttps://cdn.example.com/clip.ts\n/absolute.ts\n';
    const rewritten = rewritePlaylistReferences(playlistBody, 'http://127.0.0.1:3000/videos/demo-video');
    assert.match(rewritten, /http:\/\/127\.0\.0\.1:3000\/videos\/demo-video\/segment0\.ts/);
    assert.match(rewritten, /http:\/\/127\.0\.0\.1:3000\/videos\/demo-video\/sub\/clip\.ts/);
    assert.match(rewritten, /https:\/\/cdn\.example\.com\/clip\.ts/);
    assert.match(rewritten, /\/absolute\.ts/);
  });

  it('serves S3-backed playlist assets through the backend', async () => {
    process.env.S3_ENDPOINT = 'https://s3.example.test';
    process.env.S3_BUCKET = 'demo-bucket';
    const originalFetch = global.fetch;
    global.fetch = async (url, init) => {
      if (typeof url === 'string') {
        try {
          const parsedUrl = new URL(url);
          if (parsedUrl.origin === 'https://s3.example.test') {
            return new Response('#EXTM3U\n#EXTINF:1.0,placeholder\nsegment0.ts\n', {
              status: 200,
              headers: { 'Content-Type': 'application/vnd.apple.mpegurl' },
            });
          }
        } catch {
          // fall through to the real fetch for non-URL values
        }
      }
      return originalFetch(url, init);
    };

    try {
      const result = db.prepare(`
        INSERT INTO videos (id, api_key, title, status, storage_type, storage_key, started_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('s3-video', 'demo-key', 'S3 recording', 'recording', 's3', 'demo-prefix', new Date().toISOString());
      assert.equal(result.changes, 1);

      const res = await fetch(`${baseUrl}/videos/s3-video/playlist.m3u8`);
      assert.equal(res.status, 200);
      const body = await res.text();
      assert.match(body, /segment0\.ts/);
      assert.match(body, /videos\/s3-video\/segment0\.ts/);
    } finally {
      global.fetch = originalFetch;
      delete process.env.S3_ENDPOINT;
      delete process.env.S3_BUCKET;
    }
  });
});
