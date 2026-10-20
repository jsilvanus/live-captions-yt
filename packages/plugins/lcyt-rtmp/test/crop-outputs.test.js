/**
 * Crop per output (plan_egress_outputs.md PR 2): scopes, session keys and paths, starting crops per feed,
 * the output-scoped /crop routes and the /outputs CRUD routes.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import { initDb } from 'lcyt-backend/db';
import { createCropRouter } from '../src/routes/crop.js';
import { createOutputsRouter } from '../src/routes/outputs.js';
import { createOutput } from '../src/db/outputs.js';
import { resolveCropScope, listCropScopes, getCropConfig, setCropConfig } from '../src/db/crop.js';
import { cropSpec, startCropsForFeed, stopCropsForFeed, outputCropPath } from '../src/crop-outputs.js';
import { ensureProjectOutputs, repairCropOutputLinks } from '../src/db/outputs.js';
import { readThrough } from '../src/ownership.js';

const KEY = 'cropoutkey';
let db, server, baseUrl, mock, program, vertical, wide, feedA, feedB;

function makeMock() {
  return {
    running: new Set(), started: [], stopped: [],
    isRunning(k) { return this.running.has(k); },
    getStatus(k) { return { running: this.running.has(k), repositionMode: 'live' }; },
    async start(k, config, opts) { this.running.add(k); this.started.push({ k, opts }); },
    async stop(k) { this.running.delete(k); this.stopped.push(k); },
    async applyPosition() { return { ok: true }; },
  };
}

before(async () => {
  db = await initDb(':memory:');
  await db.prepare("INSERT INTO api_keys (key, owner) VALUES (?, 'owner')").run(KEY);
  for (const [id, key] of [['feed-a', 'cam-a'], ['feed-b', 'cam-b']]) {
    await db.prepare("INSERT INTO prod_feeds (id, owner_api_key, name, feed_key, transport, kind) VALUES (?, ?, ?, ?, 'rtmp', 'generic')").run(id, KEY, id, key);
  }
  feedA = 'feed-a'; feedB = 'feed-b';
  await db.prepare('UPDATE api_keys SET primary_feed_id = ? WHERE key = ?').run(feedA, KEY);
  await db.prepare("INSERT INTO crop_config (api_key, enabled, aspect_w, aspect_h) VALUES (?, 1, 9, 16)").run(KEY);
  const r = await ensureProjectOutputs(db, KEY);
  program = r.program; vertical = r.vertical;
  wide = (await createOutput(db, KEY, { name: 'Wide', sourceType: 'feed', sourceId: feedB })).output.id;

  mock = makeMock();
  const auth = (req, res, next) => { req.session = { apiKey: KEY }; next(); };
  const app = express();
  app.use(express.json());
  app.use('/crop', createCropRouter(db, auth, mock, { isPublishing: () => true, isFeedPublishing: () => true }));
  app.use('/outputs', createOutputsRouter(db, auth));
  await new Promise(res => { server = createServer(app).listen(0, '127.0.0.1', () => { baseUrl = `http://127.0.0.1:${server.address().port}`; res(); }); });
});

after(() => new Promise(r => server.close(async () => { await db.close(); r(); })));

const j = (method, path, body) => fetch(`${baseUrl}${path}`, {
  method, headers: { 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
});

describe('crop scopes', () => {
  test('the legacy crop is the default scope of Vertical and keeps the api key session', async () => {
    const scope = await resolveCropScope(db, KEY, vertical);
    assert.equal(scope.isDefault, true);
    const spec = await cropSpec(db, scope);
    assert.equal(spec.sessionKey, KEY);
    assert.equal(spec.outputPath, `${KEY}-crop`);
    assert.equal(spec.rootFeedId, feedA);
  });

  test('another output has its own config, session key and path', async () => {
    await setCropConfig(db, await resolveCropScope(db, KEY, wide), { enabled: true, aspectW: 1, aspectH: 1 });
    const scope = await resolveCropScope(db, KEY, wide);
    assert.equal(scope.isDefault, false);
    assert.equal((await getCropConfig(db, scope)).aspectW, 1);
    assert.equal((await getCropConfig(db, await resolveCropScope(db, KEY, vertical))).aspectW, 9);
    const spec = await cropSpec(db, scope);
    assert.equal(spec.sessionKey, wide);
    assert.equal(spec.outputPath, outputCropPath(KEY, wide, false));
    assert.equal(spec.sourcePath, 'cam-b');
    assert.equal(spec.rootFeedId, feedB);
    assert.equal((await listCropScopes(db, KEY)).length, 2);
  });

  test('an unknown output has no scope', async () => {
    assert.equal(await resolveCropScope(db, KEY, 'out-nope'), null);
  });
});

describe('starting crops per feed', () => {
  test('a feed starts only the crops hanging on it, and stops them again', async () => {
    mock.started.length = 0; mock.running.clear();
    await startCropsForFeed(db, mock, readThrough, KEY, feedB);
    assert.deepEqual(mock.started.map(s => s.k), [wide]);
    assert.equal(mock.started[0].opts.sourcePath, 'cam-b');
    await stopCropsForFeed(db, mock, readThrough, KEY, feedB);
    assert.deepEqual(mock.stopped.slice(-1), [wide]);
    await startCropsForFeed(db, mock, readThrough, KEY); // main stream
    assert.equal(mock.started.at(-1).k, KEY);
    mock.running.clear();
  });
});

describe('/crop with outputId', () => {
  test('config reads and writes the output scope', async () => {
    const put = await j('PUT', `/crop/config?outputId=${wide}`, { enabled: true, aspectW: 4, aspectH: 5 });
    assert.equal(put.status, 200);
    const got = await (await j('GET', `/crop/config?outputId=${wide}`)).json();
    assert.equal(got.aspectW, 4);
    const legacy = await (await j('GET', '/crop/config')).json();
    assert.equal(legacy.aspectW, 9);
    assert.ok(mock.running.has(wide));
  });
  test('unknown output is 404', async () => {
    assert.equal((await j('GET', '/crop/config?outputId=out-none')).status, 404);
  });
  test('a crop of a cropped output is refused', async () => {
    const chained = (await createOutput(db, KEY, { name: 'Chained', sourceType: 'output', sourceId: wide })).output.id;
    const res = await j('PUT', `/crop/config?outputId=${chained}`, { enabled: true, aspectW: 9, aspectH: 16 });
    assert.equal(res.status, 400);
  });
  test('presets are scoped to the output', async () => {
    const made = await j('POST', `/crop/presets?outputId=${wide}`, { name: 'Left', xNorm: 0 });
    assert.ok(made.status < 300, `status ${made.status}`);
    const mine = await (await j('GET', `/crop/presets?outputId=${wide}`)).json();
    const legacy = await (await j('GET', '/crop/presets')).json();
    assert.equal((mine.presets ?? mine).length, 1);
    assert.equal((legacy.presets ?? legacy).length, 0);
  });
});

describe('/outputs', () => {
  test('list, create, patch, delete', async () => {
    const list = await (await j('GET', '/outputs')).json();
    assert.ok(list.outputs.length >= 3);
    const created = await j('POST', '/outputs', { name: 'Extra', sourceType: 'output', sourceId: program });
    assert.equal(created.status, 201);
    const { id } = await created.json();
    assert.equal((await j('PATCH', `/outputs/${id}`, { name: 'Extra2' })).status, 200);
    assert.equal((await j('POST', '/outputs', { name: 'Extra2', sourceType: 'feed', sourceId: feedA })).status, 409);
    assert.equal((await j('DELETE', `/outputs/${id}`)).status, 200);
    assert.equal((await j('DELETE', `/outputs/${id}`)).status, 404);
  });
});

describe('repairCropOutputLinks', () => {
  test('links a PR 1 style project (copy in output_crop_config) back to crop_config', async () => {
    const K2 = 'oldkey';
    await db.prepare("INSERT INTO api_keys (key, owner) VALUES (?, 'owner')").run(K2);
    await db.prepare("INSERT INTO prod_feeds (id, owner_api_key, name, feed_key) VALUES ('f2', ?, 'm', 'm-key')").run(K2);
    await db.prepare('UPDATE api_keys SET primary_feed_id = ? WHERE key = ?').run('f2', K2);
    await db.prepare("INSERT INTO crop_config (api_key, enabled) VALUES (?, 1)").run(K2);
    const r = await ensureProjectOutputs(db, K2);
    await db.prepare('UPDATE crop_config SET output_id = NULL WHERE api_key = ?').run(K2);
    await db.prepare('INSERT INTO output_crop_config (output_id, enabled) VALUES (?, 1)').run(r.vertical);
    await repairCropOutputLinks(db);
    assert.equal((await db.prepare('SELECT output_id FROM crop_config WHERE api_key = ?').get(K2)).output_id, r.vertical);
    assert.equal(await db.prepare('SELECT 1 AS x FROM output_crop_config WHERE output_id = ?').get(r.vertical), undefined);
  });
});
