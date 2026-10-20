/** Broadcast outputs (plan_broadcast_lifecycle.md PR 5): links, selection, deliverables, relay filter, routes, steps. */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import { initDb } from '../src/db.js';
import { createAuthMiddleware } from '../src/middleware/auth.js';
import { createBroadcastsRouter } from '../src/routes/broadcasts.js';
import { createBroadcastLifecycle } from '../src/broadcasts/lifecycle.js';
import { createLifecycleSteps } from '../src/broadcasts/steps.js';
import { duplicateBroadcast } from '../src/db/broadcasts.js';
import {
  filterRelaysForOutputs, getOutputSelection, listBroadcastOutputs, selectionDeliverables, setBroadcastOutputs,
} from '../src/db/broadcast-outputs.js';
import { createOutput, deleteOutput, updateOutput } from 'lcyt-rtmp/src/db/outputs.js';

const SECRET = 'bo-secret';
const KEY = 'bo-key';
const OTHER = 'bo-other-key';
let db, server, baseUrl, token, relayCalls, feedAv, feedAudio;

before(() => new Promise(async (resolve) => {
  db = await initDb(':memory:');
  for (const k of [KEY, OTHER]) await db.prepare("INSERT INTO api_keys (key, owner, active) VALUES (?, 'Owner', 1)").run(k);
  await db.prod_feeds.create({ data: { id: 'f-av', owner_api_key: KEY, name: 'Main', feed_key: 'bo-main', media: 'av' } });
  await db.prod_feeds.create({ data: { id: 'f-audio', owner_api_key: KEY, name: 'Radio', feed_key: 'bo-radio', media: 'audio' } });
  feedAv = 'f-av'; feedAudio = 'f-audio';

  const steps = createLifecycleSteps({
    db,
    relay: { on: async (apiKey, opts) => { relayCalls.push(opts); return { note: 'fake' }; }, off: async () => {} },
  });
  const lifecycle = createBroadcastLifecycle({
    db, steps,
    deliverables: async (apiKey, broadcast) => {
      const sel = await getOutputSelection(db, broadcast.id);
      return { captions: false, video: false, audio: false, ...(sel.linked ? await selectionDeliverables(db, apiKey, sel.outputIds) : {}) };
    },
  });
  const app = express();
  app.use(express.json());
  app.use('/broadcasts', createBroadcastsRouter(createAuthMiddleware(SECRET), db, { lifecycle }));
  server = createServer(app);
  server.listen(0, () => { baseUrl = `http://localhost:${server.address().port}`; resolve(); });
  token = jwt.sign({ sessionId: 's', apiKey: KEY }, SECRET);
}));
after(() => new Promise((resolve) => { db.close(); server.close(resolve); }));
beforeEach(async () => {
  relayCalls = [];
  await db.broadcast_outputs.deleteMany({});
  await db.broadcasts.deleteMany({ where: { api_key: KEY } });
  await db.outputs.deleteMany({ where: { owner_api_key: { in: [KEY, OTHER] } } });
});

