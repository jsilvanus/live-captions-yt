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

// Add a YouTube target
await page.locator('.setup-card', { hasText: 'Caption targets' }).locator('.setup-card__add-btn').click();
await page.waitForTimeout(300);
await page.locator('input[type="password"]').fill('yt-stream-key-abcd1234');
await page.waitForTimeout(150);
await page.screenshot({ path: `${OUT}/targets-add-youtube.png` });
await page.locator('button.btn--primary', { hasText: 'Create' }).click();
await page.waitForTimeout(500);

// Add a viewer target
await page.locator('.setup-card', { hasText: 'Caption targets' }).locator('.setup-card__add-btn').click();
await page.waitForTimeout(300);
await page.locator('.settings-modal select').selectOption('viewer');
await page.locator('.settings-modal input[type="text"], .settings-modal input:not([type])').first().fill('sunday-service');
await page.waitForTimeout(150);
await page.locator('button.btn--primary', { hasText: 'Create' }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/targets-two-added.png` });

// Delete the youtube one via confirm dialog
await page.locator('.setup-item-row', { hasText: 'YouTube' }).locator('.setup-item-row__icon-btn--danger').click();
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/targets-delete-confirm.png` });
await page.locator('button.btn--danger', { hasText: 'Delete' }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/targets-after-delete.png` });

console.log('errors:', errors.length ? errors : 'none');
await browser.close();
console.log('done');
