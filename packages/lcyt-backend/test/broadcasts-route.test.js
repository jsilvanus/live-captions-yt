/**
 * Tests for the /broadcasts router. In-memory SQLite + session JWT auth,
 * following the harness in stream.test.js.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import { initDb } from '../src/db.js';
import { createAuthMiddleware } from '../src/middleware/auth.js';
import { createBroadcastsRouter } from '../src/routes/broadcasts.js';

const JWT_SECRET = 'test-broadcasts-secret';
const KEY = 'bcast-route-key';

let server, baseUrl, db, token;

before(() => new Promise((resolve) => {
  db = initDb(':memory:');
  db.prepare("INSERT INTO api_keys (key, owner, active) VALUES (?, 'Owner', 1)").run(KEY);

  const auth = createAuthMiddleware(JWT_SECRET);
  const app = express();
  app.use(express.json());
  app.use('/broadcasts', createBroadcastsRouter(auth, db));

  server = createServer(app);
  server.listen(0, () => {
    baseUrl = `http://localhost:${server.address().port}`;
    resolve();
  });

  token = jwt.sign({ sessionId: 'sess-b-1', apiKey: KEY }, JWT_SECRET);
}));

after(() => new Promise((resolve) => {
  db.close();
  server.close(resolve);
}));

beforeEach(() => {
  db.prepare('DELETE FROM broadcasts WHERE api_key = ?').run(KEY);
});

async function api(path, opts = {}) {
  const res = await fetch(`${baseUrl}/broadcasts${path}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

describe('/broadcasts CRUD', () => {
  it('requires auth', async () => {
    const res = await fetch(`${baseUrl}/broadcasts`);
    assert.equal(res.status, 401);
  });

  it('creates, lists, gets, and updates', async () => {
    const created = await api('/', { method: 'POST', body: JSON.stringify({ title: 'Cast 1' }) });
    assert.equal(created.status, 201);
    const id = created.body.broadcast.id;

    const list = await api('/');
    assert.equal(list.status, 200);
    assert.equal(list.body.broadcasts.length, 1);

    const got = await api(`/${id}`);
    assert.equal(got.status, 200);
    assert.equal(got.body.broadcast.title, 'Cast 1');

    const upd = await api(`/${id}`, { method: 'PUT', body: JSON.stringify({ status: 'scheduled', scheduledStart: '2026-08-01T10:00:00' }) });
    assert.equal(upd.status, 200);
    assert.equal(upd.body.broadcast.status, 'scheduled');
  });

  it('404s for unknown id', async () => {
    const got = await api('/does-not-exist');
    assert.equal(got.status, 404);
  });
});

describe('/broadcasts delete = archive then cooling-off', () => {
  it('first DELETE archives (202), second is blocked (409)', async () => {
    const created = await api('/', { method: 'POST', body: JSON.stringify({ title: 'x' }) });
    const id = created.body.broadcast.id;

    const first = await api(`/${id}`, { method: 'DELETE' });
    assert.equal(first.status, 202);
    assert.equal(first.body.archived, true);

    const second = await api(`/${id}`, { method: 'DELETE' });
    assert.equal(second.status, 409);

    // restore brings it back
    const restored = await api(`/${id}/restore`, { method: 'POST' });
    assert.equal(restored.status, 200);
    assert.equal(restored.body.broadcast.status, 'draft');
  });
});

describe('/broadcasts assets + duplicate', () => {
  it('links an asset and duplicates without produced content', async () => {
    const created = await api('/', { method: 'POST', body: JSON.stringify({ title: 'Orig' }) });
    const id = created.body.broadcast.id;

    const link = await api(`/${id}/assets`, { method: 'POST', body: JSON.stringify({ assetType: 'graphic', assetRef: '7' }) });
    assert.equal(link.status, 201);

    const dup = await api(`/${id}/duplicate`, { method: 'POST', body: JSON.stringify({}) });
    assert.equal(dup.status, 201);
    assert.equal(dup.body.broadcast.title, 'Orig (copy)');
    assert.equal(dup.body.broadcast.assets.length, 1);
  });

  it('cross-project duplicate is 501 (not yet implemented)', async () => {
    const created = await api('/', { method: 'POST', body: JSON.stringify({ title: 'Orig' }) });
    const id = created.body.broadcast.id;
    const dup = await api(`/${id}/duplicate`, { method: 'POST', body: JSON.stringify({ targetApiKey: 'other-key' }) });
    assert.equal(dup.status, 501);
  });
});
