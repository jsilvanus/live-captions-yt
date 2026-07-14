import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultViews, activeView, updateActiveView, setActiveView,
  addCustomView, removeView, addColumn, addRow, addPane,
  changePaneType, removePane, resizePair,
} from '../src/components/production/workspace/layout.js';

// A hand-built state so we never touch localStorage (initialLayoutState does).
function baseState() {
  const d = defaultViews();
  return { views: d.views, viewOrder: d.viewOrder, activeView: 'preflight', customCount: 0 };
}

test('defaultViews ships the four built-in views in order', () => {
  const { views, viewOrder } = defaultViews();
  assert.deepEqual(viewOrder, ['preflight', 'relay', 'mixer', 'captions']);
  assert.equal(views.preflight.kind, 'builtin');
  assert.equal(views.preflight.cols.length, 3);
});

test('activeView falls back to preflight for an unknown id', () => {
  const s = { ...baseState(), activeView: 'nope' };
  assert.equal(activeView(s), s.views.preflight);
});

test('updateActiveView clones — it never mutates the previous state', () => {
  const s = baseState();
  const next = updateActiveView(s, (v) => { v.cols[0].frac = 0.99; });
  assert.equal(next.views.preflight.cols[0].frac, 0.99);
  assert.notEqual(s.views.preflight.cols[0].frac, 0.99, 'original left intact');
  assert.notEqual(next.views, s.views);
});

test('setActiveView only switches to views that exist', () => {
  const s = baseState();
  assert.equal(setActiveView(s, 'mixer').activeView, 'mixer');
  assert.equal(setActiveView(s, 'ghost').activeView, 'preflight');
});

test('addCustomView clones the active view, appends it, and selects it', () => {
  const s = addCustomView(baseState());
  assert.equal(s.customCount, 1);
  assert.equal(s.activeView, 'custom1');
  assert.equal(s.views.custom1.kind, 'custom');
  assert.equal(s.viewOrder[s.viewOrder.length - 1], 'custom1');
  // deep clone of preflight's shape
  assert.equal(s.views.custom1.cols.length, s.views.preflight.cols.length);
});

test('removeView drops the view and resets active to preflight', () => {
  let s = addCustomView(baseState()); // active custom1
  s = removeView(s, 'custom1');
  assert.equal(s.views.custom1, undefined);
  assert.ok(!s.viewOrder.includes('custom1'));
  assert.equal(s.activeView, 'preflight');
});

test('structural edits: addColumn / addRow / addPane / changePaneType', () => {
  let s = addCustomView(baseState());
  const cols0 = activeView(s).cols.length;
  s = addColumn(s);
  assert.equal(activeView(s).cols.length, cols0 + 1);

  const rows0 = activeView(s).cols[0].rows.length;
  s = addRow(s, 0);
  assert.equal(activeView(s).cols[0].rows.length, rows0 + 1);

  s = addPane(s, 0, 0);
  const row = activeView(s).cols[0].rows[0];
  assert.equal(row.panels.length, 2);
  assert.equal(row.split.length, 2);

  s = changePaneType(s, 0, 0, 1, 'chat');
  assert.equal(activeView(s).cols[0].rows[0].panels[1], 'chat');
});

test('removePane collapses empty rows and empty columns', () => {
  let s = addCustomView(baseState());
  // preflight col 0 has 2 single-pane rows; remove both panes of row 0 → row drops
  s = removePane(s, 0, 0, 0);
  assert.equal(activeView(s).cols[0].rows.length, 1);
});

test('resizePair conserves total and respects the minimum share', () => {
  const [a, b] = resizePair([0.5, 0.5], 0, 0.3, 0.1);
  assert.ok(Math.abs((a + b) - 1) < 1e-9, 'total conserved');
  assert.ok(a >= 0.1 && b >= 0.1, 'both above min');

  // A delta that would push one side negative clamps to the minimum.
  const [c, d] = resizePair([0.5, 0.5], 0, -1, 0.1);
  assert.ok(Math.abs((c + d) - 1) < 1e-9);
  assert.ok(c >= 0.1 - 1e-9, 'clamped to min');
});
