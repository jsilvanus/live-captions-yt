import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

// jsdom does not implement pointer-capture APIs used by TemplatePreview.
// Stub them at the prototype level so they are no-ops.
const _origSetPointerCapture     = HTMLElement.prototype.setPointerCapture;
const _origReleasePointerCapture = HTMLElement.prototype.releasePointerCapture;
beforeEach(() => {
  HTMLElement.prototype.setPointerCapture     = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
});
afterEach(() => {
  HTMLElement.prototype.setPointerCapture     = _origSetPointerCapture;
  HTMLElement.prototype.releasePointerCapture = _origReleasePointerCapture;
});

// TemplatePreview is a standalone component with no external context dependencies.
import TemplatePreview from '../../src/components/dsk-editor/TemplatePreview.jsx';

const baseTemplate = {
  background: '#111',
  width: 1920,
  height: 1080,
  groups: [],
  layers: [
    { id: 'rect-1', type: 'rect', x: 100, y: 50, width: 200, height: 100,
      style: { background: '#ff0000' } },
    { id: 'text-1', type: 'text', x: 400, y: 200, text: 'Hello', visible: false,
      style: { color: '#fff', 'font-size': '48px' } },
  ],
};

function makeProps(overrides = {}) {
  return {
    template: baseTemplate,
    selectedIds: new Set(),
    primaryId: null,
    selectedViewport: 'landscape',
    onSelect: vi.fn(),
    onDragStart: vi.fn(),
    onMoveSelected: vi.fn(),
    onResizeLayer: vi.fn(),
    snapGrid: false,
    showSafeArea: false,
    vpWidth: 1920,
    vpHeight: 1080,
    previewTargetWidth: 960,
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('TemplatePreview — rendering', () => {
  it('renders without crashing for an empty template', () => {
    const { container } = render(
      <TemplatePreview {...makeProps({ template: { background: 'transparent', width: 1920, height: 1080, groups: [], layers: [] } })} />,
    );
    expect(container.firstChild).toBeTruthy();
  });

  it('renders visible layers', () => {
    const { container } = render(<TemplatePreview {...makeProps()} />);
    // rect-1 is visible; text-1 has visible:false and should not be rendered
    const divs = container.querySelectorAll('[style]');
    // At least the outer wrapper + inner canvas + rect layer
    expect(divs.length).toBeGreaterThan(2);
  });

  it('does not render hidden layers', () => {
    const props = makeProps({ selectedIds: new Set(['text-1']), primaryId: 'text-1' });
    const { container } = render(<TemplatePreview {...props} />);
    expect(container.textContent).not.toContain('Hello');
  });

  it('renders resize handles for the single selected layer', () => {
    const props = makeProps({ selectedIds: new Set(['rect-1']), primaryId: 'rect-1' });
    const { container } = render(<TemplatePreview {...props} />);
    // 8 handles expected — each has cursor:*-resize
    const handles = Array.from(container.querySelectorAll('[style]')).filter(el =>
      el.style.cursor?.endsWith('-resize'),
    );
    expect(handles).toHaveLength(8);
  });

  it('shows safe-area overlays when showSafeArea=true', () => {
    const props = makeProps({ showSafeArea: true });
    const { container } = render(<TemplatePreview {...props} />);
    const overlays = Array.from(container.querySelectorAll('[title]')).filter(el =>
      el.getAttribute('title')?.includes('safe'),
    );
    expect(overlays).toHaveLength(2);
  });

  it('does NOT show safe-area overlays by default', () => {
    const props = makeProps({ showSafeArea: false });
    const { container } = render(<TemplatePreview {...props} />);
    const overlays = Array.from(container.querySelectorAll('[title]')).filter(el =>
      el.getAttribute('title')?.includes('safe'),
    );
    expect(overlays).toHaveLength(0);
  });

  it('renders ellipse layers with borderRadius:50%', () => {
    const template = {
      ...baseTemplate,
      layers: [{ id: 'el-1', type: 'ellipse', x: 100, y: 100, width: 100, height: 100,
                  style: { background: '#00f' } }],
    };
    const { container } = render(<TemplatePreview {...makeProps({ template })} />);
    const el = Array.from(container.querySelectorAll('[style]')).find(
      node => node.style.borderRadius === '50%',
    );
    expect(el).toBeTruthy();
  });
});

describe('TemplatePreview — pointer interactions', () => {
  it('calls onSelect(null) when clicking the canvas background', () => {
    const onSelect = vi.fn();
    const { container } = render(<TemplatePreview {...makeProps({ onSelect })} />);
    // The outer container is the first child
    const outer = container.firstChild;
    fireEvent.pointerDown(outer);
    fireEvent.pointerUp(outer);
    expect(onSelect).toHaveBeenCalledWith(null, false);
  });

  it('calls onSelect(layerId) on a click with no movement', () => {
    const onSelect = vi.fn();
    const props = makeProps({ onSelect });
    const { container } = render(<TemplatePreview {...props} />);

    // Find the rect layer element — it has cursor:move
    const layerEl = Array.from(container.querySelectorAll('[style]')).find(
      el => el.style.cursor === 'move',
    );
    expect(layerEl).toBeTruthy();

    // pointerDown on layer, then pointerUp without movement → treated as click
    fireEvent.pointerDown(layerEl, { clientX: 200, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(layerEl, { clientX: 200, clientY: 100, pointerId: 1 });

    expect(onSelect).toHaveBeenCalledWith('rect-1', false);
  });

  it('calls onDragStart and onMoveSelected during a drag', () => {
    const onDragStart    = vi.fn();
    const onMoveSelected = vi.fn();
    const props = makeProps({
      selectedIds: new Set(['rect-1']),
      primaryId: 'rect-1',
      onDragStart,
      onMoveSelected,
    });
    const { container } = render(<TemplatePreview {...props} />);

    // outer container handles move/up events
    const outer    = container.firstChild;
    const layerEl  = Array.from(container.querySelectorAll('[style]')).find(
      el => el.style.cursor === 'move',
    );

    fireEvent.pointerDown(layerEl,  { clientX: 200, clientY: 100, pointerId: 1 });
    // Move > 3px to trigger drag
    fireEvent.pointerMove(outer, { clientX: 230, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(outer,   { clientX: 230, clientY: 100, pointerId: 1 });

    expect(onDragStart).toHaveBeenCalledTimes(1);
    expect(onMoveSelected).toHaveBeenCalled();
    // The layer should have moved right by 30/scale = 60 template px
    const calls = onMoveSelected.mock.calls;
    const lastUpdates = calls[calls.length - 1][0];
    expect(lastUpdates[0].id).toBe('rect-1');
    expect(lastUpdates[0].x).toBe(160); // 100 + 60
  });
});

describe('TemplatePreview — keyboard nudge', () => {
  it('nudges layer by 1px on ArrowRight', () => {
    const onMoveSelected = vi.fn();
    const props = makeProps({
      selectedIds: new Set(['rect-1']),
      primaryId:   'rect-1',
      onMoveSelected,
    });
    const { container } = render(<TemplatePreview {...props} />);
    const outer = container.firstChild;

    fireEvent.keyDown(outer, { key: 'ArrowRight' });
    expect(onMoveSelected).toHaveBeenCalledWith([{ id: 'rect-1', x: 101, y: 50 }]);
  });

  it('nudges layer by 10px on Shift+ArrowLeft', () => {
    const onMoveSelected = vi.fn();
    const props = makeProps({
      selectedIds: new Set(['rect-1']),
      primaryId:   'rect-1',
      onMoveSelected,
    });
    const { container } = render(<TemplatePreview {...props} />);
    const outer = container.firstChild;

    fireEvent.keyDown(outer, { key: 'ArrowLeft', shiftKey: true });
    expect(onMoveSelected).toHaveBeenCalledWith([{ id: 'rect-1', x: 90, y: 50 }]);
  });

  it('nudges layer vertically with ArrowUp', () => {
    const onMoveSelected = vi.fn();
    const props = makeProps({
      selectedIds: new Set(['rect-1']),
      primaryId:   'rect-1',
      onMoveSelected,
    });
    const { container } = render(<TemplatePreview {...props} />);
    fireEvent.keyDown(container.firstChild, { key: 'ArrowUp' });
    expect(onMoveSelected).toHaveBeenCalledWith([{ id: 'rect-1', x: 100, y: 49 }]);
  });

  it('does nothing when no layer is selected', () => {
    const onMoveSelected = vi.fn();
    const { container } = render(
      <TemplatePreview {...makeProps({ onMoveSelected })} />,
    );
    fireEvent.keyDown(container.firstChild, { key: 'ArrowRight' });
    expect(onMoveSelected).not.toHaveBeenCalled();
  });
});
