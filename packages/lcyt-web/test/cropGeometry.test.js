import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCropBox, boxFrac, fracToNorm } from '../src/lib/cropGeometry.js';

test('computeCropBox derives a 9:16 window out of a 1920x1080 frame', () => {
  const box = computeCropBox({ inW: 1920, inH: 1080, aspectW: 9, aspectH: 16 });
  assert.equal(box.cropH, 1080);
  assert.equal(box.cropW, 608); // round_even(1080 * 9/16) = 607.5 -> 608
  assert.equal(box.maxY, 0);
  assert.equal(box.maxX, 1920 - 608);
});

test('computeCropBox clamps the window width to the input width', () => {
  const box = computeCropBox({ inW: 400, inH: 1080, aspectW: 9, aspectH: 16 });
  assert.ok(box.cropW <= 400);
  assert.equal(box.maxX, 0);
});

test('computeCropBox returns null without input dimensions', () => {
  assert.equal(computeCropBox({ inW: 0, inH: 1080 }), null);
  assert.equal(computeCropBox({ inW: 1920, inH: undefined }), null);
});

test('boxFrac places the box at the left edge for xNorm=0', () => {
  const geo = computeCropBox({ inW: 1920, inH: 1080, aspectW: 9, aspectH: 16 });
  const f = boxFrac({ xNorm: 0, yNorm: 0 }, { inW: 1920, inH: 1080, ...geo });
  assert.equal(f.leftFrac, 0);
  assert.ok(Math.abs(f.widthFrac - geo.cropW / 1920) < 1e-9);
});

test('boxFrac places the box at the right edge for xNorm=1', () => {
  const geo = computeCropBox({ inW: 1920, inH: 1080, aspectW: 9, aspectH: 16 });
  const f = boxFrac({ xNorm: 1, yNorm: 0 }, { inW: 1920, inH: 1080, ...geo });
  assert.ok(Math.abs(f.leftFrac - geo.maxX / 1920) < 1e-9);
});

test('boxFrac clamps out-of-range normalised input', () => {
  const geo = computeCropBox({ inW: 1920, inH: 1080, aspectW: 9, aspectH: 16 });
  const f = boxFrac({ xNorm: -1, yNorm: 5 }, { inW: 1920, inH: 1080, ...geo });
  assert.equal(f.leftFrac, 0);
  assert.ok(f.topFrac <= 1);
});

test('fracToNorm is the inverse of boxFrac for round-trip positions', () => {
  const geo = computeCropBox({ inW: 1920, inH: 1080, aspectW: 9, aspectH: 16 });
  const full = { inW: 1920, inH: 1080, ...geo };
  for (const xNorm of [0, 0.25, 0.5, 0.75, 1]) {
    const f = boxFrac({ xNorm, yNorm: 0 }, full);
    const back = fracToNorm(f.leftFrac, f.topFrac, f);
    assert.ok(Math.abs(back.xNorm - xNorm) < 1e-6, `${back.xNorm} ~= ${xNorm}`);
  }
});

test('fracToNorm handles a box with zero travel range (maxXFrac=0)', () => {
  // cropW === inW means widthFrac === 1, so xNorm is always 0 regardless of drag.
  const back = fracToNorm(0.3, 0, { widthFrac: 1, heightFrac: 0.5 });
  assert.equal(back.xNorm, 0);
});
