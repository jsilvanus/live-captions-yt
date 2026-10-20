/** /broadcasts lifecycle routes with a real lifecycle service and fake steps. */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import { initDb } from '../src/db.js';
import { createAuthMiddleware } from '../src/middleware/auth.js';
import { createBroadcastsRouter } from '../src/routes/broadcasts.js';
import { createBroadcastLifecycle } from '../src/broadcasts/lifecycle.js';

const SECRET = 'lifecycle-routes-secret';
const KEY = 'lc-route-key';
let server, baseUrl, db, token, synced = 0;

before(() => new Promise(async (resolve) => {
  db = await initDb(':memory:');
  await db.prepare("INSERT INTO api_keys (key, owner, active) VALUES (?, 'Owner', 1)").run(KEY);
  const lifecycle = createBroadcastLifecycle({
    db, steps: {}, deliverables: async () => ({ captions: true, video: false, audio: false }),
  });
  const app = express();
  app.use(express.json());
  app.use('/broadcasts', createBroadcastsRouter(createAuthMiddleware(SECRET), db, {
    lifecycle,
    captionSync: { syncNow: async () => { synced += 1; return { ok: true, offsetMs: 3 }; } },
  }));
  server = createServer(app);
  server.listen(0, () => { baseUrl = `http://localhost:${server.address().port}`; resolve(); });
  token = jwt.sign({ sessionId: 's', apiKey: KEY }, SECRET);
}));
after(() => new Promise((resolve) => { db.close(); server.close(resolve); }));
beforeEach(async () => { await db.prepare('DELETE FROM broadcasts WHERE api_key = ?').run(KEY); });

async function api(path, opts = {}) {
  const res = await fetch(`${baseUrl}/broadcasts${path}`, {
    method: opts.method || 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

describe('lifecycle routes', () => {
  it('stage -> go-live -> stop -> complete, with /current in between', async () => {
    const id = (await api('', { method: 'POST', body: { title: 'Mass' } })).body.broadcast.id;
    assert.equal((await api('/current')).body.broadcast, null);
    assert.equal((await api(`/${id}/stage`, { method: 'POST' })).body.broadcast.status, 'staging');
    assert.equal((await api('/current')).body.broadcast.id, id);
    assert.equal((await api(`/${id}/go-live`, { method: 'POST' })).body.broadcast.status, 'live');
    assert.equal((await api(`/${id}/stop`, { method: 'POST' })).body.broadcast.status, 'stopped');
    assert.equal((await api(`/${id}/complete`, { method: 'POST' })).body.broadcast.status, 'completed');
  });

  it('answers 409 with a code for a wrong-state action and returns pre-flight findings', async () => {
    const id = (await api('', { method: 'POST', body: { title: 'Mass' } })).body.broadcast.id;
    const bad = await api(`/${id}/go-live`, { method: 'POST' });
    assert.equal(bad.status, 409);
    const pf = await api(`/${id}/preflight`);
    assert.equal(pf.status, 200);
    assert.equal(pf.body.ok, true);
  });

  it('cancels and restores a cancelled broadcast through /restore', async () => {
    const id = (await api('', { method: 'POST', body: { title: 'Mass' } })).body.broadcast.id;
    assert.equal((await api(`/${id}/cancel`, { method: 'POST' })).body.broadcast.status, 'cancelled');
    assert.equal((await api(`/${id}/restore`, { method: 'POST' })).body.broadcast.status, 'draft');
  });

  it('POST /:id/sync runs the caption sync', async () => {
    const id = (await api('', { method: 'POST', body: { title: 'Mass' } })).body.broadcast.id;
    const r = await api(`/${id}/sync`, { method: 'POST' });
    assert.equal(r.status, 200);
    assert.equal(synced, 1);
    assert.equal((await api('/nope/sync', { method: 'POST' })).status, 404);
  });

  it('404s for an unknown broadcast', async () => {
    assert.equal((await api('/nope/stage', { method: 'POST' })).status, 404);
  });
});
