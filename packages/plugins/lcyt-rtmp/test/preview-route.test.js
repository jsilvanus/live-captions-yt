import assert from 'assert';
import http from 'http';
import express from 'express';
import fetch from 'node-fetch';
import { createPreviewRouter } from '../src/routes/preview.js';

async function startApp(previewManager) {
  const app = express();
  app.use(createPreviewRouter(previewManager));
  return new Promise((resolve) => {
    const srv = app.listen(0, () => resolve({ app, srv }));
  });
}

function bufferToStream(buf) {
  const { Readable } = require('stream');
  return Readable.from(buf);
}

export async function testBufferResponse() {
  const previewManager = {
    async fetchThumbnail() {
      return { headers: { 'Content-Type': 'image/webp' }, body: Buffer.from('hello') };
    },
    async fetchWebRtcInfo() { return { ok: true }; }
  };
  const { srv } = await startApp(previewManager);
  const port = srv.address().port;
  const res = await fetch(`http://127.0.0.1:${port}/preview/key1/incoming`);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.headers.get('content-type'), 'image/webp');
  const b = await res.arrayBuffer();
  assert.ok(b.byteLength > 0);
  srv.close();
}

export async function testStreamResponse() {
  const previewManager = {
    async fetchThumbnail() {
      return { headers: { 'Content-Type': 'image/png' }, body: bufferToStream(Buffer.from('stream')) };
    },
    async fetchWebRtcInfo() { return { ok: true }; }
  };
  const { srv } = await startApp(previewManager);
  const port = srv.address().port;
  const res = await fetch(`http://127.0.0.1:${port}/preview/key2/incoming.jpg`);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.headers.get('content-type'), 'image/png');
  const b = await res.arrayBuffer();
  assert.ok(b.byteLength > 0);
  srv.close();
}

export async function testOptionsPreflight() {
  const previewManager = { async fetchThumbnail() { return null; }, async fetchWebRtcInfo() { return null; } };
  const { srv } = await startApp(previewManager);
  const port = srv.address().port;
  const res = await fetch(`http://127.0.0.1:${port}/preview/key3/incoming`, { method: 'OPTIONS' });
  assert.strictEqual(res.status, 204);
  srv.close();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    await testBufferResponse();
    await testStreamResponse();
    await testOptionsPreflight();
    console.log('ok');
  })().catch(err => { console.error(err); process.exit(1); });
}

