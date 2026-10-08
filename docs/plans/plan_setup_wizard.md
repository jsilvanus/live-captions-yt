---
id: plan/setup_wizard
title: "Setup Wizard"
status: implemented
summary: "Adds a guided `/setup` wizard: feature selection, dependency auto-enable, shared config panels (targets/translation/relay/CEA/embed/STT) reused by the wizard and existing modals. All build items done, including the CCModal/SettingsModal panel migration originally tracked as a follow-on. Superseded in part by plan_dashboard_console_redesign.md, which repurposed the `/setup` route itself into the persistent SetupHubPage device/service catalog; the wizard now lives at `/setup/wizard`, reachable via the hub's 'Run setup wizard' link."
---

# Setup Wizard â€” Implementation Plan

## Context

The LCYT web app has a project feature system and session settings (targets, translation, relay)
scattered across CCModal and SettingsModal. There is no guided setup flow. This plan adds a
`/setup` route that walks users through feature selection followed by relevant config pages.

**Key principle:** The config panels (targets, translation, relay, etc.) are **shared** â€” they
render identically whether inside the wizard or inside an existing modal/settings page. The wizard
provides the navigation shell; the panels provide the content. This avoids duplicating UI and
means migrating existing modals to use the same panels is straightforward.

---

## Two Storage Tiers

| Setting type | Store | Written by |
|---|---|---|
| Feature flags + feature config | Backend `project_features` table | `updateFeature(code, enabled, config)` |
| Session settings (targets, translation, relay) | `localStorage` via `KEYS.*` | Direct `localStorage.setItem` calls |

---

## Feature Codes and Config Steps

All 19 feature codes â€” those with `*` get a wizard step:

| Code | Step? | Storage | Config shape |
|---|---|---|---|
| `captions` | **Yes*** | localStorage | `KEYS.targets.list` â€” array of YouTube/viewer/generic targets |
| `viewer-target` | No (covered by targets step) | â€” | â€” |
| `translations` | **Yes** | localStorage | `KEYS.translation.*` â€” vendor, vendorKey, libreUrl, libreKey, showOriginal, list |
| `ingest` | **Yes** | localStorage | `KEYS.relay.*` + `relaySlotKey(slot, field)` â€” up to 8 relay slots |
| `cea-captions` | **Yes** | backend config | `{ delay_ms: number }` |
| `embed` | **Yes** | backend config | `{ cors: string }` |
| `stt-server` | **Yes** | backend config | `{ provider, language, audioSource, confidenceThreshold }` |
| all others | No | â€” | toggle-only in Feature Selection |

*`captions` is a default feature so this step almost always appears.

---

## Dependencies (auto-enable on selection, show inline notice)

```
graphics-server  â†’ graphics-client, ingest
stt-server       â†’ ingest
radio            â†’ ingest
hls-stream       â†’ ingest
preview          â†’ ingest
graphics-client  â†’ (none)
```

---

## Wizard Steps (computed order)

Backend URL is captured at login. API key is managed on the Projects page. Neither appears in
the wizard or settings modals.

```
[0] Feature Selection      (always)
[1] Caption Targets        (if captions)         â†’ localStorage KEYS.targets.list
[2] Translation            (if translations)     â†’ localStorage KEYS.translation.*
[3] RTMP Relay Slots       (if ingest)           â†’ localStorage KEYS.relay.*
[4] CEA Captions           (if cea-captions)     â†’ backend feature config
[5] Embed Widgets          (if embed)            â†’ backend feature config
[6] Server STT             (if stt-server)       â†’ backend feature config
[N] Review                 (always)
```

---

## File Structure

### Already complete (âœ…)

| File | Status |
|---|---|
| `packages/lcyt-backend/src/db/project-features.js` | âœ… `FEATURE_DEPS` + `applyFeatureDeps()` added |
| `packages/lcyt-backend/src/routes/project-features.js` | âœ… calls `applyFeatureDeps`; returns `autoEnabled` |
| `packages/lcyt-web/src/styles/components.css` | âœ… `.btn--ghost`, `.wizard-progress`, `.wizard-dep-notice` added |
| `packages/lcyt-web/src/components/SettingsModal.jsx` | âœ… `backendUrl`/`apiKey` fields removed |

