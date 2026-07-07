import { chromium } from 'playwright';

const OUT = '/home/jsilvanus/.claude/jobs/bd4fd75b/tmp';

const browser = await chromium.launch();

async function shot(width, height, label) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });

  await page.addInitScript(() => {
    localStorage.setItem('lcyt.backend.features', JSON.stringify(['rtmp', 'graphics', 'production', 'ai', 'admin']));
    localStorage.setItem('lcyt.session.config', JSON.stringify({ backendUrl: 'http://localhost:4000', apiKey: 'test-key' }));
    localStorage.setItem('lcyt.session.autoConnect', 'true');
  });

  page.on('pageerror', (err) => console.log(`[pageerror ${label}]`, err.message));

  await page.goto('http://localhost:5173/graphics/editor', { waitUntil: 'load' });
  await page.waitForTimeout(1800);

  // Add a layer or two so the canvas isn't empty, and check for horizontal overflow.
  const rectBtn = page.locator('button', { hasText: '+ Rect' });
  if (await rectBtn.count() > 0) await rectBtn.first().click();
  await page.waitForTimeout(300);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  console.log(`${label} (${width}x${height}): horizontal overflow = ${overflow}`);

  await page.screenshot({ path: `${OUT}/editor-${label}.png`, fullPage: true });
  await page.close();
}

await shot(1440, 900, 'desktop');
await shot(820, 1180, 'tablet');
await shot(390, 844, 'mobile');

await browser.close();
