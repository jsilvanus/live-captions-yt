import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  handleAnchor,
  applyResize,
  gridSnap,
  snapToLayerEdges,
  getLayerViewportPos,
  GRID_SIZE,
  SNAP_THRESH,
} from '../src/lib/dskEditorGeometry.js';

// ── handleAnchor ──────────────────────────────────────────────────────────────

describe('handleAnchor', () => {
  const layer = { x: 100, y: 50, width: 200, height: 100 };

  it('nw → top-left corner', () => {
    assert.deepEqual(handleAnchor('nw', layer), { left: 100, top: 50 });
  });
  it('n → top-center', () => {
    assert.deepEqual(handleAnchor('n', layer), { left: 200, top: 50 });
  });
  it('ne → top-right corner', () => {
    assert.deepEqual(handleAnchor('ne', layer), { left: 300, top: 50 });
  });
  it('e → center-right', () => {
    assert.deepEqual(handleAnchor('e', layer), { left: 300, top: 100 });
  });
  it('se → bottom-right corner', () => {
    assert.deepEqual(handleAnchor('se', layer), { left: 300, top: 150 });
  });
  it('s → bottom-center', () => {
    assert.deepEqual(handleAnchor('s', layer), { left: 200, top: 150 });
  });
  it('sw → bottom-left corner', () => {
    assert.deepEqual(handleAnchor('sw', layer), { left: 100, top: 150 });
  });
  it('w → center-left', () => {
    assert.deepEqual(handleAnchor('w', layer), { left: 100, top: 100 });
  });

  it('works with zero-origin layer', () => {
    const l = { x: 0, y: 0, width: 100, height: 60 };
    assert.deepEqual(handleAnchor('nw', l), { left: 0, top: 0 });
    assert.deepEqual(handleAnchor('se', l), { left: 100, top: 60 });
    assert.deepEqual(handleAnchor('n',  l), { left: 50, top: 0 });
  });

  it('coerces missing values to 0', () => {
    const l = {};
    assert.deepEqual(handleAnchor('nw', l), { left: 0, top: 0 });
    assert.deepEqual(handleAnchor('se', l), { left: 0, top: 0 });
  });
});

// ── applyResize ───────────────────────────────────────────────────────────────

describe('applyResize', () => {
  const rect = { x: 100, y: 50, width: 200, height: 100 };

  it('e — grows/shrinks width only', () => {
    assert.deepEqual(applyResize('e', rect, 30, 0), { x: 100, y: 50, width: 230, height: 100 });
    assert.deepEqual(applyResize('e', rect, -20, 0), { x: 100, y: 50, width: 180, height: 100 });
  });
  it('w — moves x and adjusts width', () => {
    assert.deepEqual(applyResize('w', rect, 20, 0), { x: 120, y: 50, width: 180, height: 100 });
    assert.deepEqual(applyResize('w', rect, -20, 0), { x: 80, y: 50, width: 220, height: 100 });
  });
  it('s — grows/shrinks height only', () => {
    assert.deepEqual(applyResize('s', rect, 0, 40), { x: 100, y: 50, width: 200, height: 140 });
  });
  it('n — moves y and adjusts height', () => {
    assert.deepEqual(applyResize('n', rect, 0, 10), { x: 100, y: 60, width: 200, height: 90 });
  });
  it('se — grows both dimensions', () => {
    assert.deepEqual(applyResize('se', rect, 50, 30), { x: 100, y: 50, width: 250, height: 130 });
  });
  it('nw — moves origin, adjusts both dimensions', () => {
    assert.deepEqual(applyResize('nw', rect, 10, 5), { x: 110, y: 55, width: 190, height: 95 });
  });
  it('ne — adjusts width and moves y', () => {
    assert.deepEqual(applyResize('ne', rect, 20, -10), { x: 100, y: 40, width: 220, height: 110 });
  });
  it('sw — moves x and adjusts height', () => {
    assert.deepEqual(applyResize('sw', rect, -10, 20), { x: 90, y: 50, width: 210, height: 120 });
  });

  it('clamps width to minimum 4', () => {
    const r = { x: 0, y: 0, width: 10, height: 10 };
    assert.equal(applyResize('e', r, -200, 0).width, 4);
  });
  it('clamps height to minimum 4', () => {
    const r = { x: 0, y: 0, width: 10, height: 10 };
    assert.equal(applyResize('s', r, 0, -200).height, 4);
  });
  it('rounds fractional results', () => {
    const r = { x: 0, y: 0, width: 100, height: 100 };
    const result = applyResize('se', r, 10.7, 10.2);
    assert.equal(result.width, 111);
    assert.equal(result.height, 110);
  });
});

// ── gridSnap ──────────────────────────────────────────────────────────────────

