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
await page.screenshot({ path: `${OUT}/enriched-hub.png` });

// Create a viewer target first, so there's something to edit
await page.locator('.setup-card', { hasText: 'Caption targets' }).locator('.setup-card__add-btn').click();
await page.waitForTimeout(300);
await page.locator('.settings-modal select').first().selectOption('viewer');
await page.waitForTimeout(150);
await page.locator('.settings-modal input[type="text"]').fill('sunday-service');
await page.locator('button.btn--primary', { hasText: 'Create' }).click();
await page.waitForTimeout(500);

// Edit the viewer target we just created
await page.locator('.setup-card', { hasText: 'Caption targets' }).locator('.setup-item-row__icon-btn').first().click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/enriched-edit-viewer.png` });
await page.locator('.settings-modal__close').click();
await page.waitForTimeout(300);

// Add a new generic target with headers
await page.locator('.setup-card', { hasText: 'Caption targets' }).locator('.setup-card__add-btn').click();
await page.waitForTimeout(300);
await page.locator('.settings-modal select').first().selectOption('generic');
await page.waitForTimeout(150);
await page.locator('.settings-modal input[type="url"]').fill('https://example.com/captions');
await page.locator('.settings-modal textarea').fill('{"Authorization": "Bearer abc123"}');
await page.waitForTimeout(150);
await page.screenshot({ path: `${OUT}/enriched-add-generic.png` });
await page.locator('button.btn--primary', { hasText: 'Create' }).click();
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/enriched-after-add.png` });

console.log('errors:', errors.length ? errors : 'none');
await browser.close();
console.log('done');
