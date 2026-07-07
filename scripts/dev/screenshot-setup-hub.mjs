import { chromium } from 'playwright';

const OUT = '/home/jsilvanus/.claude/jobs/bd4fd75b/tmp';
const browser = await chromium.launch();

async function shoot(name, viewport, deviceScaleFactor = 2) {
  const page = await browser.newPage({ viewport, deviceScaleFactor, colorScheme: 'light' });
  page.on('pageerror', (err) => console.log(`[pageerror:${name}]`, err.message));
  await page.addInitScript(() => {
    localStorage.setItem('lcyt.backend.features', JSON.stringify(['rtmp', 'graphics', 'production', 'ai', 'admin']));
    localStorage.setItem('lcyt.session.config', JSON.stringify({ backendUrl: 'http://localhost:4000', apiKey: 'test-key' }));
    localStorage.setItem('lcyt.session.autoConnect', 'true');
    localStorage.setItem('lcyt.ui.theme', 'light');
  });
  await page.goto('http://localhost:5173/setup', { waitUntil: 'load' });
  await page.waitForTimeout(1800);

  const contentHeight = await page.evaluate(() => {
    let best = document.scrollingElement;
    let bestDiff = best.scrollHeight - best.clientHeight;
    for (const el of document.querySelectorAll('*')) {
      const diff = el.scrollHeight - el.clientHeight;
      if (diff > bestDiff) { bestDiff = diff; best = el; }
    }
    return best.scrollHeight;
  });
  await page.setViewportSize({ width: viewport.width, height: Math.ceil(contentHeight) + 20 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  await page.close();
}

await shoot('setup-hub-desktop', { width: 1600, height: 1000 }, 1);
await shoot('setup-hub-mobile', { width: 390, height: 844 }, 1);

await browser.close();
console.log('done');
