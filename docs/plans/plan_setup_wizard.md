# Setup Wizard — Implementation Plan

## Context

The LCYT web app has a project feature system and session settings (targets, translation, relay)
scattered across CCModal and SettingsModal. There is no guided setup flow. This wizard adds a
`/setup` route that walks users through feature selection followed by the relevant config pages
for each chosen feature — both feature-level config (stored in backend `project_features.config`)
and session-level config (stored in localStorage).

---

## Two Storage Tiers

| Setting type | Store | Written by |
|---|---|---|
| Feature flags + feature config | Backend `project_features` table | `updateFeature(code, enabled, config)` |
| Session settings (targets, translation, relay, credentials) | `localStorage` via `KEYS.*` | Direct `localStorage.setItem` calls |

The wizard save flow must handle both on Finish.

---

## Feature Codes and Config Steps

All 19 feature codes — those with `*` get a wizard step:

| Code | Step? | Storage | Config shape |
|---|---|---|---|
| `captions` | **Yes*** | localStorage | `KEYS.targets.list` — array of YouTube/viewer/generic targets |
| `viewer-target` | No (covered by targets step) | — | — |
| `translations` | **Yes** | localStorage | `KEYS.translation.*` — vendor, vendorKey, libreUrl, libreKey, showOriginal, list |
| `ingest` | **Yes** | localStorage | `KEYS.relay.*` + `relaySlotKey(slot, field)` — up to 8 relay slots |
| `cea-captions` | **Yes** | backend config | `{ delay_ms: number }` |
| `embed` | **Yes** | backend config | `{ cors: string }` |
| `stt-server` | **Yes** | backend config | `{ provider, language, audioSource, confidenceThreshold }` |
| all others | No | — | toggle-only in Feature Selection |

*`captions` is a default feature so this step almost always appears.

---

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

## Wizard Steps (computed order)

Backend URL is captured at login. API key is managed on the Projects page. Neither appears in the wizard or settings modals.

```
[0] Feature Selection      (always)
[1] Caption Targets        (if captions)         → localStorage KEYS.targets.list
[2] Translation            (if translations)     → localStorage KEYS.translation.*
[3] RTMP Relay Slots       (if ingest)           → localStorage KEYS.relay.*
[4] CEA Captions           (if cea-captions)     → backend feature config
[5] Embed Widgets          (if embed)            → backend feature config
[6] Server STT             (if stt-server)       → backend feature config
[N] Review                 (always)
```

Step array derived:
```js
const CONFIG_STEP_TEMPLATES = [
  { id: 'targets',      title: 'Caption Targets',    featureCode: 'captions'     },
  { id: 'translation',  title: 'Translation',        featureCode: 'translations' },
  { id: 'relay',        title: 'RTMP Relay Slots',   featureCode: 'ingest'       },
  { id: 'cea-captions', title: 'CEA Captions',       featureCode: 'cea-captions' },
  { id: 'embed',        title: 'Embed Widgets',      featureCode: 'embed'        },
  { id: 'stt-server',   title: 'Server STT',         featureCode: 'stt-server'   },
];

function computeSteps(selectedFeatures) {
  return [
    { id: 'features', title: 'Select Features' },
    ...CONFIG_STEP_TEMPLATES.filter(t => t.always || selectedFeatures.has(t.featureCode)),
    { id: 'review', title: 'Review' },
  ];
}
```

---

## Files to Create / Modify

| File | Action |
|---|---|
| `packages/lcyt-backend/src/db/project-features.js` | **Modify** — add `FEATURE_DEPS` + `applyFeatureDeps()` |
| `packages/lcyt-backend/src/routes/project-features.js` | **Modify** — call `applyFeatureDeps` before writing; include `autoEnabled` in response |
| `packages/lcyt-web/src/components/SetupWizardPage.jsx` | **Create** — all wizard sub-components in one file |
| `packages/lcyt-web/src/main.jsx` | **Modify** — lazy import + `<Route path="/setup">` inside SidebarApp |
| `packages/lcyt-web/src/styles/components.css` | **Modify** — add `.btn--ghost`, `.wizard-progress`, `.wizard-dep-notice` |

---

## Component Breakdown

### `SetupWizardPage` (default export)

