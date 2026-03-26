# Component Split Plan — `packages/lcyt-web`

**Created:** 2026-03-26
**Status:** Completed (all high, medium, and low priority items done)

This document identifies monolithic components in `packages/lcyt-web/src/components/`
that should be split into smaller, potentially shared, pieces. Priorities are ranked
**High / Medium / Low** based on component size, duplication, and testability benefit.

---

## Background: Shared panels already extracted

As of the setup-wizard PR the following shared panels exist under `components/panels/`:

| Panel | Lines | Used in |
|---|---|---|
| `TargetRow.jsx` / `TargetsPanel.jsx` | 130 / 45 | `CCModal`, wizard |
| `TranslationPanel.jsx` | 120 | `CCModal`, wizard |
| `RelaySlotRow.jsx` / `RelayPanel.jsx` | 100 / 80 | `SettingsModal`, wizard |
| `CeaCaptionsPanel.jsx` | 30 | wizard |
| `EmbedPanel.jsx` | 30 | wizard |
| `SttPanel.jsx` | 70 | wizard |
| `ReviewSummary.jsx` | 55 | wizard |

These panels are the **reference pattern**: pure data components with `onChange` props,
no wizard or modal state, no side-effects. New splits should follow this pattern.

---

## 1. `CCModal.jsx` — 1 400 lines → ~600 lines  ⚡ High

CCModal has already been migrated to use shared panels for the Targets and Translation tabs.
Two more sections can be extracted.

### 1a. Service tab → `panels/ServicePanel.jsx` (~280 lines)

The **Service** tab contains the STT engine picker, mic selector, language selector,
on-device local model toggle, utterance-end controls, Google Cloud STT model/options/
confidence/credential fields, and the Server STT section (provider, language, audio
source, confidence threshold, auto-start, start/stop controls).

**Extract:**
```
components/panels/ServicePanel.jsx
```

Props:
```
sttEngine, onSttEngineChange,
selectedMicId, onMicIdChange, micDevices, onRefreshMics,
sttLang, onSttLangChange,
sttLocal, onSttLocalChange, localAvailability,
utteranceEndButton, onUtteranceEndButtonChange,
utteranceEndTimer, onUtteranceEndTimerChange,
cloudModel, onCloudModelChange,
cloudPunctuation, onCloudPunctuationChange,
cloudProfanity, onCloudProfanityChange,
cloudConfidence, onCloudConfidenceChange,
cloudMaxLen, onCloudMaxLenChange,
credential, onCredentialLoad, onCredentialClear, credError,
serverStt: { provider, lang, audioSource, autoStart, confidenceThreshold, running,
             busy, error, whepAvailable },
onServerSttChange, onServerSttStart, onServerSttStop,
advancedMode, connected,
```

**Caller change in `CCModal.jsx`:**
```jsx
{activeTab === 'service' && (
  <div className="settings-panel settings-panel--active">
    <ServicePanel {...serviceProps} />
  </div>
)}
```

**Testability benefit:** ServicePanel can be unit-tested without the full CCModal
state machine. The server STT start/stop logic can be tested with mock session props.

### 1b. Details tab → `panels/DetailsPanel.jsx` (~80 lines)

The **Details** tab contains the batch window slider, transcription offset slider,
and client VAD settings (enable, silence duration, energy threshold).

**Extract:**
```
components/panels/DetailsPanel.jsx
```

Props:
```
batchInterval, onBatchIntervalChange, batchLocked,
transcriptionOffset, onTranscriptionOffsetChange,
vadEnabled, onVadEnabledChange,
vadSilenceMs, onVadSilenceMsChange,
vadThreshold, onVadThresholdChange,
```

---

## 2. `DskEditorPage.jsx` — 1 755 lines → ~350 lines  ⚡ High

The DSK visual editor is the largest file in the codebase. Most of its bulk is in
helper functions and sub-components that can live in their own files.

### 2a. Geometry helpers → `lib/dskEditorGeometry.js`

Pure functions (no React) currently at the top of the file:

- `handleAnchor(handle, layer)`
- `applyResize(handle, startRect, dx, dy)`
- `gridSnap(v)`
- `snapToLayerEdges(tentX, tentY, primaryLayer, allLayers, movingIds)`
- `getLayerViewportPos(layer, selectedViewport)`

**Extract:**
```
lib/dskEditorGeometry.js
```

Benefit: pure functions are trivially unit-testable.

### 2b. Preset templates → `lib/dskEditorPresets.js`

The `PRESETS` array (lines 131–185, ~55 lines) is constant data. Move to a module.

**Extract:**
```
lib/dskEditorPresets.js
```

### 2c. `TemplatePreview` → `dsk-editor/TemplatePreview.jsx`

The `TemplatePreview` component (~245 lines, lines 252–476) renders the live
canvas preview of a template (drag+drop, resize handles, selection, snap lines).
It has its own `useEffect`/`useCallback` hooks and is logically self-contained.

