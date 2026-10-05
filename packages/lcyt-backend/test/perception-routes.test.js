/**
 * Route-level tests for POST /production/perception/ingest and the
 * /production/perception/shared/* routes (plan_video_perception.md Phase 2/3).
 */

import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import { createPerceptionRouter } from '../src/routes/perception.js';
import { mintIngestToken, verifyIngestToken } from 'lcyt-compute/perception/ingest-token';

let server, baseUrl;

function fakeAuth(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) return res.status(401).json({ error: 'missing api key' });
  req.session = { apiKey };
  next();
}

function startApp(aggregator, resolver, opts) {
  const app = express();
  app.use(express.json());
  app.use('/production/perception', createPerceptionRouter(aggregator, resolver, opts));
  return new Promise((resolve) => {
    server = createServer(app);
    server.listen(0, () => { baseUrl = `http://localhost:${server.address().port}`; resolve(); });
  });
}

after(() => {});
afterEach(() => { if (server) { server.close(); server = null; } });

describe('POST /production/perception/ingest', () => {
  it('400s without apiKey or cameraId', async () => {
    await startApp({ ingest: () => {} });
    const res = await fetch(`${baseUrl}/production/perception/ingest`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
  });

  it('calls aggregator.ingest with the request body and returns ok', async () => {
    const calls = [];
    await startApp({ ingest: (apiKey, detection) => calls.push({ apiKey, detection }) });
    const res = await fetch(`${baseUrl}/production/perception/ingest`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: 'key1', cameraId: 'cam-1', ts: 5, objects: [], visible: true }),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].apiKey, 'key1');
    assert.equal(calls[0].detection.cameraId, 'cam-1');
  });

  it('passes capturedAt, boxes with track ids and the framing notes through to the aggregator', async () => {
    const calls = [];
    await startApp({ ingest: (apiKey, detection) => calls.push(detection) });
    const objects = [{ id: 't1', trackId: 't1', label: 'person', confidence: 0.9, bbox: { x: 0.1, y: 0.2, w: 0.3, h: 0.6 } }];
    const res = await fetch(`${baseUrl}/production/perception/ingest`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: 'key1', cameraId: 'cam-1', ts: 5, seq: 3, capturedAt: 4, latencyMs: 1, objects, framing: { score: 0.7, notes: 'subject small in frame' }, visible: true }),
    });
    assert.equal(res.status, 200);
    assert.equal(calls[0].capturedAt, 4);
    assert.deepEqual(calls[0].objects, objects);
    assert.deepEqual(calls[0].framing, { score: 0.7, notes: 'subject small in frame' });
  });

  it('401s without X-Internal-Auth when an internalToken is configured', async () => {
    await startApp({ ingest: () => {} }, null, { internalToken: 'secret' });
    let res = await fetch(`${baseUrl}/production/perception/ingest`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: 'key1', cameraId: 'cam-1' }),
    });
    assert.equal(res.status, 401);

    res = await fetch(`${baseUrl}/production/perception/ingest`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Internal-Auth': 'wrong' },
      body: JSON.stringify({ apiKey: 'key1', cameraId: 'cam-1' }),
    });
    assert.equal(res.status, 401);

    res = await fetch(`${baseUrl}/production/perception/ingest`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Internal-Auth': 'secret' },
      body: JSON.stringify({ apiKey: 'key1', cameraId: 'cam-1' }),
    });
    assert.equal(res.status, 200);
  });

  it('re-tags a shared-feed detection (feedKind: shared) via the resolver before ingesting', async () => {
    const ingestCalls = [];
    const resolver = { tagSharedDetection: (apiKey, detection) => ({ ...detection, cameraId: 'resolved-cam' }) };
    await startApp({ ingest: (apiKey, detection) => ingestCalls.push({ apiKey, detection }) }, resolver);

    const res = await fetch(`${baseUrl}/production/perception/ingest`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: 'key1', cameraId: null, feedKind: 'shared', ts: 1, objects: [] }),
    });
    assert.equal(res.status, 200);
    assert.equal(ingestCalls.length, 1);
    assert.equal(ingestCalls[0].detection.cameraId, 'resolved-cam');
  });

  it('drops a shared-feed detection (no aggregator.ingest call) when the resolver has no active camera yet', async () => {
    const ingestCalls = [];
    const resolver = { tagSharedDetection: () => null };
    await startApp({ ingest: (apiKey, detection) => ingestCalls.push({ apiKey, detection }) }, resolver);

    const res = await fetch(`${baseUrl}/production/perception/ingest`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: 'key1', cameraId: null, feedKind: 'shared', ts: 1, objects: [] }),
    });
    assert.equal(res.status, 200);
    assert.equal(ingestCalls.length, 0);
  });

  it('400s a non-shared detection with no cameraId', async () => {
    await startApp({ ingest: () => {} });
    const res = await fetch(`${baseUrl}/production/perception/ingest`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: 'key1', ts: 1, objects: [] }),
    });
    assert.equal(res.status, 400);
  });
});

