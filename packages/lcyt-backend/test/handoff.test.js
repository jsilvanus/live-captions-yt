import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import express from 'express';
import { initDb } from '../src/db.js';
import { getVideo, getVideoStorageDir } from '../src/db/videos.js';
import { listGroupFeeds } from '../src/db/video-feeds.js';
import { startRecordingGroup, stopRecordingGroup, configuredFeedRoles } from '../src/recording/feeds.js';
import { createHandoffService } from '../src/handoff/service.js';
import { createHandoffRouter } from '../src/routes/handoff.js';
import { buildManifest, validateManifest, resolveManifestRefs } from '../src/handoff/manifest.js';
import { signHandoffToken, verifyHandoffToken } from '../src/handoff/tokens.js';
import { groupParts, segmentWallMs } from '../src/recording/recorder.js';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

function makeSegment(file, seconds, hz) {
  const r = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `testsrc=size=320x180:rate=25:duration=${seconds}`,
    '-f', 'lavfi', '-i', `sine=frequency=${hz}:duration=${seconds}`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '25', '-c:a', 'aac', '-shortest',
    '-movflags', '+frag_keyframe+empty_moov+default_base_moof', file,
  ]);
  assert.equal(r.status, 0, String(r.stderr));
}

describe('handoff pieces', () => {
  it('validates manifests and keeps secrets out', () => {
    const feeds = [{ role: 'clean', parts: [{ ref: 'clean-1.mp4', startMs: 0, durationMs: 1000 }] }, { role: 'program', aliasOf: 'clean' }];
    const m = buildManifest({ origin: { system: 'lcyt' }, title: 't', startedAt: 'a', endedAt: 'b', feeds, captions: [{ language: 'fi', ref: 'captions.fi.vtt' }] });
    assert.deepEqual(validateManifest(m), []);
    assert.ok(validateManifest({ ...m, feeds: [{ role: 'program', aliasOf: 'clean' }] }).some((e) => /clean/.test(e)));
    assert.ok(validateManifest({ ...m, title: 'has SECRET-KEY inside' }, { forbidden: ['SECRET-KEY'] }).length > 0);
    const bad = structuredClone(m); bad.feeds[0].parts[0].ref = 'https://x/y.mp4';
    assert.ok(validateManifest(bad).some((e) => /relative/.test(e)));
    const resolved = resolveManifestRefs(m, (n) => `http://h/${n}`);
    assert.equal(resolved.feeds[0].parts[0].ref, 'http://h/clean-1.mp4');
    assert.equal(m.feeds[0].parts[0].ref, 'clean-1.mp4', 'original is untouched');
  });

  it('signs download tokens that expire and bind to one handoff', () => {
    const t = signHandoffToken('s', 'g1', Date.now() + 1000);
    assert.equal(verifyHandoffToken('s', 'g1', t), true);
    assert.equal(verifyHandoffToken('s', 'g2', t), false);
    assert.equal(verifyHandoffToken('other', 'g1', t), false);
    assert.equal(verifyHandoffToken('s', 'g1', signHandoffToken('s', 'g1', Date.now() - 1)), false);
    assert.equal(verifyHandoffToken('s', 'g1', 'garbage'), false);
  });

  it('splits recordings into continuous parts at gaps', () => {
    const parts = groupParts([
      { wallMs: 0, durationMs: 4000 }, { wallMs: 4000, durationMs: 4000 }, { wallMs: 20000, durationMs: 3000 },
    ]);
    assert.equal(parts.length, 2);
    assert.deepEqual(parts.map((p) => [p.startMs, p.playlistStartMs, p.durationMs]), [[0, 0, 8000], [20000, 8000, 3000]]);
    assert.equal(segmentWallMs('x/2026-10-12_08-00-04-500000.mp4') - segmentWallMs('2026-10-12_08-00-00-000000.mp4'), 4500);
  });

  it('records all three feeds by default and clean always', () => {
    assert.deepEqual(configuredFeedRoles({}), ['clean', 'program', 'dsk']);
    assert.deepEqual(configuredFeedRoles({ RECORD_FEEDS: 'program' }), ['clean', 'program']);
  });
});

