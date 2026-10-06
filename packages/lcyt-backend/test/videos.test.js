import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import express from 'express';
import { initDb } from '../src/db/schema.js';
import { createVideosRouter, rewritePlaylistReferences } from '../src/routes/videos.js';
import { startVideoRecording, getVideo, getVideoStorageDir, syncVideoRecordingToStorage } from '../src/db/videos.js';
import { startMockS3Server } from '../../plugins/lcyt-files/test/helpers/mock-s3-server.js';
import { createS3ObjectStore } from 'lcyt-files';

function auth(req, res, next) {
  req.session = { apiKey: 'demo-key' };
  next();
}

describe('videos router', () => {
  let server;
  let baseUrl;
  let tempDir;
  let db;

  function closeHttpServer(target) {
    if (!target) return Promise.resolve();
    target.closeIdleConnections?.();
    target.closeAllConnections?.();
    return new Promise((resolve) => target.close(() => resolve()));
  }

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
    return closeHttpServer(server).finally(() => {
      try { db?.close?.(); } catch {}
      rmSync(tempDir, { recursive: true, force: true });
      delete process.env.VIDEOS_STORAGE_DIR;
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
    const mockS3 = await startMockS3Server();
    const recordingsStore = await createS3ObjectStore({
      bucket: 'demo-bucket',
      prefix: 'recordings',
      region: 'auto',
      endpoint: `http://127.0.0.1:${mockS3.port}`,
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    });

    const app = express();
    app.use(express.json());
    app.use('/videos', createVideosRouter(auth, db, { recordingsStore }));
    const s3Server = createServer(app);
    await new Promise((resolve) => s3Server.listen(0, resolve));
    const s3BaseUrl = `http://127.0.0.1:${s3Server.address().port}`;

    try {
      await recordingsStore.put('demo-prefix/playlist.m3u8', '#EXTM3U\n#EXTINF:1.0,placeholder\nsegment0.ts\n', { contentType: 'application/vnd.apple.mpegurl' });
      const result = db.prepare(`
        INSERT INTO videos (id, api_key, title, status, storage_type, storage_key, started_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('s3-video', 'demo-key', 'S3 recording', 'recording', 's3', 'demo-prefix', new Date().toISOString());
      assert.equal(result.changes, 1);

      const res = await fetch(`${s3BaseUrl}/videos/s3-video/playlist.m3u8`);
      assert.equal(res.status, 200);
      const body = await res.text();
      assert.match(body, /segment0\.ts/);
      assert.match(body, /videos\/s3-video\/segment0\.ts/);
    } finally {
      recordingsStore.close?.();
      await closeHttpServer(s3Server);
      await mockS3.stop();
    }
  });

  it('syncVideoRecordingToStorage uploads local recording artifacts to S3', async () => {
    const mockS3 = await startMockS3Server();
    process.env.S3_ENDPOINT = `http://127.0.0.1:${mockS3.port}`;
    process.env.S3_BUCKET = 'demo-bucket';
    process.env.S3_ACCESS_KEY_ID = 'test';
    process.env.S3_SECRET_ACCESS_KEY = 'test';
    let recordingsStore = null;
    try {
      const result = startVideoRecording(db, 'demo-key', { title: 'S3 sync', storageType: 's3' });
      assert.ok(result.ok);
      const videoId = result.video.id;

      // Simulate MediaMTX having written a real recorded segment alongside the placeholders.
      writeFileSync(join(getVideoStorageDir('demo-key', videoId), 'segment1.ts'), 'segment-bytes');

      recordingsStore = await createS3ObjectStore({
        bucket: 'demo-bucket',
        prefix: 'recordings',
        region: 'auto',
        endpoint: `http://127.0.0.1:${mockS3.port}`,
        credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
      });

      await syncVideoRecordingToStorage(db, 'demo-key', videoId, { recordingsStore });

      const storageKey = getVideo(db, 'demo-key', videoId).storageKey;
      assert.ok(mockS3.objects.has(`demo-bucket/recordings/${storageKey}/playlist.m3u8`));
      assert.ok(mockS3.objects.has(`demo-bucket/recordings/${storageKey}/segment0.ts`));
      assert.equal(mockS3.objects.get(`demo-bucket/recordings/${storageKey}/segment1.ts`)?.toString(), 'segment-bytes');

      const updated = getVideo(db, 'demo-key', videoId);
      assert.equal(updated.storageType, 's3');
      assert.ok(updated.sizeBytes > 0);
    } finally {
      recordingsStore.close?.();
      await mockS3.stop();
      delete process.env.S3_ENDPOINT;
      delete process.env.S3_BUCKET;
      delete process.env.S3_ACCESS_KEY_ID;
      delete process.env.S3_SECRET_ACCESS_KEY;
    }
  });

  it('syncVideoRecordingToStorage falls back to local storage when the upload fails', async () => {
    try {
      const result = startVideoRecording(db, 'demo-key', { title: 'S3 sync failure', storageType: 's3' });
      assert.ok(result.ok);
      const videoId = result.video.id;

      const brokenStore = {
        type: 's3',
        putFile: async () => { throw new Error('simulated upload failure'); },
      };

      await syncVideoRecordingToStorage(db, 'demo-key', videoId, { recordingsStore: brokenStore });

      const updated = getVideo(db, 'demo-key', videoId);
      assert.equal(updated.storageType, 'local');
    } finally {
      // no-op
    }
  });

  it('syncVideoRecordingToStorage is a no-op for local-storage recordings', async () => {
    const result = startVideoRecording(db, 'demo-key', { title: 'Local only', storageType: 'local' });
    assert.ok(result.ok);
    const videoId = result.video.id;

    await syncVideoRecordingToStorage(db, 'demo-key', videoId, { recordingsStore: null });

    const updated = getVideo(db, 'demo-key', videoId);
    assert.equal(updated.storageType, 'local');
    assert.equal(updated.sizeBytes, 0);
  });
});