### New files to create

```
packages/lcyt-web/src/
  components/
    panels/                          â† shared config panels (wizard + modals)
      TargetsPanel.jsx
      TargetRow.jsx
      TranslationPanel.jsx
      RelayPanel.jsx
      RelaySlotRow.jsx
      CeaCaptionsPanel.jsx
      EmbedPanel.jsx
      SttPanel.jsx
      ReviewSummary.jsx

    setup-wizard/                    â† wizard shell + orchestration
      index.js
      SetupWizardPage.jsx
      WizardShell.jsx
      WizardProgress.jsx
      DepNotice.jsx
      StepFeatureSelection.jsx
      StepReview.jsx
      hooks/
        useWizardState.js
      lib/
        constants.js
        computeSteps.js
        applyDeps.js
        readLocalSettings.js
        saveWizard.js
```

### Files to modify

| File | Change |
|---|---|
| `packages/lcyt-web/src/main.jsx` | Add lazy import + `<Route path="/setup">` inside SidebarApp |

### Follow-on migration (separate task, not in this implementation)

Once panels exist, swap out duplicated UI in existing modals:

| Existing file | Tab/section | Replace with |
|---|---|---|
| `CCModal.jsx` | Targets tab | `<TargetsPanel>` |
| `CCModal.jsx` | Translation tab | `<TranslationPanel>` |
| `SettingsModal.jsx` | Relay tab | `<RelayPanel>` |

---

## Component and Module Specifications

### `panels/` â€” shared config panels

Each panel: pure data component. Props are just values + onChange. No wizard state, no modal
state. Can be dropped into any container.

---

#### `TargetRow.jsx`

Single caption target editor.

```
Props:
  target: { id, type, streamKey?, viewerKey?, url?, headers?, enabled }
  onChange: (target) => void
  onRemove: () => void
```

Renders: type badge, then type-specific fields:
- `youtube` â†’ stream key `<input type="password">`
- `viewer`  â†’ viewer key `<input type="text">`
- `generic` â†’ URL input + collapsible headers JSON textarea

---

#### `TargetsPanel.jsx`

```
Props:
  targets: object[]
  onChange: (targets) => void
```

Renders list of `<TargetRow>` + add-target row (type selector + button). Shows warning when no
target has a key/URL filled in.

Export: `TargetsPanel`. Also export `targetsHasValid(targets): boolean` for external validation.

---

#### `TranslationPanel.jsx`

```
Props:
  vendor: string
  vendorKey: string
  libreUrl: string
  libreKey: string
  showOriginal: boolean
  translationList: { id, sourceLang, targetLang }[]
  onChange: (patch) => void    // patch is a partial object
```

Renders: vendor select, API key field (hidden for libre), libre URL + key (visible for libre),
show-original checkbox, language pair list with add/remove rows.

---

#### `RelaySlotRow.jsx`

```
Props:
  slot: { slot, active, type, ytKey, genericUrl, genericName, captionMode,
          scale, fps, videoBitrate, audioBitrate }
  onChange: (slot) => void
  defaultExpanded?: boolean
```

Accordion row: header shows slot number + active toggle; body has target type, key/URL, caption
mode, and collapsible advanced fields (scale, fps, bitrates).

---

#### `RelayPanel.jsx`

```
Props:
  relaySlots: object[]
  onChange: (relaySlots) => void
```

Renders list of `<RelaySlotRow>` + "Add slot" button (up to 8). First slot expanded by default.

---

#### `CeaCaptionsPanel.jsx`

```
Props:
  config: { delay_ms: number }
  onChange: (config) => void
```

Single number input for `delay_ms`. Hint: downstream encoder latency compensation.

---

#### `EmbedPanel.jsx`

```
Props:
  config: { cors: string }
  onChange: (config) => void
```

