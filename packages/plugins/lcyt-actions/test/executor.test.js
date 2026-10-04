import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { EventBus } from 'lcyt/event-bus';
import { initActions, createActionDef, createActionExecutor, parseWaitMs } from '../src/api.js';

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
