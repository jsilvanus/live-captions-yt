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
await page.screenshot({ path: `${OUT}/final-hub-top.png` });

// Egress: click Add, fill youtube key, save
await page.locator('.setup-card', { hasText: 'Egress' }).locator('.setup-card__add-btn').click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/egress-add-dialog.png` });
await page.locator('input[type="password"]').fill('abcd-1234-xyz9-9999');
await page.waitForTimeout(200);
await page.screenshot({ path: `${OUT}/egress-add-filled.png` });
await page.locator('.settings-modal__close').click();
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/egress-after-add.png` });

// Viewports: click Add, fill name, create
await page.locator('.setup-card', { hasText: 'Viewports' }).locator('.setup-card__add-btn').click();
await page.waitForTimeout(400);
await page.locator('.settings-modal input').first().fill('vertical-left');
await page.locator('button.btn--primary', { hasText: 'Create' }).click();
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/viewports-after-add.png` });

// Open the viewports parity page
await page.goto('http://localhost:5173/setup/viewports/page', { waitUntil: 'load' });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/viewports-standalone.png` });

console.log('errors:', errors.length ? errors : 'none');
await browser.close();
console.log('done');
