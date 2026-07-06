import { chromium } from 'playwright';

const OUT = '/home/jsilvanus/.claude/jobs/bd4fd75b/tmp';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, colorScheme: 'light' });
const errors = [];
page.on('pageerror', (err) => errors.push(err.message));

await page.addInitScript(() => {
  localStorage.setItem('lcyt.backend.features', JSON.stringify(['rtmp', 'graphics', 'production', 'ai', 'admin']));
  localStorage.setItem('lcyt.session.config', JSON.stringify({ backendUrl: 'http://localhost:4000', apiKey: 'test-key' }));
  localStorage.setItem('lcyt.session.autoConnect', 'true');
  localStorage.setItem('lcyt.ui.theme', 'light');
});

// 1. Deep link to /setup/bridges — should scroll+highlight
await page.goto('http://localhost:5173/setup/bridges', { waitUntil: 'load' });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/highlight-immediate.png` });

const hasHighlight = await page.locator('.setup-card--highlighted').count();
console.log('highlighted cards right after landing:', hasHighlight);

// wait past the 10s window and confirm it clears
await page.waitForTimeout(9500);
await page.screenshot({ path: `${OUT}/highlight-after-10s.png` });
const hasHighlightAfter = await page.locator('.setup-card--highlighted').count();
console.log('highlighted cards after 10s:', hasHighlightAfter);

// 2. Standalone page with parity banner
await page.goto('http://localhost:5173/setup/cameras/page', { waitUntil: 'load' });
await page.waitForTimeout(1000);
await page.screenshot({ path: `${OUT}/standalone-cameras.png` });

// 3. Encoders standalone (routes to EncodersManager directly)
await page.goto('http://localhost:5173/setup/encoders/page', { waitUntil: 'load' });
await page.waitForTimeout(1000);
await page.screenshot({ path: `${OUT}/standalone-encoders.png` });

// 4. Unknown card id should redirect to /setup
await page.goto('http://localhost:5173/setup/nonexistent/page', { waitUntil: 'load' });
await page.waitForTimeout(800);
console.log('redirected url:', page.url());

console.log('errors:', errors.length ? errors : 'none');
await browser.close();
console.log('done');
