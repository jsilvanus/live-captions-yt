/**
 * Tests for the /preview router.
 *
 * PreviewManager is replaced with a lightweight mock object. The real
 * node:fs functions (existsSync, statSync, createReadStream) touch the
 * local filesystem, but the test JPEG is written to a temp dir so no
 * stubs are needed — the test sets up actual files.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import express from 'express';
import { createPreviewRouter } from 'lcyt-rtmp/src/routes/preview.js';

// ---------------------------------------------------------------------------
// Temp directory + mock JPEG
// ---------------------------------------------------------------------------

const PREVIEW_ROOT = join(tmpdir(), `lcyt-preview-test-${Date.now()}`);
const JPEG_KEY     = 'testkey123';
const JPEG_DIR     = join(PREVIEW_ROOT, JPEG_KEY);
const JPEG_FILE    = join(JPEG_DIR, 'incoming.jpg');

before(() => {
  fs.mkdirSync(JPEG_DIR, { recursive: true });
  // Minimal valid JPEG magic bytes + filler
  fs.writeFileSync(JPEG_FILE, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]));
});

after(() => {
  fs.rmSync(PREVIEW_ROOT, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Mock PreviewManager
// ---------------------------------------------------------------------------

function makeMockPreviewManager(root) {
  return {
    _root: root,
    previewPath: (key) => join(root, key, 'incoming.jpg'),
  };
}

// ---------------------------------------------------------------------------
// Test server
// ---------------------------------------------------------------------------

let server, baseUrl;

const mockPreview = makeMockPreviewManager(PREVIEW_ROOT);

before(() => new Promise((resolve) => {
  const app = express();
  app.use('/preview', createPreviewRouter(mockPreview));
  server = createServer(app);
  server.listen(0, () => {
    baseUrl = `http://localhost:${server.address().port}`;
    resolve();
  });
}));

after(() => new Promise(r => server.close(r)));

// ---------------------------------------------------------------------------
// Key validation
// ---------------------------------------------------------------------------

describe('GET /preview/:key/incoming.jpg — key validation', () => {
  it('returns 400 for a key that is too short', async () => {
    const res = await fetch(`${baseUrl}/preview/ab/incoming.jpg`);
    assert.equal(res.status, 400);
  });

  it('returns 400 for a key with invalid characters', async () => {
    const res = await fetch(`${baseUrl}/preview/bad%20key/incoming.jpg`);
    assert.equal(res.status, 400);
  });
});

// ---------------------------------------------------------------------------
// File not found
// ---------------------------------------------------------------------------

describe('GET /preview/:key/incoming.jpg — file missing', () => {
  it('returns 404 when preview file does not exist', async () => {
    const res = await fetch(`${baseUrl}/preview/nostream/incoming.jpg`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.ok(body.error);
  });
});

// ---------------------------------------------------------------------------
// File exists — normal response
// ---------------------------------------------------------------------------

describe('GET /preview/:key/incoming.jpg — file present', () => {
  it('returns 200 with image/jpeg content type', async () => {
    const res = await fetch(`${baseUrl}/preview/${JPEG_KEY}/incoming.jpg`);
    assert.equal(res.status, 200);
    assert.ok(res.headers.get('content-type')?.includes('image/jpeg'));
  });

  it('sets CORS header to *', async () => {
    const res = await fetch(`${baseUrl}/preview/${JPEG_KEY}/incoming.jpg`);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
  });

  it('sets Cache-Control with public max-age=5', async () => {
    const res = await fetch(`${baseUrl}/preview/${JPEG_KEY}/incoming.jpg`);
    const cc = res.headers.get('cache-control');
    assert.ok(cc?.includes('public'));
    assert.ok(cc?.includes('max-age=5'));
  });

  it('sets Last-Modified header', async () => {
    const res = await fetch(`${baseUrl}/preview/${JPEG_KEY}/incoming.jpg`);
    assert.ok(res.headers.get('last-modified'));
  });

  it('returns 304 when If-Modified-Since is in the future', async () => {
    const future = new Date(Date.now() + 60_000).toUTCString();
    const res = await fetch(`${baseUrl}/preview/${JPEG_KEY}/incoming.jpg`, {
      headers: { 'If-Modified-Since': future },
    });
    assert.equal(res.status, 304);
  });

  it('returns 200 when If-Modified-Since is in the past', async () => {
    const past = new Date(Date.now() - 60_000).toUTCString();
    const res = await fetch(`${baseUrl}/preview/${JPEG_KEY}/incoming.jpg`, {
      headers: { 'If-Modified-Since': past },
    });
    assert.equal(res.status, 200);
  });
});

// ---------------------------------------------------------------------------
// CORS preflight
// ---------------------------------------------------------------------------

describe('OPTIONS /preview/:key/* — CORS preflight', () => {
  it('returns 204 with CORS headers', async () => {
    const res = await fetch(`${baseUrl}/preview/${JPEG_KEY}/incoming.jpg`, { method: 'OPTIONS' });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
  });
});