**Extract:**
```
components/dsk-editor/TemplatePreview.jsx
```

Props: `template, selectedIds, onSelect, onLayerUpdate, selectedViewport,
serverUrl, onAddTextLayer` (derive from current usage).

### 2d. `AnimationEditor` → `dsk-editor/AnimationEditor.jsx`

Animation editor sub-component (~65 lines, lines 543–606) with its helper
`parseAnimation`/`buildAnimation` functions.

**Extract:**
```
components/dsk-editor/AnimationEditor.jsx
lib/dskEditorAnimation.js   (parseAnimation, buildAnimation)
```

### 2e. `LayerPropertyEditor` → `dsk-editor/LayerPropertyEditor.jsx`

The property editor panel (~130 lines, lines 657–780) reads and writes individual
layer fields (text content, font, color, border-radius, etc.).

**Extract:**
```
components/dsk-editor/LayerPropertyEditor.jsx
```

### 2f. Resulting `DskEditorPage.jsx` (~350 lines)

After extractions the main component retains: state management (template, selection,
drag state, viewport selection), layer CRUD actions, toolbar JSX, and composition of
the extracted sub-components.

---

## 3. `AudioPanel.jsx` — 1 071 lines → ~350 lines  ⚡ High

A single 1 071-line component with 58 hook calls — the highest hook density in the
codebase. All logic and rendering live in one `export function AudioPanel`.

### 3a. Audio level meter → `audio/AudioLevelMeter.jsx`

The animated audio level bar and peak hold logic. Currently inline; used only inside
`AudioPanel`.

### 3b. STT engine selection UI → reuse `panels/ServicePanel.jsx`

Once `ServicePanel` is extracted from `CCModal` (item 1a), the STT engine picker,
mic selector, language selector, and advanced options can be composed from the same
panel inside the AudioPanel inline settings popover rather than duplicated.

### 3c. WebSpeech recognition state machine → `hooks/useWebSpeech.js`

The `SpeechRecognition` lifecycle (start, stop, error recovery, interim/final results,
`onresult` dispatch, restart-on-error backoff) is ~200 lines of state management. Extract
into a hook.

```js
// hooks/useWebSpeech.js
export function useWebSpeech({ lang, continuous, onInterim, onFinal, enabled })
// Returns: { status, start, stop }
```

### 3d. Resulting `AudioPanel.jsx` (~350 lines)

Retains: UI layout, popover state, record button, progress bar, composition of
`AudioLevelMeter`, `useWebSpeech`.

---

## 4. `BroadcastModal.jsx` — 833 lines  📌 Medium

BroadcastModal already splits content across three tab-level functions
(`EncoderTab`, `StreamTab`, `YouTubeTab`) that live in the same file.

### 4a. Extract tab functions to own files

```
components/broadcast/EncoderTab.jsx    (~165 lines)
components/broadcast/StreamTab.jsx     (~185 lines)
components/broadcast/YouTubeTab.jsx    (~245 lines)
```

Each file becomes an independent component with its own imports and local state.

### 4b. `StreamTab` to use shared `RelayPanel`

`BroadcastModal.StreamTab` (line 202) has a local `RelayRow` that duplicates
`panels/RelaySlotRow.jsx`. Replace:

```jsx
// components/broadcast/StreamTab.jsx
import { RelayPanel } from '../panels/RelayPanel.jsx';
// Remove local RelayRow and RtmpUrlField functions
```

### 4c. `BroadcastModal.jsx` shell (~80 lines)

After extraction, `BroadcastModal.jsx` retains only the tab switcher, modal
open/close logic, and lazy-loaded tab imports.

---

## 5. `SidebarLayout.jsx` — 709 lines  📌 Medium

Already has internal sub-functions but all live in one file. The component
handles both the navigation shell and several complex popovers.

### 5a. `StatusPopover` → `sidebar/StatusPopover.jsx` (~70 lines)

The session-status popover (connection info, API key/URL, disconnect button).

### 5b. `QuickActionsPopover` → `sidebar/QuickActionsPopover.jsx` (~200 lines)

The Quick Actions popover (send commands, file ops, etc.) is large enough to
warrant its own file and test.

### 5c. `TopBar` → `sidebar/TopBar.jsx` (~30 lines)

The horizontal top bar (hamburger menu, logo, popover buttons).

### 5d. `Sidebar` + `SidebarGroup` + `SidebarItem` → `sidebar/Sidebar.jsx`

The navigation list with group collapsing. Includes nav config constant
(move to `sidebar/navConfig.js`).

### 5e. Resulting `SidebarLayout.jsx` (~150 lines)

Retains: layout grid, mobile state, drawer, reconnect banner, composition.

---

## 6. `DskViewportsPage.jsx` — 862 lines  📌 Medium

