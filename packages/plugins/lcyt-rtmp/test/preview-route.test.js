import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import express from 'express';
import { createPreviewRouter } from '../src/routes/preview.js';

const servers = [];

async function startApp(previewManager) {
  const app = express();
  // Mount at /preview like lcyt-backend does — router paths are relative.
  app.use('/preview', createPreviewRouter(previewManager));
  return new Promise((resolve) => {
    const srv = app.listen(0, () => resolve(srv));
  });
}

after(() => Promise.all(servers.map(srv => new Promise(r => srv.close(r)))));

test('serves a buffer-bodied thumbnail response', async () => {
  const previewManager = {
    async fetchThumbnail() {
      return { headers: { 'Content-Type': 'image/webp' }, body: Buffer.from('hello') };
    },
    async fetchWebRtcInfo() { return { ok: true }; }
  };
  const srv = await startApp(previewManager);
  servers.push(srv);
  const res = await fetch(`http://127.0.0.1:${srv.address().port}/preview/key1/incoming`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/webp');
  const b = await res.arrayBuffer();
  assert.ok(b.byteLength > 0);
});

test('serves a stream-bodied thumbnail response', async () => {
  const previewManager = {
    async fetchThumbnail() {
      return { headers: { 'Content-Type': 'image/png' }, body: Readable.from(Buffer.from('stream')) };
    },
    async fetchWebRtcInfo() { return { ok: true }; }
  };
  const srv = await startApp(previewManager);
  servers.push(srv);
  const res = await fetch(`http://127.0.0.1:${srv.address().port}/preview/key2/incoming.jpg`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  const b = await res.arrayBuffer();
  assert.ok(b.byteLength > 0);
});

test('OPTIONS preflight returns 204 with CORS headers', async () => {
  const previewManager = { async fetchThumbnail() { return null; }, async fetchWebRtcInfo() { return null; } };
  const srv = await startApp(previewManager);
  servers.push(srv);
  const res = await fetch(`http://127.0.0.1:${srv.address().port}/preview/key3/incoming`, { method: 'OPTIONS' });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
});

test('GET /preview/:key/webrtc returns manager info as JSON', async () => {
  const previewManager = {
    async fetchThumbnail() { return null; },
    async fetchWebRtcInfo(key) { return { url: `http://mtx:8889/${key}`, active: false }; }
  };
  const srv = await startApp(previewManager);
  servers.push(srv);
  const res = await fetch(`http://127.0.0.1:${srv.address().port}/preview/key4/webrtc`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.url, 'http://mtx:8889/key4');
});

test('thumbnail 404s when manager returns null', async () => {
  const previewManager = { async fetchThumbnail() { return null; }, async fetchWebRtcInfo() { return null; } };
  const srv = await startApp(previewManager);
  servers.push(srv);
  const res = await fetch(`http://127.0.0.1:${srv.address().port}/preview/key5/incoming`);
  assert.equal(res.status, 404);
});
