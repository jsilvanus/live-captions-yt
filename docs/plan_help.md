# Help Page Screenshot Plan — lcyt-web

---
id: plan/help
---

## Goal

Generate static screenshots of every significant UI view in the `lcyt-web` browser
client, to be used in a user-facing help page.  The capture is fully **programmatic**
(no manual clicking required) and is driven by a
[Playwright](https://playwright.dev/) Node.js script.

---

## Screenshots Required

| Output file | UI view | Viewport |
|---|---|---|
| `dashboard-landscape.png` | Main dashboard (disconnected default state) | 1280 × 800 |
| `dashboard-portrait.png`  | Main dashboard — mobile/portrait layout | 390 × 844 |
| `privacy.png`             | Privacy modal (first-visit, acceptance countdown active) | 1280 × 800 |
| `settings-connection.png` | Settings → Connection tab | 1280 × 800 |
| `settings-captions.png`   | Settings → Captions tab   | 1280 × 800 |
| `settings-stt.png`        | Settings → STT / Audio tab | 1280 × 800 |
| `settings-status.png`     | Settings → Status tab     | 1280 × 800 |
| `settings-actions.png`    | Settings → Actions tab    | 1280 × 800 |

All output files are written to **`docs/screenshots/`**.

---

## Approach

Screenshots are captured with **headless Chromium** via Playwright against the
production build of the Vite app served locally by `vite preview`.

No real backend connection is needed — the UI renders fully in its disconnected/
default state.  `localStorage` is manipulated programmatically per screenshot to
control which modal (if any) is open on load.

### How each view is reached

| View | Technique |
|---|---|
| Dashboard (landscape) | `localStorage.lcyt:privacyAccepted = '1'` → no modal auto-opens |
| Dashboard (portrait) | Same as above, viewport resized to 390 × 844 |
| Privacy modal | `localStorage.lcyt:privacyAccepted` absent → modal auto-opens with 10 s countdown |
| Settings tabs | Privacy accepted, then `Ctrl+,` keyboard shortcut opens Settings; each tab button is clicked in turn |

---

## Prerequisites

1. **Node.js ≥ 18** (already required by the project).
2. **Playwright Chromium** — install once per machine:
   ```bash
   npx playwright install chromium
   ```
3. **A production build of `lcyt-web`**:
   ```bash
   npm run build:web
   ```

---

## Running the Script

```bash
npm run screenshots
```

This is equivalent to:

```bash
node scripts/screenshots/capture.js
```

The script will:

1. Start a `vite preview` server in the background (port 4173, local only).
2. Open a headless Chromium page via Playwright.
3. For each screenshot: navigate to the app, set the required `localStorage`
   state, wait for the UI to settle, then capture.
4. Save PNG files to `docs/screenshots/`.
5. Shut down the preview server and exit.

---

## Script Location

```
scripts/screenshots/capture.js
```

---

## Output

After a successful run, `docs/screenshots/` will contain:

```
docs/screenshots/
├── dashboard-landscape.png
├── dashboard-portrait.png
├── privacy.png
├── settings-connection.png
├── settings-captions.png
├── settings-stt.png
├── settings-status.png
└── settings-actions.png
```

---

## Help Page Integration

Each PNG can be embedded directly in a Markdown help file:

```markdown
## Dashboard

![Dashboard — landscape view](../screenshots/dashboard-landscape.png)

On a mobile device the layout changes to a single-column scroll view:

![Dashboard — portrait view](../screenshots/dashboard-portrait.png)
```

Or referenced from the `lcyt-site` Astro static site by placing the images in
`packages/lcyt-site/public/screenshots/` and linking to `/screenshots/*.png`.

---

## Notes

- **Animations** — the script waits 700 ms after each navigation/interaction to
  allow CSS transitions to finish before capturing.
- **Retina/HiDPI** — by default the script uses device scale factor 1 (standard).
  Uncomment the `deviceScaleFactor: 2` line in `capture.js` for 2× images suitable
  for Retina displays.
- **Privacy modal countdown** — the modal shows a 10-second countdown before the
  accept button becomes active (first-visit UX).  The screenshot is taken
  immediately after the modal appears so the countdown is visible and the button
  state is realistic.
- **Settings modal** — opened via the `Ctrl+,` keyboard shortcut that the app
  already handles globally; no private API is used.
- **Selector stability** — the script targets CSS class names (`.settings-modal__box`,
  `.settings-tab`) and ARIA roles/text that are intrinsic to the component
  structure and unlikely to change without intentional redesign.
- **CI integration** — the `npm run screenshots` script can be added to a CI
  pipeline (e.g. a GitHub Actions workflow that runs on `docs/**` changes) to
  keep screenshots up to date automatically.  Playwright can run in headed or
  headless mode on all major CI platforms; see
  [Playwright CI docs](https://playwright.dev/docs/ci).
