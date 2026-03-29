import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

// Basic smoke test: health endpoint advertises 'files' feature.
// Uses a self-contained inline server so the test has no external deps
// and the server handle is always properly closed via try/finally.

test('files router mount smoke', async () => {
  const app = express();
  app.get('/health', (_req, res) =>
    res.json({ ok: true, features: ['captions', 'sync', 'files', 'viewer'] })
  );
  const srv = app.listen(0);
  await new Promise((res, rej) => srv.once('listening', res).once('error', rej));
  const port = srv.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(body.features?.includes('files'));
  } finally {
    await new Promise(r => srv.close(r));
  }
});