describe('POST /production/perception/shared/start|stop, GET /shared/status', () => {
  it('503s all three when no perceptionManager is configured', async () => {
    await startApp({ ingest: () => {} }, null, { auth: fakeAuth });
    for (const [method, path] of [
      ['POST', '/shared/start'], ['POST', '/shared/stop'], ['GET', '/shared/status'],
    ]) {
      const res = await fetch(`${baseUrl}/production/perception${path}`, { method, headers: { 'x-api-key': 'key1' } });
      assert.equal(res.status, 503);
    }
  });

  it('401s without auth credentials when opts.auth is configured', async () => {
    await startApp({ ingest: () => {} }, null, { auth: fakeAuth, perceptionManager: { startSharedFeed: async () => ({ jobId: 'x' }) } });
    const res = await fetch(`${baseUrl}/production/perception/shared/start`, { method: 'POST' });
    assert.equal(res.status, 401);
  });

  it('start/stop/status delegate to the manager with the session apiKey', async () => {
    const calls = [];
    const perceptionManager = {
      startSharedFeed: async (apiKey, opts) => { calls.push(['start', apiKey, opts]); return { jobId: 'shared-job-1' }; },
      stopSharedFeed: async (apiKey) => { calls.push(['stop', apiKey]); return true; },
      sharedFeedStatus: (apiKey) => { calls.push(['status', apiKey]); return { jobId: 'shared-job-1' }; },
    };
    await startApp({ ingest: () => {} }, null, { auth: fakeAuth, perceptionManager });

    let res = await fetch(`${baseUrl}/production/perception/shared/start`, {
      method: 'POST', headers: { 'x-api-key': 'key1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ emitIntervalMs: 400 }),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, jobId: 'shared-job-1' });

    res = await fetch(`${baseUrl}/production/perception/shared/status`, { headers: { 'x-api-key': 'key1' } });
    assert.equal(res.status, 200);

    res = await fetch(`${baseUrl}/production/perception/shared/stop`, { method: 'POST', headers: { 'x-api-key': 'key1' } });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, stopped: true });

    assert.equal(calls[0][0], 'start');
    assert.equal(calls[0][1], 'key1');
    assert.equal(calls[0][2].emitIntervalMs, 400);
  });
});

describe('POST /production/perception/ingest — per-job tokens', () => {
  const secret = 's3cret';
  const scope = { apiKey: 'k1', cameraId: 'cam-1', feedKind: 'dedicated', jobId: 'perception-cam1-abc' };
  const manager = { verifyIngest: (s, token) => verifyIngestToken(secret, s, token) };
  const post = (body, token) => fetch(`${baseUrl}/production/perception/ingest`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Internal-Auth': token } : {}) }, body: JSON.stringify(body),
  });
  const body = { apiKey: 'k1', cameraId: 'cam-1', feedKind: 'dedicated', jobId: scope.jobId, objects: [] };

  it('accepts the token minted for exactly this job', async () => {
    const calls = [];
    await startApp({ ingest: (...a) => calls.push(a) }, null, { perceptionManager: manager, jobTokensEnabled: true });
    assert.equal((await post(body, mintIngestToken(secret, scope))).status, 200);
    assert.equal(calls.length, 1);
  });

  it('rejects a missing token, a token for another camera or project, and a token from another secret', async () => {
    await startApp({ ingest: () => assert.fail('must not ingest') }, null, { perceptionManager: manager, jobTokensEnabled: true });
    assert.equal((await post(body)).status, 401);
    assert.equal((await post({ ...body, cameraId: 'cam-2' }, mintIngestToken(secret, scope))).status, 401);
    assert.equal((await post({ ...body, apiKey: 'other' }, mintIngestToken(secret, scope))).status, 401);
    assert.equal((await post(body, mintIngestToken('other-secret', scope))).status, 401);
  });

  it('still accepts the shared internal token', async () => {
    const calls = [];
    await startApp({ ingest: (...a) => calls.push(a) }, null, { perceptionManager: manager, jobTokensEnabled: true, internalToken: 'shared' });
    assert.equal((await post(body, 'shared')).status, 200);
  });

  it('a shared-feed job (cameraId null) validates against its own scope', async () => {
    const calls = [];
    const sharedScope = { apiKey: 'k1', cameraId: null, feedKind: 'shared', jobId: 'j-shared' };
    const resolver = { tagSharedDetection: (k, d) => ({ ...d, cameraId: 'choir' }) };
    await startApp({ ingest: (...a) => calls.push(a) }, resolver, { perceptionManager: manager, jobTokensEnabled: true });
    const res = await post({ apiKey: 'k1', feedKind: 'shared', jobId: 'j-shared', objects: [] }, mintIngestToken(secret, sharedScope));
    assert.equal(res.status, 200);
    assert.equal(calls[0][1].cameraId, 'choir');
  });
});
