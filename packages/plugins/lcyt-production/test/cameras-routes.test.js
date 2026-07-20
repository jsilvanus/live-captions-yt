/**
 * Route-level tests for the camera thumbnail capture/serve endpoints added to
 * routes/cameras.js: POST /:id/thumbnail/capture, GET /:id/thumbnail(.jpg),
 * DELETE /:id (thumbnail-file cleanup), and the thumbnailUrl field on
 * GET / and GET /:id. First route-level test file for this router.
 */

import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import express from 'express';

import { runMigrations } from '../src/db.js';
import { createCamerasRouter } from '../src/routes/cameras.js';

const realFetch = global.fetch;

let server, baseUrl, db, thumbnailsDir;

function makeRegistryStub(activeSourceByMixer = {}) {
  return {
    reloadCamera: async () => {},
    removeCamera: async () => {},
    getActiveSource: (mixerId) => activeSourceByMixer[mixerId] ?? null,
  };
}

function insertCamera(overrides = {}) {
  const id = overrides.id ?? randomUUID();
  db.prepare(`
    INSERT INTO prod_cameras (id, name, mixer_input, control_type, control_config, sort_order, camera_key, owner_api_key)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    overrides.name ?? 'Cam 1',
    overrides.mixer_input ?? null,
    overrides.control_type ?? 'webcam',
    JSON.stringify(overrides.control_config ?? {}),
    overrides.sort_order ?? 0,
    overrides.camera_key ?? null,
    overrides.owner_api_key ?? null,
  );
  return id;
}

function insertMixer(overrides = {}) {
  const id = overrides.id ?? randomUUID();
  db.prepare(`
    INSERT INTO prod_mixers (id, name, type, connection_config)
    VALUES (?, ?, ?, ?)
  `).run(id, overrides.name ?? 'Mixer 1', overrides.type ?? 'lcyt', JSON.stringify({}));
  return id;
}

// global.fetch is shared with the test's own calls to the local test server —
// only intercept the capture module's internal preview fetch, pass everything else through.
function mockPreview(jpegBytes = 'jpeg-bytes') {
  global.fetch = async (url, init) => {
    if (typeof url === 'string' && url.includes('/production/cameras')) return realFetch(url, init);
    return { ok: true, status: 200, arrayBuffer: async () => Buffer.from(jpegBytes) };
  };
}

function startApp(registry, mediamtxClient = null, opts = {}) {
  const app = express();
  app.use(express.json());
  app.use('/production/cameras', createCamerasRouter(db, registry, null, { cameraThumbnail: { thumbnailsDir }, mediamtxClient, ...opts }));
  return new Promise((resolve) => {
    server = createServer(app);
    server.listen(0, () => { baseUrl = `http://localhost:${server.address().port}`; resolve(); });
  });
}

// Stand-in for scopedAuth('production') — real auth middleware resolves a
// session/user-project/device JWT or lcytmcp_ token down to req.session.apiKey
// (see project-access.js); tests only need that end result, keyed off a
// plain header so each test can act as a different project.
function fakeAuth(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) return res.status(401).json({ error: 'missing api key' });
  req.session = { apiKey };
  next();
}

before(() => {
  db = new Database(':memory:');
  runMigrations(db);
});

after(() => db.close());

afterEach(() => {
  global.fetch = realFetch;
  if (server) { server.close(); server = null; }
});