State:
```js
selectedFeatures: Set<string>     // feature toggles
configs: Record<string, object>   // backend feature configs, keyed by feature code
localSettings: {                  // localStorage-bound settings
  targets: object[],              // caption targets array
  translationVendor: string,
  translationVendorKey: string,
  translationLibreUrl: string,
  translationLibreKey: string,
  translationShowOriginal: boolean,
  translationList: object[],
  relaySlots: object[],           // up to 8 relay slot configs
}
stepIndex: number
depNotices: string[]
saving: boolean
saveError: string | null
initialized: boolean
```

- `useUserAuth()` → `backendUrl`, `token`
- Active `apiKey` from localStorage `KEYS.session.config`
- `useProjectFeatures(backendUrl, token, apiKey)` → initial feature state
- `steps` via `useMemo` from `selectedFeatures`
- Draft to `localStorage` key `lcyt.wizard.draft` on every change

---

### Step Components (all module-private)

#### `WizardShell`
Card container + progress bar + nav. Props: `title`, `stepIndex`, `totalSteps`, `isConfigStep`, `onBack`, `onNext`, `onSkip`, `onFinish`, `saving`, `saveError`, `children`. Nav: Back (`btn--secondary`), Skip (`btn--ghost`, config steps only), Next/Finish (`btn--primary`).

#### `WizardProgress`
Segmented bar: `steps.length` thin divs, filled up to `currentIndex`. Label: `Step N of T — title`.

#### `DepNotice`
Banner when deps auto-enabled: "Also enabled: X, Y. Required by your selections." with ✕ dismiss.

#### `StepFeatureSelection`
`<FeaturePicker>` + `<DepNotice>`. Dep logic runs inside `handleFeaturesChange`.

#### `StepTargets` *(new)*
Manage the `targets[]` array. Mirrors the Targets tab of CCModal but simplified for wizard:
- List of existing targets with type badge + key/URL summary + Remove button
- "Add target" row with type selector (`youtube` / `viewer` / `generic`) then relevant fields:
  - `youtube` → stream key input
  - `viewer` → viewer key input
  - `generic` → URL input + optional headers (JSON textarea, collapsible)
- At least one enabled target required to enable Next (show inline warning otherwise)

State: `targets: object[]` (matches `KEYS.targets.list` JSON shape).

#### `StepTranslation` *(new)*
Four `settings-field` items:
1. Vendor — `<select>`: `google`, `azure`, `libre`
2. API key — `<input type="password">`
3. LibreTranslate URL — `<input type="url">` (only visible when vendor = `libre`)
4. Show original — checkbox

Below: language pair list (add/remove, source lang → target lang). Mirrors CCModal Translation tab.

#### `StepRelaySlots` *(new)*
Up to 8 relay slots. Each slot (collapsed by default, expand on click):
- Active toggle
- Target type (`youtube` / `generic`)
- YouTube key or generic URL + name
- Caption mode (`http` / `cea708`)
- Advanced (scale, fps, video bitrate, audio bitrate) — collapsed by default

Only slot 1 expanded on initial render.

#### `StepCeaCaptions`
Single `settings-field`: number input for `delay_ms`. Hint: downstream encoder latency compensation.

#### `StepEmbed`
Single `settings-field`: textarea for `cors` origins (one per line). Hint: use `*` to allow all.

#### `StepStt`
Four `settings-field` items: provider select, language input, audio source select, confidence threshold range + readout.

#### `StepReview`
Summary in two sections:
1. **Enabled features** — badge list
2. **Configuration** — one card per config step: shows key values, "Edit" button jumps to that step

Save error inline.

---

## Dependency Auto-Enable Logic

```js
const DEPS = {
  'graphics-server': ['graphics-client', 'ingest'],
  'stt-server':      ['ingest'],
  'radio':           ['ingest'],
  'hls-stream':      ['ingest'],
  'preview':         ['ingest'],
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
  return autoEnabled;
}
```

---

## Save Flow (Finish on Review)