describe('gridSnap', () => {
  it('snaps 0 to 0', () => assert.equal(gridSnap(0), 0));
  it(`snaps ${GRID_SIZE / 2 - 1} down to 0`, () => assert.equal(gridSnap(GRID_SIZE / 2 - 1), 0));
  it(`snaps ${GRID_SIZE / 2} up to ${GRID_SIZE}`, () => assert.equal(gridSnap(GRID_SIZE / 2), GRID_SIZE));
  it(`snaps exactly ${GRID_SIZE} to ${GRID_SIZE}`, () => assert.equal(gridSnap(GRID_SIZE), GRID_SIZE));
  it('handles negative values — rounds toward positive (JS tie-break)', () => assert.equal(gridSnap(-GRID_SIZE / 2) == 0, true));
  it('snaps -15 down to -20', () => assert.equal(gridSnap(-15), -20));
  it('works with large values', () => assert.equal(gridSnap(1000), 1000));
  it('snaps a typical position', () => assert.equal(gridSnap(35), 40));
  it('snaps midpoint: 30 → 40', () => assert.equal(gridSnap(30), 40));
});

// ── snapToLayerEdges ──────────────────────────────────────────────────────────

describe('snapToLayerEdges', () => {
  const primary = { id: 'a', x: 100, y: 100, width: 100, height: 60 };

  it('returns unchanged coords when no other layers', () => {
    const result = snapToLayerEdges(100, 100, primary, [primary], new Set(['a']));
    assert.deepEqual(result, { x: 100, y: 100 });
  });

  it('snaps left edge of primary to left edge of other layer', () => {
    const other = { id: 'b', x: 200, y: 200, width: 100, height: 60 };
    // Move primary so its left edge (tentX=202) is within SNAP_THRESH of other.left=200
    const result = snapToLayerEdges(202, 300, primary, [primary, other], new Set(['a']));
    assert.equal(result.x, 200);
  });

  it('does not snap when outside threshold', () => {
    const other = { id: 'b', x: 300, y: 300, width: 100, height: 60 };
    const result = snapToLayerEdges(100, 100, primary, [primary, other], new Set(['a']));
    assert.equal(result.x, 100);
  });

  it('returns unchanged when primary has no width/height', () => {
    const bare = { id: 'a', x: 50, y: 50 };
    const other = { id: 'b', x: 50, y: 50, width: 100, height: 60 };
    const result = snapToLayerEdges(50, 50, bare, [bare, other], new Set(['a']));
    assert.deepEqual(result, { x: 50, y: 50 });
  });

  it('skips layers in movingIds', () => {
    const partner = { id: 'a2', x: 201, y: 100, width: 100, height: 60 };
    const other   = { id: 'b',  x: 500, y: 500, width: 100, height: 60 };
    // partner is in movingIds → should not trigger snap
    const result = snapToLayerEdges(100, 100, primary, [primary, partner, other], new Set(['a', 'a2']));
    assert.equal(result.x, 100); // no snap to partner or far other
  });
});

// ── getLayerViewportPos ───────────────────────────────────────────────────────

describe('getLayerViewportPos', () => {
  it('returns landscape coords when no viewport selected', () => {
    const layer = { x: 100, y: 50, width: 200, height: 100 };
    assert.deepEqual(getLayerViewportPos(layer, null), { x: 100, y: 50, width: 200, height: 100 });
  });

  it('returns landscape coords for "landscape" viewport', () => {
    const layer = { x: 10, y: 20, width: 400, height: 200,
                    viewports: { portrait: { x: 30, y: 40 } } };
    assert.deepEqual(getLayerViewportPos(layer, 'landscape'), { x: 10, y: 20, width: 400, height: 200 });
  });

  it('returns viewport-specific coords when viewport has overrides', () => {
    const layer = { x: 10, y: 20, width: 400, height: 200,
                    viewports: { portrait: { x: 30, y: 40, width: 300, height: 150 } } };
    const result = getLayerViewportPos(layer, 'portrait');
    assert.deepEqual(result, { x: 30, y: 40, width: 300, height: 150 });
  });

  it('falls back to base layer coords when viewport has no overrides', () => {
    const layer = { x: 10, y: 20, width: 400, height: 200, viewports: {} };
    const result = getLayerViewportPos(layer, 'portrait');
    assert.deepEqual(result, { x: 10, y: 20, width: 400, height: 200 });
  });

  it('mixes viewport x/y with base width/height when viewport overrides only position', () => {
    const layer = { x: 10, y: 20, width: 400, height: 200,
                    viewports: { portrait: { x: 50, y: 60 } } };
    const result = getLayerViewportPos(layer, 'portrait');
    assert.deepEqual(result, { x: 50, y: 60, width: 400, height: 200 });
  });

  it('returns zeros for null layer', () => {
    const result = getLayerViewportPos(null, 'portrait');
    assert.deepEqual(result, { x: 0, y: 0 });
  });

  it('coerces string values to numbers', () => {
    const layer = { x: '100', y: '50', width: '200', height: '100' };
    const result = getLayerViewportPos(layer, null);
    assert.strictEqual(result.x, 100);
    assert.strictEqual(result.y, 50);
  });

  it('returns undefined width/height when layer has none', () => {
    const layer = { x: 10, y: 20 };
    const result = getLayerViewportPos(layer, null);
    assert.strictEqual(result.width, undefined);
    assert.strictEqual(result.height, undefined);
  });
});

// ── exported constants ────────────────────────────────────────────────────────

describe('exported constants', () => {
  it('GRID_SIZE is 20', () => assert.equal(GRID_SIZE, 20));
  it('SNAP_THRESH is 10', () => assert.equal(SNAP_THRESH, 10));
});
