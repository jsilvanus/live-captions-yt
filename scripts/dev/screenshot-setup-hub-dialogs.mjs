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

// Click "+ Add" on the Cameras card (first .setup-card) to open its dialog
await page.locator('.setup-card', { hasText: 'Cameras' }).locator('.setup-card__add-btn').click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/dialog-add-camera.png` });

// Close it
await page.locator('.settings-modal__close').click();
await page.waitForTimeout(300);

// Click STT service's settings pencil to open its dialog
await page.locator('.setup-item-row', { hasText: 'Google Cloud Speech-to-Text' }).locator('.setup-item-row__icon-btn').click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/dialog-stt.png` });
await page.locator('.settings-modal__close').click();
await page.waitForTimeout(300);

// Dark theme check
await page.evaluate(() => { document.documentElement.setAttribute('data-theme', 'dark'); });
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/dark-theme.png` });

console.log('errors:', errors.length ? errors : 'none');
await browser.close();
console.log('done');
