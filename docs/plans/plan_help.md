---
id: plan/help
title: "Help Page Screenshot Capture"
status: implemented
summary: "Programmatic Playwright screenshot capture of significant lcyt-web UI views for the user-facing help page. Implemented as scripts/screenshots/capture.mjs (not capture.js as originally sketched below): captures every shot in both dark and light theme, and writes to both docs/screenshots/ and packages/lcyt-site/public/screenshots/. The shipped view/element coverage (status bar, left/right panels, input bar, mobile audio bar, Settings tabs, Controls panel, CC modal tabs) differs from this plan's original 'settings-connection/captions/stt/status/actions' table — see the Notes section for the as-built list, verified against code 2026-07-20."
---

# Help Page Screenshot Plan — lcyt-web

## Goal

Generate static screenshots of every significant UI view in the `lcyt-web` browser
client, to be used in a user-facing help page.  The capture is fully **programmatic**
(no manual clicking required) and is driven by a
[Playwright](https://playwright.dev/) Node.js script.

---

## Screenshots Required (original design)

The table below was the plan's original sketch. **As shipped, coverage and
naming differ** — see "As-Built Coverage" further down for what
`capture.mjs` actually produces.

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

### As-Built Coverage (verified against `scripts/screenshots/capture.mjs`, 2026-07-20)

Every shot below is captured **twice** — once per theme — producing
`<name>-dark.png` and `<name>-light.png`:

| Base name | UI view | Viewport |
|---|---|---|
| `dashboard-landscape` | Main dashboard (privacy accepted, default state) | 1280 × 800 |
| `dashboard-portrait` | Main dashboard, mobile/portrait layout | 390 × 844 |
| `statusbar` | Status bar (`#header`), cropped | 1280 × 800 |
| `panel-left` | Left panel — drop zone + caption view (`#left-panel`), cropped | 1280 × 800 |
| `panel-right` | Right panel — sent captions log (`#right-panel`), cropped | 1280 × 800 |
| `inputbar` | Input bar / footer (`#footer`), cropped | 1280 × 800 |
| `mobile-audio-bar` | Mobile audio bar (`#mobile-audio-bar`), cropped | 390 × 844 |
| `privacy-first-visit` | Privacy modal, first visit (countdown active), cropped | 1280 × 800 |
| `modal-settings` | Settings modal — basic tab, cropped | 1280 × 800 |
| `modal-settings-rtmp` | Settings modal — RTMP relay tab (advanced mode), cropped | 1280 × 800 |
| `modal-settings-credentials` | Settings modal — credentials tab (advanced mode), cropped | 1280 × 800 |
| `controls-panel` | Controls panel (floating), cropped | 1280 × 800 |
| CC modal — Targets/Translation/Service tabs | Three separate cropped shots | 1280 × 800 |
| Privacy modal (opened via Settings bar) | Cropped | 1280 × 800 |

This does not match the "Screenshots Required" table above (no
`settings-connection`/`settings-captions`/`settings-stt`/`settings-status`/
`settings-actions` files exist; there is no single `privacy.png`). Treat this
section, not the table above, as authoritative.

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
node scripts/screenshots/capture.mjs
```

The script will:

1. Start a `vite preview` server in the background (port 4173, local only).
2. Open a headless Chromium page via Playwright.
3. For each screenshot: navigate to the app, apply dark/light theme via
   `localStorage`/`data-theme`, set any other required `localStorage` state,
   wait for the UI to settle, then capture (full-page or cropped to a
   selector's bounding box).
4. Save PNG files to **both** `docs/screenshots/` and
   `packages/lcyt-site/public/screenshots/` (the latter is the Astro site's
   public dir, served at `/screenshots/*`).
5. Shut down the preview server and exit.

---

## Script Location

```
scripts/screenshots/capture.mjs
```

---

## Output

After a successful run, `docs/screenshots/` and
`packages/lcyt-site/public/screenshots/` will each contain a `-dark.png` and
`-light.png` file per base name in the "As-Built Coverage" table above, e.g.:

```
docs/screenshots/
├── dashboard-landscape-dark.png
├── dashboard-landscape-light.png
├── dashboard-portrait-dark.png
├── dashboard-portrait-light.png
├── statusbar-dark.png
├── statusbar-light.png
├── ... (one dark/light pair per row in As-Built Coverage)
```

---

## Help Page Integration

Each PNG can be embedded directly in a Markdown help file:

```markdown
## Dashboard

![Dashboard — landscape view](../screenshots/dashboard-landscape-dark.png)

On a mobile device the layout changes to a single-column scroll view:

![Dashboard — portrait view](../screenshots/dashboard-portrait-dark.png)
```

The script already copies every shot into `packages/lcyt-site/public/screenshots/`
as part of the capture run, so the Astro site can link to `/screenshots/*.png`
directly with no separate copy step.

---

## Notes

- **Animations** — the script waits 700 ms after each navigation/interaction to
  allow CSS transitions to finish before capturing.
- **Dark/light theme** — every shot is captured twice by setting `data-theme`
  on `<html>` and the `lcyt-theme` localStorage key before each screenshot
  (`applyTheme()` in `capture.mjs`), producing `-dark`/`-light` file pairs.
  There is no device-scale-factor toggle in the current script.
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