describe('camera thumbnail routes', () => {
  it('capture on unknown camera id -> 404', async () => {
    thumbnailsDir = fs.mkdtempSync(join(tmpdir(), 'lcyt-cam-thumb-'));
    await startApp(makeRegistryStub());
    const res = await fetch(`${baseUrl}/production/cameras/does-not-exist/thumbnail/capture`, { method: 'POST' });
    assert.equal(res.status, 404);
  });

  it('capture with no camera_key and no apiKey -> 400', async () => {
    thumbnailsDir = fs.mkdtempSync(join(tmpdir(), 'lcyt-cam-thumb-'));
    await startApp(makeRegistryStub());
    const id = insertCamera({ control_type: 'amx', camera_key: null });
    const res = await fetch(`${baseUrl}/production/cameras/${id}/thumbnail/capture`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    assert.equal(res.status, 400);
  });

  it('GET .../thumbnail before any capture -> 404', async () => {
    thumbnailsDir = fs.mkdtempSync(join(tmpdir(), 'lcyt-cam-thumb-'));
    await startApp(makeRegistryStub());
    const id = insertCamera();
    const res = await fetch(`${baseUrl}/production/cameras/${id}/thumbnail`);
    assert.equal(res.status, 404);
  });

  it('capture happy path (webcam camera_key) then GET .../thumbnail serves the JPEG', async () => {
    thumbnailsDir = fs.mkdtempSync(join(tmpdir(), 'lcyt-cam-thumb-'));
    await startApp(makeRegistryStub());
    const id = insertCamera({ camera_key: 'cam-key-1' });

    mockPreview();

    const captureRes = await fetch(`${baseUrl}/production/cameras/${id}/thumbnail/capture`, { method: 'POST' });
    assert.equal(captureRes.status, 200);
    const captureBody = await captureRes.json();
    assert.equal(captureBody.ok, true);
    assert.ok(captureBody.thumbnailCapturedAt);

    const getRes = await fetch(`${baseUrl}/production/cameras/${id}/thumbnail`);
    assert.equal(getRes.status, 200);
    assert.equal(getRes.headers.get('content-type'), 'image/jpeg');
    const bytes = Buffer.from(await getRes.arrayBuffer());
    assert.equal(bytes.toString(), 'jpeg-bytes');
  });

  it('program-feed capture (amx camera) requires the camera to be the active mixer source', async () => {
    thumbnailsDir = fs.mkdtempSync(join(tmpdir(), 'lcyt-cam-thumb-'));
    const mixerId = insertMixer();
    const id = insertCamera({ control_type: 'amx', camera_key: null, mixer_input: 2 });
    await startApp(makeRegistryStub({ [mixerId]: 1 })); // input 1 is live, camera is input 2

    const res = await fetch(`${baseUrl}/production/cameras/${id}/thumbnail/capture`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey: 'proj-key' }),
    });
    assert.equal(res.status, 409);
  });

  it('DELETE /:id removes the thumbnail file from disk', async () => {
    thumbnailsDir = fs.mkdtempSync(join(tmpdir(), 'lcyt-cam-thumb-'));
    await startApp(makeRegistryStub());
    const id = insertCamera({ camera_key: 'cam-key-1' });

    mockPreview();
    const captureRes = await fetch(`${baseUrl}/production/cameras/${id}/thumbnail/capture`, { method: 'POST' });
    assert.equal(captureRes.status, 200);

    const filepath = join(thumbnailsDir, `${id}.jpg`);
    assert.ok(fs.existsSync(filepath));

    const delRes = await fetch(`${baseUrl}/production/cameras/${id}`, { method: 'DELETE' });
    assert.equal(delRes.status, 204);
    assert.equal(fs.existsSync(filepath), false);
  });

  it('GET / shows thumbnailUrl: null before capture and a URL after', async () => {
    thumbnailsDir = fs.mkdtempSync(join(tmpdir(), 'lcyt-cam-thumb-'));
    await startApp(makeRegistryStub());
    const id = insertCamera({ camera_key: 'cam-key-1' });

    const beforeRes = await fetch(`${baseUrl}/production/cameras`);
    const beforeList = await beforeRes.json();
    const beforeCam = beforeList.find(c => c.id === id);
    assert.equal(beforeCam.thumbnailUrl, null);

    mockPreview();
    await fetch(`${baseUrl}/production/cameras/${id}/thumbnail/capture`, { method: 'POST' });

    const afterRes = await fetch(`${baseUrl}/production/cameras`);
    const afterList = await afterRes.json();
    const afterCam = afterList.find(c => c.id === id);
    assert.equal(afterCam.thumbnailUrl, `${baseUrl}/production/cameras/${id}/thumbnail`);
  });

  it('GET / and GET /:id show live: null with no mediamtxClient configured', async () => {
    thumbnailsDir = fs.mkdtempSync(join(tmpdir(), 'lcyt-cam-thumb-'));
    await startApp(makeRegistryStub());
    const id = insertCamera({ camera_key: 'cam-key-2' });

    const listRes = await fetch(`${baseUrl}/production/cameras`);
    const list = await listRes.json();
    assert.equal(list.find(c => c.id === id).live, null);

    const oneRes = await fetch(`${baseUrl}/production/cameras/${id}`);
    assert.equal((await oneRes.json()).live, null);
  });

  it("GET / and GET /:id reflect live status for camera_key-bearing cameras (plan_ingest_feeds.md §2b)", async () => {
    thumbnailsDir = fs.mkdtempSync(join(tmpdir(), 'lcyt-cam-thumb-'));
    const mtx = { isPathPublishing: async (key) => key === 'live-cam' };
    await startApp(makeRegistryStub(), mtx);
    const liveId = insertCamera({ camera_key: 'live-cam', control_type: 'rtmp' });
    const offlineId = insertCamera({ camera_key: 'offline-cam', control_type: 'rtmp' });
    const noKeyId = insertCamera({ camera_key: null, control_type: 'none' });

    const list = await (await fetch(`${baseUrl}/production/cameras`)).json();
    assert.equal(list.find(c => c.id === liveId).live, true);
    assert.equal(list.find(c => c.id === offlineId).live, false);
    assert.equal(list.find(c => c.id === noKeyId).live, null);

    const one = await (await fetch(`${baseUrl}/production/cameras/${liveId}`)).json();
    assert.equal(one.live, true);
  });
});

