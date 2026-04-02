---
id: plan/dsk
title: "DSK Graphics Editor — Phases 2–4 (Editable Shapes, Multi-select, Media Library)"
status: implemented
summary: "Phases 1–4 complete. Direct canvas manipulation (drag/resize/nudge), undo/redo, multi-selection, snap-to-grid, snap-to-edges, grouping, alignment, Media Library."
---

# Plan: DSK Graphics Editor — Phases 2–4 (Editable Shapes, Multi-select, Media Library)

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

## Phase 2 — Editable Shapes — Status: Complete ✓

### Goal

Replace the forms-only workflow with direct manipulation on the preview canvas:
users can drag to move layers and drag resize handles to resize them, without
needing to type numbers into the property panel. The panel remains available
for precise numeric editing.

### Implemented

| Feature | File | Status |
|---|---|---|
| `TemplatePreview` extracted as standalone component | `src/components/dsk-editor/TemplatePreview.jsx` | ✓ Done |
| Geometry helpers library | `src/lib/dskEditorGeometry.js` | ✓ Done |
| Drag-to-move (single + multi-selection) | `TemplatePreview.jsx` | ✓ Done |
| 8 resize handles with correct cursors | `TemplatePreview.jsx` | ✓ Done |
| Keyboard nudge (arrow keys, Shift×10) | `TemplatePreview.jsx` | ✓ Done |
| `hasMoved` ref — click vs drag disambiguation | `TemplatePreview.jsx` | ✓ Done |
| Pointer capture for smooth drag | `TemplatePreview.jsx` | ✓ Done |
| Viewport-aware drag/resize overrides | `DskEditorPage.jsx` | ✓ Done |
| `onMoveLayer` / `onResizeLayer` callbacks wired | `DskEditorPage.jsx` | ✓ Done |
| Unit tests for geometry pure functions | `test/dskEditorGeometry.test.js` | ✓ Done |
| Component tests for TemplatePreview | `test/components/TemplatePreview.test.jsx` | ✓ Done |

### Scale contract (implemented)

The preview renders a 1920×1080 canvas scaled to 50% (960×540 display area).
All pointer events divide coordinates by the scale factor before storing them in
the template JSON.

---

## Phase 3 — Multi-selection, Undo, Snap — Status: Complete ✓

All Phase 3 features (previously listed as "excluded from Phase 2") are implemented:

| Feature | File | Status |
|---|---|---|
| Undo / Redo (Ctrl+Z / Ctrl+Y, up to 50 steps) | `DskEditorPage.jsx` | ✓ Done |
| Multi-selection (Shift+click, range select, Ctrl+click toggle) | `DskEditorPage.jsx` | ✓ Done |
| Snap to grid (20 px grid, toggleable) | `dskEditorGeometry.js` + `TemplatePreview.jsx` | ✓ Done |
| Snap to layer edges (10 px threshold) | `dskEditorGeometry.js` + `TemplatePreview.jsx` | ✓ Done |
| Group / Ungroup selected layers | `DskEditorPage.jsx` | ✓ Done |
| Alignment tools (L/C/R, T/M/B for ≥2 selected) | `DskEditorPage.jsx` | ✓ Done |
| `ellipse` shape type | `TemplatePreview.jsx` + `LayerPropertyEditor.jsx` | ✓ Done |
| Copy / Paste layers (Ctrl+C / Ctrl+V, offset by 20 px) | `DskEditorPage.jsx` | ✓ Done |
| Delete selected layers (Delete / Backspace key) | `DskEditorPage.jsx` | ✓ Done |
| Layer visibility toggle (eye icon) | `DskEditorPage.jsx` | ✓ Done |
| Duplicate layer button | `DskEditorPage.jsx` | ✓ Done |
| Safe area guides overlay (90%/80%) | `TemplatePreview.jsx` | ✓ Done |

### Not yet implemented (deferred to Phase 4 or later)

- Rotation handle (future)
- Snap to grid *visual* ruler overlay (future)

---

## Phase 4 — Media Library — Status: Complete ✓

| Feature | File | Status |
|---|---|---|
| Image upload (PNG / JPEG / WebP / SVG) | `DskEditorPage.jsx` + `/images` API | ✓ Done |
| Image library browse with thumbnail preview | `DskEditorPage.jsx` | ✓ Done |
| Insert image from library into canvas | `DskEditorPage.jsx` | ✓ Done |
| Delete image from library | `DskEditorPage.jsx` | ✓ Done |
| Viewport-specific image crop/fit settings | `DskEditorPage.jsx` + `ImageSettingsTable` | ✓ Done |

---

## Files changed in Phase 2–4

| File | Change |
|---|---|
| `packages/lcyt-web/src/components/DskEditorPage.jsx` | Extracted TemplatePreview; added Phase 2–4 callbacks and UI |
| `packages/lcyt-web/src/components/dsk-editor/TemplatePreview.jsx` | New — standalone canvas preview with drag/resize/nudge |
| `packages/lcyt-web/src/components/dsk-editor/LayerPropertyEditor.jsx` | New — layer property form (extracted from DskEditorPage) |
| `packages/lcyt-web/src/components/dsk-editor/AnimationEditor.jsx` | New — animation preset picker |
| `packages/lcyt-web/src/lib/dskEditorGeometry.js` | New — pure geometry helpers |
| `packages/lcyt-web/src/lib/dskEditorPresets.js` | New — preset template definitions |
| `packages/lcyt-web/test/dskEditorGeometry.test.js` | New — unit tests for geometry functions (node:test) |
| `packages/lcyt-web/test/components/TemplatePreview.test.jsx` | New — component tests for drag/resize/nudge interactions (Vitest) |

---

## Phase 5 — Animations (future)

Preset picker, per-layer CSS animation shorthand, live preview. LCYT keyframe
CSS is already injected in `DskEditorPage.jsx`; the `AnimationEditor` component
and `ANIM_PRESETS` list are in place. Full animation editing UI is a future phase.

