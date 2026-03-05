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
 *   • Privacy modal (first-visit, countdown active)
 *   • General modal
 *   • Status panel (floating)
 *   • Actions panel (floating)
 *   • Caption modal — Model tab
 *   • Caption modal — VAD tab
 *   • Caption modal — Other tab
 *   • Translation modal
 *   • Privacy modal (opened from settings)
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
 * Output: docs/screenshots/<name>-dark.png  and  docs/screenshots/<name>-light.png
 */

import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const WEB_PKG = resolve(ROOT, 'packages', 'lcyt-web');
const OUT_DIR = resolve(ROOT, 'docs', 'screenshots');
const PREVIEW_PORT = 4173;
const BASE_URL = `http://localhost:${PREVIEW_PORT}`;

// Viewports
const LANDSCAPE = { width: 1280, height: 800 };
const PORTRAIT  = { width: 390,  height: 844 };

// Settle time (ms) after each navigation/interaction before screenshotting
const SETTLE_MS = 700;

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

// ── Main ─────────────────────────────────────────────────────────────────────

// Verify the web build exists
if (!existsSync(resolve(WEB_PKG, 'dist', 'index.html'))) {
  console.error(
    'ERROR: dist/index.html not found.\n' +
    'Run `npm run build:web` first, then re-run this script.'
  );
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });

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
   * Take one screenshot in the requested theme.
   * @param {string}   name     - base output filename (without theme suffix or .png)
   * @param {string}   theme    - 'dark' | 'light'
   * @param {object}   viewport - { width, height }
   * @param {Function} setup    - async (page) => void — runs after first load
   */
  async function shot(name, theme, viewport, setup) {
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();

    // Load the app (fresh localStorage in every context)
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });

    // Apply the requested theme before any user setup runs
    await applyTheme(page, theme);

    if (setup) await setup(page, theme);

    await sleep(SETTLE_MS);
    const outPath = resolve(OUT_DIR, `${name}-${theme}.png`);
    await page.screenshot({ path: outPath, fullPage: false });
    console.log(`  ✓  ${name}-${theme}.png`);
    await ctx.close();
  }

  /**
   * Convenience wrapper: take the same shot in both dark and light mode.
   */
  async function shotBoth(name, viewport, setup) {
    await shot(name, 'dark',  viewport, setup);
    await shot(name, 'light', viewport, setup);
  }

  // ── 1. Dashboard — landscape ───────────────────────────────────────────────
  await shotBoth('dashboard-landscape', LANDSCAPE, async page => {
    await page.evaluate(() => localStorage.setItem('lcyt:privacyAccepted', '1'));
    await page.reload({ waitUntil: 'networkidle' });
  });

  // ── 2. Dashboard — portrait / mobile ──────────────────────────────────────
  await shotBoth('dashboard-portrait', PORTRAIT, async page => {
    await page.evaluate(() => localStorage.setItem('lcyt:privacyAccepted', '1'));
    await page.reload({ waitUntil: 'networkidle' });
  });

  // ── 3. Privacy modal — first-visit (acceptance countdown active) ───────────
  // Note: theme must be re-applied after the forced reload because localStorage is cleared.
  await shotBoth('privacy-first-visit', LANDSCAPE, async (page, theme) => {
    // Leave lcyt:privacyAccepted unset → modal auto-opens with countdown
    await page.waitForSelector('.settings-modal__box');
    // Re-apply theme because we reloaded with an empty localStorage
    await applyTheme(page, theme);
  });

  // ── Helper: open a StatusBar button by its title attribute ─────────────────
  async function openStatusBarBtn(page, title) {
    await page.evaluate(() => localStorage.setItem('lcyt:privacyAccepted', '1'));
    await page.reload({ waitUntil: 'networkidle' });
    await page.click(`button[title="${title}"]`);
  }

  // ── 4. General modal ───────────────────────────────────────────────────────
  await shotBoth('modal-general', LANDSCAPE, async page => {
    await openStatusBarBtn(page, 'General settings');
    await page.waitForSelector('.settings-modal__box');
  });

  // ── 5. Status panel (floating) ─────────────────────────────────────────────
  await shotBoth('panel-status', LANDSCAPE, async page => {
    await openStatusBarBtn(page, 'Status');
    await page.waitForSelector('.floating-panel');
  });

  // ── 6. Actions panel (floating) ────────────────────────────────────────────
  await shotBoth('panel-actions', LANDSCAPE, async page => {
    await openStatusBarBtn(page, 'Actions');
    await page.waitForSelector('.floating-panel');
  });

  // ── 7–9. Caption modal — one tab at a time ─────────────────────────────────
  const CAPTION_TABS = [
    { id: 'model', label: 'Model' },
    { id: 'vad',   label: 'VAD'   },
    { id: 'other', label: 'Other' },
  ];

  for (const { id, label } of CAPTION_TABS) {
    await shotBoth(`modal-caption-${id}`, LANDSCAPE, async page => {
      await openStatusBarBtn(page, 'Caption settings');
      await page.waitForSelector('.settings-modal__box');
      await page.locator('.settings-tab', { hasText: label }).click();
      await sleep(200);
    });
  }

  // ── 10. Translation modal ──────────────────────────────────────────────────
  await shotBoth('modal-translation', LANDSCAPE, async page => {
    await openStatusBarBtn(page, 'Translation settings');
    await page.waitForSelector('.settings-modal__box');
  });

  // ── 11. Privacy modal (opened via Settings bar) ────────────────────────────
  await shotBoth('modal-privacy', LANDSCAPE, async page => {
    await openStatusBarBtn(page, 'Privacy');
    await page.waitForSelector('.settings-modal__box');
  });

  await browser.close();
}

run()
  .then(() => {
    console.log(`\nAll screenshots saved to ${OUT_DIR}`);
    server.kill();
    process.exit(0);
  })
  .catch(err => {
    console.error('\nScreenshot capture failed:', err.message);
    server.kill();
    process.exit(1);
  });
