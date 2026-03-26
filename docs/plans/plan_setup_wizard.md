# Setup Wizard — Implementation Plan

## Context

The LCYT web app has a project feature system (`project_features` table, `useProjectFeatures` hook, `FeaturePicker` component) but no guided setup flow. Users enabling features like `stt-server`, `cea-captions`, or `embed` need to configure them — currently there's no wizard to walk them through it. This plan adds a `/setup` route that presents a feature selection step followed by config-only pages for the features that actually require input, then a review step.

---

## Feature Codes and Which Get a Config Step

From `FeaturePicker.jsx` FEATURE_GROUPS — all 19 codes, only 3 need wizard config pages:

| Code | Config page? | Config shape |
|---|---|---|
| `captions`, `viewer-target`, `mic-lock`, `stats`, `collaboration` | No | — |
| `file-saving`, `translations`, `planning` | No | — |
| `graphics-client` | No | — |
| `graphics-server` | No | — |
| `ingest`, `radio`, `hls-stream`, `preview`, `restream-fanout` | No | — |
| `device-control` | No | — |
| `cea-captions` | **Yes** | `{ delay_ms: number }` |
| `embed` | **Yes** | `{ cors: string }` |
| `stt-server` | **Yes** | `{ provider, language, audioSource, confidenceThreshold }` |

## Dependencies (auto-enable on selection, show inline notice)

```
graphics-server  → graphics-client, ingest
  (server renderer loads the graphics-client page in headless Chromium, then pushes to RTMP)
stt-server       → ingest
radio            → ingest
hls-stream       → ingest
preview          → ingest
graphics-client  → (none — browser-side SSE subscriber, standalone)
```

---

## Wizard Steps (computed)

```
[0] Feature Selection   (always)
[1] CEA Captions Config (if cea-captions selected)
[2] Embed Widgets       (if embed selected)
[3] Speech-to-Text      (if stt-server selected)
[N] Review              (always)
```

Step array is derived: `[features, ...CONFIG_STEP_TEMPLATES.filter(t => selected.has(t.featureCode)), review]`

---

## Files to Create / Modify

| File | Action |
|---|---|
| `packages/lcyt-backend/src/db/project-features.js` | **Modify** — add `FEATURE_DEPS` map + `applyFeatureDeps()` helper; call it in `setProjectFeature` and `setProjectFeatures` |
| `packages/lcyt-backend/src/routes/project-features.js` | **Modify** — call `applyFeatureDeps` before writing, include auto-enabled codes in response |
| `packages/lcyt-web/src/components/SetupWizardPage.jsx` | **Create** — all wizard sub-components (module-private functions in one file, matching large single-file page pattern) |
| `packages/lcyt-web/src/main.jsx` | **Modify** — add lazy import + `<Route path="/setup">` inside SidebarApp |
| `packages/lcyt-web/src/styles/components.css` | **Modify** — add `.btn--ghost`, `.wizard-progress`, `.wizard-dep-notice` |

---

## Component Breakdown

### `SetupWizardPage` (default export)

State:
```js
selectedFeatures: Set<string>         // toggled features
configs: Record<string, object>       // per-feature config, keyed by feature code
stepIndex: number                     // index into computed steps[]
depNotices: string[]                  // feature codes auto-enabled (dismissed by user)
saving: boolean
saveError: string | null
initialized: boolean                  // true once initial load from API completes
```

- Reads auth via `useUserAuth()` for `backendUrl`, `token`
- Reads active `apiKey` from localStorage (`lcyt-config` → `apiKey`), same as ProjectsPage
- Uses `useProjectFeatures(backendUrl, token, apiKey)` to load initial state
- `steps` computed with `useMemo` from `selectedFeatures`
- Draft persisted to `localStorage` key `lcyt.wizard.draft` on every state change

### `WizardShell` (module-private)

Card container + nav row. Props: `title`, `stepIndex`, `totalSteps`, `isConfigStep`, `onBack`, `onNext`, `onSkip`, `onFinish`, `saving`, `saveError`, `children`.

Layout: centered card, `maxWidth: 560`, `padding: 32 28`, `gap: 20`. Nav row: Back (`btn--secondary`), Skip link (`btn--ghost`, only on config steps), Next/Finish (`btn--primary`).

### `WizardProgress` (module-private)

Segmented progress bar — flex row of thin divs (4px height), filled/unfilled by index. Label: `Step {n} of {total} — {title}`.

### `DepNotice` (module-private)

Inline banner: `codes[]` → "Also enabled: X, Y. Required by your selections." with ✕ dismiss. Accent-tinted background.

### `StepFeatureSelection` (module-private)

Renders `<FeaturePicker>` (reuse existing) + `<DepNotice>` when `depNotices.length > 0`. Dependency auto-enable logic lives here via `onChange` wrapper in `SetupWizardPage`.

### `StepCeaCaptions` (module-private)

Single `settings-field`: number input for `delay_ms`. Hint explains downstream encoder compensation.

### `StepEmbed` (module-private)

Single `settings-field`: textarea for `cors` (one origin per line). Hint: use `*` to allow all.

### `StepStt` (module-private)

Four `settings-field` items:
1. Provider — `<select>`: `google`, `whisper_http`, `openai`
2. Language — `<input>` placeholder `en-US`
3. Audio source — `<select>`: `hls`, `rtmp`, `whep`
4. Confidence threshold — `<input type="range" min=0 max=1 step=0.05>` + numeric readout

### `StepReview` (module-private)

- Badge list of all enabled features (pill style matching ProjectsPage)
- One summary card per config step with values + "Edit" button (calls `onEditStep(index)`)
- Save error displayed inline

---

## Dependency Auto-Enable Logic

