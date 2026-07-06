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
await page.goto('http://localhost:5173/setup', { waitUntil: 'load' });
await page.waitForTimeout(1200);

// Scroll the Languages card into view and screenshot the empty state
await page.locator('.setup-card', { hasText: 'Languages' }).scrollIntoViewIfNeeded();
await page.waitForTimeout(200);
await page.screenshot({ path: `${OUT}/languages-empty.png` });

// Add a language via the card's header Add button
await page.locator('.setup-card', { hasText: 'Languages' }).locator('.setup-card__add-btn').click();
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/languages-add-dialog.png` });
await page.locator('button.btn--primary', { hasText: 'Create' }).click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/languages-after-add.png` });

// Open the Translation provider dialog
await page.locator('.setup-card', { hasText: 'Languages' }).getByText('Translation provider').locator('..').locator('..').locator('.setup-item-row__icon-btn').click();
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/languages-provider-dialog.png` });

console.log('errors:', errors.length ? errors : 'none');
await browser.close();
console.log('done');
