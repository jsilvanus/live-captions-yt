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
await page.locator('.setup-card', { hasText: 'Languages' }).scrollIntoViewIfNeeded();
await page.waitForTimeout(200);
await page.screenshot({ path: `${OUT}/lang2-empty.png` });

// Add a target language
await page.locator('.setup-card', { hasText: 'Languages' }).locator('.setup-card__add-btn').click();
await page.waitForTimeout(300);
await page.locator('button.btn--primary', { hasText: 'Create' }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/lang2-after-add.png` });

// Quick-toggle it off via the row's toggle switch (scoped to the Languages card)
await page.locator('.setup-card', { hasText: 'Languages' }).locator('.setup-item-row__toggle').click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/lang2-toggled-off.png` });

// Open the Source language dialog
await page.locator('.setup-card', { hasText: 'Languages' }).getByText('Source language').locator('..').locator('..').locator('.setup-item-row__icon-btn').click();
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/lang2-source-dialog.png` });

console.log('errors:', errors.length ? errors : 'none');
await browser.close();
console.log('done');
