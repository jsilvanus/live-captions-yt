#!/usr/bin/env node
/**
 * scripts/screenshots/capture.js
 *
 * Captures UI screenshots of lcyt-web for the help/guide page.
 * Every shot is taken twice — once in dark mode and once in light mode —
 * producing files named  <name>-dark.png  and  <name>-light.png.
 *
 * Coverage:
 *   • Main dashboard (landscape + portrait)
 *   • Status bar (cropped)
 *   • Left panel: drop zone + caption view
 *   • Right panel: sent captions log
 *   • Input bar (cropped)
 *   • Mobile audio bar (portrait, cropped)
 *   • Privacy modal — first-visit (countdown active)
 *   • General modal — caption relay (cropped)
 *   • General modal — RTMP relay (cropped)
 *   • Status panel (floating, cropped)
 *   • Actions panel (floating, cropped)
 *   • Caption modal — Model tab (cropped)
 *   • Caption modal — VAD tab (cropped)
 *   • Caption modal — Other tab (cropped)
 *   • Translation modal (cropped)
 *   • Privacy modal (opened from settings, cropped)
 *
 * Prerequisites:
 *   npm run build:web                  # build the Vite app
 *   npx playwright install chromium    # install headless browser (once per machine)
 *
 * Usage:
 *   node scripts/screenshots/capture.js
 *   # or via npm script:
 *   npm run screenshots
 *
 * Output:
 *   docs/screenshots/<name>-dark.png
 *   docs/screenshots/<name>-light.png
 *   packages/lcyt-site/public/screenshots/<name>-dark.png
 *   packages/lcyt-site/public/screenshots/<name>-light.png
 */

import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { mkdirSync, existsSync, copyFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const WEB_PKG = resolve(ROOT, 'packages', 'lcyt-web');
// Canonical docs location — kept in git for reference
const DOCS_DIR = resolve(ROOT, 'docs', 'screenshots');
// Astro public dir — served at /screenshots/ on the site
const SITE_DIR = resolve(ROOT, 'packages', 'lcyt-site', 'public', 'screenshots');
const PREVIEW_PORT = 4173;
const BASE_URL = `http://localhost:${PREVIEW_PORT}`;

// Viewports
const LANDSCAPE = { width: 1280, height: 800 };
const PORTRAIT  = { width: 390,  height: 844 };

// Settle time (ms) after each navigation/interaction before screenshotting
const SETTLE_MS = 700;

// Padding (px) added around a cropped element bounding box
const CROP_PAD = 16;

// ── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/** Poll the preview server until it responds, then resolve. */
async function waitForServer(url, retries = 40) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await sleep(500);
  }
  throw new Error(`Preview server at ${url} did not start within ${retries * 0.5}s`);
}

/** Apply dark or light theme by setting data-theme on <html> and localStorage. */
async function applyTheme(page, theme) {
  await page.evaluate((t) => {
    localStorage.setItem('lcyt-theme', t);
    document.documentElement.setAttribute('data-theme', t);
  }, theme);
}

/**
 * Save a screenshot to both output directories and log a confirmation line.
 * @param {Buffer|string} data   - screenshot buffer (or path string from page.screenshot)
 * @param {string}        name   - base file name (without theme suffix or .png)
 * @param {string}        theme  - 'dark' | 'light'
 */
