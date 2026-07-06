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
await page.goto('http://localhost:5174/setup', { waitUntil: 'load' });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/favs-1-default.png`, fullPage: true });

// Star the Cameras card
await page.locator('.setup-card', { hasText: 'Cameras' }).locator('.setup-card__fav-btn').click();
await page.waitForTimeout(200);
await page.screenshot({ path: `${OUT}/favs-2-starred.png` });

// Click the Favorites pill
await page.locator('.setup-hub-page__pill', { hasText: 'Favorites' }).click();
await page.waitForTimeout(200);
await page.screenshot({ path: `${OUT}/favs-3-favorites-filter.png`, fullPage: true });

// Back to All
await page.locator('.setup-hub-page__pill', { hasText: 'All' }).click();
await page.waitForTimeout(200);

// Click Workflow pill
await page.locator('.setup-hub-page__pill', { hasText: 'Workflow' }).click();
await page.waitForTimeout(200);
await page.screenshot({ path: `${OUT}/favs-4-workflow-filter.png`, fullPage: true });

console.log('errors:', errors.length ? errors : 'none');
await browser.close();
console.log('done');
