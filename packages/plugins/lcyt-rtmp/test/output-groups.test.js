/**
 * Lock groups (plan_locked_outputs.md): the group ffmpeg arguments, the group rules in the database and the supervisor running
 * several outputs in one process.
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initDb } from 'lcyt-backend/db';
import { buildGroupArgs, groupRequires } from '../src/output-group-plan.js';
import { buildDskStepArgs, OutputStepManager } from '../src/output-steps.js';
import { createOutput, updateOutput, deleteOutput, createGroup, deleteGroup, listGroups, listOutputs } from '../src/db/outputs.js';

const KEY = 'grpkey';
let db, feedId;
const settings = (over = {}) => ({ get: (k) => ({ 'graphics.dsk_rtmp_app': 'dsk', ...over })[k] });

const vp = (name, chroma) => ({ url: `rtsp://m/dsk/${name}`, chromaKey: chroma ? { enabled: true, color: '#00B140', similarity: 0.3, blend: 0.1 } : null });

describe('buildGroupArgs', () => {
  test('one member is exactly the plain DSK step', () => {
    const viewports = [vp('a', true), vp('b', false)];
    const one = buildGroupArgs({ sourceUrl: 'rtsp://m/src', members: [{ viewports, outputUrl: 'rtmp://m/o', videoBitrate: '3M' }] });
    assert.deepEqual(one, buildDskStepArgs({ sourceUrl: 'rtsp://m/src', viewports, outputUrl: 'rtmp://m/o', videoBitrate: '3M' }));
    const fc = one[one.indexOf('-filter_complex') + 1];
    assert.equal(fc, [
      '[1:v]colorkey=0x00B140:0.3:0.1[k1]', '[k1][0:v]scale2ref=w=main_w:h=main_h[s1][b1]', '[b1][s1]overlay=0:0:eof_action=pass[o1]',
      '[2:v][o1]scale2ref=w=main_w:h=main_h[s2][b2]', '[b2][s2]overlay=0:0:eof_action=pass[o2]',
    ].join(';'));
    assert.deepEqual(one.slice(one.indexOf('-map')), ['-map', '[o2]', '-map', '0:a?', '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-b:v', '3M', '-c:a', 'copy', '-f', 'flv', 'rtmp://m/o']);
  });

  test('no viewports: a plain re-encode', () => {
    const a = buildGroupArgs({ sourceUrl: 'rtsp://m/src', members: [{ viewports: [], outputUrl: 'rtmp://m/o' }] });
    assert.equal(a[a.indexOf('-filter_complex') + 1], '[0:v]null[o0]');
    assert.equal(a[a.indexOf('-map') + 1], '[o0]');
  });

  test('members with the same viewports share one composite and split after it', () => {
    const a = buildGroupArgs({ sourceUrl: 'rtsp://m/src', members: [
      { viewports: [vp('a', true)], outputUrl: 'rtmp://m/o1', videoBitrate: '4M' },
      { viewports: [vp('a', true)], outputUrl: 'rtmp://m/o2', videoBitrate: '1M' },
    ] });
    const fc = a[a.indexOf('-filter_complex') + 1];
    assert.equal(fc.split('colorkey').length - 1, 1, 'keyed once');
    assert.equal(fc.split('overlay=').length - 1, 1, 'composited once');
    assert.match(fc, /\[o1\]split=2\[g0_0\]\[g0_1\]/);
    assert.deepEqual(a.filter((x, i) => a[i - 1] === '-map' && x.startsWith('[')), ['[g0_0]', '[g0_1]']);
    assert.equal(a.filter(x => x === 'libx264').length, 2, 'one encode per member');
    assert.equal(a.filter(x => x === '-i').length, 2, 'source plus one viewport input');
  });

  test('different viewport lists diverge at the source; a shared viewport input is split', () => {
    const a = buildGroupArgs({ sourceUrl: 'rtsp://m/src', members: [
      { viewports: [vp('a', false)], outputUrl: 'rtmp://m/o1' },
      { viewports: [vp('a', false), vp('b', false)], outputUrl: 'rtmp://m/o2' },
    ] });
    const fc = a[a.indexOf('-filter_complex') + 1];
    // both lists start with 'a' (shared), then the second adds 'b': one split of the 'a' picture, nothing for the inputs
    assert.equal(fc.split('overlay=').length - 1, 2);
    assert.match(fc, /\[o1\]split=2/);
    const c = buildGroupArgs({ sourceUrl: 'rtsp://m/src', members: [
      { viewports: [vp('a', false)], outputUrl: 'rtmp://m/o1' },
      { viewports: [vp('b', false), vp('a', false)], outputUrl: 'rtmp://m/o2' },
    ] });
    const fc2 = c[c.indexOf('-filter_complex') + 1];
    assert.match(fc2, /\[1:v\]split=2\[v1_0\]\[v1_1\]/, 'viewport a used on two branches is split first');
    assert.equal(c.filter(x => x === '-i').length, 3);
    assert.equal(c.filter(x => x === '-map' ).length, 4);
  });

  test('a member that ends where another continues gets its own branch', () => {
    const a = buildGroupArgs({ sourceUrl: 'rtsp://m/src', members: [
      { viewports: [vp('a', false)], outputUrl: 'rtmp://m/o1' },
      { viewports: [vp('a', false), vp('b', false)], outputUrl: 'rtmp://m/o2' },
    ] });
    const maps = a.filter((x, i) => a[i - 1] === '-map' && x.startsWith('['));
    assert.equal(new Set(maps).size, 2);
  });

  test('requires follow the keyed viewports', () => {
    assert.deepEqual(groupRequires([{ viewports: [vp('a', false)] }]), ['encoder:libx264']);
    assert.deepEqual(groupRequires([{ viewports: [vp('a', true)] }]), ['encoder:libx264', 'filter:colorkey']);
  });

  test('refuses an empty group', () => {
    assert.throws(() => buildGroupArgs({ sourceUrl: 'x', members: [] }));
  });
});

function fakeMtx() {
  const ready = new Set();
  return { ready, async getPath(name) { if (!ready.has(name)) { const e = new Error('nf'); e.statusCode = 404; throw e; } return { ready: true }; } };
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
async function viewport(name) {
  await db.prepare('INSERT INTO dsk_viewports (api_key, name, display_settings_json) VALUES (?, ?, NULL)').run(KEY, name);
}

before(async () => {
  db = await initDb(':memory:');
  await db.prepare("INSERT INTO api_keys (key, owner) VALUES (?, 'owner')").run(KEY);
  await db.prepare("INSERT INTO prod_feeds (id, owner_api_key, name, feed_key) VALUES ('f1', ?, 'Main', 'main-key')").run(KEY);
  await db.prepare("INSERT INTO prod_feeds (id, owner_api_key, name, feed_key) VALUES ('f2', ?, 'Other', 'other-key')").run(KEY);
  feedId = 'f1';
});
after(async () => { await db.close(); });
beforeEach(async () => {
  await db.exec('DELETE FROM outputs');
  await db.exec('DELETE FROM output_groups');
  await db.exec('DELETE FROM dsk_viewports');
});

const mk = async (name, extra = {}) => (await createOutput(db, KEY, { name, sourceType: 'feed', sourceId: feedId, ...extra })).output;

describe('lock groups in the database', () => {
  test('create, list and dissolve', async () => {
    const a = await mk('A'); const b = await mk('B');
    const r = await createGroup(db, KEY, { outputIds: [a.id, b.id], name: 'Both' });
    assert.equal(r.ok, true);
    assert.match(r.group.id, /^lg-/);
    assert.deepEqual((await listGroups(db, KEY)).map(g => [g.name, g.outputIds.length]), [['Both', 2]]);
    assert.equal((await listOutputs(db, KEY)).every(o => o.groupId === r.group.id), true);
    assert.equal((await deleteGroup(db, KEY, r.group.id)).ok, true);
    assert.equal((await listOutputs(db, KEY)).every(o => o.groupId === null), true);
    assert.equal((await listGroups(db, KEY)).length, 0);
  });

  test('refuses fewer than two, crop, another input, an output already grouped, too many', async () => {
    const a = await mk('A'); const b = await mk('B'); const c = await mk('C', { cropEnabled: true });
    const d = (await createOutput(db, KEY, { name: 'D', sourceType: 'feed', sourceId: 'f2' })).output;
    assert.equal((await createGroup(db, KEY, { outputIds: [a.id] })).status, 400);
    assert.match((await createGroup(db, KEY, { outputIds: [a.id, c.id] })).error, /crop/);
    assert.match((await createGroup(db, KEY, { outputIds: [a.id, d.id] })).error, /same input/);
    assert.equal((await createGroup(db, KEY, { outputIds: [a.id, 'nope'] })).status, 404);
    assert.equal((await createGroup(db, KEY, { outputIds: [a.id, b.id] })).ok, true);
    assert.match((await createGroup(db, KEY, { outputIds: [a.id, d.id] })).error, /already in a lock group/);
    assert.match((await createGroup(db, KEY, { outputIds: [a.id, b.id, d.id] }, { maxGroupMembers: 2 })).error, /at most 2/);
  });

  test('an output leaving a group of two dissolves it; deleting a member does too', async () => {
    const a = await mk('A'); const b = await mk('B'); const c = await mk('C');
    const g = (await createGroup(db, KEY, { outputIds: [a.id, b.id, c.id] })).group;
    assert.equal((await updateOutput(db, KEY, c.id, { groupId: null })).ok, true);
    assert.equal((await listGroups(db, KEY)).length, 1);
    assert.equal((await deleteOutput(db, KEY, b.id)).ok, true);
    assert.equal((await listGroups(db, KEY)).length, 0, 'one member left, no lock');
    assert.equal((await listOutputs(db, KEY)).find(o => o.id === a.id).groupId, null);
    assert.ok(g.id);
  });

  test('joining a group is checked: crop on a member and a changed source are refused', async () => {
    const a = await mk('A'); const b = await mk('B'); const c = await mk('C');
    const g = (await createGroup(db, KEY, { outputIds: [a.id, b.id] })).group;
    assert.equal((await updateOutput(db, KEY, c.id, { groupId: g.id })).ok, true);
    const crop = await updateOutput(db, KEY, a.id, { cropEnabled: true });
    assert.equal(crop.status, 409);
    const move = await updateOutput(db, KEY, b.id, { sourceType: 'feed', sourceId: 'f2' });
    assert.equal(move.status, 409);
    assert.equal((await updateOutput(db, KEY, a.id, { groupId: 'lg-missing' })).status, 404);
  });
});

describe('OutputStepManager with lock groups', () => {
  const setup = async ({ over = {}, group = true } = {}) => {
    await viewport('lt'); await viewport('bug');
    const a = await mk('A', { dsk: ['lt'] });
    const b = await mk('B', { dsk: ['lt', 'bug'] });
    if (group) await createGroup(db, KEY, { outputIds: [a.id, b.id] });
    const mtx = fakeMtx();
    for (const p of ['main-key', `dsk/${KEY}__lt`, `dsk/${KEY}__bug`]) mtx.ready.add(p);
    const factory = fakeFactory();
    const mgr = new OutputStepManager({ db, mediamtx: mtx, settings: settings(over), runnerFactory: factory });
    return { a, b, mtx, factory, mgr };
  };

  test('a group is one process with one output per member', async () => {
    const { a, b, factory, mgr } = await setup();
    await mgr.reconcile();
    assert.equal(factory.runners.length, 1);
    const args = factory.runners[0].opts.args;
    assert.equal(args.filter(x => x === 'libx264').length, 2);
    assert.ok(args.some(x => x.endsWith(`/out-${a.id}-dsk`)) && args.some(x => x.endsWith(`/out-${b.id}-dsk`)));
    const st = mgr.status();
    assert.equal(st.steps.length, 1);
    assert.deepEqual(st.steps[0].outputIds.sort(), [a.id, b.id].sort());
    assert.ok(st.steps[0].groupId);
    await mgr.stopAll();
  });

  test('without a group each output is its own process', async () => {
    const { factory, mgr } = await setup({ group: false });
    await mgr.reconcile();
    assert.equal(factory.runners.length, 2);
    await mgr.stopAll();
  });

  test('a viewport coming up restarts the whole group once; dissolving splits it', async () => {
    const { b, mtx, factory, mgr } = await setup();
    mtx.ready.delete(`dsk/${KEY}__bug`);
    await mgr.reconcile();
    assert.equal(factory.runners.length, 1);
    const first = factory.runners[0];
    mtx.ready.add(`dsk/${KEY}__bug`);
    await mgr.reconcile();
    assert.equal(first.stopped, true);
    assert.equal(factory.runners.length, 2);
    const [g] = await listGroups(db, KEY);
    await deleteGroup(db, KEY, g.id);
    await mgr.reconcile();
    assert.equal(factory.runners.length, 4, 'two separate steps after the lock is removed');
    assert.ok(b.id);
    await mgr.stopAll();
  });

  test('the member cap skips the extra output and says so', async () => {
    const { mgr, factory } = await setup({ over: { 'outputs.max_group_members': 2 } });
    const c = await mk('C', { dsk: ['lt'] });
    const [g] = await listGroups(db, KEY);
    await db.outputs.updateMany({ where: { id: c.id }, data: { group_id: g.id } }); // bypasses the API check on purpose
    await mgr.reconcile();
    assert.equal(factory.runners.length, 1);
    assert.equal(mgr.status().skipped.length, 1);
    assert.match(mgr.status().skipped[0].reason, /lock group/);
    assert.ok(c.id);
    await mgr.stopAll();
  });

  test('the fleet RTMP base is used for the outputs when set', async () => {
    const { factory, mgr } = await setup({ over: { 'mediamtx.rtmp_fleet_base_url': 'rtmp://mtx.private:1935/' } });
    await mgr.reconcile();
    assert.ok(factory.runners[0].opts.args.some(x => x.startsWith('rtmp://mtx.private:1935/out-')));
    await mgr.stopAll();
  });
});

describe('/outputs/groups routes', () => {
  let server, base;
  before(async () => {
    const { createServer } = await import('node:http');
    const { default: express } = await import('express');
    const { createOutputsRouter } = await import('../src/routes/outputs.js');
    const auth = (req, res, next) => { req.session = { apiKey: KEY }; next(); };
    const app = express();
    app.use(express.json());
    app.use('/outputs', createOutputsRouter(db, auth, undefined, { maxGroupMembers: 3, reconcile() {}, status: () => ({ active: true, steps: [], skipped: [] }) }));
    await new Promise(res => { server = createServer(app).listen(0, '127.0.0.1', () => { base = `http://127.0.0.1:${server.address().port}`; res(); }); });
  });
  after(() => new Promise(r => server.close(r)));
  const call = (method, path, body) => fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });

  test('create, list, join and leave through the API', async () => {
    const a = await mk('A'); const b = await mk('B'); const c = await mk('C');
    const bad = await call('POST', '/outputs/groups', { outputIds: [a.id] });
    assert.equal(bad.status, 400);
    const created = await call('POST', '/outputs/groups', { outputIds: [a.id, b.id] });
    assert.equal(created.status, 201);
    const g = await created.json();
    assert.equal((await (await call('GET', '/outputs/groups')).json()).groups.length, 1);
    assert.equal((await call('PATCH', `/outputs/${c.id}`, { groupId: g.id })).status, 200);
    assert.equal((await (await call('GET', '/outputs')).json()).outputs.filter(o => o.groupId === g.id).length, 3);
    assert.equal((await call('PATCH', `/outputs/${c.id}`, { groupId: null })).status, 200);
    assert.equal((await call('DELETE', `/outputs/groups/${g.id}`)).status, 200);
    assert.equal((await call('DELETE', `/outputs/groups/${g.id}`)).status, 404);
  });
});

describe('buildGroupArgs with a real ffmpeg', { skip: spawnSync('ffmpeg', ['-version']).status !== 0 }, () => {
  // Same arguments, with the RTSP inputs swapped for synthetic pictures and the RTMP outputs for files.
  function runnable(args, dir) {
    const out = [];
    let n = 0;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '-rtsp_transport') { out.push('-f', 'lavfi', '-i', `testsrc2=size=${n++ === 0 ? '320x180' : '160x90'}:rate=10:duration=1`); i += 3; continue; }
      if (args[i] === '-f' && args[i + 1] === 'flv') { out.push('-f', 'matroska', join(dir, `m${out.filter(x => x === 'matroska').length}.mkv`)); i += 2; continue; }
      out.push(args[i]);
    }
    return ['-v', 'error', '-y', ...out];
  }
  const cases = {
    'one member': [{ viewports: [vp('a', true)], outputUrl: 'x' }],
    'two members sharing a composite': [{ viewports: [vp('a', true)], outputUrl: 'x' }, { viewports: [vp('a', true)], outputUrl: 'y' }],
    'diverging lists with a shared viewport': [{ viewports: [vp('a', false)], outputUrl: 'x' }, { viewports: [vp('b', true), vp('a', false)], outputUrl: 'y' }, { viewports: [], outputUrl: 'z' }],
  };
  for (const [name, members] of Object.entries(cases)) {
    test(`${name}: the graph is valid and every member gets a file`, () => {
      const dir = mkdtempSync(join(tmpdir(), 'lcyt-group-'));
      try {
        const args = buildGroupArgs({ sourceUrl: 'rtsp://m/src', members });
        const r = spawnSync('ffmpeg', runnable(args, dir), { encoding: 'utf8', timeout: 60000 });
        assert.equal(r.status, 0, r.stderr);
        for (let i = 0; i < members.length; i++) assert.ok(statSync(join(dir, `m${i}.mkv`)).size > 0, `member ${i} has output`);
      } finally { rmSync(dir, { recursive: true, force: true }); }
    });
  }
});