describe('handoff end to end', { skip: !hasFfmpeg }, () => {
  let tempDir; let db; let server; let baseUrl; let service; let sent;
  const startedAt = '2026-10-12T07:59:58.000Z';

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'lcyt-handoff-'));
    process.env.VIDEOS_STORAGE_DIR = join(tempDir, 'recordings');
    db = await initDb(':memory:');
    await db.prepare('INSERT INTO api_keys (key, owner) VALUES (?, ?)').run('demo-key-secret', 'demo');
    sent = [];
    const captionVtt = 'WEBVTT\n\n1\n00:00:05.000 --> 00:00:07.000\nHei maailma\n';
    const resolveStorage = async () => ({ openRead: async () => ({ stream: Readable.from([captionVtt]) }) });
    service = createHandoffService({
      db, resolveStorage, jwtSecret: 'jwt-secret',
      env: { SAARNAVIDEO_URL: 'http://saarna.test', SAARNAVIDEO_TOKEN: 'tok', PUBLIC_URL: 'http://lcyt.test' },
      fetchImpl: async (url, init) => { sent.push([url, init]); return { ok: true, status: 202 }; },
    });
    const app = express();
    app.use(express.json());
    app.use('/api/v1/handoff', createHandoffRouter((req, _res, next) => { req.session = { apiKey: 'demo-key-secret' }; next(); }, db, service));
    server = createServer(app);
    await new Promise((r) => server.listen(0, r));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterEach(async () => {
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
    try { await db?.close?.(); } catch {}
    rmSync(tempDir, { recursive: true, force: true });
    delete process.env.VIDEOS_STORAGE_DIR;
  });

  it('builds a manifest from clean (with a gap), program and dsk events, then delivers it', async () => {
    // A broadcast with a caption file and a session that started 1 s before the recording.
    await db.prepare("INSERT INTO caption_files (api_key, filename, lang, format, type, broadcast_id) VALUES (?,?,?,?,?,?)")
      .run('demo-key-secret', 'cap.vtt', 'fi', 'vtt', 'captions', 'bc1');
    await db.prepare("INSERT INTO session_stats (session_id, api_key, started_at, ended_at, duration_ms, broadcast_id) VALUES (?,?,?,?,?,?)")
      .run('s1', 'demo-key-secret', '2026-10-12 07:59:57', '2026-10-12 08:01:00', 63000, 'bc1');

    const handlers = [];
    const eventBus = { subscribe: (_k, _t, h) => { handlers.push(h); return () => {}; } };
    const group = await startRecordingGroup(db, { apiKey: 'demo-key-secret', broadcastId: 'bc1', title: 'Messu', startedAt, eventBus });
    assert.deepEqual(Object.keys(group.feeds).sort(), ['clean', 'dsk', 'program']);
    handlers[0]({ ts: Date.parse(startedAt) + 5000, topic: 'dsk.graphics_changed', data: { default: ['lower-third'] } });

    // MediaMTX output: clean = two contiguous segments, a 6 s gap, one more; program starts 1 s later; dsk never published.
    const dir = (role) => getVideoStorageDir('demo-key-secret', group.feeds[role]);
    mkdirSync(join(dir('clean'), 'p'), { recursive: true });
    makeSegment(join(dir('clean'), 'p', '2026-10-12_08-00-00-000000.mp4'), 2, 440);
    makeSegment(join(dir('clean'), 'p', '2026-10-12_08-00-02-000000.mp4'), 2, 440);
    makeSegment(join(dir('clean'), 'p', '2026-10-12_08-00-10-000000.mp4'), 2, 660);
    mkdirSync(join(dir('program'), 'p'), { recursive: true });
    makeSegment(join(dir('program'), 'p', '2026-10-12_08-00-01-000000.mp4'), 2, 880);

    const stopped = await stopRecordingGroup(db, { apiKey: 'demo-key-secret', groupId: group.groupId, delayMs: 0, finalizeOpts: { settleMs: 0 } });
    await stopped.finalized;
    assert.equal((await listGroupFeeds(db, 'demo-key-secret', group.groupId)).length, 2, 'the empty dsk feed is dropped');
    assert.equal(await getVideo(db, 'demo-key-secret', group.feeds.dsk), null);
    assert.equal((await getVideo(db, 'demo-key-secret', group.feeds.clean)).status, 'completed');

    let res = await fetch(`${baseUrl}/api/v1/handoff`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ broadcastId: 'bc1' }) });
    assert.equal(res.status, 202);
    await service.build('demo-key-secret', { groupId: group.groupId }); // wait for a full build (the route builds in the background too)

    res = await fetch(`${baseUrl}/api/v1/handoff/${group.groupId}`);
    const { handoff } = await res.json();
    assert.equal(handoff.status, 'ready');
    const m = handoff.manifest;
    assert.equal(m.version, 1);
    assert.equal(m.title, 'Messu');
    assert.equal(m.timeAlignment, 'recorded');
    assert.ok(!JSON.stringify(m).includes('demo-key-secret'), 'no API key in the manifest');
    const clean = m.feeds.find((f) => f.role === 'clean');
    assert.deepEqual(clean.parts.map((p) => p.startMs), [0, 10000]);
    assert.equal(clean.width, 320);
    const program = m.feeds.find((f) => f.role === 'program');
    assert.equal(program.parts.length, 1);
    assert.equal(program.parts[0].startMs, 1000);
    assert.equal(m.feeds.find((f) => f.role === 'dsk'), undefined);
    // The session started 07:59:57 and the first clean frame is 08:00:00, so a caption at 5 s of the session is at 2 s of the clean feed.
    assert.equal(m.captions.length, 1);
    assert.equal(m.dskEvents.count, 1);

    // The importer downloads with the token in the manifest URLs, and nothing without it.
    const part = clean.parts[0].ref;
    assert.match(part, /\/handoff\/.+\/files\/clean-1\.mp4\?token=/);
    const file = await fetch(part.replace('http://lcyt.test', baseUrl));
    assert.equal(file.status, 200);
    const bytes = Buffer.from(await file.arrayBuffer());
    assert.ok(bytes.length > 1000);
    const noToken = await fetch(part.replace('http://lcyt.test', baseUrl).replace(/\?token=.*/, ''));
    assert.equal(noToken.status, 401);
    const vtt = await (await fetch(m.captions[0].ref.replace('http://lcyt.test', baseUrl))).text();
    assert.match(vtt, /Hei maailma/);
    assert.match(vtt, /00:00:02\.000 --> 00:00:04\.000/);
    const events = await (await fetch(m.dskEvents.ref.replace('http://lcyt.test', baseUrl))).json();
    assert.equal(events.events[0].kind, 'graphics_changed');

    res = await fetch(`${baseUrl}/api/v1/handoff/${group.groupId}/send`, { method: 'POST' });
    assert.equal(res.status, 200);
    assert.equal(sent.length, 1);
    assert.equal(sent[0][0], 'http://saarna.test/api/imports/lcyt');
    assert.equal(sent[0][1].headers.Authorization, 'Bearer tok');
    const body = JSON.parse(sent[0][1].body);
    assert.match(body.manifestUrl, /^http:\/\/lcyt\.test\/api\/v1\/handoff\/.+\/manifest\.json\?token=/);
    const delivered = await (await fetch(`${baseUrl}/api/v1/handoff/${group.groupId}`)).json();
    assert.equal(delivered.handoff.status, 'sent');
  });

  it('refuses a handoff while the recording is still being processed', async () => {
    const group = await startRecordingGroup(db, { apiKey: 'demo-key-secret', broadcastId: 'bc2', startedAt });
    const res = await fetch(`${baseUrl}/api/v1/handoff`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ groupId: group.groupId }) });
    assert.equal(res.status, 409);
    const none = await fetch(`${baseUrl}/api/v1/handoff`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ broadcastId: 'nope' }) });
    assert.equal(none.status, 404);
  });
});
