import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { targetCenter, xNormForCenter, createFollowSmoother } from '../src/crop-follow.js';

const person = (x, w = 0.1, extra = {}) => ({ label: 'person', bbox: { x, y: 0.2, w, h: 0.6 }, confidence: 0.9, ...extra });
// 9:16 window in a 16:9 frame covers 9/16 / (16/9) = 0.316 of the width
const WINDOW = (9 / 16) / (16 / 9);

describe('crop follow geometry', () => {
  it('no people -> no target', () => {
    assert.equal(targetCenter([], { windowFrac: WINDOW }), null);
    assert.equal(targetCenter([{ label: 'chair', bbox: { x: 0, y: 0, w: 1, h: 1 } }], { windowFrac: WINDOW }), null);
  });

  it('a group that fits the window is framed together', () => {
    const c = targetCenter([person(0.40), person(0.50)], { windowFrac: WINDOW });
    assert.ok(Math.abs(c - 0.5) < 1e-9); // union 0.40..0.60
  });

  it('a group wider than the window falls back to the biggest, most confident person', () => {
    const c = targetCenter([person(0.05, 0.1), person(0.7, 0.2)], { windowFrac: WINDOW });
    assert.ok(Math.abs(c - 0.8) < 1e-9);
  });

  it('an identified preferred role wins over the rest', () => {
    const c = targetCenter([person(0.05, 0.3), person(0.7, 0.1, { role: 'Preacher' })], { windowFrac: WINDOW, preferRoles: ['preacher'] });
    assert.ok(Math.abs(c - 0.75) < 1e-9);
  });

  it('xNormForCenter centres the window and clamps at the edges', () => {
    const g = { inW: 1920, cropW: 608 };
    assert.ok(Math.abs(xNormForCenter(0.5, g) - 0.5) < 1e-9);
    assert.equal(xNormForCenter(0.0, g), 0);
    assert.equal(xNormForCenter(1.0, g), 1);
    assert.equal(xNormForCenter(0.5, { inW: 608, cropW: 608 }), 0); // no travel
  });
});

describe('follow smoother', () => {
  it('ignores small drifts, rate-limits moves, and eases toward a far target', () => {
    const s = createFollowSmoother({ alpha: 0.5, deadband: 0.05, minIntervalMs: 500 });
    assert.equal(s.next(0.5, 0.52, 0), null);          // inside the dead band
    assert.equal(s.next(0.5, null, 100), null);        // nothing to follow
    const first = s.next(0.5, 0.9, 200);               // smoothed 0.71
    assert.ok(first > 0.6 && first < 0.9);
    assert.equal(s.next(0.5, 0.9, 400), null);         // too soon after the last move
    const second = s.next(0.5, 0.9, 800);
    assert.ok(second > first && second <= 0.9);
  });

  it('reset re-anchors after a manual move', () => {
    const s = createFollowSmoother({ alpha: 1, deadband: 0.05, minIntervalMs: 0 });
    s.next(0.2, 0.8, 0);
    s.reset();
    assert.equal(s.next(0.8, 0.82, 10), null); // window is already near the target: dead band against the new anchor
  });
});
