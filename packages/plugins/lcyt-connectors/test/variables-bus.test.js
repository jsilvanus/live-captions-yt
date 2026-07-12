import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from 'lcyt/event-bus';
import { VariablesBus, variableTopic } from '../src/variables-bus.js';

function fakeRes() {
  return { frames: [], write(s) { this.frames.push(s); return true; } };
}
function parseFrame(frame) {
  const m = /^event: (.*)\ndata: (.*)\n\n$/s.exec(frame);
  assert.ok(m, `unparseable: ${JSON.stringify(frame)}`);
  return { event: m[1], data: JSON.parse(m[2]) };
}

describe('VariablesBus per-variable topics', () => {
  it('variableTopic builds variable.<name>.changed', () => {
    assert.equal(variableTopic('section'), 'variable.section.changed');
  });

  it('publishes variable.<name>.changed carrying the value', () => {
    const eventBus = new EventBus();
    const bus = new VariablesBus(eventBus);
    const seen = [];
    eventBus.subscribe('proj', ['variable.*'], (e) => seen.push(e));

    bus.emitVariableUpdated('proj', { name: 'section', value: 'Prayer', source: 'manual', resolvedAt: null });

    assert.equal(seen.length, 1);
    assert.equal(seen[0].topic, 'variable.section.changed');
    assert.equal(seen[0].data.value, 'Prayer'); // content rides along
  });

  it('a single-variable subscription only sees its own variable', () => {
    const eventBus = new EventBus();
    const bus = new VariablesBus(eventBus);
    const seen = [];
    eventBus.subscribe('proj', ['variable.section.changed'], (e) => seen.push(e.data.name));

    bus.emitVariableUpdated('proj', { name: 'section', value: 'A' });
    bus.emitVariableUpdated('proj', { name: 'hymn', value: 'B' });

    assert.deepEqual(seen, ['section']);
  });

  it('legacy /variables/events subscriber still receives variable_updated with raw data', () => {
    const bus = new VariablesBus(new EventBus());
    const res = fakeRes();
    bus.addSubscriber('proj', res);

    bus.emitVariableUpdated('proj', { name: 'section', value: 'A', source: 'manual', resolvedAt: null });

    assert.equal(res.frames.length, 1);
    const { event, data } = parseFrame(res.frames[0]);
    assert.equal(event, 'variable_updated'); // historical name preserved
    assert.deepEqual(data, { name: 'section', value: 'A', source: 'manual', resolvedAt: null });
  });
});
