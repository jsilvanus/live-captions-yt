import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from 'lcyt/event-bus';
import { createCueActionDispatcher } from '../src/api.js';

function setup({ armed = true, ...opts } = {}) {
  const eventBus = new EventBus();
  const runs = [];
  const events = [];
  eventBus.subscribe('k', ['action.*'], (e) => events.push(e));
  const state = { armed, clock: 1_000_000 };
  const executor = {
    run: async (apiKey, target, o) => {
      runs.push({ apiKey, target, opts: o });
      return { ok: true, runId: `r${runs.length}`, steps: [], clientAtoms: target.expr.includes('audio:') ? [{ metacode: 'audio', value: 'start' }] : [] };
    },
  };
  const dispatcher = createCueActionDispatcher({ eventBus, executor, isArmed: () => state.armed, now: () => state.clock, ...opts });
  const fire = (data, projectId = 'k') => dispatcher.handle({ topic: 'cue.fired', projectId, data });
  return { eventBus, dispatcher, runs, events, state, fire };
}
const cue = (over = {}) => ({ label: 'Amen', source: 'auto', ruleId: 'r1', action: { run: 'camera:a.b' }, ...over });

describe('CueActionDispatcher', () => {
  let t;
  beforeEach(() => { t = setup(); });

  it('runs a rule with action.run as the cue source, armed', async () => {
    await t.fire(cue({ action: { run: '@intro | camera:a.b', stopOnError: true } }));
    assert.equal(t.runs.length, 1);
    assert.deepEqual(t.runs[0].target, { expr: '@intro | camera:a.b' });
    assert.equal(t.runs[0].opts.source, 'cue');
    assert.equal(t.runs[0].opts.skipDevices, false);
    assert.equal(t.runs[0].opts.stopOnError, true);
    assert.equal(t.runs[0].opts.causation.depth, 1);
  });

  it('skips device steps while disarmed but still runs the action', async () => {
    t.state.armed = false;
    await t.fire(cue());
    assert.equal(t.runs[0].opts.skipDevices, true);
  });

  it('ignores cues without run, without a rule, or from inline/explicit sources', async () => {
    await t.fire(cue({ action: { type: 'goto' } }));
    await t.fire(cue({ action: { run: '' } }));
    await t.fire(cue({ ruleId: undefined }));
    await t.fire(cue({ source: 'inline' }));
    await t.fire(cue({ source: 'explicit' }));
    await t.fire(cue({ action: 'camera:a.b' }));
    assert.equal(t.runs.length, 0);
  });

  it('applies a per-rule cooldown, overridable and disableable per rule', async () => {
    await t.fire(cue());
    await t.fire(cue());
    assert.equal(t.runs.length, 1);
    assert.equal(t.events.at(-1).topic, 'action.skipped');
    assert.equal(t.events.at(-1).data.reason, 'cooldown');
    t.state.clock += 2001;
    await t.fire(cue());
    assert.equal(t.runs.length, 2);
    await t.fire(cue({ action: { run: 'camera:a.b', cooldownMs: 0 } }));
    await t.fire(cue({ action: { run: 'camera:a.b', cooldownMs: 0 } }));
    assert.equal(t.runs.length, 4);
    await t.fire(cue({ ruleId: 'other' }));
    assert.equal(t.runs.length, 5);
  });

  it('cooldown is per project', async () => {
    await t.fire(cue());
    await t.fire(cue(), 'k2');
    assert.equal(t.runs.length, 2);
  });

  it('refuses event-driven cues chained deeper than 3 within the window, then recovers', async () => {
    const ev = (n) => cue({ source: 'track', ruleId: `e${n}` });
    for (let n = 1; n <= 3; n++) { await t.fire(ev(n)); t.state.clock += 500; }
    assert.deepEqual(t.runs.map((r) => r.opts.causation.depth), [1, 2, 3]);
    assert.equal(new Set(t.runs.map((r) => r.opts.causation.rootId)).size, 1);
    await t.fire(ev(4));
    assert.equal(t.runs.length, 3);
    assert.equal(t.events.at(-1).data.reason, 'loop_guard');
    t.state.clock += 4000; // quiet gap
    await t.fire(ev(5));
    assert.equal(t.runs.length, 4);
    assert.equal(t.runs[3].opts.causation.depth, 1);
  });

  it('text-matched cues never chain, but start the window for event cues after them', async () => {
    for (let n = 1; n <= 5; n++) { await t.fire(cue({ ruleId: `p${n}` })); t.state.clock += 100; }
    assert.equal(t.runs.length, 5);
    assert.ok(t.runs.every((r) => r.opts.causation.depth === 1));
    await t.fire(cue({ source: 'event_cue', ruleId: 'x' }));
    assert.equal(t.runs.at(-1).opts.causation.depth, 2);
  });

  it('publishes browser atoms of a cue-started run', async () => {
    await t.fire(cue({ action: { run: 'audio:start | camera:a.b' } }));
    const ev = t.events.find((e) => e.topic === 'action.client_atoms');
    assert.deepEqual(ev.data.atoms, [{ metacode: 'audio', value: 'start' }]);
  });

  it('start() taps the bus for cue.fired only and swallows executor errors', async () => {
    const x = setup();
    x.dispatcher.start();
    x.dispatcher.start(); // idempotent
    x.eventBus.publish('k', 'cue.fired', cue());
    x.eventBus.publish('k', 'caption.sent', cue({ ruleId: 'zz' }));
    await new Promise((r) => setImmediate(r));
    assert.equal(x.runs.length, 1);
    x.dispatcher.stop();
    x.state.clock += 5000;
    x.eventBus.publish('k', 'cue.fired', cue());
    await new Promise((r) => setImmediate(r));
    assert.equal(x.runs.length, 1);

    const boom = createCueActionDispatcher({
      eventBus: x.eventBus, isArmed: () => true,
      executor: { run: async () => { throw new Error('kaboom'); } },
    });
    boom.start();
    x.eventBus.publish('k', 'cue.fired', cue({ ruleId: 'new' }));
    await new Promise((r) => setImmediate(r)); // must not reject unhandled
    boom.stop();
  });
});

