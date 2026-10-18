import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { createJobsRouter } from '../src/routes/jobs.js';
import { createJobsPanelService, liveClientRef } from 'lcyt-compute/jobs-panel';

// Fake auditor (/status, /v1/live) and fake orchestrator (/v1/capabilities, /v1/workers, /v1/pools).
function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
  });
}
const send = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };

const KEY_A = 'projectaaaa1111';
const KEY_B = 'projectbbbb2222';
let auditor, fleet, app, base;
let auditorSeen = [];
let auditorDown = false;
let runs = [];

before(async () => {
  auditor = await listen((req, res) => {
    auditorSeen.push([req.url, req.headers.authorization]);
    if (auditorDown) return send(res, 500, {});
    if (req.url === '/status') return send(res, 200, { queue: { live_depth: 1, batch_depth: 2, max_queue: 8 }, model: {} });
    if (req.url === '/v1/live') {
      return send(res, 200, { sessions: [
        { id: 's1', status: 'running', client_ref: liveClientRef(KEY_A), language: 'fi', transcripts: 7, created: '2026-10-18T10:00:00.000Z' },
        { id: 's2', status: 'running', client_ref: liveClientRef(KEY_B), language: 'en', transcripts: 1, created: '2026-10-18T10:01:00.000Z' },
        { id: 's3', status: 'ended', client_ref: liveClientRef(KEY_A), language: 'fi', transcripts: 3, created: '2026-10-18T09:00:00.000Z' },
        { id: 's4', status: 'running', client_ref: 'someone-else', language: 'fi', transcripts: 0, created: '2026-10-18T10:02:00.000Z' },
      ] });
    }
    return send(res, 404, {});
  });
  fleet = await listen((req, res) => {
    if (req.headers.authorization !== 'Bearer fleet-token') return send(res, 401, {});
    if (req.url === '/v1/capabilities') return send(res, 200, { workers: 2, slots: { default: { total: 8, used: 5 } }, queued: 2 });
    if (req.url === '/v1/workers') return send(res, 403, {});
    if (req.url === '/v1/pools') return send(res, 200, { pools: [{ name: 'hetzner', instances: 1, max: 5 }] });
    return send(res, 404, {});
  });
  const service = createJobsPanelService({
    env: { FFFLEET_URL: fleet.url, FFFLEET_TOKEN: 'fleet-token' },
    getAuditor: () => ({ url: auditor.url, apiKey: 'auditor-key' }),
    listRuns: () => runs,
    now: (() => { let t = 0; return () => (t += 10_000); })(), // every call is past the cache
  });
  const auth = (req, res, next) => {
    const key = req.headers['x-key'];
    if (!key) return res.status(401).json({ error: 'no' });
    req.session = { apiKey: key };
    if (req.headers['x-admin']) req.user = { isAdmin: true };
    next();
  };
  app = express();
  app.use('/jobs', createJobsRouter(auth, service));
  const s = await listen(app);
  base = `${s.url}/jobs`;
  app.close = () => s.server.close();
});
after(() => { app.close(); auditor.server.close(); fleet.server.close(); });

const get = (path, headers = { 'x-key': KEY_A }) => fetch(base + path, { headers, signal: AbortSignal.timeout(5000) });

describe('jobs routes', { timeout: 20_000 }, () => {
  it('needs the auth middleware', async () => {
    assert.equal((await get('', {})).status, 401);
    assert.equal((await get('/strip', {})).status, 401);
  });

  it("lists the project's ffmpeg runs and its auditor live session as RUNNING rows", async () => {
    runs = [
      { id: 'ffmpeg-1', purpose: 'hls', apiKey: KEY_A, runner: 'fleet', startedAt: Date.parse('2026-10-18T10:00:30Z') },
      { id: 'ffmpeg-2', purpose: 'radio', apiKey: KEY_B, runner: 'spawn', startedAt: Date.parse('2026-10-18T10:00:40Z') },
    ];
    const body = await (await get('')).json();
    assert.deepEqual(body.jobs.map((j) => j.id), ['auditor-s1', 'ffmpeg-1']);
    assert.deepEqual(body.counts, { running: 2, queued: 0 });
    const live = body.jobs[0];
    assert.equal(live.type, 'AUDITOR_LIVE');
    assert.equal(live.status, 'RUNNING');
    assert.equal(live.message, 'fi · 7');
    const ff = body.jobs[1];
    assert.equal(ff.type, 'FFMPEG');
    assert.equal(ff.projectTitle, 'hls');
    assert.equal(ff.workerId, 'fleet');
    assert.ok(auditorSeen.some(([, auth]) => auth === 'Bearer auditor-key'));
  });

  it('shows an admin every project but never a foreign session', async () => {
    const body = await (await get('', { 'x-key': KEY_A, 'x-admin': '1' })).json();
    assert.deepEqual(body.jobs.map((j) => j.id).sort(), ['auditor-s1', 'auditor-s2', 'ffmpeg-1', 'ffmpeg-2']);
  });

  it('builds the strip from the orchestrator (capabilities + pools) and the auditor', async () => {
    const strip = await (await get('/strip')).json();
    assert.equal(strip.enabled, true);
    assert.deepEqual(strip.fleet, { state: 'ok', workers: 2, slotsUsed: 5, slotsTotal: 8, queued: 2, pools: [{ name: 'hetzner', instances: 1, max: 5 }] });
    assert.deepEqual(strip.app, { running: 1, queued: 0 });
    assert.deepEqual(strip.stt, { queued: 2, running: 1 });
    assert.equal(strip.live, 1);
  });

  it('leaves the auditor parts out when it does not answer', async () => {
    auditorDown = true;
    try {
      const strip = await (await get('/strip')).json();
      assert.equal(strip.stt, null);
      assert.equal(strip.live, null);
      assert.equal(strip.fleet.state, 'ok');
      const jobs = await (await get('')).json();
      assert.deepEqual(jobs.jobs.map((j) => j.id), ['ffmpeg-1']);
    } finally { auditorDown = false; }
  });
});

describe('jobs panel service without fleet or auditor', { timeout: 10_000 }, () => {
  it('has only the ffmpeg runs and a null fleet and auditor', async () => {
    const service = createJobsPanelService({ env: {}, getAuditor: () => ({}), listRuns: () => [{ id: 'ffmpeg-9', purpose: 'dsk', apiKey: KEY_A, runner: 'spawn', startedAt: 1 }] });
    const strip = await service.strip({ projectId: KEY_A });
    assert.deepEqual(strip, { enabled: true, fleet: null, local: null, app: { running: 1, queued: 0 }, stt: null, live: null });
    assert.equal((await service.jobs({ projectId: KEY_B })).jobs.length, 0);
  });
});
