/**
 * Tests for the /targets router (server-persisted caption delivery targets,
 * plan/selfservice_config_backend §1).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import { initDb, createKey } from '../src/db.js';
import { createAuthMiddleware } from '../src/middleware/auth.js';
import { createTargetsRouter } from '../src/routes/targets.js';

const JWT_SECRET = 'test-targets-secret';

let server, baseUrl, db, apiKey, token;

before(() => new Promise((resolve) => {
  db = initDb(':memory:');
  const auth = createAuthMiddleware(JWT_SECRET);
  const app = express();
  app.use(express.json());
  app.use('/targets', createTargetsRouter(auth, db));

  const k = createKey(db, { owner: 'TargetsUser' });
  apiKey = k.key;
  token = jwt.sign({ sessionId: 'targets-session', apiKey }, JWT_SECRET, { expiresIn: '1h' });

  server = createServer(app);
  server.listen(0, () => {
    baseUrl = `http://localhost:${server.address().port}`;
    resolve();
  });
}));

after(() => new Promise((resolve) => {
  db.close();
  server.close(resolve);
}));

function bearer(tok = token) {
  return { Authorization: `Bearer ${tok}` };
}

async function get(path = '/targets') {
  return fetch(`${baseUrl}${path}`, { headers: bearer() });
}
async function post(path, body) {
  return fetch(`${baseUrl}${path}`, { method: 'POST', headers: { ...bearer(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
async function put(path, body) {
  return fetch(`${baseUrl}${path}`, { method: 'PUT', headers: { ...bearer(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
async function del(path) {
  return fetch(`${baseUrl}${path}`, { method: 'DELETE', headers: bearer() });
}

describe('/targets', () => {
  it('rejects missing auth', async () => {
    const res = await fetch(`${baseUrl}/targets`);
    assert.equal(res.status, 401);
  });

  it('GET /targets returns an empty list initially', async () => {
    const res = await get();
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.targets, []);
  });

  it('POST /targets creates a youtube target', async () => {
    const res = await post('/targets', { type: 'youtube', streamKey: 'abcd-1234' });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.target.type, 'youtube');
    assert.equal(body.target.streamKey, 'abcd-1234');
    assert.equal(body.target.enabled, true);
    assert.ok(body.target.id);
  });

  it('POST /targets creates a generic target with headers', async () => {
    const res = await post('/targets', { type: 'generic', url: 'https://example.com/hook', headers: { 'X-Test': '1' } });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.target.url, 'https://example.com/hook');
    assert.deepEqual(body.target.headers, { 'X-Test': '1' });
  });

  it('POST /targets creates a viewer target', async () => {
    const res = await post('/targets', { type: 'viewer', viewerKey: 'my-viewer-key' });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.target.viewerKey, 'my-viewer-key');
  });

  it('POST /targets rejects an invalid type', async () => {
    const res = await post('/targets', { type: 'bogus' });
    assert.equal(res.status, 400);
  });

  it('POST /targets rejects a generic target with a bad URL', async () => {
    const res = await post('/targets', { type: 'generic', url: 'not-a-url' });
    assert.equal(res.status, 400);
  });

  it('POST /targets rejects a viewer target with a too-short viewerKey', async () => {
    const res = await post('/targets', { type: 'viewer', viewerKey: 'ab' });
    assert.equal(res.status, 400);
  });

  it('GET /targets lists all created targets ordered by sort_order', async () => {
    const res = await get();
    const body = await res.json();
    assert.equal(body.targets.length, 3);
    assert.equal(body.targets[0].type, 'youtube');
    assert.equal(body.targets[1].type, 'generic');
    assert.equal(body.targets[2].type, 'viewer');
  });

  it('PUT /targets/:id updates enabled and streamKey', async () => {
    const list = await (await get()).json();
    const yt = list.targets.find(t => t.type === 'youtube');
    const res = await put(`/targets/${yt.id}`, { enabled: false, streamKey: 'new-key' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.target.enabled, false);
    assert.equal(body.target.streamKey, 'new-key');
  });

  it('PUT /targets/:id returns 404 for an unknown id', async () => {
    const res = await put('/targets/does-not-exist', { enabled: true });
    assert.equal(res.status, 404);
  });

  it('PUT /targets/reorder persists a new sort order', async () => {
    const list = await (await get()).json();
    const ids = list.targets.map(t => t.id);
    const reversed = [...ids].reverse();
    const res = await put('/targets/reorder', { order: reversed });
    assert.equal(res.status, 200);

    const after = await (await get()).json();
    assert.deepEqual(after.targets.map(t => t.id), reversed);
  });

  it('PUT /targets/reorder rejects an unknown id', async () => {
    const res = await put('/targets/reorder', { order: ['nope'] });
    assert.equal(res.status, 400);
  });

  it('DELETE /targets/:id removes a target', async () => {
    const list = await (await get()).json();
    const victim = list.targets[0];
    const res = await del(`/targets/${victim.id}`);
    assert.equal(res.status, 200);

    const after = await (await get()).json();
    assert.equal(after.targets.length, 2);
    assert.ok(!after.targets.find(t => t.id === victim.id));
  });

  it('DELETE /targets/:id returns 404 for an unknown id', async () => {
    const res = await del('/targets/does-not-exist');
    assert.equal(res.status, 404);
  });

  it('targets are scoped per api_key', async () => {
    const otherKey = createKey(db, { owner: 'OtherProject' });
    const otherToken = jwt.sign({ sessionId: 'other-session', apiKey: otherKey.key }, JWT_SECRET, { expiresIn: '1h' });
    const res = await fetch(`${baseUrl}/targets`, { headers: bearer(otherToken) });
    const body = await res.json();
    assert.deepEqual(body.targets, []);
  });
});
