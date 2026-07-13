import { describe, it } from 'node:test';
import assert from 'node:assert';
import { EventBus } from 'lcyt/event-bus';
import { DskBus } from '../src/dsk-bus.js';

function fakeRes() {
  return { frames: [], write(s) { this.frames.push(s); return true; } };
}
function parseFrame(frame) {
  const m = /^event: (.*)\ndata: (.*)\n\n$/s.exec(frame);
  assert.ok(m, `unparseable frame: ${JSON.stringify(frame)}`);
  return { event: m[1], data: JSON.parse(m[2]) };
}

describe('DskBus delegates to the shared EventBus', () => {
  it('legacy subscriber keeps historical event names + raw data', () => {
    const bus = new DskBus(new EventBus());
    const res = fakeRes();
    bus.addDskSubscriber('proj1', res);

    bus.emitDskEvent('proj1', 'graphics', { default: ['logo'], viewports: {}, ts: 1 });
    bus.emitDskEvent('proj1', 'bindings', { codes: { section: 'A' }, ts: 2 });

    assert.equal(res.frames.length, 2);
    const g = parseFrame(res.frames[0]);
    assert.equal(g.event, 'graphics'); // historical name, not the canonical topic
    assert.deepEqual(g.data, { default: ['logo'], viewports: {}, ts: 1 }); // raw payload
    assert.equal(parseFrame(res.frames[1]).event, 'bindings');
  });

  it('a canonical envelope subscriber on the same bus sees the same publish', () => {
    const eventBus = new EventBus();
    const dskBus = new DskBus(eventBus);
    const legacy = fakeRes();
    const unified = fakeRes();
    dskBus.addDskSubscriber('proj1', legacy);
    // e.g. what GET /events/stream registers — full envelope, canonical topic.
    eventBus.subscribeSse('proj1', ['dsk.*'], unified);

    dskBus.emitDskEvent('proj1', 'graphics', { default: ['logo'], viewports: {}, ts: 9 });

    assert.equal(parseFrame(legacy.frames[0]).event, 'graphics');
    const u = parseFrame(unified.frames[0]);
    assert.equal(u.event, 'dsk.graphics_changed');
    assert.equal(u.data.topic, 'dsk.graphics_changed');
    assert.deepEqual(u.data.data, { default: ['logo'], viewports: {}, ts: 9 });
  });

  it('removeDskSubscriber stops delivery', () => {
    const bus = new DskBus(new EventBus());
    const res = fakeRes();
    bus.addDskSubscriber('proj1', res);
    bus.emitDskEvent('proj1', 'text', { text: 'hi', ts: 1 });
    bus.removeDskSubscriber('proj1', res);
    bus.emitDskEvent('proj1', 'text', { text: 'bye', ts: 2 });
    assert.equal(res.frames.length, 1);
  });

  it('graphics state is per-key and unaffected by the bus delegation', () => {
    const bus = new DskBus(new EventBus());
    assert.deepEqual(bus.getDskGraphicsState('proj1'), { default: [], viewports: {} });
    bus.setDskGraphicsState('proj1', { default: ['a'], viewports: { v: ['b'] } });
    assert.deepEqual(bus.getDskGraphicsState('proj1'), { default: ['a'], viewports: { v: ['b'] } });
    assert.deepEqual(bus.getDskGraphicsState('proj2'), { default: [], viewports: {} });
  });
});
