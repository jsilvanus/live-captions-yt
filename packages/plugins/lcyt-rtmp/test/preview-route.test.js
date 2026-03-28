import test from 'node:test';
import assert from 'node:assert';
import express from 'express';
import http from 'http';
import { createPreviewRouter } from '../src/routes/preview.js';

function startApp(app) {
  return new Promise((resolve) => {
    const srv = http.createServer(app);
    srv.listen(0, () => {
      const addr = srv.address();
      resolve({ srv, url: `http://127.0.0.1:${addr.port}` });
    });
  });
}

test('preview route returns provider content-type (image/webp) for buffer response', async () => {
  const previewManager = {
    async fetchThumbnail(key) {
      const buf = Buffer.from([0x00,0x01,0x02]);
      return { headers: { 'content-type': 'image/webp', 'content-length': String(buf.length) }, body: buf };
    }
  };

  const app = express();
  app.use('/preview', createPreviewRouter(previewManager));

  const { srv, url } = await startApp(app);
  try {
    const res = await new Promise((resolve, reject) => {
      http.get(`${url}/preview/testkey/incoming`, (r) => resolve(r)).on('error', reject);
    });

    assert.strictEqual(res.headers['content-type'], 'image/webp');
    const chunks = [];
    for await (const chunk of res) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    assert.ok(body.length >= 1);
  } finally {
    srv.close();
  }
});
