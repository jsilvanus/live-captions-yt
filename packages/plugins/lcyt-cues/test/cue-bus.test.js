/**
 * `cue.fired` on the EventBus (docs/plans/plan_backend_actions.md).
 *
 * Every cue-firing site (explicit metacode, auto rules, event/inline/composite
 * results, sound and tracker listeners) goes through createCueEmitter, which
 * keeps the legacy per-session `cue_fired` event AND publishes the canonical
 * `cue.fired` topic under the project's apiKey — with or without a session.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { EventBus } from 'lcyt/event-bus';

import {
  createCueProcessor, createCueEmitter, createSoundCueListener, createTrackerCueListener,
} from '../src/cue-processor.js';

function makeBus() {
  const bus = new EventBus();
  const seen = [];
  bus.tap((e) => seen.push(e));
  return { bus, seen };
}

function makeStore(apiKey) {
  const emitter = new EventEmitter();
  const emitted = [];
  emitter.on('event', (e) => emitted.push(e));
  const session = { apiKey, emitter };
  return {
    emitted,
    session,
    getByApiKey: (k) => (k === apiKey ? session : null),
    all: () => [session],
    onNewSession: null,
  };
}

const noDb = { exec() {}, prepare() { return { run() { return {}; }, all() { return []; } }; } };

const rule = { id: 'r1', name: 'amen', match_type: 'phrase', action: '{"run":"@intro"}' };

describe('cue.fired on the event bus', () => {
  test('explicit cue publishes cue.fired even with no session open', () => {
    const { bus, seen } = makeBus();
    const engine = { evaluate: () => [], invalidate() {} };
    const proc = createCueProcessor({ store: makeStore('other'), db: noDb, engine, eventBus: bus });
    proc('key1', '<!-- cue:prayer -->');
    assert.equal(seen.length, 1);
    assert.equal(seen[0].topic, 'cue.fired');
    assert.equal(seen[0].projectId, 'key1');
    assert.equal(seen[0].data.label, 'prayer');
    assert.equal(seen[0].data.source, 'explicit');
  });

  test('keeps the legacy session event as well as the bus topic', () => {
    const { bus, seen } = makeBus();
    const store = makeStore('key1');
    const proc = createCueProcessor({ store, db: noDb, engine: { evaluate: () => [], invalidate() {} }, eventBus: bus });
    proc('key1', '<!-- cue:prayer -->');
    assert.equal(store.emitted.filter((e) => e.type === 'cue_fired').length, 1);
    assert.equal(seen.filter((e) => e.topic === 'cue.fired').length, 1);
  });

  test('auto rule carries the parsed action, rule id and matched text', () => {
    const { bus, seen } = makeBus();
    const engine = { evaluate: () => [{ rule, matched: 'amen' }], invalidate() {} };
    const proc = createCueProcessor({ store: null, db: noDb, engine, eventBus: bus });
    proc('key1', 'and all said amen');
    assert.equal(seen.length, 1);
    assert.deepEqual(
      { ...seen[0].data, ts: undefined },
      { label: 'amen', source: 'auto', ruleId: 'r1', matchType: 'phrase', matched: 'amen', action: { run: '@intro' }, ts: undefined },
    );
  });

  test('event/inline/composite results are published once each', async () => {
    const { bus, seen } = makeBus();
    const engine = {
      evaluate: () => [],
      async evaluateEventCues(apiKey, text, cb) { cb([{ rule: { ...rule, source: 'inline' }, matched: 'x' }]); },
      async evaluateCompositeRules(apiKey, text, codes, cb) { cb([{ rule: { ...rule, id: 'c1', match_type: 'composite' }, matched: 'y' }]); },
    };
    const proc = createCueProcessor({ store: null, db: noDb, engine, eventBus: bus });
    proc('key1', 'hello');
    await new Promise((r) => setImmediate(r));
    const sources = seen.map((e) => e.data.source).sort();
    assert.deepEqual(sources, ['composite', 'inline']);
  });

  test('works without a bus or a store, and a throwing bus never breaks processing', () => {
    const engine = { evaluate: () => [{ rule, matched: 'amen' }], invalidate() {} };
    assert.equal(createCueProcessor({ store: null, db: noDb, engine })('key1', 'amen'), 'amen');
    const badBus = { publish() { throw new Error('bus down'); } };
    assert.equal(createCueProcessor({ store: null, db: noDb, engine, eventBus: badBus })('key1', 'amen'), 'amen');
  });

  test('createCueEmitter publishes nothing without an apiKey', () => {
    const { bus, seen } = makeBus();
    createCueEmitter({ eventBus: bus })('', { label: 'x' });
    assert.equal(seen.length, 0);
  });

  test('sound listener publishes cue.fired for music_start rules', () => {
    const { bus, seen } = makeBus();
    const store = makeStore('key1');
    const engine = { evaluateSoundEvent: () => [{ rule: { ...rule, match_type: 'music_start' }, matched: 'music' }] };
    createSoundCueListener({ store, engine, eventBus: bus });
    store.session.emitter.emit('event', { type: 'sound_label', data: { label: 'music' } });
    const cue = seen.filter((e) => e.topic === 'cue.fired');
    assert.equal(cue.length, 1);
    assert.equal(cue[0].projectId, 'key1');
    assert.equal(cue[0].data.source, 'sound');
    assert.equal(cue[0].data.matchType, 'music_start');
  });

  test('tracker listener publishes cue.fired for track rules', () => {
    const { bus, seen } = makeBus();
    const store = makeStore('key1');
    const engine = { evaluateTrackerEvent: () => [{ rule: { ...rule, match_type: 'track' }, matched: 'track:presenter' }] };
    createTrackerCueListener({ store, engine, eventBus: bus });
    store.session.emitter.emit('event', { type: 'track_state', data: { labels: [] } });
    const cue = seen.filter((e) => e.topic === 'cue.fired');
    assert.equal(cue.length, 1);
    assert.equal(cue[0].data.source, 'track');
  });
});
