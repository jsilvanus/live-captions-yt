import { chromium } from 'playwright';

const OUT = '/home/jsilvanus/.claude/jobs/bd4fd75b/tmp';
const SAMPLE_DRAFT = Array.from({ length: 20 }, (_, i) => `Caption line ${i + 1}`).join('\n');

const browser = await chromium.launch();

async function check(path, label, { plannerContent } = {}) {
  const page = await browser.newPage({ viewport: { width: 390, height: 700 }, deviceScaleFactor: 2 });
  await page.addInitScript(({ draft }) => {
    localStorage.setItem('lcyt.backend.features', JSON.stringify(['rtmp', 'graphics', 'production', 'ai', 'admin']));
    localStorage.setItem('lcyt.session.config', JSON.stringify({ backendUrl: 'http://localhost:4000', apiKey: 'test-key' }));
    localStorage.setItem('lcyt.session.autoConnect', 'true');
    if (draft) localStorage.setItem('lcyt:planner-draft', draft);
  }, { draft: plannerContent ? SAMPLE_DRAFT : null });
  page.on('pageerror', (err) => console.log(`[pageerror ${label}]`, err.message));
  await page.goto(`http://localhost:5173${path}`, { waitUntil: 'load' });
  await page.waitForTimeout(1200);

  if (path === '/graphics/editor') {
    for (let i = 0; i < 3; i++) {
      const rectBtn = page.locator('button', { hasText: '+ Rect' });
      if (await rectBtn.count() > 0) await rectBtn.first().click();
      await page.waitForTimeout(100);
    }
  }

  // Find whichever element is actually scrollable (each page owns its own
  // scroll region in the narrow layout) and scroll it directly.
  await page.evaluate(() => {
    const all = document.querySelectorAll('body *');
    for (const el of all) {
      if (el.scrollHeight > el.clientHeight + 10 && /auto|scroll/.test(getComputedStyle(el).overflowY)) {
        el.scrollBy(0, 500);
        break;
      }
    }
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/sticky-${label}.png` });
  await page.close();
}

await check('/planner', 'planner', { plannerContent: true });
await check('/graphics/editor', 'graphics');

await browser.close();
