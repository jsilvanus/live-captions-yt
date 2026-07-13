/**
 * /crop router tests: config, presets, sets (incl. activate re-apply),
 * position, source map, and the FEATURE_GATE_ENFORCE gate.
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import Database from 'better-sqlite3';
import { runCropMigrations } from '../src/db/crop.js';
import { createCropRouter } from '../src/routes/crop.js';

const KEY = 'routekey';
let db, server, baseUrl, mockCrop, mockRelay;

function makeMockCropManager() {
  return {
    running: new Set(),
    applied: [],
    status: {},
    isRunning(k) { return this.running.has(k); },
    getStatus(k) {
      return this.running.has(k)
        ? { running: true, repositionMode: 'live', xNorm: 0.5, yNorm: 0, activePresetId: this.status.activePresetId ?? null }
        : { running: false, repositionMode: 'live' };
    },
    async start(k) { this.running.add(k); },
    async stop(k) { this.running.delete(k); },
    async applyPosition(k, opts) {
      this.applied.push({ k, ...opts });
      if (opts.activePresetId !== undefined) this.status.activePresetId = opts.activePresetId;
      return { ok: true, mode: 'live', xNorm: opts.xNorm, yNorm: opts.yNorm };
    },
  };
}

before(async () => {
  db = new Database(':memory:');
  runCropMigrations(db);
  db.exec(`CREATE TABLE project_features (api_key TEXT, feature_code TEXT, enabled INTEGER)`);

  mockCrop = makeMockCropManager();
  mockRelay = { isPublishing: () => true };

  const auth = (req, res, next) => { req.session = { apiKey: KEY }; next(); };
  const app = express();
  app.use(express.json());
  app.use('/crop', createCropRouter(db, auth, mockCrop, mockRelay));
  await new Promise(resolve => {
    server = createServer(app).listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(() => new Promise(r => server.close(() => { db.close(); r(); })));

beforeEach(() => {
  mockCrop.running.clear();
  mockCrop.applied.length = 0;
  mockCrop.status = {};
  db.exec('DELETE FROM crop_config; DELETE FROM crop_presets; DELETE FROM crop_preset_sets; DELETE FROM crop_source_map; DELETE FROM project_features;');
});

const j = (method, path, body) => fetch(`${baseUrl}${path}`, {
  method,
  headers: { 'Content-Type': 'application/json' },
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
});

describe('/crop/config', () => {
  test('GET returns defaults + status', async () => {
    const res = await j('GET', '/crop/config');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.enabled, false);
    assert.equal(body.aspectW, 9);
    assert.equal(body.running, false);
    assert.equal(body.repositionMode, 'live');
  });

  test('PUT updates config and starts the renderer when enabling mid-publish', async () => {
    const res = await j('PUT', '/crop/config', { enabled: true, transitionMs: 250 });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.enabled, true);
    assert.equal(body.transitionMs, 250);
    assert.ok(mockCrop.isRunning(KEY), 'renderer started (isPublishing=true)');

    const off = await j('PUT', '/crop/config', { enabled: false });
    assert.equal((await off.json()).enabled, false);
    assert.ok(!mockCrop.isRunning(KEY), 'renderer stopped on disable');
  });

  test('PUT rejects invalid values', async () => {
    assert.equal((await j('PUT', '/crop/config', { aspectW: -1 })).status, 400);
  });
});

describe('/crop/position', () => {
  test('applies a clamped free position when running', async () => {
    mockCrop.running.add(KEY);
    const res = await j('POST', '/crop/position', { xNorm: 0.8, yNorm: 0, transitionMs: 100 });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).mode, 'live');
    assert.equal(mockCrop.applied[0].xNorm, 0.8);
    assert.equal(mockCrop.applied[0].activePresetId, null, 'free move clears the active preset');
  });

  test('409 when the renderer is not running; 400 on bad input', async () => {
    assert.equal((await j('POST', '/crop/position', { xNorm: 0.5, yNorm: 0 })).status, 409);
    mockCrop.running.add(KEY);
    assert.equal((await j('POST', '/crop/position', { xNorm: 'junk' })).status, 400);
  });
});

describe('/crop/presets', () => {
  test('CRUD + activate', async () => {
    const created = await j('POST', '/crop/presets', { name: 'lectern', xNorm: 0.2, yNorm: 0 });
    assert.equal(created.status, 201);
    const { preset } = await created.json();

    const listed = await (await j('GET', '/crop/presets')).json();
    assert.equal(listed.presets.length, 1);

    const updated = await j('PUT', `/crop/presets/${preset.id}`, { xNorm: 0.3 });
    assert.equal((await updated.json()).preset.xNorm, 0.3);

    mockCrop.running.add(KEY);
    const activated = await j('POST', `/crop/presets/${preset.id}/activate`, {});
    assert.equal(activated.status, 200);
    assert.equal((await activated.json()).presetId, preset.id);
    assert.equal(mockCrop.applied[0].xNorm, 0.3);
    assert.equal(mockCrop.applied[0].activePresetId, preset.id);

    assert.equal((await j('DELETE', `/crop/presets/${preset.id}`)).status, 200);
    assert.equal((await j('DELETE', `/crop/presets/${preset.id}`)).status, 404);
  });

  test('activate 409s when the renderer is not running', async () => {
    const { preset } = await (await j('POST', '/crop/presets', { name: 'x' })).json();
    assert.equal((await j('POST', `/crop/presets/${preset.id}/activate`, {})).status, 409);
  });

  test('activate uses the configured default transition when none is given', async () => {
    await j('PUT', '/crop/config', { transitionMs: 400 });
    const { preset } = await (await j('POST', '/crop/presets', { name: 'x' })).json();
    mockCrop.running.add(KEY);
    await j('POST', `/crop/presets/${preset.id}/activate`, {});
    assert.equal(mockCrop.applied.at(-1).transitionMs, 400);
  });
});

describe('/crop/sets', () => {
  test('CRUD + clone + activate re-applies the same-named preset from the new set', async () => {
    const setA = (await (await j('POST', '/crop/sets', { name: 'A' })).json()).set;
    const pA = (await (await j('POST', '/crop/presets', { name: 'stage', xNorm: 0.2, setId: setA.id })).json()).preset;

    // Clone A → B, then move B's "stage" position
    const setB = (await (await j('POST', '/crop/sets', { name: 'B', cloneFromSetId: setA.id })).json()).set;
    const bPresets = (await (await j('GET', `/crop/presets?setId=${setB.id}`)).json()).presets;
    assert.equal(bPresets.length, 1);
    await j('PUT', `/crop/presets/${bPresets[0].id}`, { xNorm: 0.9 });

    // Activate set A and its "stage" preset
    await j('POST', `/crop/sets/${setA.id}/activate`, {});
    mockCrop.running.add(KEY);
    await j('POST', `/crop/presets/${pA.id}/activate`, {});

    // Switching to set B re-applies "stage" from B — live, at B's position
    const res = await j('POST', `/crop/sets/${setB.id}/activate`, {});
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.activeSetId, setB.id);
    assert.equal(body.applied?.xNorm, 0.9);

    assert.equal((await j('DELETE', `/crop/sets/${setB.id}`)).status, 200);
  });

  test('GET lists sets with the active id', async () => {
    const setA = (await (await j('POST', '/crop/sets', { name: 'A' })).json()).set;
    await j('POST', `/crop/sets/${setA.id}/activate`, {});
    const body = await (await j('GET', '/crop/sets')).json();
    assert.equal(body.sets.length, 1);
    assert.equal(body.activeSetId, setA.id);
  });
});

describe('/crop/source-map', () => {
  test('CRUD with validation', async () => {
    const { preset } = await (await j('POST', '/crop/presets', { name: 'p' })).json();
    assert.equal((await j('POST', '/crop/source-map', { mixerInput: 1 })).status, 400);
    const created = await j('POST', '/crop/source-map', { mixerInput: 1, presetId: preset.id });
    assert.equal(created.status, 201);
    const { entry } = await created.json();

    const listed = await (await j('GET', '/crop/source-map')).json();
    assert.equal(listed.entries.length, 1);

    assert.equal((await j('DELETE', `/crop/source-map/${entry.id}`)).status, 200);
    assert.equal((await j('DELETE', `/crop/source-map/${entry.id}`)).status, 404);
  });
});

describe('feature gate', () => {
  test("403 when FEATURE_GATE_ENFORCE=1 and 'crop' is not enabled; passes when granted", async () => {
    const orig = process.env.FEATURE_GATE_ENFORCE;
    process.env.FEATURE_GATE_ENFORCE = '1';
    try {
      const denied = await j('GET', '/crop/config');
      assert.equal(denied.status, 403);
      assert.equal((await denied.json()).feature, 'crop');

      db.prepare("INSERT INTO project_features (api_key, feature_code, enabled) VALUES (?, 'crop', 1)").run(KEY);
      assert.equal((await j('GET', '/crop/config')).status, 200);
    } finally {
      if (orig === undefined) delete process.env.FEATURE_GATE_ENFORCE;
      else process.env.FEATURE_GATE_ENFORCE = orig;
    }
  });
});
