import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestServer } from './test-server.js';

// Basic smoke test for the files router integration (local adapter).
// This uses the lightweight test server helper and ensures the files router is mountable.

test('files router mount smoke', async () => {
  const { app } = createTestServer();
  const srv = app.listen(0);
  await new Promise((res, rej) => srv.once('listening', res).once('error', rej));
  const port = srv.address().port;
  const baseUrl = 'http://127.0.0.1:' + port;

  const res = await fetch(baseUrl + '/health');
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.ok(body.features?.includes('files'));

  srv.close();
});
