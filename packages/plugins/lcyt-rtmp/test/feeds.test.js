/**
 * prod_feeds: the /feeds router and the backfill from cameras and mixer outputs.
 * Cameras and mixers belong to lcyt-production; their rows are seeded with plain SQL (same convention as
 * feed-rtmp.test.js).
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import { initDb } from 'lcyt-backend/db';
import { createFeedsRouter } from '../src/routes/feeds.js';
import { backfillFeeds, listFeeds, getFeedByKey, listFeedsForDevice, unlinkDeviceFeeds } from '../src/db/feeds.js';

const KEY = 'feedsproj';
const OTHER = 'otherproj';
let db, server, baseUrl, relay, mediamtx;

before(async () => {
  db = await initDb(':memory:');
  await db.prepare("INSERT INTO api_keys (key, owner, ingest_stream_key) VALUES (?, 'o', 'rotated-key')").run(KEY);
  await db.prepare("INSERT INTO api_keys (key, owner) VALUES (?, 'o2')").run(OTHER);

  mediamtx = { live: new Set(), webrtcBaseUrl: 'http://mtx:8889', async isPathPublishing(n) { return this.live.has(n); } };
  relay = { mediamtx, isPublishing: () => true };
  const auth = (req, res, next) => { req.session = { apiKey: KEY }; next(); };
  const app = express();
  app.use(express.json());
  app.use('/feeds', createFeedsRouter(db, auth, relay));
  await new Promise((resolve) => {
    server = createServer(app).listen(0, '127.0.0.1', () => { baseUrl = `http://127.0.0.1:${server.address().port}`; resolve(); });
  });
});

after(() => new Promise((r) => server.close(async () => { await db.close(); r(); })));

beforeEach(async () => {
  await db.prepare('DELETE FROM prod_feeds').run();
  await db.prepare('DELETE FROM prod_cameras').run();
  await db.prepare('DELETE FROM prod_mixers').run();
  mediamtx.live.clear();
});

const call = (method, path, body) => fetch(`${baseUrl}/feeds${path}`, {
  method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
});

describe('GET /feeds', () => {
  it('leads with the two managed feeds built from the project keys', async () => {
    const { feeds } = await (await call('GET', '')).json();
    assert.deepEqual(feeds.map((f) => f.id), ['managed:video', 'managed:dsk']);
    assert.equal(feeds[0].feedKey, 'rotated-key');
    assert.equal(feeds[0].label, 'main');
    assert.equal(feeds[0].managed, true);
    assert.match(feeds[0].ingestUrl, /^rtmp:\/\/.+\/stream\/rotated-key$/);
    assert.equal(feeds[1].kind, 'dsk');
    assert.equal(feeds[1].feedKey, KEY);
    assert.equal(feeds[1].live, null);
  });

  it('lists only the project\'s own feeds, with live status from MediaMTX', async () => {
    await call('POST', '', { name: 'Altar', kind: 'camera', feedKey: 'altar' });
    await db.prepare("INSERT INTO prod_feeds (id, owner_api_key, name, feed_key) VALUES ('x', ?, 'Theirs', 'theirs')").run(OTHER);
    mediamtx.live.add('altar');
    const { feeds } = await (await call('GET', '')).json();
    const named = feeds.filter((f) => !f.managed);
    assert.deepEqual(named.map((f) => f.name), ['Altar']);
    assert.equal(named[0].live, true);
    assert.equal(named[0].ingestUrl.endsWith('/feed/altar'), true);
  });
});

describe('POST /feeds', () => {
  it('creates a feed with defaults and a generated key', async () => {
    const res = await call('POST', '', { name: 'Guest speaker' });
    assert.equal(res.status, 201);
    const f = await res.json();
    assert.equal(f.kind, 'generic');
    assert.equal(f.transport, 'rtmp');
    assert.match(f.feedKey, /^feed-[0-9a-f]{12}$/);
  });

  it('keeps a free label on generic feeds', async () => {
    const f = await (await call('POST', '', { name: 'Out of mixer 2', label: ' mixer2 ' })).json();
    assert.equal(f.label, 'mixer2');
  });

  it('rejects bad input', async () => {
    for (const body of [{}, { name: '' }, { name: 'a', kind: 'program' }, { name: 'a', transport: 'srt' },
      { name: 'a', feedKey: 'has space' }, { name: 'a', deviceType: 'camera' }, { name: 'a', deviceType: 'tv', deviceId: '1' }]) {
      assert.equal((await call('POST', '', body)).status, 400, JSON.stringify(body));
    }
  });

  it('refuses a key already used by a feed, an API key, an ingest key or somebody else\'s camera', async () => {
    await db.prepare("INSERT INTO prod_cameras (id, name, camera_key, control_type, owner_api_key) VALUES ('c-other', 'C', 'cam-key', 'rtmp', ?)").run(OTHER);
    await call('POST', '', { name: 'First', feedKey: 'taken' });
    for (const feedKey of ['taken', KEY, OTHER, 'rotated-key', 'cam-key']) {
      assert.equal((await call('POST', '', { name: 'Again', feedKey })).status, 409, feedKey);
    }
  });

  it('links to a device of the project, many feeds per device, and refuses other projects\' or missing devices', async () => {
    await db.prepare("INSERT INTO prod_cameras (id, name, control_type, owner_api_key) VALUES ('c1', 'Wide', 'none', ?)").run(KEY);
    await db.prepare("INSERT INTO prod_cameras (id, name, control_type, owner_api_key) VALUES ('c2', 'Theirs', 'none', ?)").run(OTHER);
    const a = await call('POST', '', { name: 'Wide main', kind: 'camera', deviceType: 'camera', deviceId: 'c1' });
    const b = await call('POST', '', { name: 'Wide low', kind: 'camera', deviceType: 'camera', deviceId: 'c1' });
    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
    assert.equal((await listFeedsForDevice(db, 'camera', 'c1')).length, 2);
    assert.equal((await call('POST', '', { name: 'x', deviceType: 'camera', deviceId: 'c2' })).status, 400);
    assert.equal((await call('POST', '', { name: 'x', deviceType: 'mixer', deviceId: 'nope' })).status, 400);
  });
});

describe('PATCH and DELETE /feeds/:id', () => {
  it('edits fields, relabels, links and unlinks a device', async () => {
    await db.prepare("INSERT INTO prod_mixers (id, name, type, owner_api_key) VALUES ('m1', 'Mixer 1', 'atem', ?)").run(KEY);
    const f = await (await call('POST', '', { name: 'Feed', feedKey: 'ed1' })).json();
    let r = await (await call('PATCH', `/${f.id}`, { name: 'Renamed', label: 'preview', deviceType: 'mixer', deviceId: 'm1' })).json();
    assert.equal(r.name, 'Renamed');
    assert.equal(r.label, 'preview');
    assert.equal(r.deviceId, 'm1');
    assert.equal(r.feedKey, 'ed1');
    r = await (await call('PATCH', `/${f.id}`, { deviceType: null, deviceId: null, label: null })).json();
    assert.equal(r.deviceType, null);
    assert.equal(r.label, null);
  });

  it('allows setting the key it already has but not another feed\'s', async () => {
    const a = await (await call('POST', '', { name: 'A', feedKey: 'ka' })).json();
    await call('POST', '', { name: 'B', feedKey: 'kb' });
    assert.equal((await call('PATCH', `/${a.id}`, { feedKey: 'ka' })).status, 200);
    assert.equal((await call('PATCH', `/${a.id}`, { feedKey: 'kb' })).status, 409);
  });

  it('answers 404 for unknown and other projects\' feeds, 400 for managed ones', async () => {
    await db.prepare("INSERT INTO prod_feeds (id, owner_api_key, name, feed_key) VALUES ('theirs', ?, 'T', 'tk')").run(OTHER);
    assert.equal((await call('PATCH', '/nope', { name: 'x' })).status, 404);
    assert.equal((await call('PATCH', '/theirs', { name: 'x' })).status, 404);
    assert.equal((await call('DELETE', '/theirs')).status, 404);
    assert.equal((await call('PATCH', '/managed:video', { name: 'x' })).status, 400);
    assert.equal((await call('DELETE', '/managed:dsk')).status, 400);
  });

  it('deletes', async () => {
    const f = await (await call('POST', '', { name: 'Gone' })).json();
    assert.equal((await call('DELETE', `/${f.id}`)).status, 204);
    assert.equal((await listFeeds(db, KEY)).length, 0);
  });
});

describe('backfillFeeds', () => {
  async function seed() {
    const cam = (id, type, key, owner = KEY, name = id) => db.prepare(
      'INSERT INTO prod_cameras (id, name, camera_key, control_type, owner_api_key, sort_order) VALUES (?, ?, ?, ?, ?, 2)',
    ).run(id, name, key, type, owner);
    await cam('c-rtmp', 'rtmp', 'altar');
    await cam('c-whip', 'webcam', 'laptop');
    await cam('c-mobile', 'mobile', 'phone');
    await cam('c-ptz', 'amx', 'ptzkey'); // PTZ cameras with a key are not feeds
    await cam('c-nokey', 'rtmp', null);
    await cam('c-noowner', 'rtmp', 'orphan', null);
    await db.prepare("INSERT INTO prod_mixers (id, name, type, output_key, owner_api_key) VALUES ('m1', 'Main mixer', 'lcyt', 'mixout', ?)").run(KEY);
    await db.prepare("INSERT INTO prod_mixers (id, name, type, owner_api_key) VALUES ('m2', 'No output', 'atem', ?)").run(KEY);
  }

  it('turns pushed cameras and mixer outputs into feeds linked to their device', async () => {
    await seed();
    const res = await backfillFeeds(db);
    assert.deepEqual(res, { created: 4, skipped: 1 }); // the camera without an owner is skipped
    const feeds = await listFeeds(db, KEY);
    const byKey = Object.fromEntries(feeds.map((f) => [f.feedKey, f]));
    assert.deepEqual(Object.keys(byKey).sort(), ['altar', 'laptop', 'mixout', 'phone']);
    assert.equal(byKey.altar.transport, 'rtmp');
    assert.equal(byKey.laptop.transport, 'whip');
    assert.equal(byKey.altar.kind, 'camera');
    assert.equal(byKey.altar.deviceType, 'camera');
    assert.equal(byKey.altar.deviceId, 'c-rtmp');
    assert.equal(byKey.mixout.kind, 'generic');
    assert.equal(byKey.mixout.label, 'Main mixer');
    assert.equal(byKey.mixout.deviceType, 'mixer');
    assert.equal((await getFeedByKey(db, 'altar')).ownerApiKey, KEY);
  });

  it('is idempotent and leaves cameras and mixers untouched', async () => {
    await seed();
    await backfillFeeds(db);
    const again = await backfillFeeds(db);
    assert.deepEqual(again, { created: 0, skipped: 1 });
    assert.equal((await listFeeds(db, KEY)).length, 4);
    const cam = await db.prepare("SELECT control_type, camera_key FROM prod_cameras WHERE id = 'c-rtmp'").get();
    assert.equal(cam.control_type, 'rtmp');
    assert.equal(cam.camera_key, 'altar');
  });

  it('skips, without failing, a key that another feed already holds', async () => {
    await seed();
    await db.prepare("INSERT INTO prod_feeds (id, owner_api_key, name, feed_key) VALUES ('f0', ?, 'Existing', 'altar')").run(OTHER);
    const res = await backfillFeeds(db);
    assert.equal(res.created, 3);
    assert.equal((await getFeedByKey(db, 'altar')).ownerApiKey, OTHER);
  });
});

describe('unlinkDeviceFeeds', () => {
  it('detaches the feeds of a deleted device and keeps the feeds', async () => {
    await db.prepare("INSERT INTO prod_feeds (id, owner_api_key, name, feed_key, device_type, device_id) VALUES ('f1', ?, 'F', 'fk1', 'camera', 'c9')").run(KEY);
    assert.equal(await unlinkDeviceFeeds(db, 'camera', 'c9'), 1);
    const [f] = await listFeeds(db, KEY);
    assert.equal(f.deviceType, null);
    assert.equal(f.deviceId, null);
  });
});
