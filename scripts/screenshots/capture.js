#!/usr/bin/env node
/**
 * scripts/screenshots/capture.js
 *
 * Captures UI screenshots of lcyt-web for the help page.
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
 * Output: docs/screenshots/*.png
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
  // Log server errors but not routine vite startup messages
  const msg = d.toString();
  if (msg.includes('error') || msg.includes('Error')) process.stderr.write(msg);
});

async function run() {
  await waitForServer(BASE_URL);
  console.log(`Preview server ready at ${BASE_URL}\n`);

  const browser = await chromium.launch({
    // Uncomment the next line for a visible browser window (useful for debugging):
    // headless: false,
  });

  /**
   * Take one screenshot.
   * @param {string}   name     - output filename (without .png)
   * @param {object}   viewport - { width, height }
   * @param {Function} setup    - async (page) => void — runs after first load
   */
  async function shot(name, viewport, setup) {
    const ctx = await browser.newContext({
      viewport,
      // deviceScaleFactor: 2,  // uncomment for 2× / Retina-quality images
    });
    const page = await ctx.newPage();

    // Load the app (localStorage is empty in a fresh context)
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });

    if (setup) await setup(page);

    await sleep(SETTLE_MS);
    const outPath = resolve(OUT_DIR, `${name}.png`);
    await page.screenshot({ path: outPath, fullPage: false });
    console.log(`  ✓  ${name}.png`);
    await ctx.close();
  }

  // ── 1. Dashboard — landscape ───────────────────────────────────────────────
  await shot('dashboard-landscape', LANDSCAPE, async page => {
    // Mark privacy as accepted so the blocking modal does not open
    await page.evaluate(() => localStorage.setItem('lcyt:privacyAccepted', '1'));
    await page.reload({ waitUntil: 'networkidle' });
  });

  // ── 2. Dashboard — portrait / mobile ──────────────────────────────────────
  await shot('dashboard-portrait', PORTRAIT, async page => {
    await page.evaluate(() => localStorage.setItem('lcyt:privacyAccepted', '1'));
    await page.reload({ waitUntil: 'networkidle' });
  });

  // ── 3. Privacy modal (first-visit, acceptance countdown active) ────────────
  await shot('privacy', LANDSCAPE, async page => {
    // Leave localStorage empty → modal auto-opens with the 10 s countdown
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('.settings-modal__box');
  });

  // ── 4–8. Settings modal — one tab at a time ────────────────────────────────
  const TABS = [
    { id: 'connection', label: 'Connection'   },
    { id: 'captions',   label: 'Captions'     },
    { id: 'stt',        label: 'STT / Audio'  },
    { id: 'status',     label: 'Status'       },
    { id: 'actions',    label: 'Actions'      },
  ];

  for (const { id, label } of TABS) {
    await shot(`settings-${id}`, LANDSCAPE, async page => {
      await page.evaluate(() => localStorage.setItem('lcyt:privacyAccepted', '1'));
      await page.reload({ waitUntil: 'networkidle' });

      // Open Settings via the global keyboard shortcut (Ctrl+,)
      await page.keyboard.press('Control+Comma');
      await page.waitForSelector('.settings-modal__box');

      // Click the requested tab
      await page.locator(`.settings-tab`, { hasText: label }).click();
      await sleep(200);
    });
  }

  await browser.close();
}

run()
  .then(() => {
    console.log(`\nAll screenshots saved to docs/screenshots/`);
    server.kill();
    process.exit(0);
  })
  .catch(err => {
    console.error('\nScreenshot capture failed:', err.message);
    server.kill();
    process.exit(1);
  });
