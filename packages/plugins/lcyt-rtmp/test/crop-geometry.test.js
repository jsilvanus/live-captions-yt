/**
 * Pure geometry tests for crop-manager.js (plan_vertical_crop.md).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeCropGeometry, normToPixels, clampNorm, buildEaseSteps } from '../src/crop-manager.js';

describe('computeCropGeometry', () => {
  test('16:9 1080p → 9:16 window is 608x1080 with horizontal travel only', () => {
    const g = computeCropGeometry({ inW: 1920, inH: 1080, aspectW: 9, aspectH: 16 });
    assert.equal(g.cropW, 608); // round_even(1080 * 9/16 = 607.5)
    assert.equal(g.cropH, 1080);
    assert.equal(g.maxX, 1920 - 608);
    assert.equal(g.maxY, 0);
  });

  test('16:9 720p → 9:16 window scales with input height', () => {
    const g = computeCropGeometry({ inW: 1280, inH: 720, aspectW: 9, aspectH: 16 });
    assert.equal(g.cropW, 406); // round_even(720 * 9/16 = 405)
    assert.equal(g.cropH, 720);
  });

  test('4:3 source → 9:16 window still uses full height', () => {
    const g = computeCropGeometry({ inW: 1440, inH: 1080, aspectW: 9, aspectH: 16 });
    assert.equal(g.cropW, 608);
    assert.equal(g.cropH, 1080);
    assert.equal(g.maxX, 1440 - 608);
  });

  test('1:1 source cropped to 9:16 still uses full height (horizontal travel)', () => {
    const g = computeCropGeometry({ inW: 1080, inH: 1080, aspectW: 9, aspectH: 16 });
    assert.equal(g.cropW, 608);
    assert.equal(g.cropH, 1080);
    assert.equal(g.maxX, 1080 - 608);
  });

  test('source narrower than target aspect pins width and shrinks height (vertical travel)', () => {
    // 500-wide portrait-ish source cropped to 9:16 — full width, reduced height
    const g = computeCropGeometry({ inW: 500, inH: 1080, aspectW: 9, aspectH: 16 });
    assert.equal(g.cropW, 500);
    assert.equal(g.cropH, 888); // round_even(500 * 16/9 = 888.9)
    assert.equal(g.maxX, 0);
    assert.equal(g.maxY, 1080 - 888);
    // 16:9 source cropped to 16:9 (degenerate) — full frame, no travel
    const g2 = computeCropGeometry({ inW: 1920, inH: 1080, aspectW: 16, aspectH: 9 });
    assert.equal(g2.cropW, 1920);
    assert.equal(g2.cropH, 1080);
    assert.equal(g2.maxX, 0);
    assert.equal(g2.maxY, 0);
  });

  test('crop window dimensions are always even (libx264 requirement)', () => {
    for (const [inW, inH] of [[1919, 1079], [1280, 719], [854, 480]]) {
      const g = computeCropGeometry({ inW, inH, aspectW: 9, aspectH: 16 });
      assert.equal(g.cropW % 2, 0, `cropW even for ${inW}x${inH}`);
    }
  });
});

describe('normToPixels', () => {
  const geom = { maxX: 1312, maxY: 0 };

  test('0 / 0.5 / 1 map to left / centre / right of the travel range', () => {
    assert.deepEqual(normToPixels({ xNorm: 0, yNorm: 0 }, geom), { x: 0, y: 0 });
    assert.deepEqual(normToPixels({ xNorm: 1, yNorm: 0 }, geom), { x: 1312, y: 0 });
    assert.equal(normToPixels({ xNorm: 0.5, yNorm: 0 }, geom).x, 656);
  });

  test('out-of-range and non-numeric values are clamped', () => {
    assert.equal(normToPixels({ xNorm: 2, yNorm: 0 }, geom).x, 1312);
    assert.equal(normToPixels({ xNorm: -1, yNorm: 0 }, geom).x, 0);
    assert.equal(normToPixels({ xNorm: 'junk', yNorm: 0 }, geom).x, 0);
  });

  test('pixel offsets are even', () => {
    const { x } = normToPixels({ xNorm: 0.333, yNorm: 0 }, geom);
    assert.equal(x % 2, 0);
  });
});

describe('clampNorm', () => {
  test('clamps to 0..1 and defaults non-numeric to 0', () => {
    assert.equal(clampNorm(0.5), 0.5);
    assert.equal(clampNorm(-3), 0);
    assert.equal(clampNorm(7), 1);
    assert.equal(clampNorm('x'), 0);
    assert.equal(clampNorm(undefined), 0);
  });
});

describe('buildEaseSteps', () => {
  test('ends exactly at the target and is monotonic for a forward move', () => {
    const steps = buildEaseSteps({ xNorm: 0, yNorm: 0 }, { xNorm: 1, yNorm: 0 }, 300, 33);
    assert.ok(steps.length >= 2);
    const last = steps[steps.length - 1];
    assert.equal(last.xNorm, 1);
    for (let i = 1; i < steps.length; i++) {
      assert.ok(steps[i].xNorm >= steps[i - 1].xNorm, 'monotonic');
    }
  });

  test('very short transition produces a single step at the target', () => {
    const steps = buildEaseSteps({ xNorm: 0.2, yNorm: 0 }, { xNorm: 0.8, yNorm: 0 }, 10, 33);
    assert.equal(steps.length, 1);
    assert.equal(steps[0].xNorm, 0.8);
  });

  test('ease is slower at the ends than the middle', () => {
    const steps = buildEaseSteps({ xNorm: 0, yNorm: 0 }, { xNorm: 1, yNorm: 0 }, 990, 33); // 30 steps
    const first = steps[0].xNorm;
    const midDelta = steps[15].xNorm - steps[14].xNorm;
    assert.ok(first < midDelta, `first step ${first} should be smaller than mid-step delta ${midDelta}`);
  });
});
