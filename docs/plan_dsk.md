# Plan: DSK Graphics Editor — Phase 2 (Editable Shapes)

---
id: plan/dsk
---

> Target branch: `claude/add-editable-shapes-yxAXO`

---

## Phase 1 — Status: Complete

Phase 1 shipped the full DSK template editor pipeline:

| Component | File | Status |
|---|---|---|
| Visual editor UI | `packages/lcyt-web/src/components/DskEditorPage.jsx` | ✓ Done |
| Broadcast control panel | `packages/lcyt-web/src/components/DskControlPage.jsx` | ✓ Done |
| Green-screen overlay display | `packages/lcyt-web/src/components/DskPage.jsx` | ✓ Done |
| Playwright renderer + ffmpeg RTMP output | `packages/plugins/lcyt-dsk/src/renderer.js` | ✓ Done |
| Template CRUD API | `packages/plugins/lcyt-dsk/src/routes/dsk-templates.js` | ✓ Done |
| DB helpers | `packages/plugins/lcyt-dsk/src/db/dsk-templates.js` | ✓ Done |
| Editor auth middleware | `packages/plugins/lcyt-dsk/src/middleware/editor-auth.js` | ✓ Done |

**Phase 1 capabilities:**
- Create/edit/delete named templates stored as JSON on the backend
- Preset templates: Lower Third, Corner Bug, Full-screen Title
- Layers: `rect`, `text`, `image` with CSS style overrides
- Reorder layers (z-index), delete, add
- Click a layer in the 960×540 scaled preview to select it
- Property editor panel: form inputs for x, y, width, height, and type-specific style fields
- Save to backend; Playwright renders to HTML → ffmpeg → RTMP
- `DskControlPage`: activate templates and inject live text data

---

## Phase 2 — Editable Shapes

### Goal

Replace the forms-only workflow with direct manipulation on the preview canvas:
users can drag to move layers and drag resize handles to resize them, without
needing to type numbers into the property panel. The panel remains available
for precise numeric editing.

### User-visible changes

1. **Drag to move**: grab any layer and drag it; x/y update in real time.
2. **Resize handles**: 8 handles appear around the selected layer (4 corners + 4 edge midpoints); dragging any handle resizes (and for top/left handles, also repositions) the layer.
3. **Keyboard nudge**: arrow keys move the selected layer by 1 px; Shift+arrow by 10 px.
4. **Cursor feedback**: `move` cursor when hovering a layer, `resize` cursors on handles.
5. **No-op on deselect**: clicking the canvas background deselects the layer.

### Scale contract

The preview renders a 1920×1080 canvas scaled to 50% (960×540 display area).
All pointer events must divide coordinates by 0.5 before storing them in the
template JSON, and the preview must multiply stored coordinates by 0.5 when
positioning elements.

---

## Implementation Plan

### 1. `TemplatePreview` — add drag-move and resize-handle support

**File:** `packages/lcyt-web/src/components/DskEditorPage.jsx`

#### 1a. New props

```js
function TemplatePreview({ template, selectedLayerId, onSelectLayer, onMoveLayer, onResizeLayer })
```

- `onMoveLayer(id, { x, y })` — called during and after drag; updates layer position
- `onResizeLayer(id, { x, y, width, height })` — called during and after handle drag

#### 1b. Drag-to-move

Replace the plain `onClick` on each layer element with full pointer-event handling:

```
onPointerDown(e) {
  if layer is not selected → select it and return (first click selects only)
  capture pointer
  record startPointer = { x: e.clientX, y: e.clientY }
  record startPos    = { x: layer.x, y: layer.y }
  set dragging = true
}

onPointerMove(e) {
  if !dragging return
  const dx = (e.clientX - startPointer.x) / SCALE   // SCALE = 0.5
  const dy = (e.clientY - startPointer.y) / SCALE
  onMoveLayer(id, {
    x: Math.round(startPos.x + dx),
    y: Math.round(startPos.y + dy),
  })
}

onPointerUp(e) {
  release pointer
  dragging = false
}
```

Use `useRef` for drag state (not `useState`) to avoid re-renders mid-drag. The final
position is committed to React state via `onMoveLayer`, which calls the parent's
`updateLayer`.

#### 1c. Resize handles

Render 8 handle `<div>` elements as children of the selected-layer wrapper.
Each handle is a small square (8×8 px at display scale) absolutely positioned
at one of these anchor points relative to the layer:

| Handle ID | CSS position | Cursor |
|---|---|---|
| `nw` | top-left | `nw-resize` |
| `n` | top-center | `n-resize` |
| `ne` | top-right | `ne-resize` |
| `e` | center-right | `e-resize` |
| `se` | bottom-right | `se-resize` |
| `s` | bottom-center | `s-resize` |
| `sw` | bottom-left | `sw-resize` |
| `w` | center-left | `w-resize` |

Each handle has its own `onPointerDown` handler that records:
- `handle` — which of the 8 anchors
- `startPointer` — pointer coords at mousedown
- `startRect` — `{ x, y, width, height }` at mousedown

On `onPointerMove` (attached to the outer canvas container, not the handle itself,
to avoid losing the pointer if the mouse moves fast):