Already has sub-components defined at the bottom of the file. Extract them:

### 6a. `TextLayersEditor` → `dsk-viewports/TextLayersEditor.jsx` (~130 lines)

The editor for per-viewport static text overlay layers, with its helper
`TextLayerMiniPreview`.

### 6b. `ImageSettingsTable` → `dsk-viewports/ImageSettingsTable.jsx` (~45 lines)

Per-image settings table (z-index, animation, etc.).

### 6c. `ImageRow` → `dsk-viewports/ImageRow.jsx` (~50 lines)

Single image accordion row.

### 6d. Resulting `DskViewportsPage.jsx` (~600 lines)

Retains: viewport CRUD, SSE connection, API calls, composition of extracted
sub-components.

---

## 7. `CaptionsModal.jsx` — 639 lines  🔵 Low

Three tabs: **Model** (STT cloud config), **VAD** (voice activity detection), **Other**
(caption post-processing). Can be split once `ServicePanel` exists.

### 7a. Model tab content

The Model tab overlaps significantly with the cloud section of `ServicePanel` (item 1a).
After `ServicePanel` is extracted, `CaptionsModal`'s Model tab can be refactored to
compose from `ServicePanel` rather than duplicating.

### 7b. VAD tab → `panels/VadPanel.jsx` (~70 lines)

VAD settings (enable, silence duration, energy threshold) are already similar to the
Details tab VAD section in CCModal. Extract to a shared panel.

---

## 8. `ControlsPanel.jsx` — 460 lines  🔵 Low

A single export containing playback controls, file navigation, send controls, and
settings shortcuts. Could be split by function group once patterns emerge, but current
size is borderline. Defer unless a clear reuse opportunity arises.

---

## 9. Production pages — 470–523 lines each  🔵 Low

`ProductionCamerasPage`, `ProductionMixersPage`, `ProductionBridgesPage` all follow a
consistent pattern (Form + Row + Page). Already reasonably structured. Main candidate:

### 9a. Shared `ConnectionDot` → `production/ConnectionDot.jsx`

`ConnectionDot` is defined identically in both `ProductionMixersPage` and
`ProductionBridgesPage`. Extract to a shared component.

### 9b. Forms to own files (optional)

`CameraForm` (225 lines), `MixerForm` (255 lines), `AddBridgeForm` / `SendCommandModal`
are large enough to benefit from extraction but are used only once each. Low priority.

---

## Summary table

| File | Before | After | Priority | Status | Key extractions |
|---|---|---|---|---|---|
| `CCModal.jsx` | 1 400 | 468 | **High** | ✅ Done | `ServicePanel`, `DetailsPanel`, `TargetsPanel`, `TranslationPanel` |
| `DskEditorPage.jsx` | 1 755 | 1 350 | **High** | ✅ Done | geometry lib, presets lib, `TemplatePreview`, `AnimationEditor`, `LayerPropertyEditor` |
| `AudioPanel.jsx` | 1 071 | 1 040 | **High** | ✅ Done | `AudioLevelMeter`, `useWebSpeech` |
| `BroadcastModal.jsx` | 833 | 55 | **Medium** | ✅ Done | `EncoderTab`, `StreamTab` (uses `RelayPanel`), `YouTubeTab` |
| `SidebarLayout.jsx` | 709 | 95 | **Medium** | ✅ Done | `StatusPopover`, `QuickActionsPopover`, `TopBar`, `Sidebar`, `navConfig.js` |
| `DskViewportsPage.jsx` | 862 | 493 | **Medium** | ✅ Done | `TextLayersEditor`, `ImageSettingsTable`, `ImageRow`, `styles.js` |
| `CaptionsModal.jsx` | 639 | 602 | **Low** | ✅ Done | `VadPanel` |
| `ControlsPanel.jsx` | 460 | — | **Low** | ⏭ Deferred | defer until clear reuse opportunity |
| Production pages × 3 | 470–523 | ~505 | **Low** | ✅ Done | shared `ConnectionDot` |

---

## Implementation order

1. **`panels/ServicePanel.jsx`** — most reuse potential (CCModal, CaptionsModal, AudioPanel).
2. **`panels/DetailsPanel.jsx` / `panels/VadPanel.jsx`** — small, test immediately.
3. **`dsk-editor/` + `lib/dsk*.js`** — large win for DskEditorPage testability.
4. **`hooks/useWebSpeech.js`** — AudioPanel complexity reduction.
5. **`broadcast/`** — remove third copy of RelayRow.
6. **`sidebar/`** — cosmetic but improves navigation/discoverability.
7. Production pages / ControlsPanel — as needed.

---

## Notes

- Each extraction **must not change observable behaviour**.
- Extract files should have their own `test/components/` file verifying the extracted
  component in isolation.
- Shared panels follow the convention: pure data props + `onChange`, no side-effects,
  no context access except `useLang`.
