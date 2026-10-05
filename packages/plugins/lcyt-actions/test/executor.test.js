import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { EventBus } from 'lcyt/event-bus';
import { initActions, createActionDef, createActionExecutor, currentCausation, parseWaitMs } from '../src/api.js';

function setup(handlers = {}, extra = {}) {
  const db = new Database(':memory:');
  initActions(db);
  const eventBus = new EventBus();
  const events = [];
  eventBus.subscribe('k', ['action.*'], (e) => events.push(e));
  const calls = [];
  const executor = createActionExecutor({
    db, eventBus,
    handlers: {
      camera: { device: true, run: async (k, v, m) => { calls.push(['camera', k, v, m.source]); return { ok: true, transport: 'direct' }; } },
      api: async (k, v) => { calls.push(['api', k, v]); return { ok: v !== 'bad.req', error: 'boom' }; },
      ...handlers,
    },
    ...extra,
  });
  const def = (slug, definition) => createActionDef(db, 'k', { id: slug, name: slug, slug, definition });
  return { db, executor, events, calls, def };
}

describe('parseWaitMs', () => {
  it('parses seconds, ms and bare numbers, clamps, rejects junk', () => {
    assert.equal(parseWaitMs('2s'), 2000);
    assert.equal(parseWaitMs('1.5s'), 1500);
    assert.equal(parseWaitMs('250ms'), 250);
    assert.equal(parseWaitMs('3'), 3000);
    assert.equal(parseWaitMs('999s'), 30000);
    assert.equal(parseWaitMs('soon'), null);
  });
});

describe('rewriteDeviceRefs', () => {
  it('rewrites hooked atoms only, keeps @refs, waits and other atoms verbatim', () => {
    const { executor } = setup({
      camera: {
        device: true, run: async () => ({ ok: true }),
        toIds: (k, v) => (v === 'pulpit.wide' ? 'cam-1.p1' : null),
        toLabels: (k, v) => (v === 'cam-1.p1' ? 'pulpit.wide' : null),
      },
    });
    const typed = 'camera:pulpit.wide | wait:2s | @intro | audio:start | camera:ghost.x';
    const stored = executor.rewriteDeviceRefs('k', typed, 'ids');
    assert.equal(stored, 'camera:cam-1.p1 | wait:2s | @intro | audio:start | camera:ghost.x');
    assert.equal(executor.rewriteDeviceRefs('k', stored, 'labels'), typed);
    assert.equal(executor.rewriteDeviceRefs('k', 'wait:1s', 'ids'), 'wait:1s');
    assert.equal(executor.rewriteDeviceRefs('k', '', 'ids'), '');
  });

  it('a throwing hook leaves the atom as written', () => {
    const { executor } = setup({ camera: { device: true, run: async () => ({ ok: true }), toIds: () => { throw new Error('x'); } } });
    assert.equal(executor.rewriteDeviceRefs('k', 'camera:a.b', 'ids'), 'camera:a.b');
  });
});

describe('ActionExecutor', () => {
  let t;
  beforeEach(() => { t = setup(); });

  it('runs server atoms in order and returns client atoms', async () => {
    const r = await t.executor.run('k', { expr: 'camera:pulpit.wide | audio:start | wait:10ms | api:weather.now' }, { source: 'api' });
    assert.equal(r.ok, true);
    assert.deepEqual(r.steps.map((s) => [s.atom, s.status, s.where]), [
      ['camera:pulpit.wide', 'ok', 'server'],
      ['audio:start', 'client', 'client'],
      ['wait:10ms', 'ok', 'server'],
      ['api:weather.now', 'ok', 'server'],
    ]);
    assert.deepEqual(r.clientAtoms, [{ metacode: 'audio', value: 'start' }]);
    assert.deepEqual(t.calls.map((c) => c[0]), ['camera', 'api']);
    assert.equal(t.calls[0][3], 'api');
  });

  it('expands @refs (nested) and warns on unknown and cyclic refs', async () => {
    t.def('inner', 'camera:a.b');
    t.def('outer', '@inner | api:x.y');
    t.def('loop', '@loop | camera:c.d');
    let r = await t.executor.run('k', { ref: 'outer' });
    assert.deepEqual(t.calls.map((c) => c[2]), ['a.b', 'x.y']);
    assert.equal(r.ok, true);
    r = await t.executor.run('k', { expr: '@ghost | @loop' });
    assert.equal(r.warnings.length, 2);
    assert.match(r.warnings[0], /ghost/);
  });

  it('unknown ref and empty request fail without throwing', async () => {
    assert.deepEqual((await t.executor.run('k', { ref: 'nope' })).code, 'not_found');
    assert.deepEqual((await t.executor.run('k', {})).code, 'bad_request');
    assert.equal(t.events.at(-1).topic, 'action.failed');
  });

  it('names are scoped to the project', async () => {
    t.def('mine', 'camera:a.b');
    assert.equal((await t.executor.run('other', { ref: 'mine' })).code, 'not_found');
  });

  it('continues past a failed step by default and reports it', async () => {
    const r = await t.executor.run('k', { expr: 'api:bad.req | camera:a.b' });
    assert.equal(r.ok, false);
    assert.equal(r.steps[0].status, 'error');
    assert.equal(r.steps[0].error, 'boom');
    assert.equal(r.steps[1].status, 'ok');
    assert.equal(t.events.at(-1).topic, 'action.failed');
  });

  it('stopOnError skips the remaining steps', async () => {
    const r = await t.executor.run('k', { expr: 'api:bad.req | camera:a.b | audio:stop' }, { stopOnError: true });
    assert.deepEqual(r.steps.map((s) => s.status), ['error', 'skipped', 'skipped']);
    assert.equal(t.calls.length, 1);
  });

  it('skipDevices skips device atoms only', async () => {
    const r = await t.executor.run('k', { expr: 'camera:a.b | api:x.y' }, { skipDevices: true });
    assert.equal(r.steps[0].status, 'skipped');
    assert.equal(r.steps[0].reason, 'disarmed');
    assert.equal(r.steps[1].status, 'ok');
    assert.equal(r.ok, true);
    assert.deepEqual(t.calls.map((c) => c[0]), ['api']);
  });

  it('bad wait value is a step error; a throwing handler is a step error', async () => {
    const x = setup({ boom: async () => { throw new Error('kaboom'); } });
    const r = await x.executor.run('k', { expr: 'wait:soon | boom:1' });
    assert.equal(r.steps[0].status, 'error');
    assert.equal(r.steps[1].error, 'kaboom');
  });

  it('a hung handler times out', async () => {
    const x = setup({ hang: () => new Promise(() => {}) }, { stepTimeoutMs: 20 });
    const r = await x.executor.run('k', { expr: 'hang:1 | api:x.y' });
    assert.match(r.steps[0].error, /timed out/);
    assert.equal(r.steps[1].status, 'ok');
  });

  it('publishes started, one step per atom, then completed', async () => {
    await t.executor.run('k', { expr: 'camera:a.b | audio:start' }, { source: 'tool', causation: { rootId: 'r', depth: 1 } });
    assert.deepEqual(t.events.map((e) => e.topic), ['action.started', 'action.step', 'action.step', 'action.completed']);
    assert.equal(t.events[0].data.source, 'tool');
    assert.equal(t.events[0].data.causation.depth, 1);
    assert.equal(t.events[3].data.ok, true);
  });
});

