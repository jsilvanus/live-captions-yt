---
id: plan/dsk
title: "DSK Graphics Editor â€” Phases 2â€“5 (Editable Shapes, Multi-select, Media Library, Animations)"
status: implemented
summary: "Phases 1â€“5 complete. Direct canvas manipulation (drag/resize/nudge), undo/redo, multi-selection, snap-to-grid, snap-to-edges, grouping, alignment, Media Library, entry/exit CSS animations for DSK graphic images."
---

# Plan: DSK Graphics Editor â€” Phases 2â€“5 (Editable Shapes, Multi-select, Media Library, Animations)

> Target branch: `claude/add-editable-shapes-yxAXO`

---

## Phase 1 â€” Status: Complete

Phase 1 shipped the full DSK template editor pipeline:

| Component | File | Status |
|---|---|---|
| Visual editor UI | `packages/lcyt-web/src/components/DskEditorPage.jsx` | âœ“ Done |
| Broadcast control panel | `packages/lcyt-web/src/components/DskControlPage.jsx` | âœ“ Done |
| Green-screen overlay display | `packages/lcyt-web/src/components/DskPage.jsx` | âœ“ Done |
| Playwright renderer + ffmpeg RTMP output | `packages/plugins/lcyt-dsk/src/renderer.js` | âœ“ Done |
| Template CRUD API | `packages/plugins/lcyt-dsk/src/routes/dsk-templates.js` | âœ“ Done |
| DB helpers | `packages/plugins/lcyt-dsk/src/db/dsk-templates.js` | âœ“ Done |
| Editor auth middleware | `packages/plugins/lcyt-dsk/src/middleware/editor-auth.js` | âœ“ Done |

**Phase 1 capabilities:**
- Create/edit/delete named templates stored as JSON on the backend
- Preset templates: Lower Third, Corner Bug, Full-screen Title
- Layers: `rect`, `text`, `image` with CSS style overrides
- Reorder layers (z-index), delete, add
- Click a layer in the 960Ã—540 scaled preview to select it
- Property editor panel: form inputs for x, y, width, height, and type-specific style fields
- Save to backend; Playwright renders to HTML â†’ ffmpeg â†’ RTMP
- `DskControlPage`: activate templates and inject live text data

---

## Phase 2 â€” Editable Shapes â€” Status: Complete âœ“

### Goal

Replace the forms-only workflow with direct manipulation on the preview canvas:
users can drag to move layers and drag resize handles to resize them, without
needing to type numbers into the property panel. The panel remains available
for precise numeric editing.

### Implemented

| Feature | File | Status |
|---|---|---|
| `TemplatePreview` extracted as standalone component | `src/components/dsk-editor/TemplatePreview.jsx` | âœ“ Done |
| Geometry helpers library | `src/lib/dskEditorGeometry.js` | âœ“ Done |
| Drag-to-move (single + multi-selection) | `TemplatePreview.jsx` | âœ“ Done |
| 8 resize handles with correct cursors | `TemplatePreview.jsx` | âœ“ Done |
| Keyboard nudge (arrow keys, ShiftÃ—10) | `TemplatePreview.jsx` | âœ“ Done |
| `hasMoved` ref â€” click vs drag disambiguation | `TemplatePreview.jsx` | âœ“ Done |
| Pointer capture for smooth drag | `TemplatePreview.jsx` | âœ“ Done |
| Viewport-aware drag/resize overrides | `DskEditorPage.jsx` | âœ“ Done |
| `onMoveLayer` / `onResizeLayer` callbacks wired | `DskEditorPage.jsx` | âœ“ Done |
| Unit tests for geometry pure functions | `test/dskEditorGeometry.test.js` | âœ“ Done |
| Component tests for TemplatePreview | `test/components/TemplatePreview.test.jsx` | âœ“ Done |

### Scale contract (implemented)

The preview renders a 1920Ã—1080 canvas scaled to 50% (960Ã—540 display area).
All pointer events divide coordinates by the scale factor before storing them in
the template JSON.

---

## Phase 3 â€” Multi-selection, Undo, Snap â€” Status: Complete âœ“

All Phase 3 features (previously listed as "excluded from Phase 2") are implemented:

