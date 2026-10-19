import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import { initDb } from 'lcyt-backend/db';
import { createIngestionRouter } from '../src/routes/ingestion.js';
import { classifyTracks, listIngestStreams, listUnclaimedStreams } from '../src/ingest-streams.js';

const ready = (name, extra = {}) => ({ name, ready: true, readyTime: '2026-10-19T05:00:00Z', tracks: ['H264', 'Opus'], readers: [], bytesReceived: 10, ...extra });

class FakeMediaMtx {
  constructor(items) { this.items = items; this.calls = []; }
  async listPaths({ page = 0, itemsPerPage = 100 } = {}) {
    this.calls.push(page);
    const start = page * itemsPerPage;
    return { itemCount: this.items.length, pageCount: Math.max(1, Math.ceil(this.items.length / itemsPerPage)), items: this.items.slice(start, start + itemsPerPage) };
  }
}

describe('classifyTracks', () => {
  it('reads codec strings and tracks2 objects', () => {
    assert.deepEqual(classifyTracks({ tracks: ['H264', 'Opus'] }), { video: true, audio: true, codecs: ['H264', 'Opus'] });
    assert.equal(classifyTracks({ tracks: ['MPEG-4 Audio'] }).video, false);
    assert.equal(classifyTracks({ tracks: ['MPEG-4 Audio'] }).audio, true);
    assert.deepEqual(classifyTracks({ tracks: ['x'], tracks2: [{ codec: 'AV1' }] }), { video: true, audio: false, codecs: ['AV1'] });
    assert.deepEqual(classifyTracks({}), { video: false, audio: false, codecs: [] });
  });
});

describe('listIngestStreams', () => {
  it('keeps only ready raw ingest paths of the project', async () => {
    const mtx = new FakeMediaMtx([
      ready('KEY1'), ready('stream/KEY1', { tracks: ['H264'] }), ready('KEY1-out'), ready('KEY1-crop'), ready('KEY1-t0'),
      ready('dsk/KEY1'), ready('dsk/OTHER'), ready('OTHER'), ready('altar-cam'), { name: 'KEY1', ready: false },
    ]);
    const streams = await listIngestStreams(mtx, [{ key: 'KEY1', kind: 'video' }, { key: 'altar-cam', kind: 'feed', label: 'Altar' }]);
    assert.deepEqual(streams.map(s => [s.path, s.kind, s.label]), [
      ['KEY1', 'video', null], ['stream/KEY1', 'video', null], ['dsk/KEY1', 'dsk', null], ['altar-cam', 'feed', 'Altar'],
    ]);
    assert.equal(streams[1].audio, false);
  });

  it('follows MediaMTX pagination', async () => {
    const items = Array.from({ length: 450 }, (_, i) => ready(`p${i}`));
    items.push(ready('KEY1'));
    const mtx = new FakeMediaMtx(items);
    const streams = await listIngestStreams(mtx, [{ key: 'KEY1', kind: 'video' }]);
    assert.equal(streams.length, 1);
    assert.deepEqual(mtx.calls, [0, 1, 2]);
  });
});

describe('listUnclaimedStreams', () => {
  it('skips owned keys and relay outputs, flags what can become a feed', async () => {
    const mtx = new FakeMediaMtx([
      ready('KEY1'), ready('KEY1-out'), ready('KEY1-t2'), ready('dsk/KEY1'), ready('altar-cam'),
      ready('webcam'), ready('stream/guest cam'), ready('dsk/newdsk'), ready('stream/obs1'), { name: 'idle', ready: false },
    ]);
    const streams = await listUnclaimedStreams(mtx, new Set(['KEY1', 'altar-cam']));
    assert.deepEqual(streams.map(s => [s.path, s.kind, s.attachable]), [
      ['webcam', 'video', true], ['stream/guest cam', 'video', false], ['dsk/newdsk', 'dsk', false], ['stream/obs1', 'video', false],
    ]);
  });
});

describe('GET /ingestion/streams', () => {
  let db, server, baseUrl, mediamtx, denySetup = false;
  const relayManager = { isPublishing: () => false, get mediamtx() { return mediamtx; } };

  before(async () => {
    db = await initDb(':memory:');
    await db.prepare("INSERT INTO api_keys (key, owner) VALUES ('KEY1', 'o')").run();
    await db.prepare("INSERT INTO prod_cameras (id, name, camera_key, control_type, owner_api_key) VALUES ('c1', 'Altar', 'altar-cam', 'rtmp', 'KEY1')").run();
    await db.prepare("INSERT INTO prod_cameras (id, name, camera_key, control_type, owner_api_key) VALUES ('c2', 'Other', 'other-cam', 'rtmp', 'KEY2')").run();
    const app = express();
    app.use((req, res, next) => { req.session = { apiKey: 'KEY1' }; next(); });
    app.use('/ingestion', createIngestionRouter(db, (req, res, next) => next(), relayManager, null, (req, res, next) => (denySetup && req.method === 'POST' ? res.status(403).json({ error: 'no' }) : next())));
    server = createServer(app);
    await new Promise(r => server.listen(0, r));
    baseUrl = `http://localhost:${server.address().port}`;
  });
  after(async () => { await new Promise(r => server.close(r)); await db.close(); });

  it('is unavailable (not an error) without a MediaMTX API', async () => {
    mediamtx = null;
    const res = await fetch(`${baseUrl}/ingestion/streams`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { available: false, streams: [] });
  });

  it('lists the project streams and its own cameras only', async () => {
    mediamtx = new FakeMediaMtx([ready('KEY1'), ready('altar-cam'), ready('other-cam'), ready('KEY2')]);
    const body = await (await fetch(`${baseUrl}/ingestion/streams`)).json();
    assert.equal(body.available, true);
    assert.deepEqual(body.streams.map(s => [s.path, s.kind, s.label]), [['KEY1', 'video', null], ['altar-cam', 'feed', 'Altar']]);
  });

  it('discover lists unowned paths and is held to the setup tier', async () => {
    mediamtx = new FakeMediaMtx([ready('KEY1'), ready('altar-cam'), ready('other-cam'), ready('webcam')]);
    const body = await (await fetch(`${baseUrl}/ingestion/streams/unclaimed`)).json();
    assert.deepEqual(body.streams.map(s => s.path), ['webcam']);
    denySetup = true;
    try {
      assert.equal((await fetch(`${baseUrl}/ingestion/streams/unclaimed`)).status, 403);
    } finally { denySetup = false; }
  });

  it('is unavailable when MediaMTX cannot be reached', async () => {
    mediamtx = { listPaths: async () => { throw new Error('boom'); } };
    assert.deepEqual(await (await fetch(`${baseUrl}/ingestion/streams`)).json(), { available: false, streams: [] });
  });
});