Textarea for CORS origins (one per line; stored comma-separated internally). Hint: use `*` to
allow all.

---

#### `SttPanel.jsx`

```
Props:
  config: { provider, language, audioSource, confidenceThreshold }
  onChange: (config) => void
```

Four fields: provider select (google/whisper_http/openai), language text input, audio source
select (hls/rtmp/whep), confidence threshold range slider + numeric readout.

---

#### `ReviewSummary.jsx`

```
Props:
  step: StepDescriptor
  localSettings: object
  configs: Record<string, object>
```

Renders a compact summary for a single config step. Used by `StepReview`.

---

### `setup-wizard/` â€” wizard shell and orchestration

---

#### `lib/constants.js`

Exports:
- `DRAFT_KEY = 'lcyt.wizard.draft'`
- `MAX_RELAY_SLOTS = 8`
- `ALL_FEATURE_CODES: string[]` â€” all 19 codes
- `FEATURE_LABELS: Record<string, string>` â€” code â†’ human label
- `DEPS: Record<string, string[]>` â€” dependency map
- `CONFIG_STEP_TEMPLATES: StepDescriptor[]` â€” ordered list of config steps

---

#### `lib/applyDeps.js`

```js
// Mutates set. Returns array of auto-enabled codes.
export function applyDeps(set: Set<string>): string[]
```

---

#### `lib/computeSteps.js`

```js
export function computeSteps(selectedFeatures: Set<string>): StepDescriptor[]
// Returns: [{ id:'features', title:'Select Features' }, ...matching config steps, { id:'review', title:'Review' }]
```

---

#### `lib/readLocalSettings.js`

```js
export function readLocalSettings(): LocalSettings
// Reads KEYS.targets.list, KEYS.translation.*, relaySlotKey(n, field) for slots 1-8.
// Returns safe defaults when keys are absent.
```

---

#### `lib/saveWizard.js`

```js
export async function saveWizard({
  selectedFeatures,
  configs,
  localSettings,
  updateFeature,       // from useProjectFeatures
  initialFeatureSet,   // Set<string> â€” state at load time
  initialConfigs,      // Record<string,object> â€” configs at load time
  hasBackend,          // boolean â€” skip backend calls if no apiKey/token
}): Promise<void>
```

Writes localStorage keys first, then diffs against initial state and fires `updateFeature` only
for changed features.

---

#### `hooks/useWizardState.js`

```js
export function useWizardState(backendUrl, token, apiKey): {
  // State
  selectedFeatures: Set<string>,
  configs: Record<string, object>,
  localSettings: LocalSettings,
  stepIndex: number,
  depNotices: string[],
  saving: boolean,
  saveError: string | null,
  initialized: boolean,
  steps: StepDescriptor[],          // computed

  // Actions
  setSelectedFeatures,
  setConfigs,
  setLocalSettings,
  setStepIndex,
  setDepNotices,
  handleFeaturesChange,             // applies deps, updates depNotices
  handleFinish,                     // saves + navigates to /projects
  handleNext, handleBack, handleSkip,
  handleEditStep(idx),
  nextDisabled: boolean,
}
```

Uses `useProjectFeatures(backendUrl, token, apiKey)` internally.
Persists draft to `localStorage` key `lcyt.wizard.draft` on every state change.
Loads draft on first render (before backend features arrive) if present.
Stores initial feature set + configs in refs for diff comparison on save.

---

#### `WizardProgress.jsx`

```
Props: steps: StepDescriptor[], currentIndex: number
```

Flex row of thin segments, filled up to `currentIndex`. Label: `Step N of T â€” title`.

---

#### `DepNotice.jsx`

```
Props: codes: string[], onDismiss: () => void
```

Accent-tinted banner: "Also enabled: X, Y. Required by your selections." + âœ• button.

---

#### `WizardShell.jsx`