async function api(path, opts = {}) {
  const res = await fetch(`${baseUrl}/broadcasts${path}`, {
    method: opts.method || 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const newBroadcast = async () => (await api('', { method: 'POST', body: { title: 'Mass' } })).body.broadcast.id;
const mkOutput = async (name, sourceId = feedAv, extra = {}) =>
  (await createOutput(db, KEY, { name, sourceType: 'feed', sourceId, ...extra })).output.id;

describe('broadcast_outputs links', () => {
  it('replaces the list, keeps order, reports what the output table says now', async () => {
    const id = await newBroadcast();
    const a = await mkOutput('A');
    const b = await mkOutput('B');
    const put = await api(`/${id}/outputs`, { method: 'PUT', body: { outputs: [{ outputId: b }, { outputId: a, enabled: false }] } });
    assert.equal(put.status, 200);
    assert.deepEqual(put.body.outputs.map((o) => [o.outputId, o.enabled, o.name]), [[b, true, 'B'], [a, false, 'A']]);
    assert.deepEqual((await api(`/${id}/outputs`)).body.outputs.map((o) => o.outputId), [b, a]);
    await api(`/${id}/outputs`, { method: 'PUT', body: { outputIds: [a] } });
    assert.deepEqual((await listBroadcastOutputs(db, id)).map((o) => o.outputId), [a]);
  });

  it('refuses another project\'s output, duplicates and a finished broadcast', async () => {
    const id = await newBroadcast();
    const foreign = (await createOutput(db, OTHER, { name: 'X', sourceType: 'feed', sourceId: feedAv })).output;
    // the feed belongs to KEY, so make a feed of OTHER for a valid foreign output
    await db.prod_feeds.create({ data: { id: 'f-other', owner_api_key: OTHER, name: 'O', feed_key: 'bo-other-feed' } });
    const o2 = (await createOutput(db, OTHER, { name: 'Y', sourceType: 'feed', sourceId: 'f-other' })).output;
    assert.equal((await api(`/${id}/outputs`, { method: 'PUT', body: { outputs: [{ outputId: o2.id }] } })).status, 400);
    assert.equal((await api(`/${id}/outputs`, { method: 'PUT', body: { outputs: [{ outputId: 'out-nope' }] } })).status, 400);
    const a = await mkOutput('A');
    assert.equal((await api(`/${id}/outputs`, { method: 'PUT', body: { outputs: [a, a] } })).status, 400);
    await api(`/${id}/cancel`, { method: 'POST' });
    assert.equal((await api(`/${id}/outputs`, { method: 'PUT', body: { outputs: [a] } })).status, 409);
    assert.equal((await api('/nope/outputs')).status, 404);
    void foreign;
  });

  it('is copied by duplicate and dropped when the output is deleted', async () => {
    const id = await newBroadcast();
    const a = await mkOutput('A');
    await setBroadcastOutputs(db, KEY, id, [a]);
    const copy = await duplicateBroadcast(db, KEY, id);
    assert.deepEqual((await listBroadcastOutputs(db, copy.broadcast.id)).map((o) => o.outputId), [a]);
    assert.equal((await deleteOutput(db, KEY, a)).ok, true);
    assert.deepEqual(await listBroadcastOutputs(db, id), []);
  });
});

describe('selection, deliverables and relay filter', () => {
  it('no links = project as configured; disabled outputs fall out of the selection', async () => {
    const id = await newBroadcast();
    assert.deepEqual(await getOutputSelection(db, id), { linked: false, outputIds: [] });
    const a = await mkOutput('A');
    const b = await mkOutput('B');
    await setBroadcastOutputs(db, KEY, id, [a, { outputId: b, enabled: false }]);
    await updateOutput(db, KEY, a, { enabled: false });
    assert.deepEqual(await getOutputSelection(db, id), { linked: true, outputIds: [] });
  });

  it('a picture output is video (DSK alone counts), an audio-feed output is audio, one through another output follows the chain', async () => {
    const dsk = await mkOutput('Dsk');
    const radio = await mkOutput('Radio', feedAudio);
    const chained = (await createOutput(db, KEY, { name: 'Chained', sourceType: 'output', sourceId: radio })).output.id;
    assert.deepEqual(await selectionDeliverables(db, KEY, [dsk]), { video: true, audio: false });
    assert.deepEqual(await selectionDeliverables(db, KEY, [radio]), { video: false, audio: true });
    assert.deepEqual(await selectionDeliverables(db, KEY, [chained]), { video: false, audio: true });
    assert.deepEqual(await selectionDeliverables(db, KEY, []), { video: false, audio: false });
  });

  it('filterRelaysForOutputs leaves out slots that send an unselected output', () => {
    const relays = [{ slot: 1, sourceOutputId: 'o1' }, { slot: 2, sourceOutputId: 'o2' }, { slot: 3, sourceOutputId: null }];
    assert.equal(filterRelaysForOutputs(relays, null), relays);
    assert.deepEqual(filterRelaysForOutputs(relays, ['o2']).map((r) => r.slot), [2, 3]);
    assert.deepEqual(filterRelaysForOutputs(relays, []).map((r) => r.slot), [3]);
  });
});

describe('lifecycle with chosen outputs', () => {
  it('staging needs a deliverable; an audio output is enough and reaches the outputs step', async () => {
    const id = await newBroadcast();
    assert.equal((await api(`/${id}/stage`, { method: 'POST' })).status, 409);
    const radio = await mkOutput('Radio', feedAudio);
    await api(`/${id}/outputs`, { method: 'PUT', body: { outputs: [radio] } });
    const r = await api(`/${id}/stage`, { method: 'POST' });
    assert.equal(r.status, 200);
    assert.deepEqual(relayCalls, [{ outputIds: [radio] }]);
  });

  it('pre-flight warns about a disabled chosen output; force stages anyway', async () => {
    const id = await newBroadcast();
    const a = await mkOutput('A');
    const b = await mkOutput('B');
    await api(`/${id}/outputs`, { method: 'PUT', body: { outputs: [a, b] } });
    await updateOutput(db, KEY, b, { enabled: false });
    const pf = await api(`/${id}/preflight`);
    assert.deepEqual(pf.body.findings.filter((f) => f.code === 'output_disabled').map((f) => f.outputId), [b]);
    assert.equal(pf.body.ok, false);
    assert.equal((await api(`/${id}/preflight?force=1`)).body.ok, true);
  });

  it('no outputs chosen passes null so the relay keeps today\'s behaviour', async () => {
    const id = await newBroadcast();
    // deliverables fake returns nothing without a selection, so skip it by staging through the lifecycle options is not
    // possible here; check the step directly
    const steps = createLifecycleSteps({ db, relay: { on: async (k, o) => { relayCalls.push(o); }, off: async () => {} } });
    await steps.outputsOn({ apiKey: KEY, broadcast: { id } });
    assert.deepEqual(relayCalls, [{ outputIds: null }]);
  });
});
