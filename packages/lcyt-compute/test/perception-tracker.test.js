import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTracker, assign, iou } from '../src/perception/tracker.js';
import { scoreFraming } from '../src/perception/framing.js';
import { createTrackedDetector } from '../src/perception/tracked-detector.js';

const det = (x, y = 0.2, w = 0.15, h = 0.5, confidence = 0.9, label = 'person') => ({ label, confidence, bbox: { x, y, w, h } });

test('iou of identical, disjoint and half-overlapping boxes', () => {
  assert.equal(iou({ x: 0, y: 0, w: 1, h: 1 }, { x: 0, y: 0, w: 1, h: 1 }), 1);
  assert.equal(iou({ x: 0, y: 0, w: 0.1, h: 0.1 }, { x: 0.5, y: 0.5, w: 0.1, h: 0.1 }), 0);
  assert.ok(Math.abs(iou({ x: 0, y: 0, w: 2, h: 1 }, { x: 1, y: 0, w: 2, h: 1 }) - 1 / 3) < 1e-9);
});

test('assign finds the minimum total cost, also for non-square matrices', () => {
  assert.deepEqual(assign([[1, 2], [2, 1]]).sort(), [[0, 0], [1, 1]]);
  // Greedy would give 0->0 (cost 1) then 1->1 (cost 100); optimal is 0->1, 1->0 (cost 4).
  assert.deepEqual(assign([[1, 2], [2, 100]]).sort(), [[0, 1], [1, 0]]);
  assert.deepEqual(assign([[5, 1, 9]]), [[0, 1]]);
  assert.equal(assign([[1], [2], [3]]).length, 1);
  assert.deepEqual(assign([]), []);
});

test('a person who moves a little keeps the same id; it is reported from the second detection', () => {
  const tracker = createTracker();
  assert.deepEqual(tracker.update([det(0.3)]), []); // tentative
  const second = tracker.update([det(0.31)]);
  assert.equal(second.length, 1);
  const id = second[0].trackId;
  for (let i = 2; i < 12; i++) assert.equal(tracker.update([det(0.3 + 0.01 * i)])[0].trackId, id);
});

test('two people keep their own ids, also after they cross paths', () => {
  const tracker = createTracker();
  let a;
  let b;
  for (let i = 0; i < 20; i++) {
    const out = tracker.update([det(0.1 + 0.03 * i), det(0.7 - 0.03 * i)]);
    if (i === 3) { a = out.find((t) => t.bbox.x < 0.5); b = out.find((t) => t.bbox.x >= 0.5); }
  }
  const final = tracker.update([det(0.1 + 0.03 * 20), det(0.7 - 0.03 * 20)]);
  // They swapped sides during the walk; the ids followed the people.
  assert.equal(final.find((t) => t.trackId === a.trackId).bbox.x > 0.5, true);
  assert.equal(final.find((t) => t.trackId === b.trackId).bbox.x < 0.5, true);
});

test('a weak detection keeps a track alive through a bad frame instead of splitting it', () => {
  const tracker = createTracker();
  tracker.update([det(0.3)]);
  const id = tracker.update([det(0.3)])[0].trackId;
  const weak = tracker.update([det(0.3, 0.2, 0.15, 0.5, 0.3)]); // below the confident threshold
  assert.equal(weak[0].trackId, id);
});

test('a track survives a short gap, but an id is not reused after it is dropped', () => {
  const tracker = createTracker({ maxLost: 3 });
  tracker.update([det(0.3)]);
  const id = tracker.update([det(0.3)])[0].trackId;
  for (let i = 0; i < 3; i++) assert.deepEqual(tracker.update([]), []); // not reported while unmatched
  assert.equal(tracker.update([det(0.3)])[0].trackId, id); // back within maxLost: same id
  for (let i = 0; i < 5; i++) tracker.update([]);
  tracker.update([det(0.3)]);
  const next = tracker.update([det(0.3)])[0].trackId;
  assert.notEqual(next, id);
});