| Feature | File | Status |
|---|---|---|
| Undo / Redo (Ctrl+Z / Ctrl+Y, up to 50 steps) | `DskEditorPage.jsx` | âœ“ Done |
| Multi-selection (Shift+click, range select, Ctrl+click toggle) | `DskEditorPage.jsx` | âœ“ Done |
| Snap to grid (20 px grid, toggleable) | `dskEditorGeometry.js` + `TemplatePreview.jsx` | âœ“ Done |
| Snap to layer edges (10 px threshold) | `dskEditorGeometry.js` + `TemplatePreview.jsx` | âœ“ Done |
| Group / Ungroup selected layers | `DskEditorPage.jsx` | âœ“ Done |
| Alignment tools (L/C/R, T/M/B for â‰¥2 selected) | `DskEditorPage.jsx` | âœ“ Done |
| `ellipse` shape type | `TemplatePreview.jsx` + `LayerPropertyEditor.jsx` | âœ“ Done |
| Copy / Paste layers (Ctrl+C / Ctrl+V, offset by 20 px) | `DskEditorPage.jsx` | âœ“ Done |
| Delete selected layers (Delete / Backspace key) | `DskEditorPage.jsx` | âœ“ Done |
| Layer visibility toggle (eye icon) | `DskEditorPage.jsx` | âœ“ Done |
| Duplicate layer button | `DskEditorPage.jsx` | âœ“ Done |
| Safe area guides overlay (90%/80%) | `TemplatePreview.jsx` | âœ“ Done |

### Originally deferred to Phase 4+ â€” since shipped

- Rotation handle â€” **Done** (`tmp_plan_tier3.md` Item 2a): drag handle in `TemplatePreview.jsx`
  (`startRotateDrag`, `rotationFromPointerAngle`, `snapRotation` in `dskEditorGeometry.js`)
  + numeric input in `LayerPropertyEditor.jsx`, 15Â° snap increments, applied consistently in the
  editor canvas, `lcyt-dsk`'s `renderer.js` (Playwright RTMP output â€” `layer.rotation` â†’ CSS
  `transform: rotate()`), and `DskPage.jsx` (live overlay â€” same transform). Verified in code
  2026-07-20.
- Snap to grid *visual* ruler overlay â€” **Done** (`tmp_plan_tier3.md` Item 2b): toggleable
  gridline overlay (`showGrid` prop, `GRID_SIZE` from `dskEditorGeometry.js`) in
  `TemplatePreview.jsx`, editor-canvas-only. Verified in code 2026-07-20.

---

## Phase 4 â€” Media Library â€” Status: Complete âœ“

| Feature | File | Status |
|---|---|---|
| Image upload (PNG /api/v1/ JPEG /api/v1/ WebP /api/v1/ SVG) | `DskEditorPage.jsx` + `/api/v1/images` API | âœ“ Done |
| Image library browse with thumbnail preview | `DskEditorPage.jsx` | âœ“ Done |
| Insert image from library into canvas | `DskEditorPage.jsx` | âœ“ Done |
| Delete image from library | `DskEditorPage.jsx` | âœ“ Done |
| Viewport-specific image crop/fit settings | `DskEditorPage.jsx` + `ImageSettingsTable` | âœ“ Done |

---

## Files changed in Phase 2â€“4

| File | Change |
|---|---|
| `packages/lcyt-web/src/components/DskEditorPage.jsx` | Extracted TemplatePreview; added Phase 2â€“4 callbacks and UI |
| `packages/lcyt-web/src/components/dsk-editor/TemplatePreview.jsx` | New â€” standalone canvas preview with drag/resize/nudge |
| `packages/lcyt-web/src/components/dsk-editor/LayerPropertyEditor.jsx` | New â€” layer property form (extracted from DskEditorPage) |
| `packages/lcyt-web/src/components/dsk-editor/AnimationEditor.jsx` | New â€” animation preset picker |
| `packages/lcyt-web/src/lib/dskEditorGeometry.js` | New â€” pure geometry helpers |
| `packages/lcyt-web/src/lib/dskEditorPresets.js` | New â€” preset template definitions |
| `packages/lcyt-web/test/dskEditorGeometry.test.js` | New â€” unit tests for geometry functions (node:test) |
| `packages/lcyt-web/test/components/TemplatePreview.test.jsx` | New â€” component tests for drag/resize/nudge interactions (Vitest) |