```
delta = { dx: (e.clientX - startPointer.x) / SCALE,
          dy: (e.clientY - startPointer.y) / SCALE }

Compute new { x, y, width, height } based on handle:
  "e"  → width  += dx
  "w"  → x += dx, width -= dx
  "s"  → height += dy
  "n"  → y += dy, height -= dy
  "se" → width += dx, height += dy
  "sw" → x += dx, width -= dx, height += dy
  "ne" → width += dx, y += dy, height -= dy
  "nw" → x += dx, width -= dx, y += dy, height -= dy

Clamp: width = Math.max(4, Math.round(width))
       height = Math.max(4, Math.round(height))
       x = Math.round(x), y = Math.round(y)

onResizeLayer(id, { x, y, width, height })
```

The outer canvas container (the 960×540 `<div>`) receives `onPointerMove` and
`onPointerUp` so the drag continues even if the pointer leaves the layer element.

#### 1d. Keyboard nudge

Attach `onKeyDown` to the preview container (make it `tabIndex={0}` and
`outline: none`):

```
if (!selectedLayerId) return
const step = e.shiftKey ? 10 : 1
switch (e.key) {
  case 'ArrowLeft':  onMoveLayer(id, { x: layer.x - step, y: layer.y }); break
  case 'ArrowRight': onMoveLayer(id, { x: layer.x + step, y: layer.y }); break
  case 'ArrowUp':    onMoveLayer(id, { x: layer.x, y: layer.y - step }); break
  case 'ArrowDown':  onMoveLayer(id, { x: layer.x, y: layer.y + step }); break
}
e.preventDefault()
```

#### 1e. Deselect on canvas click

The outer 960×540 container already calls `onClick={() => setSelectedLayerId(null)}`
via the existing `onSelectLayer` prop — no change needed.

---

### 2. `DskEditorPage` — wire new callbacks

In `DskEditorPage`, add two new handlers and pass them to `TemplatePreview`:

```js
function moveLayer(id, { x, y }) {
  setTemplate(t => ({
    ...t,
    layers: t.layers.map(l =>
      l.id === id ? { ...l, x, y } : l
    ),
  }));
  isDirty.current = true;
}

function resizeLayer(id, { x, y, width, height }) {
  setTemplate(t => ({
    ...t,
    layers: t.layers.map(l =>
      l.id === id ? { ...l, x, y, width, height } : l
    ),
  }));
  isDirty.current = true;
}
```

Pass to preview:

```jsx
<TemplatePreview
  template={template}
  selectedLayerId={selectedLayerId}
  onSelectLayer={id => setSelectedLayerId(id === selectedLayerId ? null : id)}
  onMoveLayer={moveLayer}
  onResizeLayer={resizeLayer}
/>
```

The `LayerPropertyEditor` already calls `onChange` (which calls `updateLayer`) on
each keystroke — no change needed there. The two sources of truth (canvas drag and
form inputs) both flow through `setTemplate`, so they stay in sync automatically.

---

### 3. Pointer event coordination — drag vs click

A plain click on a non-selected layer must only select it (not start a drag).
Use a `hasMoved` ref to distinguish:

```
onPointerDown: hasMoved = false; dragging = true
onPointerMove: if distance > 3px: hasMoved = true; ... update position
onPointerUp: if !hasMoved: onSelectLayer(id)  // treat as click
             dragging = false
```

This prevents accidental position changes when the user intends just to select.

---

### 4. Handle rendering details

Handles are rendered **outside** the `transform: scale(0.5)` container, or they
must be sized at `8/0.5 = 16 px` in template coordinates to appear as 8 px in the
scaled preview.

**Recommended approach**: render handles inside the scaled container at 16×16 px
(template space), which shows as 8×8 px at 50% scale, centred on the handle anchor.
Position them using CSS `transform: translate(-50%, -50%)` relative to the anchor
corner/edge.

Each handle `<div>` style:

```js
{
  position: 'absolute',
  width: 16,
  height: 16,
  background: '#4af',
  border: '2px solid #fff',
  borderRadius: 2,
  cursor: `${handle}-resize`,
  zIndex: 9999,
  // Anchor positioning computed from layer dimensions + handle id
}
```

Handle anchor coordinates (in template px, relative to layer origin):

| Handle | left | top |
|---|---|---|
| `nw` | 0 | 0 |
| `n` | width/2 | 0 |
| `ne` | width | 0 |
| `e` | width | height/2 |
| `se` | width | height |
| `s` | width/2 | height |
| `sw` | 0 | height |
| `w` | 0 | height/2 |

```js
style={{
  left: anchorX,
  top:  anchorY,
  transform: 'translate(-50%, -50%)',
}}
```

---

### 5. No backend changes required

Phase 2 is purely a UI change. The template JSON schema (`x`, `y`, `width`,
`height`) is unchanged; the property editor, save/load, Playwright renderer, and
all API routes are unaffected.

---

## Files changed

| File | Change |
|---|---|
| `packages/lcyt-web/src/components/DskEditorPage.jsx` | Add drag-move, resize handles, keyboard nudge; wire `onMoveLayer` / `onResizeLayer` callbacks |

No other files need to change.

---

## Scope explicitly excluded from Phase 2

- Snap to grid / snap to other layers (Phase 3)
- Multi-selection and group move (Phase 3)
- Undo/redo (Phase 3)
- New shape types (`ellipse`, `line`, `polygon`) (Phase 3)
- Rotation handle (Phase 3)
- Image upload drag-and-drop into canvas (separate feature)