```
Props:
  title: string
  steps: StepDescriptor[]
  stepIndex: number
  isConfigStep: boolean     // true = show Skip link
  onBack, onNext, onSkip, onFinish: () => void
  saving: boolean
  saveError: string | null
  nextDisabled: boolean
  children: ReactNode
```

Card container (max-width 620, `var(--color-surface)` bg, border + border-radius 12).
Contains: `<WizardProgress>`, `<h2>` title, `children`, optional error box, nav row.
Nav row: Back (`btn--secondary`), Skip (`btn--ghost`, config steps only), Next/Finish
(`btn--primary`).

---

#### `StepFeatureSelection.jsx`

```
Props:
  value: Set<string>
  onChange: (Set<string>) => void
  depNotices: string[]
  onDismissNotices: () => void
```

Renders `<DepNotice>` then `<FeaturePicker>`. This is the only wizard-specific step that
doesn't delegate to a panel (FeaturePicker is already the right shared component).

---

#### `StepReview.jsx`

```
Props:
  steps: StepDescriptor[]
  selectedFeatures: Set<string>
  localSettings: LocalSettings
  configs: Record<string, object>
  onEditStep: (idx: number) => void
```

Two sections: feature badge list, then one summary card per config step (title + `<ReviewSummary>`
+ "Edit" button).

---

#### `SetupWizardPage.jsx`

Thin orchestrator. Calls `useWizardState`, renders `<WizardShell>` with the current step's panel
as children. Step â†’ component mapping:

| Step id | Component |
|---|---|
| `features` | `StepFeatureSelection` |
| `targets` | `TargetsPanel` |
| `translation` | `TranslationPanel` |
| `relay` | `RelayPanel` |
| `cea-captions` | `CeaCaptionsPanel` |
| `embed` | `EmbedPanel` |
| `stt-server` | `SttPanel` |
| `review` | `StepReview` |

---

#### `index.js`

```js
export { SetupWizardPage } from './SetupWizardPage.jsx';
```

---

## Dependency Auto-Enable Logic (frontend)

```js
// lib/applyDeps.js
const DEPS = {
  'graphics-server': ['graphics-client', 'ingest'],
  'stt-server':      ['ingest'],
  'radio':           ['ingest'],
  'hls-stream':      ['ingest'],
  'preview':         ['ingest'],
};

export function applyDeps(set) {
  const autoEnabled = [];
  for (const [code, deps] of Object.entries(DEPS)) {
    if (set.has(code)) {
      for (const dep of deps) {
        if (!set.has(dep)) { set.add(dep); autoEnabled.push(dep); }
      }
    }
  }
  return autoEnabled;
}
```

---

## Save Flow (in `lib/saveWizard.js`)

```js
// 1. Write localStorage
localStorage.setItem(KEYS.targets.list, JSON.stringify(localSettings.targets));
localStorage.setItem(KEYS.translation.vendor,      localSettings.translationVendor);
localStorage.setItem(KEYS.translation.vendorKey,   localSettings.translationVendorKey);
localStorage.setItem(KEYS.translation.libreUrl,    localSettings.translationLibreUrl);
localStorage.setItem(KEYS.translation.libreKey,    localSettings.translationLibreKey);
localStorage.setItem(KEYS.translation.showOriginal, String(localSettings.translationShowOriginal));
localStorage.setItem(KEYS.translation.list,        JSON.stringify(localSettings.translationList));
localSettings.relaySlots.forEach(slot => {
  localStorage.setItem(relaySlotKey(slot.slot, 'type'),         slot.type || 'youtube');
  localStorage.setItem(relaySlotKey(slot.slot, 'ytKey'),        slot.ytKey || '');
  // ... remaining fields
});

// 2. Diff + write backend features
if (hasBackend) {
  for (const code of ALL_FEATURE_CODES) {
    const wasEnabled = initialFeatureSet.has(code);
    const isEnabled  = selectedFeatures.has(code);
    const cfg        = configs[code] ?? null;
    if (isEnabled !== wasEnabled || (isEnabled && JSON.stringify(cfg) !== JSON.stringify(initialConfigs[code] ?? null))) {
      await updateFeature(code, isEnabled, cfg);
    }
  }
}

// 3. Clear draft
localStorage.removeItem(DRAFT_KEY);
```