---

## Phase 5 â€” Animations â€” Status: Complete âœ“

### Goal

Entry animations (CSS `animation` shorthand, e.g. `lcyt-fadeIn 0.5s`) already played
correctly when a DSK image or template layer first mounted, on all three rendering
paths (browser overlay page, editor preview, Playwright renderer). What was missing:
images had no editor UI to set per-viewport animations beyond a raw text input, and
nothing played a matching *exit* animation before an image left the DOM â€” it just
vanished instantly the moment a `<!-- graphics:... -->` metacode dropped it from the
active set. Phase 5 closes both gaps for the public `/api/v1/dsk/api/v1/:key` overlay page (the
path OBS browser sources and viewer pages actually render).

### Implemented

| Feature | File | Status |
|---|---|---|
| Exit-animation derivation (reverses entry preset, falls back to fade) | `packages/lcyt-web/src/lib/dskExitAnimation.js` | âœ“ Done |
| Animation total-duration helper (duration + delay, ms) | `packages/lcyt-web/src/lib/dskExitAnimation.js` | âœ“ Done |
| `DskPage.jsx` keeps a removed image mounted for its exit-animation duration, then unmounts it | `packages/lcyt-web/src/components/DskPage.jsx` | âœ“ Done |
| Images with no configured animation are removed instantly (legacy behaviour preserved) | `packages/lcyt-web/src/components/DskPage.jsx` | âœ“ Done |
| Fixed: LCYT `@keyframes` were only injected into the page when a template was active, silently breaking image-only animations | `packages/lcyt-web/src/components/DskPage.jsx` | âœ“ Done |
| `AnimationEditor` preset picker wired into the per-viewport image settings table (was a raw text input) | `packages/lcyt-web/src/components/dsk-viewports/ImageSettingsTable.jsx` | âœ“ Done |
| Unit tests for `dskExitAnimation.js` | `packages/lcyt-web/test/dskExitAnimation.test.js` | âœ“ Done |
| Component tests for `DskPage.jsx` exit-animation lifecycle | `packages/lcyt-web/test/components/DskPage.test.jsx` | âœ“ Done |

### Scope notes

- Out of scope: the ffmpeg-filter-based overlay compositing used by
  `relayManager.setDskOverlay()` (`packages/plugins/lcyt-rtmp/src/rtmp-manager.js`)
  has no DOM/CSS engine and restarts the whole relay ffmpeg process on every overlay
  change â€” it cannot play CSS animations and is architecturally incompatible with
  them. The RTMP "DSK overlay" path for the landscape stream remains an instant cut.
- Out of scope: cross-fading between two different *templates* in the Playwright
  renderer (`packages/plugins/lcyt-dsk/src/renderer.js`) â€” template swaps still do a
  full-page reload. Per-layer entry/exit animations *within* a single rendered
  template already worked before this phase via the page's own CSS `animation`.
- Per-layer exit animations in the `TemplatePreview.jsx` editor canvas were left as
  an instant hide on visibility toggle â€” there's no live-broadcast trigger event for
  single-layer visibility changes without a full template reload, so there was
  nothing to animate against.

### Files changed in Phase 5

| File | Change |
|---|---|
| `packages/lcyt-web/src/lib/dskExitAnimation.js` | New â€” `deriveExitAnimation()` + `getAnimationTotalMs()` pure helpers |
| `packages/lcyt-web/src/components/DskPage.jsx` | Added `exitingNames` state machine; merged active+exiting images into the render list; fixed always-on `@keyframes` injection |
| `packages/lcyt-web/src/components/dsk-viewports/ImageSettingsTable.jsx` | Replaced raw animation text input with `AnimationEditor` preset picker |
| `packages/lcyt-web/test/dskExitAnimation.test.js` | New â€” unit tests (node:test) |
| `packages/lcyt-web/test/components/DskPage.test.jsx` | New â€” component tests (Vitest) for the exit-animation lifecycle |