function saveScreenshot(docsPath, sitePath, name, theme) {
  // page.screenshot already wrote to docsPath; copy to the site public dir
  try {
    copyFileSync(docsPath, sitePath);
  } catch (err) {
    process.stderr.write(`  ⚠  Could not copy to site public dir: ${err.message}\n`);
  }
  console.log(`  ✓  ${name}-${theme}.png`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

// Verify the web build exists
if (!existsSync(resolve(WEB_PKG, 'dist', 'index.html'))) {
  console.error(
    'ERROR: dist/index.html not found.\n' +
    'Run `npm run build:web` first, then re-run this script.'
  );
  process.exit(1);
}

mkdirSync(DOCS_DIR, { recursive: true });
mkdirSync(SITE_DIR, { recursive: true });

console.log('Starting vite preview server…');
const server = spawn(
  'npx', ['vite', 'preview', '--port', String(PREVIEW_PORT), '--host', 'localhost'],
  { cwd: WEB_PKG, stdio: 'pipe' }
);
server.stderr.on('data', d => {
  const msg = d.toString();
  if (msg.includes('error') || msg.includes('Error')) process.stderr.write(msg);
});

async function run() {
  await waitForServer(BASE_URL);
  console.log(`Preview server ready at ${BASE_URL}\n`);

  const browser = await chromium.launch();

  /**
   * Take one full-viewport screenshot in the requested theme.
   * @param {string}   name     - base output filename (without theme suffix or .png)
   * @param {string}   theme    - 'dark' | 'light'
   * @param {object}   viewport - { width, height }
   * @param {Function} setup    - async (page, theme) => void — runs after first load
   */
  async function shot(name, theme, viewport, setup) {
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();

    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await applyTheme(page, theme);

    if (setup) await setup(page, theme);

    await sleep(SETTLE_MS);

    const docsPath = resolve(DOCS_DIR, `${name}-${theme}.png`);
    const sitePath = resolve(SITE_DIR, `${name}-${theme}.png`);
    await page.screenshot({ path: docsPath, fullPage: false });
    saveScreenshot(docsPath, sitePath, name, theme);
    await ctx.close();
  }

  /**
   * Take one cropped screenshot, clipping to a specific element's bounding box
   * (plus optional padding). Falls back to a full-viewport shot if the selector
   * is not found.
   *
   * @param {string}   name      - base output filename
   * @param {string}   theme     - 'dark' | 'light'
   * @param {object}   viewport  - { width, height }
   * @param {string}   selector  - CSS selector of the element to crop to
   * @param {Function} setup     - async (page, theme) => void
   * @param {number}   [pad]     - extra padding in px (default: CROP_PAD)
   */
  async function shotCropped(name, theme, viewport, selector, setup, pad = CROP_PAD) {
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();

    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await applyTheme(page, theme);

    if (setup) await setup(page, theme);

    await sleep(SETTLE_MS);

    const docsPath = resolve(DOCS_DIR, `${name}-${theme}.png`);
    const sitePath = resolve(SITE_DIR, `${name}-${theme}.png`);

    const el = page.locator(selector).first();
    const box = await el.boundingBox().catch(() => null);

    if (box) {
      const clip = {
        x:      Math.max(0, box.x - pad),
        y:      Math.max(0, box.y - pad),
        width:  Math.min(viewport.width,  box.width  + pad * 2),
        height: Math.min(viewport.height, box.height + pad * 2),
      };
      await page.screenshot({ path: docsPath, clip });
    } else {
      // Selector not found — fall back to full viewport
      await page.screenshot({ path: docsPath, fullPage: false });
    }

    saveScreenshot(docsPath, sitePath, name, theme);
    await ctx.close();
  }

  /**
   * Convenience wrappers: take the same shot in both dark and light mode.
   */
  async function shotBoth(name, viewport, setup) {
    await shot(name, 'dark',  viewport, setup);
    await shot(name, 'light', viewport, setup);
  }

  async function shotBothCropped(name, viewport, selector, setup, pad = CROP_PAD) {
    await shotCropped(name, 'dark',  viewport, selector, setup, pad);
    await shotCropped(name, 'light', viewport, selector, setup, pad);
  }

  // ── Helper: accept privacy and reload ─────────────────────────────────────
  async function acceptPrivacy(page) {
    await page.evaluate(() => localStorage.setItem('lcyt:privacyAccepted', '1'));
    await page.reload({ waitUntil: 'networkidle' });
  }

  // ── Helper: open a StatusBar button by its title attribute ─────────────────
  async function openStatusBarBtn(page, title) {
    await acceptPrivacy(page);
    await page.click(`button[title="${title}"]`);
  }

  // ── 1. Dashboard — landscape ───────────────────────────────────────────────
  await shotBoth('dashboard-landscape', LANDSCAPE, acceptPrivacy);

  // ── 2. Dashboard — portrait / mobile ──────────────────────────────────────
  await shotBoth('dashboard-portrait', PORTRAIT, acceptPrivacy);

  // ── 3. Status bar (top header strip) ──────────────────────────────────────
  await shotBothCropped('statusbar', LANDSCAPE, '#header', acceptPrivacy, 0);

  // ── 4. Left panel (drop zone + caption view) ──────────────────────────────
  await shotBothCropped('panel-left', LANDSCAPE, '#left-panel', acceptPrivacy, 0);

  // ── 5. Right panel (sent captions log) ────────────────────────────────────
  await shotBothCropped('panel-right', LANDSCAPE, '#right-panel', acceptPrivacy, 0);

  // ── 6. Input bar (footer) ─────────────────────────────────────────────────
  await shotBothCropped('inputbar', LANDSCAPE, '#footer', acceptPrivacy, 0);

  // ── 7. Mobile audio bar ───────────────────────────────────────────────────
  await shotBothCropped('mobile-audio-bar', PORTRAIT, '#mobile-audio-bar', acceptPrivacy, 0);

  // ── 8. Privacy modal — first-visit (acceptance countdown active) ───────────
  await shotBothCropped('privacy-first-visit', LANDSCAPE, '.settings-modal__box',
    async (page, theme) => {
      // lcyt:privacyAccepted is NOT set → modal auto-opens
      await page.waitForSelector('.settings-modal__box');
      await applyTheme(page, theme);
    }
  );

  // ── 9. Settings modal — basic tab ──────────────────────────────────────────
  await shotBothCropped('modal-settings', LANDSCAPE, '.settings-modal__box',
    async page => {
      await openStatusBarBtn(page, 'Settings');
      await page.waitForSelector('.settings-modal__box');
    }
  );

  // ── 10. Settings modal — RTMP relay tab (advanced mode) ───────────────────
  await shotBothCropped('modal-settings-rtmp', LANDSCAPE, '.settings-modal__box',
    async page => {
      await page.evaluate(() => localStorage.setItem('lcyt:advanced-mode', '1'));
      await openStatusBarBtn(page, 'Settings');
      await page.waitForSelector('.settings-modal__box');
      // Switch to RTMP Relay tab
      const rtmpTab = page.locator('.settings-tab', { hasText: /rtmp/i }).first();
      if (await rtmpTab.count() > 0) {
        await rtmpTab.click();
        await sleep(200);
      }
    }
  );

  // ── 11. Controls panel (floating) ─────────────────────────────────────────
  await shotBothCropped('panel-controls', LANDSCAPE, '.floating-panel',
    async page => {
      await openStatusBarBtn(page, 'Controls');
      await page.waitForSelector('.floating-panel');
    }
  );

  // ── 12–14. CC modal — one tab at a time ───────────────────────────────────
  const CC_TABS = [
    { id: 'receivers',    label: 'Receivers'   },
    { id: 'service',      label: 'Service'     },
    { id: 'translation',  label: 'Translation' },
  ];

  for (const { id, label } of CC_TABS) {
    await shotBothCropped(`modal-cc-${id}`, LANDSCAPE, '.settings-modal__box',
      async page => {
        await openStatusBarBtn(page, 'CC');
        await page.waitForSelector('.settings-modal__box');
        const tab = page.locator('.settings-tab', { hasText: label }).first();
        if (await tab.count() > 0) {
          await tab.click();
          await sleep(200);
        }
      }
    );
  }

  // ── 15. Privacy modal (opened via Settings bar) ────────────────────────────
  await shotBothCropped('modal-privacy', LANDSCAPE, '.settings-modal__box',
    async page => {
      await openStatusBarBtn(page, 'Privacy');
      await page.waitForSelector('.settings-modal__box');
    }
  );

  await browser.close();
}

run()
  .then(() => {
    console.log(`\nAll screenshots saved to:\n  ${DOCS_DIR}\n  ${SITE_DIR}`);
    server.kill();
    process.exit(0);
  })
  .catch(err => {
    console.error('\nScreenshot capture failed:', err.message);
    server.kill();
    process.exit(1);
  });
