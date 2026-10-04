import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from 'lcyt/event-bus';
import { attachBusMetrics } from '../src/metrics/bus-tap.js';

describe('attachBusMetrics — cues.fired', () => {
  it('counts the canonical cue.fired topic once per cue', () => {
    const bus = new EventBus();
    const counts = [];
    attachBusMetrics(bus, { count: (name, n, labels) => counts.push([name, n, labels]) });
    bus.publish('key1', 'cue.fired', { label: 'x' });
    assert.deepEqual(counts, [['cues.fired', 1, { project: 'key1' }]]);
  });

  it('does not count plugin.cue_fired (the same cue relayed via a session emitter)', () => {
    const bus = new EventBus();
    const counts = [];
    attachBusMetrics(bus, { count: (name, n) => counts.push([name, n]) });
    bus.publish('key1', 'plugin.cue_fired', { label: 'x' });
    assert.deepEqual(counts, []);
  });
});
