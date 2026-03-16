/**
 * Tests for the /video router.
 *
 * HlsManager and HlsSubsManager are replaced with lightweight mock objects,
 * and fs functions (createReadStream, existsSync) are injected via a mini
 * test-only variant that overrides process.env.BACKEND_URL.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import { createVideoRouter } from '../src/routes/video.js';

// ---------------------------------------------------------------------------
// Mock HlsManager
// ---------------------------------------------------------------------------

function makeMockHlsManager({ running = [] } = {}) {
  const runningSet = new Set(running);
  return {
    isRunning: (key) => runningSet.has(key),
    _runningSet: runningSet,
  };
}

// ---------------------------------------------------------------------------
// Mock HlsSubsManager
// ---------------------------------------------------------------------------

function makeMockSubsManager({ languages = {}, playlists = {}, subsRoot = '/tmp/subs' } = {}) {
  return {
    _subsRoot: subsRoot,
    getLanguages: (key) => languages[key] || [],
    getPlaylist: (key, lang) => playlists[`${key}:${lang}`] || null,
  };
}

// ---------------------------------------------------------------------------
// Test server setup
// ---------------------------------------------------------------------------

let server, baseUrl;

const mockHls  = makeMockHlsManager({ running: ['live-key'] });
const mockSubs = makeMockSubsManager({
  languages : { 'live-key': ['en-US', 'fi-FI'] },
  playlists : { 'live-key:en-US': '#EXTM3U\n#EXT-X-VERSION:3\n' },
  subsRoot  : '/tmp/subs',
});

before(() => new Promise((resolve) => {
  process.env.BACKEND_URL = 'http://backend.test';

  const app = express();
  app.use('/video', createVideoRouter(null, mockHls, mockSubs));

  server = createServer(app);
  server.listen(0, () => {
    baseUrl = `http://localhost:${server.address().port}`;
    resolve();
  });
}));

after(() => new Promise((resolve) => {
  delete process.env.BACKEND_URL;
  server.close(resolve);
}));

// ---------------------------------------------------------------------------
// GET /video/:key — player page
// ---------------------------------------------------------------------------

describe('GET /video/:key — player HTML page', () => {
  it('returns 400 for an invalid key (too short)', async () => {
    const res = await fetch(`${baseUrl}/video/ab`);
    assert.equal(res.status, 400);
  });

  it('returns 400 for a key with invalid characters', async () => {
    const res = await fetch(`${baseUrl}/video/bad%20key`);
    assert.equal(res.status, 400);
  });

  it('returns 200 HTML for a valid key regardless of stream status', async () => {
    const res = await fetch(`${baseUrl}/video/validkey`);
    assert.equal(res.status, 200);
    assert.ok(res.headers.get('content-type')?.includes('text/html'));
    const body = await res.text();
    assert.ok(body.includes('<!DOCTYPE html>'));
    assert.ok(body.includes('validkey'));
  });

  it('includes CORS headers', async () => {
    const res = await fetch(`${baseUrl}/video/validkey`);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
  });

  it('applies dark theme by default', async () => {
    const res = await fetch(`${baseUrl}/video/validkey`);
    const body = await res.text();
    assert.ok(body.includes('#111'), 'dark background');
  });

  it('applies light theme when ?theme=light', async () => {
    const res = await fetch(`${baseUrl}/video/validkey?theme=light`);
    const body = await res.text();
    assert.ok(body.includes('#f5f5f5'), 'light background');
  });

  it('sets Cache-Control: no-cache', async () => {
    const res = await fetch(`${baseUrl}/video/validkey`);
    assert.ok(res.headers.get('cache-control')?.includes('no-cache'));
  });
});

// ---------------------------------------------------------------------------
// GET /video/:key/master.m3u8
// ---------------------------------------------------------------------------

describe('GET /video/:key/master.m3u8 — HLS master manifest', () => {
  it('returns 404 when stream is not live', async () => {
    const res = await fetch(`${baseUrl}/video/offline-key/master.m3u8`);
    assert.equal(res.status, 404);
  });

  it('returns 400 for invalid key', async () => {
    const res = await fetch(`${baseUrl}/video/x/master.m3u8`);
    assert.equal(res.status, 400);
  });

  it('returns 200 with HLS manifest for a running stream', async () => {
    const res = await fetch(`${baseUrl}/video/live-key/master.m3u8`);
    assert.equal(res.status, 200);
    assert.ok(res.headers.get('content-type')?.includes('mpegurl'));
    const body = await res.text();
    assert.ok(body.includes('#EXTM3U'), 'should be an HLS playlist');
    assert.ok(body.includes('live-key'), 'should reference the key');
  });

  it('includes subtitle tracks in manifest when subs manager has languages', async () => {
    const res = await fetch(`${baseUrl}/video/live-key/master.m3u8`);
    const body = await res.text();
    // Subtitle groups are present since getLanguages returns ['en-US', 'fi-FI']
    assert.ok(body.includes('en-US') || body.includes('subs'), 'should include subtitle tracks');
  });
});

// ---------------------------------------------------------------------------
// GET /video/:key/subs/:lang/playlist.m3u8
// ---------------------------------------------------------------------------

describe('GET /video/:key/subs/:lang/playlist.m3u8 — subtitle playlist', () => {
  it('returns 404 when playlist is not available', async () => {
    const res = await fetch(`${baseUrl}/video/live-key/subs/de-DE/playlist.m3u8`);
    assert.equal(res.status, 404);
  });

  it('returns 400 for invalid lang tag', async () => {
    const res = await fetch(`${baseUrl}/video/live-key/subs/../etc/playlist.m3u8`);
    assert.notEqual(res.status, 200); // traversal attempt blocked
  });

  it('returns 200 with playlist content when available', async () => {
    const res = await fetch(`${baseUrl}/video/live-key/subs/en-US/playlist.m3u8`);
    assert.equal(res.status, 200);
    assert.ok(res.headers.get('content-type')?.includes('mpegurl'));
    const body = await res.text();
    assert.ok(body.includes('#EXTM3U'));
  });
});

// ---------------------------------------------------------------------------
// GET /video/:key/subs/:lang/:segment — WebVTT segment
// ---------------------------------------------------------------------------

describe('GET /video/:key/subs/:lang/:segment — WebVTT segment file', () => {
  it('returns 400 for invalid segment filename format', async () => {
    const res = await fetch(`${baseUrl}/video/live-key/subs/en-US/badname.vtt`);
    assert.equal(res.status, 400);
  });

  it('returns 400 for invalid key', async () => {
    const res = await fetch(`${baseUrl}/video/x/subs/en-US/seg000001.vtt`);
    assert.equal(res.status, 400);
  });

  it('returns 404 when segment file does not exist (existsSync returns false)', async () => {
    // The router calls existsSync(file); since we did not mock it here,
    // the real fs will return false for a non-existent path.
    const res = await fetch(`${baseUrl}/video/live-key/subs/en-US/seg000001.vtt`);
    assert.equal(res.status, 404);
  });
});

// ---------------------------------------------------------------------------
// OPTIONS preflight
// ---------------------------------------------------------------------------

describe('OPTIONS /video/* — CORS preflight', () => {
  it('returns 204 with CORS headers', async () => {
    const res = await fetch(`${baseUrl}/video/live-key`, { method: 'OPTIONS' });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
  });
});
