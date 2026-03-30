/**
 * Tests for the /preview router.
 *
 * PreviewManager is replaced with a lightweight mock that implements
 * fetchThumbnail() — the only method the route calls. The mock reads from
 * a temp directory so tests can control when a preview "exists".
 *
 * The route is mounted at the root (app.use(createPreviewRouter(mock))) because
 * the router registers paths as /preview/:key/incoming[.jpg] internally.
 */

import { describe, it, before, after } from 'node:test';
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
// Mock PreviewManager — implements fetchThumbnail() as required by the route
// ---------------------------------------------------------------------------

function makeMockPreviewManager(root) {
  return {
    async fetchThumbnail(key) {
      const p = join(root, key, 'incoming.jpg');
      try {
        fs.accessSync(p, fs.constants.R_OK);
        // coercePreviewResponse accepts a { headers, body } object where body
        // is a file path string — it opens a ReadStream internally.
        return { headers: { 'content-type': 'image/jpeg' }, body: p };
      } catch {
        return null;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Test server — router is mounted at root so its /preview/:key/… paths match
// ---------------------------------------------------------------------------

let server, baseUrl;

const mockPreview = makeMockPreviewManager(PREVIEW_ROOT);

before(() => new Promise((resolve) => {
  const app = express();
  // Route registers /preview/:key/incoming[.jpg] — mount at root, not /preview
  app.use(createPreviewRouter(mockPreview));
  server = createServer(app);
  server.listen(0, () => {
    baseUrl = `http://localhost:${server.address().port}`;
    resolve();
  });
}));

after(() => new Promise(r => server.close(r)));

// ---------------------------------------------------------------------------
// File not found
// ---------------------------------------------------------------------------

describe('GET /preview/:key/incoming.jpg — file missing', () => {
  it('returns 404 when preview file does not exist', async () => {
    const res = await fetch(`${baseUrl}/preview/nostream/incoming.jpg`);
    assert.equal(res.status, 404);
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

  it('sets Cache-Control with public max-age', async () => {
    const res = await fetch(`${baseUrl}/preview/${JPEG_KEY}/incoming.jpg`);
    const cc = res.headers.get('cache-control');
    assert.ok(cc?.includes('public'));
    assert.ok(cc?.includes('max-age='));
  });

  it('sets ETag header', async () => {
    const res = await fetch(`${baseUrl}/preview/${JPEG_KEY}/incoming.jpg`);
    assert.ok(res.headers.get('etag'), 'should include ETag header');
  });

  it('returns 304 when If-None-Match matches ETag', async () => {
    // Allow the rate-limit window (1 s, max 5 req) to reset before issuing more requests
    await new Promise(r => setTimeout(r, 1100));
    // First request to get the ETag
    const first = await fetch(`${baseUrl}/preview/${JPEG_KEY}/incoming.jpg`);
    const etag = first.headers.get('etag');
    assert.ok(etag, 'ETag must be present for conditional request test');

    // Second request with matching ETag
    const second = await fetch(`${baseUrl}/preview/${JPEG_KEY}/incoming.jpg`, {
      headers: { 'If-None-Match': etag },
    });
    assert.equal(second.status, 304);
  });

  it('returns 200 when If-None-Match does not match', async () => {
    const res = await fetch(`${baseUrl}/preview/${JPEG_KEY}/incoming.jpg`, {
      headers: { 'If-None-Match': '"stale-etag-value"' },
    });
    assert.equal(res.status, 200);
  });
});

// ---------------------------------------------------------------------------
// CORS preflight
// ---------------------------------------------------------------------------

describe('OPTIONS /preview/:key/incoming — CORS preflight', () => {
  it('returns 204 with CORS headers', async () => {
    const res = await fetch(`${baseUrl}/preview/${JPEG_KEY}/incoming`, { method: 'OPTIONS' });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
  });
});
