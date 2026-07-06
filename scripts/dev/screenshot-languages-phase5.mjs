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
console.log('page errors so far:', errors);
await page.screenshot({ path: `${OUT}/lang3-debug-full.png`, fullPage: true });
await page.locator('.setup-card', { hasText: 'Languages' }).scrollIntoViewIfNeeded();
await page.waitForTimeout(200);

// Open Source language dialog — should now show the predefined list, not free-text.
await page.locator('.setup-card', { hasText: 'Languages' }).getByText('Source language').locator('..').locator('..').locator('.setup-item-row__icon-btn').click();
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/lang3-source-predefined.png` });
await page.locator('.settings-modal__close, .dialog__close').first().click().catch(() => {});
await page.keyboard.press('Escape').catch(() => {});
await page.waitForTimeout(200);

// Add a target language — check the destination picker + per-row showOriginal.
await page.locator('.setup-card', { hasText: 'Languages' }).locator('.setup-card__add-btn').click();
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/lang3-add-dialog.png` });

console.log('errors:', errors.length ? errors : 'none');
await browser.close();
console.log('done');
