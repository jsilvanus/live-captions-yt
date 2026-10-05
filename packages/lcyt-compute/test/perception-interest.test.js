import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createInterestDetector } from '../src/perception/interest.js';

const p = (id) => ({ label: 'person', trackId: id });
const kinds = (evs) => evs.map((e) => `${e.kind}${e.trackId ? ':' + e.trackId : ''}`);

describe('interest detector', () => {
  it('reports a person entering, once, and leaving after the grace period', () => {
    const d = createInterestDetector({ leaveGraceMs: 1000, stableMs: 99999 });
    assert.deepEqual(kinds(d.update({ ts: 0, objects: [p('t1')] })), ['person_entered:t1']);
    assert.deepEqual(kinds(d.update({ ts: 200, objects: [p('t1')] })), []);
    assert.deepEqual(kinds(d.update({ ts: 400, objects: [] })), []); // inside grace
    assert.deepEqual(kinds(d.update({ ts: 1500, objects: [] })), ['person_left:t1']);
    assert.deepEqual(kinds(d.update({ ts: 1700, objects: [] })), []);
  });

  it('a track that flickers out and back inside the grace period causes nothing', () => {
    const d = createInterestDetector({ leaveGraceMs: 1000, stableMs: 99999 });
    d.update({ ts: 0, objects: [p('t1')] });
    assert.deepEqual(d.update({ ts: 300, objects: [] }), []);
    assert.deepEqual(d.update({ ts: 600, objects: [p('t1')] }), []);
  });

  it('track_stable fires once per track after stableMs', () => {
    const d = createInterestDetector({ stableMs: 3000 });
    d.update({ ts: 0, objects: [p('t1')] });
    assert.deepEqual(kinds(d.update({ ts: 2900, objects: [p('t1')] })), []);
    assert.deepEqual(kinds(d.update({ ts: 3100, objects: [p('t1')] })), ['track_stable:t1']);
    assert.deepEqual(kinds(d.update({ ts: 6000, objects: [p('t1')] })), []);
  });

  it('visible:false is a confirmed absence: leaves are immediate', () => {
    const d = createInterestDetector({ leaveGraceMs: 5000, stableMs: 99999 });
    d.update({ ts: 0, objects: [p('t1'), p('t2')] });
    assert.deepEqual(kinds(d.update({ ts: 100, objects: [], visible: false })).sort(), ['person_left:t1', 'person_left:t2']);
  });

  it('detectors without track ids fall back to count changes; other labels are ignored', () => {
    const d = createInterestDetector();
    assert.deepEqual(kinds(d.update({ ts: 0, objects: [{ label: 'person' }] })), ['person_entered']);
    assert.deepEqual(kinds(d.update({ ts: 1, objects: [{ label: 'person' }, { label: 'person' }, { label: 'chair' }] })), ['person_entered']);
    assert.deepEqual(kinds(d.update({ ts: 2, objects: [{ label: 'person' }] })), ['person_left']);
  });

  it('framing_dropped fires on a fall below the low mark, then needs recovery above the high mark', () => {
    const d = createInterestDetector({ framingLow: 0.45, framingHigh: 0.6, stableMs: 99999 });
    const f = (ts, score) => kinds(d.update({ ts, objects: [], framing: { score } }));
    assert.deepEqual(f(0, 0.8), []);
    assert.deepEqual(f(1, 0.5), []);          // dip but not below the low mark
    assert.deepEqual(f(2, 0.3), ['framing_dropped']);
    assert.deepEqual(f(3, 0.2), []);          // still bad: no repeat
    assert.deepEqual(f(4, 0.5), []);          // not recovered (below high mark)
    assert.deepEqual(f(5, 0.7), []);          // recovered
    assert.deepEqual(f(6, 0.3), ['framing_dropped']);
  });
});