describe('ActionExecutor — device cooldown, atom keys, causation', () => {
  function make(extra = {}) {
    const db = new Database(':memory:');
    initActions(db);
    const calls = [];
    const clock = { t: 1000 };
    const executor = createActionExecutor({
      db, now: () => clock.t, deviceCooldownMs: 1000,
      handlers: {
        camera: { device: true, deviceKey: (v) => `camera:${v.split('.')[0]}`, run: async (k, v) => { calls.push(v); return { ok: true }; } },
        graphics: async (k, v, m) => { calls.push(`${m.metacode}=${v}`); return { ok: true }; },
        ...extra,
      },
    });
    return { executor, calls, clock };
  }

  it('deviceCooldown skips a device commanded within the window, per device, but not other devices or plain runs', async () => {
    const { executor, calls, clock } = make();
    await executor.run('k', { expr: 'camera:a.wide' });                        // manual run, always works
    const r = await executor.run('k', { expr: 'camera:a.close | camera:b.wide' }, { deviceCooldown: true });
    assert.deepEqual(r.steps.map((s) => [s.status, s.reason]), [['skipped', 'device_cooldown'], ['ok', undefined]]);
    assert.deepEqual(calls, ['a.wide', 'b.wide']);
    await executor.run('k', { expr: 'camera:a.close' });                       // not a cue run: unaffected
    clock.t += 1500;
    const again = await executor.run('k', { expr: 'camera:a.wide' }, { deviceCooldown: true });
    assert.equal(again.steps[0].status, 'ok');
  });

  it('handler keys ignore a [viewport] suffix and the handler sees the full key', async () => {
    const { executor, calls } = make();
    assert.equal(executor.isServerAtom('graphics[vertical-left]'), true);
    assert.equal(executor.isDeviceAtom('graphics[vertical-left]'), false);
    const r = await executor.run('k', { expr: 'graphics[vertical-left]:+logo | graphics:-banner' });
    assert.deepEqual(r.steps.map((s) => s.where), ['server', 'server']);
    assert.deepEqual(calls, ['graphics[vertical-left]=+logo', 'graphics=-banner']);
  });

  it('currentCausation is visible inside a step, including across awaits, and a nested run is one level deeper', async () => {
    const seen = [];
    const { executor } = make({
      probe: async () => { await new Promise((r) => setImmediate(r)); seen.push(currentCausation()); return { ok: true }; },
    });
    assert.equal(currentCausation(), undefined);
    await executor.run('k', { expr: 'probe:1' }, { causation: { rootId: 'root', depth: 2 } });
    assert.equal(seen[0].rootId, 'root');
    assert.equal(seen[0].depth, 2);
    let depth;
    // same executor instance runs the nested call: build one with both handlers
    const both = make({
      probe2: async () => { depth = currentCausation().depth; return { ok: true }; },
      inner: async () => { await both.executor.run('k', { expr: 'probe2:1' }); return { ok: true }; },
    });
    await both.executor.run('k', { expr: 'inner:1' }, { causation: { rootId: 'r', depth: 1 } });
    assert.equal(depth, 2);
  });
});
