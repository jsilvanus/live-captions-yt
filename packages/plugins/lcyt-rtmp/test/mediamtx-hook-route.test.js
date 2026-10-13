import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createMediaMtxHookRouter } from '../src/routes/mediamtx-hook.js';

async function withServer(settings, relayManager, fn) {
  const app = express();
  app.use('/internal/mediamtx', createMediaMtxHookRouter({ relayManager, settings }));
  const server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  try { await fn(`http://127.0.0.1:${server.address().port}/internal/mediamtx/path`); } finally { server.close(); }
}

test('hook route: closed without a secret, 401 on a wrong one, passes path and ready on a right one', async () => {
  const seen = [];
  const relayManager = { fanoutPathEvent: async (p, r) => { seen.push([p, r]); return true; } };
  const body = new URLSearchParams({ path: 'key1', ready: '1' });

  await withServer({ get: () => '' }, relayManager, async (url) => {
    const res = await fetch(url, { method: 'POST', body, headers: { 'x-lcyt-hook-secret': '' } });
    assert.equal(res.status, 401);
  });
  await withServer({ get: () => 'sekret' }, relayManager, async (url) => {
    assert.equal((await fetch(url, { method: 'POST', body, headers: { 'x-lcyt-hook-secret': 'nope' } })).status, 401);
    const ok = await fetch(url, { method: 'POST', body, headers: { 'x-lcyt-hook-secret': 'sekret' } });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { ok: true, handled: true });
    const off = await fetch(url, { method: 'POST', body: new URLSearchParams({ path: 'dsk/key1', ready: '0' }), headers: { 'x-lcyt-hook-secret': 'sekret' } });
    assert.equal(off.status, 200);
    const bad = await fetch(url, { method: 'POST', body: new URLSearchParams({ path: 'a b;rm', ready: '1' }), headers: { 'x-lcyt-hook-secret': 'sekret' } });
    assert.equal(bad.status, 400);
  });
  assert.deepEqual(seen, [['key1', true], ['dsk/key1', false]]);
});
