/**
 * Relay slots that send an output (plan_egress_outputs.md PR 4): the route an output resolves to, how getRelays turns it into
 * what the relay manager reads, the /stream route, fan-out of step paths and audio replacement.
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { EventEmitter } from 'node:events';
import express from 'express';
import { initDb } from 'lcyt-backend/db';
import { createStreamRouter } from '../src/routes/stream.js';
import { resolveOutputRoute } from '../src/output-routing.js';
import { getRelays, upsertRelay, hasOutputSlots } from '../src/db/relay.js';
import { createOutput, updateOutput } from '../src/db/outputs.js';
import { FanoutSupervisor } from '../src/fanout-supervisor.js';
import { RtmpRelayManager } from '../src/rtmp-manager.js';

const KEY = 'routekey';
let db, server, baseUrl, prog, vert, wide, audioFeed;

before(async () => {
  db = await initDb(':memory:');
  await db.prepare("INSERT INTO api_keys (key, owner, relay_allowed) VALUES (?, 'owner', 1)").run(KEY);
  await db.prepare("INSERT INTO prod_feeds (id, owner_api_key, name, feed_key) VALUES ('fmain', ?, 'Main', 'main-key')").run(KEY);
  await db.prepare("INSERT INTO prod_feeds (id, owner_api_key, name, feed_key) VALUES ('fside', ?, 'Side', 'side-key')").run(KEY);
  await db.prepare("INSERT INTO prod_feeds (id, owner_api_key, name, feed_key, media) VALUES ('fmic', ?, 'Mic', 'mic-key', 'audio')").run(KEY);
  audioFeed = 'fmic';
  await db.prepare('UPDATE api_keys SET primary_feed_id = ? WHERE key = ?').run('fmain', KEY);
  prog = (await createOutput(db, KEY, { name: 'Program', sourceType: 'feed', sourceId: 'fmain' })).output.id;
  vert = (await createOutput(db, KEY, { name: 'Vertical', sourceType: 'output', sourceId: prog })).output.id;
  wide = (await createOutput(db, KEY, { name: 'Wide', sourceType: 'feed', sourceId: 'fside' })).output.id;
  await db.prepare('INSERT INTO crop_config (api_key, enabled, output_id) VALUES (?, 1, ?)').run(KEY, vert);
  await updateOutput(db, KEY, vert, { cropEnabled: true });

  const auth = (req, res, next) => { req.session = { apiKey: KEY }; next(); };
  const app = express();
  app.use(express.json());
  app.use('/stream', createStreamRouter(db, auth, { start: async () => {}, stopKey: async () => {}, isRunning: () => false, runningSlots: () => [], isSlotRunning: () => false, startAll: async () => {} }, ''));
  await new Promise(res => { server = createServer(app).listen(0, '127.0.0.1', () => { baseUrl = `http://127.0.0.1:${server.address().port}`; res(); }); });
});
after(() => new Promise(r => server.close(async () => { await db.close(); r(); })));
beforeEach(async () => { await db.exec('DELETE FROM rtmp_relays'); });

describe('resolveOutputRoute', () => {
  test('main stream without a step is the old program; the default crop is the old crop', async () => {
    assert.deepEqual(await resolveOutputRoute(db, KEY, prog), { kind: 'program' });
    assert.deepEqual(await resolveOutputRoute(db, KEY, vert), { kind: 'crop' });
  });
  test('a named feed is its own path', async () => {
    assert.deepEqual(await resolveOutputRoute(db, KEY, wide), { kind: 'path', path: 'side-key', audioPath: null });
  });
  test('a DSK step or another output\'s crop is a step path', async () => {
    await db.prepare("INSERT INTO dsk_viewports (api_key, name) VALUES (?, 'lower')").run(KEY);
    await updateOutput(db, KEY, prog, { dsk: ['lower'] });
    assert.deepEqual(await resolveOutputRoute(db, KEY, prog), { kind: 'path', path: `out-${prog}-dsk`, audioPath: null });
    await updateOutput(db, KEY, wide, { cropEnabled: true });
    assert.deepEqual(await resolveOutputRoute(db, KEY, wide), { kind: 'path', path: `out-${wide}-crop`, audioPath: null });
    await updateOutput(db, KEY, wide, { cropEnabled: false });
    await updateOutput(db, KEY, prog, { dsk: [] });
  });
  test('an audio feed replaces the sound; a video-only feed does not', async () => {
    await updateOutput(db, KEY, wide, { audioSource: { feed: audioFeed } });
    assert.equal((await resolveOutputRoute(db, KEY, wide)).audioPath, 'mic-key');
    await db.prepare("UPDATE prod_feeds SET media = 'video' WHERE id = 'fmic'").run();
    assert.equal((await resolveOutputRoute(db, KEY, wide)).audioPath, null);
    await db.prepare("UPDATE prod_feeds SET media = 'audio' WHERE id = 'fmic'").run();
    await updateOutput(db, KEY, wide, { audioSource: 'source' });
  });
  test('unknown output gives null', async () => {
    assert.equal(await resolveOutputRoute(db, KEY, 'out-nope'), null);
  });
});

describe('getRelays with sourceOutputId', () => {
  test('path outputs become feed-style slots; program and crop outputs stay on the old handling', async () => {
    await upsertRelay(db, KEY, 1, 'rtmp://a/x', { sourceOutputId: prog });
    await upsertRelay(db, KEY, 2, 'rtmp://a/y', { sourceOutputId: wide });
    await upsertRelay(db, KEY, 3, 'rtmp://a/z', { sourceOutputId: vert });
    const r = await getRelays(db, KEY);
    assert.deepEqual([r[0].sourceFeedKey, r[0].sourceView], [null, 'program']);
    assert.deepEqual([r[1].sourceFeedKey, r[1].sourceOutputId], ['side-key', wide]);
    assert.deepEqual([r[2].sourceFeedKey, r[2].sourceView], [null, 'crop']);
    assert.equal(await hasOutputSlots(db, KEY), true);
  });
  test('an old crop slot on an output with crop off stays a crop slot', async () => {
    await updateOutput(db, KEY, vert, { cropEnabled: false });
    await upsertRelay(db, KEY, 1, 'rtmp://a/x', { sourceView: 'crop', sourceOutputId: vert });
    const [r] = await getRelays(db, KEY);
    assert.deepEqual([r.sourceView, r.sourceFeedKey], ['crop', null]);
    await updateOutput(db, KEY, vert, { cropEnabled: true });
  });
});

describe('/stream with sourceOutputId', () => {
  const j = (method, path, body) => fetch(`${baseUrl}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  test('accepts a known output, rejects unknown ones and a feed and output together', async () => {
    const ok = await j('POST', '/stream', { slot: 1, targetUrl: 'rtmp://a/x', sourceOutputId: wide });
    assert.equal(ok.status, 201);
    assert.equal((await ok.json()).relay.sourceOutputId, wide);
    assert.equal((await j('POST', '/stream', { slot: 2, targetUrl: 'rtmp://a/x', sourceOutputId: 'out-nope' })).status, 400);
    assert.equal((await j('POST', '/stream', { slot: 2, targetUrl: 'rtmp://a/x', sourceOutputId: wide, sourceFeedId: 'fside' })).status, 400);
  });
});

describe('fan-out of an output path', () => {
  function fakeMtx(ready) {
    return {
      calls: [],
      async addPath(n, c) { this.calls.push(['add', n, c]); },
      async patchPath(n, c) { this.calls.push(['patch', n, c]); },
      async deletePath(n) { this.calls.push(['delete', n]); },
      async kickPath() {},
      async getPath(n) { if (!ready.has(n)) { const e = new Error('nf'); e.statusCode = 404; throw e; } return { ready: true, readyTime: 't' }; },
    };
  }
  function factory() {
    const runners = [];
    const f = (opts) => { const r = Object.assign(new EventEmitter(), { opts, stopped: false }); r.start = async () => r; r.stop = async () => { r.stopped = true; }; runners.push(r); return r; };
    return { f, runners };
  }

  test('runner mode: video from the path, audio from the audio feed, both copied; waits for both paths', async () => {
    const ready = new Set(['out-x-dsk']);
    const { f, runners } = factory();
    const sup = new FanoutSupervisor({ mediamtx: fakeMtx(ready), settings: { get: (k) => ({ 'mediamtx.fanout_mode': 'runner', 'mediamtx.rtsp_base_url': 'rtsp://m:8554' })[k] }, runnerFactory: f });
    await sup.set('out-x-dsk|a|mic-key', { sourcePath: 'out-x-dsk', path: 'out-x-dsk', audioPath: 'mic-key', tee: '[f=flv]rtmp://a/b' });
    assert.equal(runners.length, 0, 'audio path not ready');
    ready.add('mic-key');
    await sup.reconcile();
    assert.equal(runners.length, 1);
    const a = runners[0].opts.args.join(' ');
    assert.match(a, /-i rtsp:\/\/m:8554\/out-x-dsk .*-i rtsp:\/\/m:8554\/mic-key -map 0:v:0 -map 1:a:0 -c copy -f tee/);
    await sup.stopAll();
  });

  test('relay manager: slots with an audio path form their own group on the video path', async () => {
    const ready = new Set(['side-key', 'mic-key']);
    const { f, runners } = factory();
    const mtx = fakeMtx(ready);
    const mgr = new RtmpRelayManager({
      mediamtxClient: mtx,
      settings: { get: (k) => ({ 'mediamtx.fanout_mode': 'runner', 'mediamtx.rtsp_base_url': 'rtsp://m:8554' })[k] ?? undefined },
      ffmpegCaps: { available: true, hasLibx264: false, hasEia608: false, hasSubrip: false },
    });
    mgr._fanout._runnerFactory = f;
    await mgr.start('p', [
      { slot: 1, targetUrl: 'rtmp://a/one', sourceFeedKey: 'side-key' },
      { slot: 2, targetUrl: 'rtmp://a/two', sourceFeedKey: 'side-key', sourceAudioPath: 'mic-key' },
    ]);
    const cmds = runners.map(r => r.opts.args.join(' '));
    assert.equal(cmds.length, 2);
    assert.ok(cmds.some(c => !c.includes('mic-key') && c.includes('a/one')));
    assert.ok(cmds.some(c => c.includes('-map 1:a:0') && c.includes('a/two')));
    await mgr.stopAll();
  });
});
