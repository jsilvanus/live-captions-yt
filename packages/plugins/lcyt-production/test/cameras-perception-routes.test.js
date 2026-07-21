/**
 * Route-level tests for the /production/cameras/:id/perception/* routes
 * (plan_video_perception.md Phase 2): dispatch delegates to an injected
 * perceptionManager (unit-tested separately in perception-manager.test.js),
 * so these focus on 503-when-unconfigured, camera lookup/ownership, and
 * that the route wires request data through to the manager correctly.
 */

import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import express from 'express';

import { runMigrations } from '../src/db.js';
import { createCamerasRouter } from '../src/routes/cameras.js';

let server, baseUrl, db;

function insertCamera(overrides = {}) {
  const id = overrides.id ?? randomUUID();
  db.prepare(`
    INSERT INTO prod_cameras (id, name, mixer_input, control_type, control_config, sort_order, camera_key, owner_api_key)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, overrides.name ?? 'Cam 1', overrides.mixer_input ?? null, overrides.control_type ?? 'webcam',
    JSON.stringify(overrides.control_config ?? {}), overrides.sort_order ?? 0,
    overrides.camera_key ?? 'feed-abc', overrides.owner_api_key ?? null,
  );
  return id;
}

function fakeAuth(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) return res.status(401).json({ error: 'missing api key' });
  req.session = { apiKey };
  next();
}

function makeRegistryStub() {
  return { reloadCamera: async () => {}, removeCamera: async () => {} };
}

function startApp(perceptionManager) {
  const app = express();
  app.use(express.json());
  app.use('/production/cameras', createCamerasRouter(db, makeRegistryStub(), null, { auth: fakeAuth, perceptionManager }));
  return new Promise((resolve) => {
    server = createServer(app);
    server.listen(0, () => { baseUrl = `http://localhost:${server.address().port}`; resolve(); });
  });
}

before(() => {
  db = new Database(':memory:');
  runMigrations(db);
});

after(() => db.close());
afterEach(() => { if (server) { server.close(); server = null; } });

describe('camera perception routes', () => {
  it('503s all three routes when no perceptionManager is configured', async () => {
    await startApp(null);
    const id = insertCamera();
    for (const [method, path] of [
      ['POST', `/production/cameras/${id}/perception/start`],
      ['POST', `/production/cameras/${id}/perception/stop`],
      ['GET', `/production/cameras/${id}/perception/status`],
    ]) {
      const res = await fetch(`${baseUrl}${path}`, { method, headers: { 'x-api-key': 'key1' } });
      assert.equal(res.status, 503);
    }
  });

  it('start() 404s for an unknown camera', async () => {
    await startApp({ start: async () => ({ jobId: 'x' }) });
    const res = await fetch(`${baseUrl}/production/cameras/does-not-exist/perception/start`, {
      method: 'POST', headers: { 'x-api-key': 'key1' },
    });
    assert.equal(res.status, 404);
  });

  it("start() 404s when the camera is owned by a different project", async () => {
    await startApp({ start: async () => ({ jobId: 'x' }) });
    const id = insertCamera({ owner_api_key: 'other-project' });
    const res = await fetch(`${baseUrl}/production/cameras/${id}/perception/start`, {
      method: 'POST', headers: { 'x-api-key': 'key1' },
    });
    assert.equal(res.status, 404);
  });

  it('start() calls manager.start(apiKey, camera, opts) and returns its jobId', async () => {
    const calls = [];
    await startApp({
      start: async (apiKey, camera, opts) => { calls.push({ apiKey, camera, opts }); return { jobId: 'job-123' }; },
    });
    const id = insertCamera();
    const res = await fetch(`${baseUrl}/production/cameras/${id}/perception/start`, {
      method: 'POST', headers: { 'x-api-key': 'key1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ emitIntervalMs: 250 }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.jobId, 'job-123');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].apiKey, 'key1');
    assert.equal(calls[0].camera.id, id);
    assert.equal(calls[0].camera.cameraKey, 'feed-abc');
    assert.equal(calls[0].opts.emitIntervalMs, 250);
  });

  it('start() maps a NOT_CONFIGURED manager error to 503', async () => {
    const id = insertCamera();
    await startApp({ start: async () => { const e = new Error('nope'); e.code = 'NOT_CONFIGURED'; throw e; } });
    const res = await fetch(`${baseUrl}/production/cameras/${id}/perception/start`, { method: 'POST', headers: { 'x-api-key': 'key1' } });
    assert.equal(res.status, 503);
  });

  it('start() maps a NO_FEED manager error to 400', async () => {
    const id = insertCamera();
    await startApp({ start: async () => { const e = new Error('nope'); e.code = 'NO_FEED'; throw e; } });
    const res = await fetch(`${baseUrl}/production/cameras/${id}/perception/start`, { method: 'POST', headers: { 'x-api-key': 'key1' } });
    assert.equal(res.status, 400);
  });

  it('stop() and status() delegate to the manager', async () => {
    const calls = [];
    await startApp({
      stop: async (cameraId) => { calls.push(['stop', cameraId]); return true; },
      status: (cameraId) => { calls.push(['status', cameraId]); return { jobId: 'job-123' }; },
    });
    const id = insertCamera();

    let res = await fetch(`${baseUrl}/production/cameras/${id}/perception/stop`, { method: 'POST', headers: { 'x-api-key': 'key1' } });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, stopped: true });

    res = await fetch(`${baseUrl}/production/cameras/${id}/perception/status`, { headers: { 'x-api-key': 'key1' } });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, status: { jobId: 'job-123' } });

    assert.deepEqual(calls, [['stop', id], ['status', id]]);
  });
});