describe('CueActionDispatcher — ambient causation and device cooldown', () => {
  it('a cue fired inside a running action is exactly one level deeper, whatever its source, and depth 4 is refused', async () => {
    const eventBus = new EventBus();
    const depths = [];
    const events = [];
    eventBus.subscribe('k', ['action.*'], (e) => events.push(e));
    const { createActionExecutor } = await import('../src/api.js');
    const Database = (await import('better-sqlite3')).default;
    const { initActions } = await import('../src/api.js');
    const db = new Database(':memory:');
    initActions(db);
    let n = 0;
    const executor = createActionExecutor({
      db, eventBus,
      handlers: {
        // Each step raises another text-matched cue synchronously, like a device move feeding a cue.
        loop: async () => { eventBus.publish('k', 'cue.fired', { label: 'x', source: 'auto', ruleId: `r${++n}`, action: { run: 'loop:1', cooldownMs: 0 } }); return { ok: true }; },
      },
    });
    const dispatcher = createCueActionDispatcher({ eventBus, executor, isArmed: () => true });
    const orig = executor.run;
    executor.run = (a, t, o) => { depths.push(o?.causation?.depth); return orig(a, t, o); };
    dispatcher.start();
    eventBus.publish('k', 'cue.fired', { label: 'x', source: 'auto', ruleId: 'r0', action: { run: 'loop:1', cooldownMs: 0 } });
    await new Promise((r) => setTimeout(r, 50));
    dispatcher.stop();
    assert.deepEqual(depths, [1, 2, 3]);
    assert.ok(events.some((e) => e.topic === 'action.skipped' && e.data.reason === 'loop_guard'));
  });

  it('passes deviceCooldown to the executor', async () => {
    const eventBus = new EventBus();
    let opts;
    const d = createCueActionDispatcher({ eventBus, isArmed: () => true, executor: { run: async (a, t, o) => { opts = o; return { ok: true }; } } });
    await d.handle({ projectId: 'k', topic: 'cue.fired', data: { source: 'auto', ruleId: 'r', action: { run: 'camera:a.b' } } });
    assert.equal(opts.deviceCooldown, true);
  });
});