describe('camera CRUD auth + ownership (code-review follow-up: cross-tenant sourceCameraId)', () => {
  it('with no auth configured, an unowned camera is fully visible/editable (legacy behavior preserved)', async () => {
    thumbnailsDir = fs.mkdtempSync(join(tmpdir(), 'lcyt-cam-thumb-'));
    await startApp(makeRegistryStub());
    const id = insertCamera();
    const res = await fetch(`${baseUrl}/production/cameras/${id}`);
    assert.equal(res.status, 200);
  });

  it('with auth configured, CRUD routes require it (401 without credentials)', async () => {
    thumbnailsDir = fs.mkdtempSync(join(tmpdir(), 'lcyt-cam-thumb-'));
    await startApp(makeRegistryStub(), null, { auth: fakeAuth });
    const res = await fetch(`${baseUrl}/production/cameras`);
    assert.equal(res.status, 401);
  });

  it('owner can read/update/delete their own camera', async () => {
    thumbnailsDir = fs.mkdtempSync(join(tmpdir(), 'lcyt-cam-thumb-'));
    await startApp(makeRegistryStub(), null, { auth: fakeAuth });
    const id = insertCamera({ owner_api_key: 'proj-a' });

    const getRes = await fetch(`${baseUrl}/production/cameras/${id}`, { headers: { 'x-api-key': 'proj-a' } });
    assert.equal(getRes.status, 200);

    const putRes = await fetch(`${baseUrl}/production/cameras/${id}`, {
      method: 'PUT', headers: { 'x-api-key': 'proj-a', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Renamed' }),
    });
    assert.equal(putRes.status, 200);
  });

  it("a different project cannot read, update, or delete another project's owned camera (404, not leaked)", async () => {
    thumbnailsDir = fs.mkdtempSync(join(tmpdir(), 'lcyt-cam-thumb-'));
    await startApp(makeRegistryStub(), null, { auth: fakeAuth });
    const id = insertCamera({ owner_api_key: 'proj-a' });

    const getRes = await fetch(`${baseUrl}/production/cameras/${id}`, { headers: { 'x-api-key': 'proj-b' } });
    assert.equal(getRes.status, 404);

    const putRes = await fetch(`${baseUrl}/production/cameras/${id}`, {
      method: 'PUT', headers: { 'x-api-key': 'proj-b', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Hijacked' }),
    });
    assert.equal(putRes.status, 404);

    const delRes = await fetch(`${baseUrl}/production/cameras/${id}`, { method: 'DELETE', headers: { 'x-api-key': 'proj-b' } });
    assert.equal(delRes.status, 404);
  });

  it("GET / filters out other projects' owned cameras but keeps unowned (legacy) ones visible", async () => {
    thumbnailsDir = fs.mkdtempSync(join(tmpdir(), 'lcyt-cam-thumb-'));
    await startApp(makeRegistryStub(), null, { auth: fakeAuth });
    const ownedId = insertCamera({ owner_api_key: 'proj-a', name: 'Owned by A' });
    const otherOwnedId = insertCamera({ owner_api_key: 'proj-b', name: 'Owned by B' });
    const legacyId = insertCamera({ owner_api_key: null, name: 'Legacy unowned' });

    const list = await (await fetch(`${baseUrl}/production/cameras`, { headers: { 'x-api-key': 'proj-a' } })).json();
    const ids = list.map((c) => c.id);
    assert.ok(ids.includes(ownedId));
    assert.ok(ids.includes(legacyId));
    assert.ok(!ids.includes(otherOwnedId));
  });

  it('POST / stamps the creating project as owner_api_key', async () => {
    thumbnailsDir = fs.mkdtempSync(join(tmpdir(), 'lcyt-cam-thumb-'));
    await startApp(makeRegistryStub(), null, { auth: fakeAuth });
    const res = await fetch(`${baseUrl}/production/cameras`, {
      method: 'POST', headers: { 'x-api-key': 'proj-a', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Cam' }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.isOwned, true);
    assert.equal(body.owner_api_key, undefined, 'owner_api_key must never be serialized back to the client');

    const row = db.prepare('SELECT owner_api_key FROM prod_cameras WHERE id = ?').get(body.id);
    assert.equal(row.owner_api_key, 'proj-a');
  });

  it('WHIP routes remain unauthenticated even when auth is configured', async () => {
    thumbnailsDir = fs.mkdtempSync(join(tmpdir(), 'lcyt-cam-thumb-'));
    await startApp(makeRegistryStub(), null, { auth: fakeAuth });
    const id = insertCamera({ owner_api_key: 'proj-a', control_type: 'webcam', camera_key: 'cam-key-whip' });
    // No x-api-key header at all — a real kiosk page sends none of these routes any auth.
    const res = await fetch(`${baseUrl}/production/cameras/${id}/whip-url`);
    assert.notEqual(res.status, 401);
  });

  it('thumbnail-serving routes remain unauthenticated even when auth is configured', async () => {
    thumbnailsDir = fs.mkdtempSync(join(tmpdir(), 'lcyt-cam-thumb-'));
    await startApp(makeRegistryStub(), null, { auth: fakeAuth });
    const id = insertCamera({ owner_api_key: 'proj-a', camera_key: 'cam-key-thumb' });
    const res = await fetch(`${baseUrl}/production/cameras/${id}/thumbnail`);
    assert.notEqual(res.status, 401);
  });
});

// ---------------------------------------------------------------------------
// PTZ preset trigger → registry.notifyCameraPresetRecalled (plan_vertical_crop.md §4)
// ---------------------------------------------------------------------------

describe('POST /:id/preset/:presetId — production-follow notification', () => {
  function makePresetRegistryStub() {
    const notified = [];
    return {
      notified,
      reloadCamera: async () => {},
      removeCamera: async () => {},
      getActiveSource: () => null,
      callPreset: async () => {},
      notifyCameraPresetRecalled(data) { notified.push(data); },
    };
  }

  it('direct (non-bridge) recall notifies with the array index (AMX presets have no presetNumber), not the raw preset id', async () => {
    // cameraPresetSources() (lcyt-web's crop editor) binds crop_source_map
    // by presetNumber-or-array-index, never by the preset's `.id` — the
    // notification must use the same key or production-follow can never
    // match a row bound through the real UI.
    thumbnailsDir = fs.mkdtempSync(join(tmpdir(), 'lcyt-cam-thumb-'));
    const registry = makePresetRegistryStub();
    await startApp(registry, null, { auth: fakeAuth });
    const id = insertCamera({ control_type: 'amx', control_config: { presets: [{ id: 'wide', name: 'Wide', command: 'X' }] } });

    const res = await fetch(`${baseUrl}/production/cameras/${id}/preset/wide`, {
      method: 'POST', headers: { 'x-api-key': 'proj-a' },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(registry.notified, [{ apiKey: 'proj-a', cameraId: id, preset: 0 }]);
  });

  it('direct recall of a VISCA preset notifies with presetNumber, not array index or the raw preset id', async () => {
    thumbnailsDir = fs.mkdtempSync(join(tmpdir(), 'lcyt-cam-thumb-'));
    const registry = makePresetRegistryStub();
    await startApp(registry, null, { auth: fakeAuth });
    const id = insertCamera({
      control_type: 'visca-ip',
      control_config: { presets: [
        { id: 'home', name: 'Home', presetNumber: 0 },
        { id: 'far', name: 'Far', presetNumber: 7 },
      ] },
    });

    const res = await fetch(`${baseUrl}/production/cameras/${id}/preset/far`, {
      method: 'POST', headers: { 'x-api-key': 'proj-a' },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(registry.notified, [{ apiKey: 'proj-a', cameraId: id, preset: 7 }]);
  });

  it('bridge-relayed recall also notifies, after the bridge command succeeds', async () => {
    thumbnailsDir = fs.mkdtempSync(join(tmpdir(), 'lcyt-cam-thumb-'));
    db.prepare(`INSERT OR IGNORE INTO prod_bridge_instances (id, name, token) VALUES (?, ?, ?)`)
      .run('bridge-1', 'Bridge 1', 'tok-bridge-1');
    const registry = makePresetRegistryStub();
    const bridgeManager = {
      isConnected: () => true,
      sendCommand: async () => ({ ok: true }),
    };
    const app = express();
    app.use(express.json());
    app.use('/production/cameras', createCamerasRouter(
      db, registry, bridgeManager, { cameraThumbnail: { thumbnailsDir }, auth: fakeAuth },
    ));
    await new Promise((resolve) => {
      server = createServer(app);
      server.listen(0, () => { baseUrl = `http://localhost:${server.address().port}`; resolve(); });
    });
    const id = insertCamera({
      control_type: 'amx',
      control_config: { host: 'h', port: 1, presets: [{ id: 'wide', name: 'Wide', command: 'X' }] },
    });
    // insertCamera()'s column list doesn't cover bridge_instance_id — set it
    // directly so the route takes the bridge-relay branch.
    db.prepare('UPDATE prod_cameras SET bridge_instance_id = ? WHERE id = ?').run('bridge-1', id);

    const res = await fetch(`${baseUrl}/production/cameras/${id}/preset/wide`, {
      method: 'POST', headers: { 'x-api-key': 'proj-b' },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(registry.notified, [{ apiKey: 'proj-b', cameraId: id, preset: 0 }]);
  });

  it('no notification when the preset trigger fails (unknown camera)', async () => {
    thumbnailsDir = fs.mkdtempSync(join(tmpdir(), 'lcyt-cam-thumb-'));
    const registry = makePresetRegistryStub();
    await startApp(registry, null, { auth: fakeAuth });

    const res = await fetch(`${baseUrl}/production/cameras/does-not-exist/preset/wide`, {
      method: 'POST', headers: { 'x-api-key': 'proj-a' },
    });
    assert.equal(res.status, 404);
    assert.deepEqual(registry.notified, []);
  });

  it('apiKey is null when auth is not configured (historical open behavior)', async () => {
    thumbnailsDir = fs.mkdtempSync(join(tmpdir(), 'lcyt-cam-thumb-'));
    const registry = makePresetRegistryStub();
    await startApp(registry); // no auth opt
    const id = insertCamera({ control_type: 'amx', control_config: { presets: [{ id: 'wide', name: 'Wide', command: 'X' }] } });

    const res = await fetch(`${baseUrl}/production/cameras/${id}/preset/wide`, { method: 'POST' });
    assert.equal(res.status, 200);
    assert.deepEqual(registry.notified, [{ apiKey: null, cameraId: id, preset: 0 }]);
  });
});
