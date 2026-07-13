import { describe, it } from 'node:test';
import assert from 'node:assert';
import { EventBus, topicMatches } from '../src/event-bus.js';
// EventBus lives in lcyt core so both lcyt-backend and the plugins can import it
// (plugins cannot depend on lcyt-backend). See src/event-bus.js header.

// A minimal stand-in for an express Response's SSE surface. Captures written
// frames; can be told to throw on write to exercise the prune path.
function fakeRes() {
  return {
    frames: [],
    fail: false,
    write(s) {
      if (this.fail) throw new Error('EPIPE');
      this.frames.push(s);
      return true;
    },
  };
}

// Parse one `event: X\ndata: {json}\n\n` frame into { event, data }.
function parseFrame(frame) {
  const m = /^event: (.*)\ndata: (.*)\n\n$/s.exec(frame);
  assert.ok(m, `unparseable frame: ${JSON.stringify(frame)}`);
  return { event: m[1], data: JSON.parse(m[2]) };
}

describe('topicMatches', () => {
  it('null/empty patterns match everything', () => {
    assert.equal(topicMatches(null, 'dsk.graphics_changed'), true);
    assert.equal(topicMatches([], 'anything'), true);
  });

  it('exact match', () => {
    assert.equal(topicMatches(['cue.fired'], 'cue.fired'), true);
    assert.equal(topicMatches(['cue.fired'], 'cue.other'), false);
  });

  it('bare * matches everything', () => {
    assert.equal(topicMatches(['*'], 'anything.at.all'), true);
  });

  it('suffix wildcard matches by prefix only', () => {
    assert.equal(topicMatches(['dsk.*'], 'dsk.graphics_changed'), true);
    assert.equal(topicMatches(['dsk.*'], 'dsk.text'), true);
    assert.equal(topicMatches(['dsk.*'], 'variable.updated'), false);
    // must not leak across a partial-name boundary
    assert.equal(topicMatches(['dsk.*'], 'dskx.y'), false);
  });
});

describe('EventBus SSE delivery', () => {
  it('delivers matching topics as full envelopes by default', () => {
    const bus = new EventBus();
    const res = fakeRes();
    bus.subscribeSse('p1', ['dsk.*'], res);

    bus.publish('p1', 'dsk.graphics_changed', { layers: ['a'] });
    bus.publish('p1', 'variable.updated', { name: 'x' }); // non-matching topic

    assert.equal(res.frames.length, 1);
    const { event, data } = parseFrame(res.frames[0]);
    assert.equal(event, 'dsk.graphics_changed');
    assert.equal(data.topic, 'dsk.graphics_changed');
    assert.equal(data.projectId, 'p1');
    assert.deepEqual(data.data, { layers: ['a'] });
    assert.equal(typeof data.ts, 'number');
  });

  it('legacy wrapper mode: rename + raw data (no envelope) preserves wire shape', () => {
    const bus = new EventBus();
    const res = fakeRes();
    const rename = (t) => ({ 'dsk.graphics_changed': 'graphics', 'dsk.text': 'text' }[t]);
    bus.subscribeSse('p1', ['dsk.graphics_changed', 'dsk.text'], res, { rename, envelope: false });

    bus.publish('p1', 'dsk.graphics_changed', { layers: ['a'] });

    const { event, data } = parseFrame(res.frames[0]);
    assert.equal(event, 'graphics'); // historical event name
    assert.deepEqual(data, { layers: ['a'] }); // raw data, not the envelope
  });

  it('meta rides on the envelope (not in data) and is filterable', () => {
    const bus = new EventBus();
    const res = fakeRes();
    // e.g. how /events consumes only its own session's events off a project bus.
    bus.subscribeSse('p1', null, res, { filter: (e) => e.sessionId === 'sessB' });

    bus.publish('p1', 'caption.sent', { requestId: 'r1' }, { sessionId: 'sessA' });
    bus.publish('p1', 'caption.sent', { requestId: 'r2' }, { sessionId: 'sessB' });

    assert.equal(res.frames.length, 1);
    const { data } = parseFrame(res.frames[0]);
    assert.equal(data.sessionId, 'sessB'); // meta at envelope top-level
    assert.deepEqual(data.data, { requestId: 'r2' }); // payload untouched
  });

  it('meta cannot override core envelope fields', () => {
    const bus = new EventBus();
    const res = fakeRes();
    bus.subscribeSse('p1', null, res);
    bus.publish('p1', 'cue.fired', { n: 1 }, { topic: 'HACK', projectId: 'HACK', data: 'HACK' });
    const { data } = parseFrame(res.frames[0]);
    assert.equal(data.topic, 'cue.fired');
    assert.equal(data.projectId, 'p1');
    assert.deepEqual(data.data, { n: 1 });
  });

  it('filter predicate gates delivery (roleCode isolation)', () => {
    const bus = new EventBus();
    const res = fakeRes();
    bus.subscribeSse('p1', ['role.*'], res, {
      filter: (e) => e.data.roleCode === 'tracker',
    });

    bus.publish('p1', 'role.tracker_update', { roleCode: 'tracker', x: 1 });
    bus.publish('p1', 'role.describer_update', { roleCode: 'describer', x: 2 });

    assert.equal(res.frames.length, 1);
    assert.equal(parseFrame(res.frames[0]).data.data.roleCode, 'tracker');
  });

  it('isolates projects', () => {
    const bus = new EventBus();
    const a = fakeRes();
    const b = fakeRes();
    bus.subscribeSse('pA', null, a);
    bus.subscribeSse('pB', null, b);

    bus.publish('pA', 'cue.fired', { n: 1 });

    assert.equal(a.frames.length, 1);
    assert.equal(b.frames.length, 0);
  });

  it('prunes a subscriber whose write throws', () => {
    const bus = new EventBus();
    const good = fakeRes();
    const bad = fakeRes();
    bus.subscribeSse('p1', null, good);
    bus.subscribeSse('p1', null, bad);

    bad.fail = true;
    bus.publish('p1', 'cue.fired', { n: 1 }); // bad throws -> pruned
    bad.fail = false;
    bus.publish('p1', 'cue.fired', { n: 2 }); // only good remains

    assert.equal(good.frames.length, 2);
    assert.equal(bad.frames.length, 0);
  });

  it('unsubscribe stops delivery', () => {
    const bus = new EventBus();
    const res = fakeRes();
    const off = bus.subscribeSse('p1', null, res);
    bus.publish('p1', 'cue.fired', { n: 1 });
    off();
    bus.publish('p1', 'cue.fired', { n: 2 });
    assert.equal(res.frames.length, 1);
  });
});