---

## Backend Dependency Enforcement (already implemented âœ…)

`FEATURE_DEPS` and `applyFeatureDeps()` in `packages/lcyt-backend/src/db/project-features.js`.
Both `_batchUpdateFeatures` and `_patchFeature` in the routes file call it and return `autoEnabled`.

---

## main.jsx Changes

Add to lazy imports (sidebar routes section):
```js
const SetupWizardPage = lazy(() =>
  import('./components/setup-wizard/index.js').then(m => ({ default: m.SetupWizardPage }))
);
```

Add route inside `<Switch>` in `SidebarApp`, after `/projects`:
```jsx
<Route path="/setup" component={SetupWizardPage} />
```

**Superseded (2026-07-06 by `plan_dashboard_console_redesign.md`):** `/setup` was
later repurposed from this one-time wizard into the persistent `SetupHubPage`
device/service catalog. The wizard itself was not deleted â€” it now lives at
`/setup/wizard` (`packages/lcyt-web/src/main.jsx`: `<Route path="/setup" component={SetupHubPage} />`,
`<Route path="/setup/wizard" component={SetupWizardPage} />`), reachable from
the hub via "Run setup wizard." Everything else in this plan (steps, panels,
dependency logic, save flow) is unaffected by the route change.

---

## Verification

1. Navigate to `/setup` â†’ Feature Selection shown, segmented progress bar shows 1 step
2. Toggle `stt-server` â†’ `ingest` auto-enables, dep notice appears with âœ• dismiss
3. Toggle `graphics-server` â†’ `graphics-client` + `ingest` auto-enable in same notice
4. Click Next â†’ Caption Targets panel (captions is default-on)
5. Add YouTube target with stream key â†’ Next enabled; leave key empty â†’ Next disabled with warning
6. Translation not selected â†’ step skipped entirely
7. Relay not selected â†’ step skipped; Relay selected â†’ RelayPanel shown, slot 1 expanded
8. `stt-server` selected â†’ SttPanel shown with provider/language/audioSource/threshold
9. Review: feature badges list all selected codes; config cards show summaries; Edit jumps back
10. Finish â†’ localStorage written; backend PATCHes sent only for changed features; redirect `/projects`
11. Refresh mid-wizard â†’ draft restored from `lcyt.wizard.draft`
12. Backend: `PATCH /keys/:key/features/graphics-server` with `enabled:true` â†’ response includes `autoEnabled: ["graphics-client","ingest"]`
13. Open CCModal Targets tab (after follow-on migration) â†’ visually identical to wizard Targets step

---

## Implementation Status

| Item | Status |
|---|---|
| `db/project-features.js` â€” FEATURE_DEPS + applyFeatureDeps | âœ… done |
| `routes/project-features.js` â€” dep enforcement + autoEnabled | âœ… done |
| `styles/components.css` â€” wizard CSS classes | âœ… done |
| `SettingsModal.jsx` â€” backendUrl/apiKey removed | âœ… done |
| `panels/` â€” all shared panel components | âœ… done |
| `setup-wizard/lib/` â€” constants, computeSteps, applyDeps, readLocalSettings, saveWizard | âœ… done |
| `setup-wizard/hooks/useWizardState.js` | âœ… done |
| `setup-wizard/` â€” WizardShell, WizardProgress, DepNotice, StepFeatureSelection, StepReview, SetupWizardPage, index | âœ… done |
| `main.jsx` â€” /setup route | âœ… done |
| `navConfig.js` â€” Setup nav item in NAV_BOTTOM | âœ… done |
| CCModal/SettingsModal migration to use panels | âœ… done â€” `CCModal.jsx` imports `TargetsPanel`, `TranslationPanel`, `ServicePanel`, `DetailsPanel`; `SettingsModal.jsx` imports `RelayPanel` (confirmed by import grep, 2026-07-20) |