```js
const DEPS = {
  'graphics-server': ['graphics-client', 'ingest'],
  //  ↑ server renderer loads the graphics-client page in headless Chromium,
  //    then captures and pushes its output via ffmpeg → RTMP (ingest)
  'stt-server':      ['ingest'],
  'radio':           ['ingest'],
  'hls-stream':      ['ingest'],
  'preview':         ['ingest'],
  // graphics-client has no deps — browser page subscribing to SSE events
};

function applyDeps(newSet) {
  const autoEnabled = [];
  for (const [code, deps] of Object.entries(DEPS)) {
    if (newSet.has(code)) {
      for (const dep of deps) {
        if (!newSet.has(dep)) { newSet.add(dep); autoEnabled.push(dep); }
      }
    }
  }
  return autoEnabled; // shown in DepNotice
}
```

Called inside `handleFeaturesChange` in `SetupWizardPage`.

---

## Step Navigation: Boundary Cases

- Changing features on step 0 recomputes `steps`. If current `stepIndex` would exceed new `steps.length - 1`, clamp it.
- "Skip" on a config step: keeps the feature enabled but leaves its config at defaults (or previously saved values).
- "Edit" from Review: sets `stepIndex` to the target step directly.

---

## Save Flow (Finish button on Review step)

```js
async function handleFinish() {
  setSaving(true);
  // 1. Determine diff vs. loaded features
  // 2. For each feature in FEATURE_CODES:
  //    - if selected and not previously enabled: updateFeature(code, true, configs[code] ?? null)
  //    - if not selected and previously enabled: updateFeature(code, false)
  //    - if selected and config changed: updateFeature(code, true, configs[code])
  // 3. Clear localStorage draft
  // 4. navigate('/projects')
}
```

Uses `updateFeature` from `useProjectFeatures` (one PATCH per changed feature).

---

## CSS Additions (`components.css`)

```css
.btn--ghost {
  background: transparent;
  border: none;
  color: var(--color-text-muted);
  padding: 5px 8px;
  font-size: 13px;
  cursor: pointer;
}
.btn--ghost:hover { color: var(--color-text); }

.wizard-progress { display: flex; gap: 4px; margin-bottom: 4px; }
.wizard-progress__seg { flex: 1; height: 4px; border-radius: 2px; background: var(--color-border); }
.wizard-progress__seg--done { background: var(--color-accent); }

.wizard-dep-notice {
  background: color-mix(in srgb, var(--color-accent) 8%, transparent);
  border: 1px solid var(--color-accent);
  border-radius: 6px;
  padding: 10px 12px;
  font-size: 13px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
```

---

## Backend Dependency Enforcement

**Current state:** `packages/lcyt-backend/src/routes/project-features.js` has no dependency logic. Enabling `graphics-server` without `graphics-client` is accepted silently.

**Add to `packages/lcyt-backend/src/db/project-features.js`:**

```js
export const FEATURE_DEPS = {
  'graphics-server': ['graphics-client', 'ingest'],
  'stt-server':      ['ingest'],
  'radio':           ['ingest'],
  'hls-stream':      ['ingest'],
  'preview':         ['ingest'],
};

/** Returns array of feature codes that were auto-enabled as deps. */
export function applyFeatureDeps(db, apiKey, featureMap) {
  const autoEnabled = [];
  for (const [code, deps] of Object.entries(FEATURE_DEPS)) {
    const val = featureMap[code];
    const enabling = typeof val === 'boolean' ? val : val?.enabled;
    if (enabling) {
      for (const dep of deps) {
        if (!featureMap[dep]) {
          featureMap[dep] = true;
          autoEnabled.push(dep);
        }
      }
    }
  }
  return autoEnabled;
}
```

**Changes to `_batchUpdateFeatures` in `project-features.js`:**
- Call `applyFeatureDeps(db, apiKey, features)` after entitlement check, before `setProjectFeatures`
- Include `autoEnabled` array in response: `{ features: [...], autoEnabled: [...] }`

**Changes to `_patchFeature`:**
- For a single PATCH enabling a feature with deps, build a synthetic `featureMap`, call `applyFeatureDeps`, then upsert all affected codes
- Include `autoEnabled` in response

---

## Key Existing Utilities to Reuse

| Utility | Path |
|---|---|
| `FeaturePicker` component | `packages/lcyt-web/src/components/FeaturePicker.jsx` |
| `useProjectFeatures` hook | `packages/lcyt-web/src/hooks/useProjectFeatures.js` |
| `useUserAuth` hook | `packages/lcyt-web/src/hooks/useUserAuth.js` |
| `.btn`, `.btn--primary`, `.btn--secondary`, `.settings-field`, `.settings-field__input`, `.settings-field__label`, `.settings-field__hint` | `packages/lcyt-web/src/styles/components.css` |
| Lazy route pattern | `packages/lcyt-web/src/main.jsx` (see other SidebarApp routes) |

---

## Verification

1. `npm run web` → navigate to `/setup`
2. Feature Selection: toggle `stt-server` → `ingest` auto-enables, dep notice appears
3. Toggle `graphics-server` → `graphics-client` + `ingest` both auto-enable, dep notice appears
4. Click Next → STT Config page appears (cea-captions and embed not selected, skipped)
5. Fill in provider/language → click Next → Review shows summary with correct values
6. Click "Edit" on STT row → jumps back to STT step
7. Refresh browser mid-wizard → draft restored from localStorage
8. Click Finish → PATCH requests sent for changed features, redirect to `/projects`
9. Re-open `/setup` with existing project features → initializes from API, no blank state
10. Backend: PATCH `/keys/:key/features/graphics-server` with `{ enabled: true }` → response includes `autoEnabled: ["graphics-client", "ingest"]`