describe('EventBus in-process listeners', () => {
  it('receives envelopes and is isolated from SSE subscribers', () => {
    const bus = new EventBus();
    const seen = [];
    bus.subscribe('p1', ['cue.fired'], (e) => seen.push(e));

    bus.publish('p1', 'cue.fired', { n: 1 });
    bus.publish('p1', 'dsk.text', { n: 2 }); // non-matching

    assert.equal(seen.length, 1);
    assert.equal(seen[0].topic, 'cue.fired');
    assert.deepEqual(seen[0].data, { n: 1 });
  });

  it('one throwing listener does not break others or SSE delivery', () => {
    const bus = new EventBus();
    const res = fakeRes();
    const seen = [];
    bus.subscribe('p1', null, () => { throw new Error('boom'); });
    bus.subscribe('p1', null, (e) => seen.push(e));
    bus.subscribeSse('p1', null, res);

    bus.publish('p1', 'cue.fired', { n: 1 });

    assert.equal(seen.length, 1);
    assert.equal(res.frames.length, 1);
  });

  it('unsubscribe stops the listener', () => {
    const bus = new EventBus();
    const seen = [];
    const off = bus.subscribe('p1', null, (e) => seen.push(e));
    bus.publish('p1', 'cue.fired', {});
    off();
    bus.publish('p1', 'cue.fired', {});
    assert.equal(seen.length, 1);
  });
});

describe('EventBus taps (audit sink hook)', () => {
  it('taps see every publish across all projects', () => {
    const bus = new EventBus();
    const seen = [];
    bus.tap((e) => seen.push(`${e.projectId}:${e.topic}`));

    bus.publish('pA', 'cue.fired', {});
    bus.publish('pB', 'dsk.graphics_changed', {});

    assert.deepEqual(seen, ['pA:cue.fired', 'pB:dsk.graphics_changed']);
  });

  it('a throwing tap does not break delivery', () => {
    const bus = new EventBus();
    const res = fakeRes();
    bus.tap(() => { throw new Error('boom'); });
    bus.subscribeSse('p1', null, res);
    bus.publish('p1', 'cue.fired', {});
    assert.equal(res.frames.length, 1);
  });
});