```js
async function handleFinish() {
  setSaving(true);

  // 1. Write localStorage settings
  localStorage.setItem(KEYS.targets.list,
    JSON.stringify(localSettings.targets));
  localStorage.setItem(KEYS.translation.vendor,    localSettings.translationVendor);
  localStorage.setItem(KEYS.translation.vendorKey, localSettings.translationVendorKey);
  localStorage.setItem(KEYS.translation.libreUrl,  localSettings.translationLibreUrl);
  localStorage.setItem(KEYS.translation.libreKey,  localSettings.translationLibreKey);
  localStorage.setItem(KEYS.translation.showOriginal,
    String(localSettings.translationShowOriginal));
  localStorage.setItem(KEYS.translation.list,
    JSON.stringify(localSettings.translationList));
  localSettings.relaySlots.forEach((slot, i) => {
    const n = i + 1;
    localStorage.setItem(relaySlotKey(n, 'type'),         slot.type || '');
    localStorage.setItem(relaySlotKey(n, 'ytKey'),        slot.ytKey || '');
    localStorage.setItem(relaySlotKey(n, 'genericUrl'),   slot.genericUrl || '');
    localStorage.setItem(relaySlotKey(n, 'genericName'),  slot.genericName || '');
    localStorage.setItem(relaySlotKey(n, 'captionMode'),  slot.captionMode || 'http');
  });

  // 2. Write feature flags + feature configs to backend
  for (const code of ALL_FEATURE_CODES) {
    const wasEnabled = initialFeatureSet.has(code);
    const isEnabled  = selectedFeatures.has(code);
    const cfg        = configs[code] ?? null;
    if (isEnabled !== wasEnabled || (isEnabled && cfg !== initialConfigs[code])) {
      await updateFeature(code, isEnabled, cfg);
    }
  }

  // 3. Clear draft, navigate
  localStorage.removeItem('lcyt.wizard.draft');
  navigate('/projects');
}
```

---

## Backend Dependency Enforcement

**Current state:** No dep logic in `project-features.js`. Enabling `graphics-server` without `graphics-client` is silently accepted.

**Add to `packages/lcyt-backend/src/db/project-features.js`:**

```js
export const FEATURE_DEPS = {
  'graphics-server': ['graphics-client', 'ingest'],
  'stt-server':      ['ingest'],
  'radio':           ['ingest'],
  'hls-stream':      ['ingest'],
  'preview':         ['ingest'],
};

export function applyFeatureDeps(featureMap) {
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

**Changes to `_batchUpdateFeatures`:** call `applyFeatureDeps(features)` after entitlement check, before `setProjectFeatures`. Add `autoEnabled` to response.

**Changes to `_patchFeature`:** build synthetic `featureMap = { [code]: body.enabled }`, call `applyFeatureDeps`, upsert all affected codes. Add `autoEnabled` to response.

---

## CSS Additions (`components.css`)

```css
.btn--ghost {
  background: transparent; border: none;
  color: var(--color-text-muted);
  padding: 5px 8px; font-size: 13px; cursor: pointer;
}
.btn--ghost:hover { color: var(--color-text); }

.wizard-progress { display: flex; gap: 4px; margin-bottom: 4px; }
.wizard-progress__seg { flex: 1; height: 4px; border-radius: 2px; background: var(--color-border); }
.wizard-progress__seg--done { background: var(--color-accent); }

.wizard-dep-notice {
  background: color-mix(in srgb, var(--color-accent) 8%, transparent);
  border: 1px solid var(--color-accent);
  border-radius: 6px; padding: 10px 12px; font-size: 13px;
  display: flex; justify-content: space-between; align-items: center; gap: 8px;
}
```

---

## Key Utilities to Reuse

| Utility | Path |
|---|---|
| `FeaturePicker` | `packages/lcyt-web/src/components/FeaturePicker.jsx` |
| `useProjectFeatures` | `packages/lcyt-web/src/hooks/useProjectFeatures.js` |
| `useUserAuth` | `packages/lcyt-web/src/hooks/useUserAuth.js` |
| `KEYS`, `relaySlotKey` | `packages/lcyt-web/src/lib/storageKeys.js` |
| `.btn`, `.settings-field`, `.settings-field__input`, `.settings-field__eye` | `packages/lcyt-web/src/styles/components.css` |
| Lazy route pattern | `packages/lcyt-web/src/main.jsx` |

---

## Verification

1. Navigate to `/setup` → Feature Selection shown
2. Toggle `stt-server` → `ingest` auto-enables + dep notice; toggle `graphics-server` → `graphics-client` + `ingest` auto-enable
3. Click Next → Caption Targets (captions is default-on)
6. Add a YouTube target with a stream key → Next
7. Skip Translation (not selected), skip RTMP Relay (not selected if ingest not chosen)
8. If `stt-server` selected: Server STT page appears with provider/language/audioSource fields
9. Review: badge list of features + summary cards; "Edit" jumps to correct step
10. Finish → localStorage written, feature PATCH calls sent, redirected to `/projects`
11. Backend: PATCH `/keys/:key/features/graphics-server` enabled → response `autoEnabled: ["graphics-client","ingest"]`
12. Refresh mid-wizard → draft restored from localStorage
