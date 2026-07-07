import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..');
const outputDir = process.env.SCREENSHOT_OUTPUT_DIR
  ? path.resolve(process.env.SCREENSHOT_OUTPUT_DIR)
  : path.join(repoRoot, 'tmp', 'screenshots');
mkdirSync(outputDir, { recursive: true });
const screenshotPath = (fileName) => path.join(outputDir, fileName);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

// Seed localStorage before any app script runs so AuthGate's synchronous
// check (main.jsx) sees a valid "minimal backend" session and features list
// wide enough to show every kept sidebar item.
await page.addInitScript(() => {
  localStorage.setItem('lcyt.backend.features', JSON.stringify([
    'rtmp', 'graphics', 'production', 'login', 'ai', 'admin',
  ]));
  localStorage.setItem('lcyt.session.config', JSON.stringify({
    backendUrl: 'http://localhost:4000',
    apiKey: 'test-key',
  }));
  localStorage.setItem('lcyt-user', JSON.stringify({
    token: 'fake-token',
    backendUrl: 'http://localhost:4000',
  }));
});

page.on('console', (msg) => {
  if (msg.type() === 'error') console.log('[console.error]', msg.text());
});
page.on('pageerror', (err) => console.log('[pageerror]', err.message));

await page.goto('http://localhost:5173/setup', { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);

const nav = await page.$('nav.sidebar');
if (!nav) {
  console.log('SIDEBAR NOT FOUND — current URL:', page.url());
  await page.screenshot({ path: screenshotPath('fallback.png'), fullPage: true });
} else {
  await page.screenshot({ path: screenshotPath('sidebar-collapsed.png') });
  // Expand sidebar via hamburger toggle for label text
  const hamburger = await page.$('.top-bar__hamburger');
  if (hamburger) {
    await hamburger.click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: screenshotPath('sidebar-expanded.png') });
  }
  const itemsText = await page.$$eval('.sidebar__item, .sidebar__group-header', els =>
    els.map(el => el.textContent.trim())
  );
  console.log('NAV ITEMS RENDERED:', JSON.stringify(itemsText));
}

await browser.close();