test('a one-frame false positive never gets an id', () => {
  const tracker = createTracker();
  assert.deepEqual(tracker.update([det(0.5)]), []);
  assert.deepEqual(tracker.update([]), []);
  assert.deepEqual(tracker.update([]), []);
});

test('a detection of another class never takes over a track', () => {
  const tracker = createTracker();
  tracker.update([det(0.3)]);
  const [p] = tracker.update([det(0.3)]);
  const out = tracker.update([det(0.3, 0.2, 0.15, 0.5, 0.9, 'cross')]);
  assert.equal(out.find((t) => t.label === 'person'), undefined);
  assert.notEqual(out.find((t) => t.label === 'cross')?.trackId, p.trackId);
});

test('framing: a centred subject with headroom scores high', () => {
  const f = scoreFraming([{ label: 'person', bbox: { x: 0.4, y: 0.1, w: 0.2, h: 0.6 } }]);
  assert.ok(f.score > 0.95, String(f.score));
  assert.deepEqual(f.notes, []);
});

test('framing: head cut off, off-centre, small and cut at the side each lower the score and say why', () => {
  const good = scoreFraming([{ label: 'person', bbox: { x: 0.4, y: 0.1, w: 0.2, h: 0.6 } }]).score;
  const cut = scoreFraming([{ label: 'person', bbox: { x: 0.4, y: 0, w: 0.2, h: 0.6 } }]);
  assert.ok(cut.score < good);
  assert.ok(cut.notes.includes('head cut off at the top'));
  const off = scoreFraming([{ label: 'person', bbox: { x: 0.0, y: 0.1, w: 0.2, h: 0.6 } }]);
  assert.ok(off.notes.includes('subject left of centre'));
  assert.ok(off.notes.includes('subject cut off at the side'));
  const small = scoreFraming([{ label: 'person', bbox: { x: 0.45, y: 0.4, w: 0.05, h: 0.12 } }]);
  assert.ok(small.notes.includes('subject small in frame'));
  assert.ok(small.score < 0.6);
});

test('framing: nobody in shot is null, and the biggest person is the subject', () => {
  assert.equal(scoreFraming([]), null);
  assert.equal(scoreFraming([{ label: 'cross', bbox: { x: 0.4, y: 0.1, w: 0.2, h: 0.6 } }]), null);
  const f = scoreFraming([
    { label: 'person', bbox: { x: 0.0, y: 0.5, w: 0.05, h: 0.1 } },
    { label: 'person', bbox: { x: 0.4, y: 0.1, w: 0.2, h: 0.6 } },
  ]);
  assert.deepEqual(f.subject, { x: 0.4, y: 0.1, w: 0.2, h: 0.6 });
});

test('tracked detector adds track ids and framing; no frame resets the tracks', async () => {
  let closed = false;
  const inner = { inputSize: 416, detect: async () => ({ objects: [det(0.4, 0.1, 0.2, 0.6)], framing: null }), close: async () => { closed = true; } };
  const tracked = createTrackedDetector(inner);
  assert.equal(tracked.inputSize, 416);
  assert.deepEqual((await tracked.detect(Buffer.from('f'))).objects, []); // first sighting is tentative
  const second = await tracked.detect(Buffer.from('f'));
  assert.equal(second.objects[0].trackId, 't1');
  assert.equal(second.objects[0].id, 't1');
  assert.ok(second.framing.score > 0.9);
  assert.equal(typeof second.framing.notes, 'string');
  assert.deepEqual(await tracked.detect(null), { objects: [], framing: null });
  await tracked.detect(Buffer.from('f'));
  const afterReset = await tracked.detect(Buffer.from('f'));
  assert.equal(afterReset.objects[0].trackId, 't2'); // a returning person is a new track
  await tracked.close();
  assert.equal(closed, true);
});
