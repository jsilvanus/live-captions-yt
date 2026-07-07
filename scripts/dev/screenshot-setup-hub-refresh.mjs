import { chromium } from 'playwright';

const OUT = '/home/jsilvanus/.claude/jobs/bd4fd75b/tmp';
const browser = await chromium.launch();

async function shot(name, viewport) {
  const page = await browser.newPage({ viewport, colorScheme: 'light' });
  await page.addInitScript(() => {
    localStorage.setItem('lcyt.backend.features', JSON.stringify(['rtmp', 'graphics', 'production', 'ai', 'admin']));
    localStorage.setItem('lcyt.session.config', JSON.stringify({ backendUrl: 'http://localhost:4000', apiKey: 'test-key' }));
    localStorage.setItem('lcyt.session.autoConnect', 'true');
    localStorage.setItem('lcyt.ui.theme', 'light');
  });
  await page.goto('http://localhost:5173/setup', { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  await page.close();
}

await shot('refresh-desktop', { width: 1600, height: 1000 });
await shot('refresh-mobile', { width: 390, height: 844 });

await browser.close();
console.log('done');
