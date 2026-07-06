import { chromium } from 'playwright';

const OUT = '/home/jsilvanus/.claude/jobs/bd4fd75b/tmp';

const browser = await chromium.launch();

async function shot(path, label, { chatMessages } = {}) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 }, deviceScaleFactor: 2 });
  await page.addInitScript(() => {
    localStorage.setItem('lcyt.backend.features', JSON.stringify(['rtmp', 'graphics', 'production', 'ai', 'admin']));
    localStorage.setItem('lcyt.session.config', JSON.stringify({ backendUrl: 'http://localhost:4000', apiKey: 'test-key' }));
    localStorage.setItem('lcyt.session.autoConnect', 'true');
  });
  page.on('pageerror', (err) => console.log(`[pageerror ${label}]`, err.message));
  await page.goto(`http://localhost:5173${path}`, { waitUntil: 'load' });
  await page.waitForTimeout(1500);

  // Expand the chat panel (starts collapsed by default only when isNarrow;
  // at this desktop width it should already be expanded).
  await page.screenshot({ path: `${OUT}/${label}.png` });
  await page.close();
}

await shot('/planner', 'chat-planner');
await shot('/graphics/editor', 'chat-graphics-editor');

await browser.close();
