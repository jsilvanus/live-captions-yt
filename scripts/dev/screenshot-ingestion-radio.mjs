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
await page.waitForTimeout(1500);

// Toggle Video ingest off
await page.locator('.setup-item-row', { hasText: 'Video' }).locator('.setup-item-row__toggle').click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/ingestion-toggled.png` });

// Open Video settings dialog
await page.locator('.setup-item-row', { hasText: 'Video' }).locator('.setup-item-row__icon-btn').click();
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/ingestion-dialog.png` });
await page.locator('.settings-modal__close').click();
await page.waitForTimeout(300);

// Web Radio: click Configure, fill title, save
await page.locator('.setup-card', { hasText: 'Web Radio' }).locator('.setup-card__add-btn').click();
await page.waitForTimeout(400);
await page.locator('.settings-modal input').first().fill('Sunday Service Audio');
await page.waitForTimeout(200);
await page.screenshot({ path: `${OUT}/radio-configure-dialog.png` });
await page.locator('button.btn--primary', { hasText: 'Save' }).click();
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/radio-after-save.png` });

console.log('errors:', errors.length ? errors : 'none');
await browser.close();
console.log('done');
