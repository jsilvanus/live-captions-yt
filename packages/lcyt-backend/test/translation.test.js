/**
 * Tests for the /translation/config router (server-persisted translation
 * vendor + language config, plan/selfservice_config_backend §1).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import { initDb, createKey } from '../src/db.js';
import { createAuthMiddleware } from '../src/middleware/auth.js';
import { createTranslationRouter } from '../src/routes/translation.js';

const JWT_SECRET = 'test-translation-secret';

let server, baseUrl, db, apiKey, token;

before(() => new Promise((resolve) => {
  db = initDb(':memory:');
  const auth = createAuthMiddleware(JWT_SECRET);
  const app = express();
  app.use(express.json());
  app.use('/translation', createTranslationRouter(auth, db));

  const k = createKey(db, { owner: 'TranslationUser' });
  apiKey = k.key;
  token = jwt.sign({ sessionId: 'translation-session', apiKey }, JWT_SECRET, { expiresIn: '1h' });

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
async function get(path) {
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

describe('GET /translation/config', () => {
  it('rejects missing auth', async () => {
    const res = await fetch(`${baseUrl}/translation/config`);
    assert.equal(res.status, 401);
  });

  it('returns default vendor config and empty targets', async () => {
    const res = await get('/translation/config');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.vendor.vendor, 'mymemory');
    assert.equal(body.vendor.showOriginal, false);
    assert.deepEqual(body.targets, []);
  });
});

describe('PUT /translation/config/vendor', () => {
  it('updates the vendor row', async () => {
    const res = await put('/translation/config/vendor', { vendor: 'deepl', vendorApiKey: 'secret-key', showOriginal: true });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.vendor.vendor, 'deepl');
    assert.equal(body.vendor.vendorApiKey, 'secret-key');
    assert.equal(body.vendor.showOriginal, true);
  });

  it('partial update preserves unspecified fields', async () => {
    const res = await put('/translation/config/vendor', { showOriginal: false });
    const body = await res.json();
    assert.equal(body.vendor.vendor, 'deepl');
    assert.equal(body.vendor.vendorApiKey, 'secret-key');
    assert.equal(body.vendor.showOriginal, false);
  });

  it('rejects an invalid vendor', async () => {
    const res = await put('/translation/config/vendor', { vendor: 'bogus-vendor' });
    assert.equal(res.status, 400);
  });

  it('GET /translation/config reflects the updated vendor', async () => {
    const res = await get('/translation/config');
    const body = await res.json();
    assert.equal(body.vendor.vendor, 'deepl');
  });
});

describe('/translation/config/targets', () => {
  it('POST creates a translation target', async () => {
    const res = await post('/translation/config/targets', { lang: 'fi', target: 'captions' });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.target.lang, 'fi');
    assert.equal(body.target.target, 'captions');
    assert.equal(body.target.enabled, true);
    assert.ok(body.target.id);
  });

  it('POST creates a file target with a format', async () => {
    const res = await post('/translation/config/targets', { lang: 'sv', target: 'file', format: 'vtt' });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.target.format, 'vtt');
  });

  it('POST rejects missing lang', async () => {
    const res = await post('/translation/config/targets', { target: 'captions' });
    assert.equal(res.status, 400);
  });

  it('POST rejects an invalid target destination', async () => {
    const res = await post('/translation/config/targets', { lang: 'de', target: 'bogus' });
    assert.equal(res.status, 400);
  });

  it('POST rejects an invalid format', async () => {
    const res = await post('/translation/config/targets', { lang: 'de', target: 'file', format: 'bogus' });
    assert.equal(res.status, 400);
  });

  it('GET /translation/config lists all created targets', async () => {
    const res = await get('/translation/config');
    const body = await res.json();
    assert.equal(body.targets.length, 2);
  });

  it('PUT /translation/config/targets/:id updates a target', async () => {
    const list = await (await get('/translation/config')).json();
    const t = list.targets.find(x => x.lang === 'fi');
    const res = await put(`/translation/config/targets/${t.id}`, { enabled: false });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.target.enabled, false);
  });

  it('PUT /translation/config/targets/:id returns 404 for an unknown id', async () => {
    const res = await put('/translation/config/targets/nope', { enabled: true });
    assert.equal(res.status, 404);
  });

  it('DELETE /translation/config/targets/:id removes a target', async () => {
    const list = await (await get('/translation/config')).json();
    const victim = list.targets[0];
    const res = await del(`/translation/config/targets/${victim.id}`);
    assert.equal(res.status, 200);
    const after = await (await get('/translation/config')).json();
    assert.equal(after.targets.length, 1);
  });

  it('DELETE /translation/config/targets/:id returns 404 for an unknown id', async () => {
    const res = await del('/translation/config/targets/nope');
    assert.equal(res.status, 404);
  });

  it('targets are scoped per api_key', async () => {
    const otherKey = createKey(db, { owner: 'OtherTranslationProject' });
    const otherToken = jwt.sign({ sessionId: 'other-session', apiKey: otherKey.key }, JWT_SECRET, { expiresIn: '1h' });
    const res = await fetch(`${baseUrl}/translation/config`, { headers: bearer(otherToken) });
    const body = await res.json();
    assert.deepEqual(body.targets, []);
    assert.equal(body.vendor.vendor, 'mymemory');
  });
});
