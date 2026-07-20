/**
 * CropManager lifecycle tests (no real ffmpeg): FFMPEG_RUNNER=worker against a
 * mock daemon, injected resolution probe. Covers start/stop, status shape,
 * restart-mode repositioning (position survives the swap, no state wipe from
 * the old runner's close event), and crop-slot fan-out registration in
 * RtmpRelayManager.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import Database from 'better-sqlite3';
import { CropManager } from '../src/crop-manager.js';
import { RtmpRelayManager } from '../src/rtmp-manager.js';
import { runCropMigrations, createCropPreset, createCropSourceMapEntry, setCropConfig } from '../src/db/crop.js';

let server;
const savedEnv = {};
const jobs = [];

before(async () => {
  await new Promise(resolve => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', d => { body += d; });
      req.on('end', () => {
        if (req.method === 'POST') jobs.push(JSON.parse(body || '{}'));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jobId: `j-${Math.random()}`, ok: true }));
      });
    }).listen(0, '127.0.0.1', resolve);
  });
  for (const k of ['FFMPEG_RUNNER', 'WORKER_DAEMON_URL', 'COMPUTE_ORCHESTRATOR_URL', 'MEDIAMTX_API_URL']) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  process.env.FFMPEG_RUNNER = 'worker';
  process.env.WORKER_DAEMON_URL = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise(resolve => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  server.close(resolve);
}));

const CONFIG = {
  enabled: true, aspectW: 9, aspectH: 16, outW: 1080, outH: 1920,
  videoBitrate: null, followProgram: true, transitionMs: 0, activeSetId: null,
};

function makeManager() {
  return new CropManager({
    // No hasZmq → restart repositioning mode; no zmq socket involved.
    ffmpegCaps: { available: true, hasZmq: false },
    probeResolution: async () => ({ inW: 1920, inH: 1080 }),
  });
}

describe('CropManager', () => {
  test('start → status → stop lifecycle', async () => {
    const mgr = makeManager();
    await mgr.start('key1', CONFIG);

    assert.ok(mgr.isRunning('key1'));
    const st = mgr.getStatus('key1');
    assert.equal(st.running, true);
    assert.equal(st.repositionMode, 'restart');
    assert.equal(st.cropW, 608);
    assert.equal(st.cropH, 1080);
    assert.equal(st.xNorm, 0.5);

    await mgr.stop('key1');
    await new Promise(r => setTimeout(r, 50));
    assert.ok(!mgr.isRunning('key1'));
    assert.equal(mgr.getStatus('key1').running, false);
  });

  test('ffmpeg args crop at incoming quality and push the bare {key}-crop path', async () => {
    jobs.length = 0;
    const mgr = makeManager();
    await mgr.start('key2', CONFIG);

    const plan = jobs[0];
    const filter = plan.args[plan.args.indexOf('-filter_complex') + 1];
    assert.match(filter, /crop@vcrop=608:1080:\d+:\d+/);
    assert.match(filter, /scale=1080:1920/);
    const out = plan.args[plan.args.length - 1];
    assert.ok(out.endsWith('/key2-crop'), `push URL must be the bare path: ${out}`);
    assert.ok(!out.includes('/stream/'), 'no RTMP app prefix');

    await mgr.stop('key2');
  });

  test('restart-mode applyPosition swaps the renderer at the new position', async () => {
    jobs.length = 0;
    const mgr = makeManager();
    await mgr.start('key3', CONFIG, { position: { xNorm: 0, yNorm: 0 } });
    assert.equal(mgr.getStatus('key3').xNorm, 0);

    const result = await mgr.applyPosition('key3', { xNorm: 1, yNorm: 0 });
    assert.equal(result.mode, 'restart');
    assert.equal(result.xNorm, 1);

    // Old runner's async close event must not wipe the new session.
    await new Promise(r => setTimeout(r, 150));
    assert.ok(mgr.isRunning('key3'), 'restarted renderer stays registered');
    assert.equal(mgr.getStatus('key3').xNorm, 1);

    // Second spawn used the new x offset (maxX = 1920-608 = 1312)
    const filters = jobs.map(j => j.args[j.args.indexOf('-filter_complex') + 1]);
    assert.match(filters[0], /crop@vcrop=608:1080:0:0/);
    assert.match(filters[1], /crop@vcrop=608:1080:1312:0/);

    await mgr.stop('key3');
  });

  test('position carries across restarts when not overridden', async () => {
    const mgr = makeManager();
    await mgr.start('key4', CONFIG, { position: { xNorm: 0.25, yNorm: 0 } });
    await mgr.start('key4', CONFIG); // restart without explicit position
    assert.equal(mgr.getStatus('key4').xNorm, 0.25);
    await mgr.stop('key4');
  });

  test('probe failure falls back to 1080p geometry', async () => {
    const mgr = new CropManager({
      ffmpegCaps: { available: true, hasZmq: false },
      probeResolution: async () => null,
    });
    await mgr.start('key5', CONFIG);
    const st = mgr.getStatus('key5');
    assert.equal(st.inW, 1920);
    assert.equal(st.inH, 1080);
    await mgr.stop('key5');
  });

  test('applyPosition throws when not running', async () => {
    const mgr = makeManager();
    await assert.rejects(() => mgr.applyPosition('nope', { xNorm: 0.5, yNorm: 0 }), /not running/);
  });

  test('fails fast when ffmpeg lacks libx264', async () => {
    const mgr = new CropManager({
      ffmpegCaps: { available: true, hasLibx264: false, hasZmq: false },
      probeResolution: async () => ({ inW: 1920, inH: 1080 }),
    });
    await assert.rejects(() => mgr.start('nox264', CONFIG), /libx264/);
    assert.ok(!mgr.isRunning('nox264'));
  });

  test('hasZmq without the zeromq module: no zmq filter in the graph, restart mode reported', async () => {
    // The optional `zeromq` package is not installed in this repo, so the
    // lazy import fails — the filter must NOT bind a dead port.
    jobs.length = 0;
    const mgr = new CropManager({
      ffmpegCaps: { available: true, hasZmq: true },
      probeResolution: async () => ({ inW: 1920, inH: 1080 }),
    });
    await mgr.start('zmqless', CONFIG);

    const filter = jobs[0].args[jobs[0].args.indexOf('-filter_complex') + 1];
    assert.ok(!filter.includes('zmq'), `no zmq filter without the client module: ${filter}`);
    assert.equal(mgr.getStatus('zmqless').repositionMode, 'restart');
    assert.equal(mgr.repositionMode(), 'restart', 'manager-level mode downgrades once the import has settled');

    await mgr.stop('zmqless');
  });
});

describe('RtmpRelayManager — crop-view slots', () => {
  function makeFakeMtx() {
    const calls = [];
    return {
      calls,
      async addPath(name, cfg)   { calls.push(['add', name, cfg]); },
      async patchPath(name, cfg) { calls.push(['patch', name, cfg]); },
      async deletePath(name)     { calls.push(['delete', name]); },
      async kickPath(name)       { calls.push(['kick', name]); },
    };
  }

  test('crop slots register a fan-out on {key}-crop; program slots on the raw path', async () => {
    const mtx = makeFakeMtx();
    const mgr = new RtmpRelayManager({
      mediamtxClient: mtx,
      ffmpegCaps: { available: true, hasLibx264: false, hasEia608: false, hasSubrip: false },
    });

    await mgr.start('mixkey', [
      { slot: 1, targetUrl: 'rtmp://a.example/live', targetName: 'main', sourceView: 'program' },
      { slot: 2, targetUrl: 'rtmp://b.example/live', targetName: 'vertical', sourceView: 'crop' },
    ]);

    const adds = mtx.calls.filter(c => c[0] === 'add');
    const cropAdd = adds.find(c => c[1] === 'mixkey-crop');
    const rawAdd  = adds.find(c => c[1] === 'mixkey');
    assert.ok(cropAdd, 'crop fan-out registered on mixkey-crop');
    assert.ok(rawAdd, 'program fan-out registered on the raw path');
    assert.match(cropAdd[2].runOnPublish, /mixkey-crop/);
    assert.match(cropAdd[2].runOnPublish, /b\.example\/live\/vertical/);
    assert.ok(!cropAdd[2].runOnPublish.includes('a.example'), 'program target not in crop fan-out');

    assert.deepEqual(mgr.runningSlots('mixkey'), [1, 2]);
    assert.ok(mgr.isSlotRunning('mixkey', 2));

    await mgr.stop('mixkey');
    assert.ok(!mgr.isRunning('mixkey'));
    const deletes = mtx.calls.filter(c => c[0] === 'delete').map(c => c[1]);
    assert.ok(deletes.includes('mixkey-crop'));
    assert.ok(deletes.includes('mixkey'));
  });

  test('crop-only slot set works without any program slots', async () => {
    const mtx = makeFakeMtx();
    const ended = [];
    const mgr = new RtmpRelayManager({
      mediamtxClient: mtx,
      ffmpegCaps: { available: true },
      onStreamEnded: (apiKey, slot) => ended.push(slot),
    });

    await mgr.start('croponly', [
      { slot: 1, targetUrl: 'rtmp://v.example/live', targetName: 'tiktok', sourceView: 'crop' },
    ]);
    assert.ok(mgr.isRunning('croponly'));
    assert.deepEqual(mgr.runningSlots('croponly'), [1]);
    assert.ok(!mtx.calls.some(c => c[0] === 'add' && c[1] === 'croponly'), 'no raw-path fan-out');

    await mgr.stop('croponly');
    assert.deepEqual(ended, [1], 'end stats fired for the crop slot');
  });
});

describe('CropManager.applyForSource — production follow (plan_vertical_crop.md §4)', () => {
  const KEY = 'followkey';

  function makeDb() {
    const db = new Database(':memory:');
    runCropMigrations(db);
    db.exec(`
      CREATE TABLE prod_cameras (
        id TEXT PRIMARY KEY,
        mixer_input INTEGER
      )
    `);
    db.prepare("INSERT INTO prod_cameras (id, mixer_input) VALUES ('cam1', 1)").run();
    db.prepare("INSERT INTO prod_cameras (id, mixer_input) VALUES ('cam2', 2)").run();
    return db;
  }

  test('no-op when follow_program is disabled', async () => {
    const db = makeDb();
    setCropConfig(db, KEY, { followProgram: false });
    const preset = createCropPreset(db, KEY, { name: 'lectern', xNorm: 0.1 }).preset;
    createCropSourceMapEntry(db, KEY, { mixerInput: 1, presetId: preset.id });

    const mgr = makeManager();
    await mgr.start(KEY, CONFIG);
    const result = await mgr.applyForSource(db, KEY, { mixerInput: 1 });
    assert.equal(result, null);
    assert.equal(mgr.getStatus(KEY).activePresetId, null);
    await mgr.stop(KEY);
  });

  test('no-op when the renderer is not running', async () => {
    const db = makeDb();
    const preset = createCropPreset(db, KEY, { name: 'lectern', xNorm: 0.1 }).preset;
    createCropSourceMapEntry(db, KEY, { mixerInput: 1, presetId: preset.id });

    const mgr = makeManager();
    const result = await mgr.applyForSource(db, KEY, { mixerInput: 1 });
    assert.equal(result, null);
  });

  test('mixer switch applies the mapped preset for that input', async () => {
    const db = makeDb();
    const preset = createCropPreset(db, KEY, { name: 'centre', xNorm: 0.5 }).preset;
    createCropSourceMapEntry(db, KEY, { mixerInput: 2, presetId: preset.id });

    const mgr = makeManager();
    await mgr.start(KEY, CONFIG);
    const result = await mgr.applyForSource(db, KEY, { mixerId: 'mix1', mixerInput: 2 });
    assert.ok(result?.ok);
    assert.equal(mgr.getStatus(KEY).activePresetId, preset.id);
    assert.equal(mgr.getStatus(KEY).xNorm, 0.5);
    await mgr.stop(KEY);
  });

  test('camera 1/preset 1 → camera 2 → camera 1/preset 2 follows across switches', async () => {
    const db = makeDb();
    const posA = createCropPreset(db, KEY, { name: 'lectern', xNorm: 0.1 }).preset;
    const posB = createCropPreset(db, KEY, { name: 'centre',  xNorm: 0.5 }).preset;
    const posC = createCropPreset(db, KEY, { name: 'piano',   xNorm: 0.9 }).preset;
    createCropSourceMapEntry(db, KEY, { cameraId: 'cam1', cameraPreset: 'preset1', presetId: posA.id });
    createCropSourceMapEntry(db, KEY, { mixerInput: 2, presetId: posB.id });
    createCropSourceMapEntry(db, KEY, { cameraId: 'cam1', cameraPreset: 'preset2', presetId: posC.id });

    const mgr = makeManager();
    await mgr.start(KEY, CONFIG);

    // Camera 1 recalls preset1 while it happens to already be on program (input 1).
    await mgr.applyForSource(db, KEY, { mixerId: 'mix1', mixerInput: 1 }); // camera 1 comes up on program first (no preset yet → no map row without cameraPreset, no-op)
    await mgr.applyForSource(db, KEY, { cameraId: 'cam1', cameraPreset: 'preset1' });
    assert.equal(mgr.getStatus(KEY).activePresetId, posA.id);
    assert.equal(mgr.getStatus(KEY).xNorm, 0.1);

    // Mixer cuts to camera 2 (input 2) — plain mixer-input mapping applies.
    await mgr.applyForSource(db, KEY, { mixerId: 'mix1', mixerInput: 2 });
    assert.equal(mgr.getStatus(KEY).xNorm, 0.5);

    // Back to camera 1 — its last-recalled preset (preset1) re-applies automatically.
    await mgr.applyForSource(db, KEY, { mixerId: 'mix1', mixerInput: 1 });
    assert.equal(mgr.getStatus(KEY).xNorm, 0.1);

    // Camera 1 recalls preset2 while still on program — applies immediately.
    await mgr.applyForSource(db, KEY, { cameraId: 'cam1', cameraPreset: 'preset2' });
    assert.equal(mgr.getStatus(KEY).xNorm, 0.9);

    await mgr.stop(KEY);
  });

  test('a preset recalled while its camera is off program is remembered but not applied yet', async () => {
    const db = makeDb();
    const onProgram = createCropPreset(db, KEY, { name: 'centre', xNorm: 0.5 }).preset;
    const offProgramPreset = createCropPreset(db, KEY, { name: 'piano', xNorm: 0.9 }).preset;
    createCropSourceMapEntry(db, KEY, { mixerInput: 2, presetId: onProgram.id });
    createCropSourceMapEntry(db, KEY, { cameraId: 'cam1', cameraPreset: 'p2', presetId: offProgramPreset.id });

    const mgr = makeManager();
    await mgr.start(KEY, CONFIG);

    // Program is on camera 2 (input 2); recall a preset on camera 1, which is
    // NOT currently on program.
    await mgr.applyForSource(db, KEY, { mixerId: 'mix1', mixerInput: 2 });
    assert.equal(mgr.getStatus(KEY).xNorm, 0.5);
    const r = await mgr.applyForSource(db, KEY, { cameraId: 'cam1', cameraPreset: 'p2' });
    assert.equal(r, null, 'off-program preset recall is memory-only');
    assert.equal(mgr.getStatus(KEY).xNorm, 0.5, 'position unchanged while cam1 stays off program');

    // Now cut to camera 1 (input 1) — its remembered preset applies.
    await mgr.applyForSource(db, KEY, { mixerId: 'mix1', mixerInput: 1 });
    assert.equal(mgr.getStatus(KEY).xNorm, 0.9);

    await mgr.stop(KEY);
  });
});
