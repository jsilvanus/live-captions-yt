import { test } from 'node:test';
import assert from 'node:assert/strict';
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-3, `${msg ?? ''} ${a} vs ${b}`);
import { anchorCount, decodeCandidates, nms, rgbToTensor } from '../src/perception/yolox.js';

/** A flat [anchors, 85] tensor where every row is "nothing" except the given rows. */
function tensor(anchors, rows) {
  const data = new Float32Array(anchors * 85);
  for (const [index, { cx, cy, w, h, obj, person }] of Object.entries(rows)) {
    const o = Number(index) * 85;
    data.set([cx, cy, w, h, obj], o);
    data[o + 5] = person; // class 0 = person
  }
  return data;
}

test('anchorCount for a 416 input is 52^2 + 26^2 + 13^2', () => {
  assert.equal(anchorCount(416), 2704 + 676 + 169);
});

test('decodeCandidates decodes grid-relative output into input pixels', () => {
  const size = 416;
  const anchors = anchorCount(size);
  // Stride 8 row for grid cell (gx 10, gy 5) is index 5 * 52 + 10 = 270.
  const data = tensor(anchors, { 270: { cx: 0.5, cy: 0.5, w: Math.log(4), h: Math.log(8), obj: 0.9, person: 0.9 } });
  const found = decodeCandidates(data, anchors, size, { minScore: 0.5 });
  assert.equal(found.length, 1);
  const f = found[0];
  // centre ((10 + 0.5) * 8, (5 + 0.5) * 8) = (84, 44), size (4 * 8, 8 * 8) = (32, 64)
  close(f.w, 32);
  close(f.h, 64);
  close(f.x, 84 - 16);
  close(f.y, 44 - 32);
  assert.ok(Math.abs(f.score - 0.81) < 1e-6);
});

test('decodeCandidates reads stride 16 and 32 rows after the stride 8 block', () => {
  const size = 416;
  const anchors = anchorCount(size);
  const s16 = 2704 + 3 * 26 + 4; // cell (gx 4, gy 3) at stride 16
  const data = tensor(anchors, { [s16]: { cx: 0, cy: 0, w: Math.log(2), h: Math.log(2), obj: 1, person: 1 } });
  const [f] = decodeCandidates(data, anchors, size, { minScore: 0.5 });
  close(f.w, 32);
  close(f.x, 4 * 16 - 16);
  close(f.y, 3 * 16 - 16);
});

test('decodeCandidates ignores other classes and low scores', () => {
  const size = 416;
  const anchors = anchorCount(size);
  const data = tensor(anchors, { 0: { cx: 0, cy: 0, w: 1, h: 1, obj: 0.9, person: 0.1 } });
  data[5 + 1] = 0.99; // class 1 (bicycle) is high, but only class 0 is read
  assert.equal(decodeCandidates(data, anchors, size, { minScore: 0.35 }).length, 0);
});

test('decodeCandidates with decode off takes pixel boxes as they are', () => {
  const data = tensor(2, { 1: { cx: 100, cy: 80, w: 20, h: 40, obj: 1, person: 0.8 } });
  const [f] = decodeCandidates(data, 2, 416, { decode: false, minScore: 0.5 });
  assert.deepEqual([f.x, f.y, f.w, f.h], [90, 60, 20, 40]);
});

test('nms keeps the best of overlapping boxes and both of separate ones', () => {
  const kept = nms([
    { x: 10, y: 10, w: 100, h: 100, score: 0.9 },
    { x: 14, y: 12, w: 100, h: 100, score: 0.7 },
    { x: 300, y: 300, w: 50, h: 50, score: 0.6 },
  ], 0.45);
  assert.equal(kept.length, 2);
  assert.equal(kept[0].score, 0.9);
  assert.equal(kept[1].score, 0.6);
});

test('rgbToTensor builds a planar BGR float tensor', () => {
  const t = rgbToTensor(Buffer.from([10, 20, 30, 11, 21, 31, 12, 22, 32, 13, 23, 33]), 2);
  assert.deepEqual(Array.from(t), [30, 31, 32, 33, 20, 21, 22, 23, 10, 11, 12, 13]);
});
