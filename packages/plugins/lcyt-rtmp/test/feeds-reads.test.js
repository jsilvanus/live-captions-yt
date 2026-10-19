/**
 * Feeds PR 2 (and PR 7, camera keys gone): the readers of prod_feeds — the nginx-rtmp publish gate, the relay's
 * sourceFeedId, and the ingestion stream lists (Discover included).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import { initDb } from 'lcyt-backend/db';
import { createFeedRtmpRouter } from '../src/routes/feed-rtmp.js';
import { createStreamRouter } from '../src/routes/stream.js';
import { createIngestionRouter } from '../src/routes/ingestion.js';
import { listUnclaimedStreams } from '../src/ingest-streams.js';
import { RtmpRelayManager } from '../src/rtmp-manager.js';
import { getRelays, getApiKeysReferencingFeed } from '../src/db/relay.js';

const KEY = 'readsproj';
const OTHER = 'otherproj';
let db, server, baseUrl, relayManager, mediamtx, started;

const ready = (name) => ({ name, ready: true, readyTime: '2026-10-19T05:00:00Z', tracks: ['H264'], readers: [], bytesReceived: 1 });

before(async () => {
  db = await initDb(':memory:');
  await db.prepare("INSERT INTO api_keys (key, owner, relay_allowed, relay_active) VALUES (?, 'o', 1, 1)").run(KEY);
  await db.prepare("INSERT INTO api_keys (key, owner, relay_allowed) VALUES (?, 'o2', 1)").run(OTHER);
  await db.prepare("INSERT INTO prod_feeds (id, owner_api_key, name, feed_key, transport) VALUES ('f-rtmp', ?, 'Guest', 'guest-feed', 'rtmp')").run(KEY);
  await db.prepare("INSERT INTO prod_feeds (id, owner_api_key, name, feed_key, transport) VALUES ('f-whip', ?, 'Laptop', 'laptop-feed', 'whip')").run(KEY);
  await db.prepare("INSERT INTO prod_feeds (id, owner_api_key, name, feed_key, transport) VALUES ('f-theirs', ?, 'Theirs', 'theirs-feed', 'rtmp')").run(OTHER);

  mediamtx = { items: [], async listPaths() { return { pageCount: 1, items: this.items }; } };
  relayManager = new RtmpRelayManager();
  Object.defineProperty(relayManager, 'mediamtx', { get: () => mediamtx });
  started = [];
  relayManager.startAll = async (apiKey) => { started.push(apiKey); };
  relayManager.stop = async () => {};
  relayManager.restart = async () => {};

  const app = express();
  app.use(express.json());
  app.use('/feed-rtmp', createFeedRtmpRouter(db, relayManager));
  const auth = (req, res, next) => { req.session = { apiKey: KEY }; next(); };
  app.use('/stream', createStreamRouter(db, auth, relayManager, '*'));
  app.use('/ingestion', createIngestionRouter(db, auth, relayManager));
  server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => { baseUrl = `http://127.0.0.1:${server.address().port}`; resolve(); }));
});

after(() => new Promise((r) => server.close(async () => { await db.close(); r(); })));

const publish = (name, path = '/feed-rtmp/on_publish') => fetch(`${baseUrl}${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ name }).toString(),
});
const stream = (method, body) => fetch(`${baseUrl}/stream`, {
  method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

describe('publish gate', () => {
  it('accepts an rtmp prod_feeds key and marks it publishing', async () => {
    assert.equal((await publish('guest-feed')).status, 200);
    assert.ok(relayManager.isFeedPublishing('guest-feed'));
    assert.equal((await publish('guest-feed', '/feed-rtmp/on_publish_done')).status, 200);
    assert.ok(!relayManager.isFeedPublishing('guest-feed'));
  });

  it('refuses a whip feed on the rtmp gate and an unknown key', async () => {
    assert.equal((await publish('laptop-feed')).status, 403);
    assert.equal((await publish('nobody')).status, 403);
  });

  it('starts the relay of a project whose slot is sourced from the published feed', async () => {
    const res = await stream('POST', { slot: 1, targetUrl: 'rtmp://example.com/live/x', sourceFeedId: 'f-rtmp' });
    assert.equal(res.status, 201);
    started.length = 0;
    await publish('guest-feed');
    assert.deepEqual(started, [KEY]);
    assert.deepEqual(await getApiKeysReferencingFeed(db, 'f-rtmp'), [KEY]);
  });
});

describe('relay sourceFeedId', () => {
  it('joins the feed key into the slot like a camera source', async () => {
    const [relay] = await getRelays(db, KEY);
    assert.equal(relay.sourceFeedId, 'f-rtmp');
    assert.equal(relay.sourceFeedKey, 'guest-feed');
  });

  it('refuses another project\'s feed, an unknown feed and the removed sourceCameraId field', async () => {
    const base = { targetUrl: 'rtmp://example.com/live/y' };
    assert.equal((await stream('POST', { ...base, sourceFeedId: 'f-theirs' })).status, 400);
    assert.equal((await stream('POST', { ...base, sourceFeedId: 'nope' })).status, 400);
    const removed = await stream('POST', { ...base, sourceCameraId: 'cam-old' });
    assert.equal(removed.status, 400);
    assert.match((await removed.json()).error, /sourceCameraId is no longer accepted/);
  });

  it('a deleted feed leaves the slot without a key, like a deleted camera', async () => {
    await db.prepare("INSERT INTO prod_feeds (id, owner_api_key, name, feed_key) VALUES ('f-tmp', ?, 'Tmp', 'tmp-feed')").run(KEY);
    await stream('POST', { slot: 2, targetUrl: 'rtmp://example.com/live/z', sourceFeedId: 'f-tmp' });
    await db.prepare("DELETE FROM prod_feeds WHERE id = 'f-tmp'").run();
    const relay = (await getRelays(db, KEY)).find((r) => r.slot === 2);
    assert.equal(relay.sourceFeedKey, null);
  });
});

describe('ingestion stream lists', () => {
  it('GET /ingestion/streams lists the project\'s rtmp feeds once, with their label', async () => {
    mediamtx.items = [ready('guest-feed'), ready('laptop-feed'), ready('theirs-feed')];
    const body = await (await fetch(`${baseUrl}/ingestion/streams`)).json();
    assert.deepEqual(body.streams.map((s) => [s.path, s.kind]).sort(), [['guest-feed', 'feed']]);
  });

  it('Discover knows every feed key, any project, and skips our own DSK viewport renders', async () => {
    mediamtx.items = [ready('guest-feed'), ready('theirs-feed'), ready('laptop-feed'), ready('dsk/KEYX__landscape'), ready('stranger')];
    const body = await (await fetch(`${baseUrl}/ingestion/streams/unclaimed`)).json();
    assert.deepEqual(body.streams.map((s) => s.path), ['stranger']);
  });
});

describe('listUnclaimedStreams', () => {
  it('skips <key>__<viewport> names whatever the app', async () => {
    const mtx = { async listPaths() { return { pageCount: 1, items: [ready('KEY__main'), ready('dsk/KEY__vertical'), ready('plain')] }; } };
    const streams = await listUnclaimedStreams(mtx, new Set());
    assert.deepEqual(streams.map((s) => s.path), ['plain']);
  });
});
