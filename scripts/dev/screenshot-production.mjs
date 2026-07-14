import { chromium } from 'playwright-core';

const OUT = process.env.OUT || '/tmp/claude-1000/-mnt-HC-Volume-104793295-coding-live-captions-yt/0367d14e-0793-4942-b8f0-6a1bd34876a3/scratchpad';
const BASE = process.env.BASE || 'http://localhost:5173';
const BACKEND = process.env.BACKEND || 'http://localhost:4010';
const EXEC = process.env.CHROME || '/home/jsilvanus/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome';

const browser = await chromium.launch({ executablePath: EXEC });
const page = await browser.newPage({ viewport: { width: 1680, height: 950 }, deviceScaleFactor: 1, colorScheme: 'dark' });
page.on('pageerror', (err) => console.log('[pageerror]', err.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[console.error]', m.text()); });

await page.addInitScript(([backend]) => {
  localStorage.setItem('lcyt.backend.features', JSON.stringify(['rtmp', 'graphics', 'production', 'ai', 'admin', 'login']));
  localStorage.setItem('lcyt.session.config', JSON.stringify({ backendUrl: backend, apiKey: 'test-key' }));
  localStorage.setItem('lcyt.session.autoConnect', 'true');
  localStorage.setItem('lcyt-user', JSON.stringify({ token: 'dev-user-token', backendUrl: backend }));
}, [BACKEND]);

await page.goto(`${BASE}/production`, { waitUntil: 'load' });
await page.waitForTimeout(2500);

async function shootView(pillText, name) {
  if (pillText) {
    const pill = page.locator('button', { hasText: pillText }).first();
    if (await pill.count()) { await pill.click(); await page.waitForTimeout(900); }
  }
  await page.screenshot({ path: `${OUT}/production-${name}.png` });
  console.log('shot', name);
}

await shootView(null, 'preflight');
await shootView('Live Relay', 'relay');
await shootView('Live Mixer', 'mixer');
await shootView('Captions', 'captions');

// Stage a lower-third to exercise the graphics editor fields (Pre-flight view).
await page.locator('button', { hasText: 'Pre-flight' }).first().click();
await page.waitForTimeout(600);
const speaker = page.locator('text=Speaker').first();
if (await speaker.count()) { await speaker.click(); await page.waitForTimeout(700); }
await page.screenshot({ path: `${OUT}/production-lowerthird-staged.png` });
console.log('shot lowerthird-staged');

// Custom view (press + to clone the active view into an editable one).
const addBtn = page.locator('button[title="New custom view"]');
if (await addBtn.count()) { await addBtn.click(); await page.waitForTimeout(900); }
await page.screenshot({ path: `${OUT}/production-custom.png` });
console.log('shot custom');

await browser.close();
console.log('done');
