import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import express from 'express';
import { initDb } from '../src/db/schema.js';
import { createVideosRouter } from '../src/routes/videos.js';

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
});
