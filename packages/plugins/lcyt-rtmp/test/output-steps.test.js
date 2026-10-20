/**
 * DSK step per output (plan_egress_outputs.md PR 3): ffmpeg arguments, which viewports a step uses, step planning with the
 * per-project cap, source paths through DSK steps, and the supervisor with a fake MediaMTX and a fake runner.
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { initDb } from 'lcyt-backend/db';
import { buildDskStepArgs, OutputStepManager } from '../src/output-steps.js';
import { effectiveDskViewports, outputSourcePath, outputDskPath } from '../src/output-paths.js';
import { createOutput, updateOutput } from '../src/db/outputs.js';

const KEY = 'stepkey';
let db, feedId, progId;

const settings = (over = {}) => ({ get: (k) => ({ 'graphics.dsk_rtmp_app': 'dsk', ...over })[k] });

function fakeMtx() {
  const ready = new Set();
  return {
    ready,
    async getPath(name) {
      if (!ready.has(name)) { const e = new Error('nf'); e.statusCode = 404; throw e; }
      return { ready: true };
    },
  };
}

function fakeFactory() {
  const runners = [];
  const factory = (opts) => {
    const r = new EventEmitter();
    r.opts = opts; r.started = false; r.stopped = false;
    r.start = async () => { r.started = true; };
    r.stop = async () => { r.stopped = true; };
    runners.push(r);
    return r;
  };
  factory.runners = runners;
  return factory;
}

async function viewport(name, stream) {
  await db.prepare('INSERT INTO dsk_viewports (api_key, name, display_settings_json) VALUES (?, ?, ?)')
    .run(KEY, name, stream ? JSON.stringify({ stream }) : null);
}

before(async () => {
  db = await initDb(':memory:');
  await db.prepare("INSERT INTO api_keys (key, owner) VALUES (?, 'owner')").run(KEY);
  await db.prepare("INSERT INTO prod_feeds (id, owner_api_key, name, feed_key) VALUES ('f1', ?, 'Main', 'main-key')").run(KEY);
  feedId = 'f1';
});
after(async () => { await db.close(); });
beforeEach(async () => {
  await db.exec('DELETE FROM outputs');
  await db.exec('DELETE FROM dsk_viewports');
  progId = (await createOutput(db, KEY, { name: 'Program', sourceType: 'feed', sourceId: feedId })).output.id;
});

describe('buildDskStepArgs', () => {
  test('no viewport is a plain re-encode, audio copied', () => {
    const a = buildDskStepArgs({ sourceUrl: 'rtsp://s/a', viewports: [], outputUrl: 'rtmp://s/o' });
    assert.ok(a.join(' ').includes('[0:v]null[o0]'));
    assert.deepEqual(a.slice(a.indexOf('-map'), a.indexOf('-map') + 4), ['-map', '[o0]', '-map', '0:a?']);
    assert.ok(a.join(' ').endsWith('-c:a copy -f flv rtmp://s/o'));
  });
  test('viewports are keyed, scaled to the picture and stacked in order', () => {
    const a = buildDskStepArgs({
      sourceUrl: 'S', outputUrl: 'O',
      viewports: [{ url: 'V1', chromaKey: { enabled: true, color: '#00ff00', similarity: 0.4, blend: 0.2 } }, { url: 'V2', chromaKey: { enabled: false } }],
    });
    const fc = a[a.indexOf('-filter_complex') + 1];
    assert.match(fc, /\[1:v\]colorkey=0x00ff00:0.4:0.2\[k1\]/);
    assert.match(fc, /\[k1\]\[0:v\]scale2ref=w=main_w:h=main_h\[s1\]\[b1\]/);
    assert.match(fc, /\[2:v\]\[o1\]scale2ref/);
    assert.equal(a[a.indexOf('-map') + 1], '[o2]');
    assert.equal(a.filter(x => x === '-i').length, 3);
  });
});

describe('effectiveDskViewports', () => {
  test('keeps order and drops unknown names; the composite viewport is the bare dsk/<key> stream', async () => {
    await viewport('lower', { chromaKey: { enabled: true, color: '#00B140' } });
    await viewport('legacy', { mode: 'composite', chromaKey: { enabled: true, color: '#112233' } });
    await viewport('logo', null);
    const v = await effectiveDskViewports(db, KEY, ['logo', 'legacy', 'ghost', 'lower'], settings());
    assert.deepEqual(v.map(x => x.name), ['logo', 'legacy', 'lower']);
    assert.equal(v[0].path, `dsk/${KEY}__logo`);
    assert.deepEqual([v[1].path, v[1].composite, v[1].chromaKey.color], [`dsk/${KEY}`, true, '#112233']);
    assert.equal(v[2].chromaKey.enabled, true);
  });
  test('with outputs.composite_in_step off the composite viewport is left to the relay', async () => {
    await viewport('lower', null);
    await viewport('legacy', { mode: 'composite' });
    const v = await effectiveDskViewports(db, KEY, ['legacy', 'lower'], settings({ 'outputs.composite_in_step': false }));
    assert.deepEqual(v.map(x => x.name), ['lower']);
  });
});

describe('source paths through a DSK step', () => {
  test('an output built on one with a DSK step reads out-<id>-dsk; crop wins over DSK', async () => {
    await viewport('lower', null);
    await updateOutput(db, KEY, progId, { dsk: ['lower'] });
    const child = (await createOutput(db, KEY, { name: 'Child', sourceType: 'output', sourceId: progId })).output.id;
    assert.equal(await outputSourcePath(db, KEY, child, null, settings()), outputDskPath(progId));
    await updateOutput(db, KEY, progId, { cropEnabled: true });
    assert.equal(await outputSourcePath(db, KEY, child, null, settings()), `out-${progId}-crop`);
  });
  test('a composite-only DSK list is a step; with outputs.composite_in_step off the child stays on the feed', async () => {
    await viewport('legacy', { mode: 'composite' });
    await updateOutput(db, KEY, progId, { dsk: ['legacy'] });
    const child = (await createOutput(db, KEY, { name: 'Child', sourceType: 'output', sourceId: progId })).output.id;
    assert.equal(await outputSourcePath(db, KEY, child, null, settings()), outputDskPath(progId));
    assert.equal(await outputSourcePath(db, KEY, child, null, settings({ 'outputs.composite_in_step': false })), 'main-key');
  });
});

describe('OutputStepManager', () => {
  const make = (mtx, factory, extra = {}) => new OutputStepManager({ db, mediamtx: mtx, settings: settings({ 'outputs.max_steps': 4, ...extra }), runnerFactory: factory, pollMs: 100000 });

  test('plans only outputs with effective viewports and honours the per-project cap', async () => {
    await viewport('a', null); await viewport('b', null);
    await updateOutput(db, KEY, progId, { dsk: ['a'] });
    const second = (await createOutput(db, KEY, { name: 'Second', sourceType: 'feed', sourceId: feedId, dsk: ['b'], sortOrder: 1 })).output.id;
    await createOutput(db, KEY, { name: 'Plain', sourceType: 'feed', sourceId: feedId });
    let m = make(fakeMtx(), fakeFactory());
    assert.deepEqual((await m.desiredSteps()).map(s => s.outputId), [progId, second]);
    m = make(fakeMtx(), fakeFactory(), { 'outputs.max_steps': 1 });
    assert.deepEqual((await m.desiredSteps()).map(s => s.outputId), [progId]);
    assert.equal(m.status().skipped[0].outputId, second);
  });

  test('starts when the source is ready with the ready viewports, restarts when the set changes, stops when removed', async () => {
    await viewport('a', { chromaKey: { enabled: true, color: '#00ff00' } }); await viewport('b', null);
    await updateOutput(db, KEY, progId, { dsk: ['a', 'b'] });
    const mtx = fakeMtx(); const factory = fakeFactory();
    const m = make(mtx, factory);

    await m.reconcile();
    assert.equal(factory.runners.length, 0, 'source not ready');

    mtx.ready.add('main-key');
    await m.reconcile();
    assert.equal(factory.runners.length, 1);
    const first = factory.runners[0];
    assert.equal(first.started, true);
    assert.ok(first.opts.args.includes('rtsp://127.0.0.1:8554/main-key'));
    assert.ok(first.opts.args.includes(`rtmp://127.0.0.1:1935/out-${progId}-dsk`));
    assert.equal(first.opts.args.filter(x => x === '-i').length, 1, 'no viewport ready yet: plain pass');

    mtx.ready.add(`dsk/${KEY}__a`);
    await m.reconcile();
    assert.equal(first.stopped, true);
    assert.equal(factory.runners.length, 2);
    assert.equal(factory.runners[1].opts.args.filter(x => x === '-i').length, 2);
    assert.ok(factory.runners[1].opts.requires.includes('filter:colorkey'));

    await m.reconcile();
    assert.equal(factory.runners.length, 2, 'nothing changed: no restart');

    await updateOutput(db, KEY, progId, { enabled: false });
    await m.reconcile();
    assert.equal(factory.runners[1].stopped, true);
    assert.deepEqual(m.status().steps, []);
    await m.stopAll();
  });

  test('a source that goes away stops the step; switching the layer off stops everything', async () => {
    await viewport('a', null);
    await updateOutput(db, KEY, progId, { dsk: ['a'] });
    const mtx = fakeMtx(); const factory = fakeFactory();
    mtx.ready.add('main-key');
    const m = make(mtx, factory);
    await m.reconcile();
    assert.equal(factory.runners.length, 1);
    mtx.ready.delete('main-key');
    await m.reconcile();
    assert.equal(factory.runners[0].stopped, true);
    mtx.ready.add('main-key');
    await m.reconcile();
    assert.equal(factory.runners.length, 2);
    const off = make(mtx, fakeFactory(), { 'outputs.steps_active': false });
    await off.reconcile();
    assert.equal(off.status().active, false);
    await m.stopAll();
  });
});
