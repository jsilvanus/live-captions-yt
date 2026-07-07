import { chromium } from 'playwright';

const OUT = '/home/jsilvanus/.claude/jobs/bd4fd75b/tmp';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });

await page.addInitScript(() => {
  localStorage.setItem('lcyt.backend.features', JSON.stringify([
    'rtmp', 'graphics', 'production', 'ai', 'admin',
  ]));
  localStorage.setItem('lcyt.session.config', JSON.stringify({
    backendUrl: 'http://localhost:4000',
    apiKey: 'test-key',
  }));
});

page.on('pageerror', (err) => console.log('[pageerror]', err.message));

await page.goto('http://localhost:5174/setup', { waitUntil: 'load' });
await page.waitForTimeout(1000);

const nav = await page.$('nav.sidebar');
await nav.screenshot({ path: `${OUT}/sidebar-icons-only.png` });

// Also check hamburger is hidden at desktop width
const hamburgerVisible = await page.$eval('.top-bar__hamburger', el => getComputedStyle(el).display !== 'none').catch(() => null);
console.log('Hamburger visible at desktop width:', hamburgerVisible);

await page.screenshot({ path: `${OUT}/full-page-icons-only.png` });
await browser.close();
