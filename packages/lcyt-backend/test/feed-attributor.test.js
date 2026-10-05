/**
 * createFeedAttributor (plan_perception_completion.md §5): mixer signals,
 * visual matching against per-camera/per-preset references, hysteresis,
 * operator override, guard window and feed.source_changed publishing.
 * "JPEGs" in these tests are raw 16x9 RGB buffers; the fake decoder just
 * wraps them, so no ffmpeg is needed.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { runMigrations } from '../../plugins/lcyt-production/src/db.js';
import { thumbnailPath } from '../../plugins/lcyt-production/src/camera-thumbnail.js';
import { fingerprintFromRgb, FP_WIDTH, FP_HEIGHT } from '../../lcyt-compute/src/perception/attribution.js';
import { createFeedAttributor } from '../src/feed-attributor.js';
import { createSharedFeedResolver } from '../src/shared-feed-resolver.js';

function shot(bx, by, { bg = 40 } = {}) {
  const buf = Buffer.alloc(FP_WIDTH * FP_HEIGHT * 3);
  for (let y = 0; y < FP_HEIGHT; y++) for (let x = 0; x < FP_WIDTH; x++) {
    const inBlock = Math.abs(x - bx) <= 2 && Math.abs(y - by) <= 1;
    const v = inBlock ? 220 : bg + x * 2;
    const o = (y * FP_WIDTH + x) * 3;
    buf[o] = v; buf[o + 1] = inBlock ? v : Math.round(v * 0.8); buf[o + 2] = Math.round(v * 0.6);
  }
  return buf;
}

const SHOTS = { altar: shot(3, 4), choir: shot(12, 4), pulpit: shot(8, 1) };
const API = 'proj-key';

function fakeRegistry() {
  const prog = []; const preset = [];
  return {
    onProgramChanged(cb) { prog.push(cb); return () => {}; },
    onCameraPresetRecalled(cb) { preset.push(cb); return () => {}; },
    program(d) { prog.forEach((cb) => cb(d)); },
    recalled(d) { preset.forEach((cb) => cb(d)); },
  };
}

describe('feed attributor', () => {
  let db, dir, registry, events, clock, frame, attributor;

  function insertCamera(id, mixerInput = null, mixerId = null) {
    db.prepare(`INSERT INTO prod_cameras (id, name, mixer_input, control_type, control_config, sort_order, mixer_id)
      VALUES (?, ?, ?, 'visca-ip', '{}', 0, ?)`).run(id, id, mixerInput, mixerId);
  }
  function saveRef(cameraId, buf, presetId = null) {
    fs.writeFileSync(thumbnailPath(cameraId, dir, presetId), buf);
    if (presetId) {
      db.prepare('INSERT INTO prod_camera_preset_thumbnails (camera_id, preset_id, captured_at) VALUES (?, ?, ?)').run(cameraId, presetId, 't1');
    } else {
      db.prepare('UPDATE prod_cameras SET thumbnail_captured_at = ? WHERE id = ?').run('t1', cameraId);
    }
  }
  function make(extra = {}) {
    attributor = createFeedAttributor({
      db, registry, eventBus: { publish: (k, t, d) => events.push({ k, t, d }) },
      thumbnailsDir: dir, thumbnailPath, now: () => clock,
      fetchFrame: async () => (frame ? { jpeg: frame, capturedAt: clock } : null),
      fingerprintJpeg: async (b) => fingerprintFromRgb(b),
      guardMs: 400, cutThreshold: 0.05, ...extra,
    });
  }

  beforeEach(() => {
    db = new Database(':memory:'); runMigrations(db);
    dir = fs.mkdtempSync(join(tmpdir(), 'attr-'));
    registry = fakeRegistry(); events = []; clock = 10_000; frame = null;
  });
  afterEach(() => { attributor?.shutdown(); db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

  it('starts unknown', () => {
    make();
    assert.equal(attributor.getTag(API).method, 'unknown');
    assert.equal(attributor.getTag(API).cameraId, null);
  });

  it('mixer signal sets the camera and publishes feed.source_changed', () => {
    insertCamera('altar', 3);
    make();
    registry.program({ apiKey: API, mixerId: null, inputNumber: 3 });
    const tag = attributor.getTag(API);
    assert.equal(tag.cameraId, 'altar'); assert.equal(tag.method, 'mixer-signal'); assert.equal(tag.confidence, 1);
    assert.equal(events.length, 1);
    assert.equal(events[0].t, 'feed.source_changed');
    assert.equal(events[0].d.cameraId, 'altar');
  });

  it('a mixer input with no camera is unknown but keeps the input', () => {
    make();
    registry.program({ apiKey: API, mixerId: 'm1', inputNumber: 9 });
    const tag = attributor.getTag(API);
    assert.equal(tag.cameraId, null); assert.equal(tag.input, 9); assert.equal(tag.method, 'unknown');
  });

  it('guard window: a frame captured just after a switch is unknown, later ones are tagged', () => {
    insertCamera('altar', 3); insertCamera('choir', 4);
    make();
    clock = 10_000; registry.program({ apiKey: API, inputNumber: 3 });
    clock = 20_000; registry.program({ apiKey: API, inputNumber: 4 });
    assert.equal(attributor.tagForCapture(API, 19_000).cameraId, 'altar'); // before the switch
    assert.equal(attributor.tagForCapture(API, 20_100).cameraId, null);    // inside the guard
    assert.equal(attributor.tagForCapture(API, 20_500).cameraId, 'choir'); // after it
  });

  it('visual loop: references (camera + preset) attribute the feed without mixer signals', async () => {
    insertCamera('altar'); insertCamera('choir'); insertCamera('pulpit');
    saveRef('altar', SHOTS.altar, 'p1'); saveRef('choir', SHOTS.choir); saveRef('pulpit', SHOTS.pulpit);
    make();
    attributor.start(API, { intervalMs: 3_600_000 });
    await new Promise((r) => setImmediate(r)); // let start()'s own first tick finish
    frame = SHOTS.altar;
    await attributor._tick(API); await attributor._tick(API);
    assert.equal(attributor.getTag(API).cameraId, 'altar');
    assert.equal(attributor.getTag(API).presetId, 'p1');
    assert.equal(attributor.getTag(API).method, 'visual-match');

    frame = SHOTS.choir; // a cut: switches immediately
    await attributor._tick(API);
    assert.equal(attributor.getTag(API).cameraId, 'choir');
    assert.equal(attributor.status(API).cuts >= 1, true);
    assert.equal(attributor.status(API).references, 3);
  });

  it('visual loop: an unmatched shot ends in unknown, never a guess', async () => {
    insertCamera('altar'); insertCamera('choir');
    saveRef('altar', SHOTS.altar); saveRef('choir', SHOTS.choir);
    make();
    attributor.start(API, { intervalMs: 3_600_000 });
    await new Promise((r) => setImmediate(r)); // let start()'s own first tick finish
    frame = SHOTS.altar; await attributor._tick(API); await attributor._tick(API);
    assert.equal(attributor.getTag(API).cameraId, 'altar');
    frame = shot(15, 8, { bg: 200 });
    for (let i = 0; i < 4; i++) await attributor._tick(API);
    assert.equal(attributor.getTag(API).cameraId, null);
  });

  it('a fresh mixer signal beats the visual loop', async () => {
    insertCamera('altar', 3); insertCamera('choir');
    saveRef('altar', SHOTS.altar); saveRef('choir', SHOTS.choir);
    make();
    registry.program({ apiKey: API, inputNumber: 3 });
    attributor.start(API, { intervalMs: 3_600_000 });
    await new Promise((r) => setImmediate(r)); // let start()'s own first tick finish
    frame = SHOTS.choir;
    for (let i = 0; i < 3; i++) await attributor._tick(API);
    assert.equal(attributor.getTag(API).cameraId, 'altar');
    assert.equal(attributor.getTag(API).method, 'mixer-signal');
  });

  it('operator override holds until the next scene cut', async () => {
    insertCamera('altar'); insertCamera('choir');
    saveRef('altar', SHOTS.altar); saveRef('choir', SHOTS.choir);
    make();
    attributor.start(API, { intervalMs: 3_600_000 });
    await new Promise((r) => setImmediate(r)); // let start()'s own first tick finish
    frame = SHOTS.altar; await attributor._tick(API);
    attributor.override(API, 'choir');
    assert.equal(attributor.getTag(API).method, 'operator');
    await attributor._tick(API); // same shot, no cut: override holds
    assert.equal(attributor.getTag(API).cameraId, 'choir');
    frame = SHOTS.choir; await attributor._tick(API); // cut clears it, visual match takes over
    await attributor._tick(API);
    assert.equal(attributor.getTag(API).method, 'visual-match');
    attributor.override(API, 'altar');
    attributor.override(API, null);
    assert.equal(attributor.getTag(API).method, 'unknown');
  });

  it('start is idempotent, stop reports, status shows the loop', () => {
    make();
    attributor.start(API, { intervalMs: 3_600_000 });
    assert.equal(attributor.start(API).running, true);
    assert.equal(attributor.stop(API), true);
    assert.equal(attributor.stop(API), false);
    assert.equal(attributor.status(API).running, false);
  });

  it('shared-feed resolver with an attributor tags by capture time and emits visible:false for the outgoing camera', () => {
    insertCamera('altar', 3); insertCamera('choir', 4);
    make();
    const ingested = [];
    const resolver = createSharedFeedResolver({ db, registry, aggregator: { ingest: (k, d) => ingested.push(d) }, attributor });
    clock = 10_000; registry.program({ apiKey: API, inputNumber: 3 });
    clock = 12_000;
    assert.equal(resolver.tagSharedDetection(API, { capturedAt: 11_000, objects: [] }).cameraId, 'altar');
    clock = 20_000; registry.program({ apiKey: API, inputNumber: 4 });
    assert.deepEqual(ingested.map((d) => [d.cameraId, d.visible]), [['altar', false]]);
    assert.equal(resolver.tagSharedDetection(API, { capturedAt: 20_050, objects: [] }), null); // guard window
    assert.equal(resolver.tagSharedDetection(API, { capturedAt: 21_000, objects: [] }).source.cameraId, 'choir');
  });
});
