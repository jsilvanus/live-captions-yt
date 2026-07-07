import { chromium } from 'playwright';

const OUT = '/home/jsilvanus/.claude/jobs/bd4fd75b/tmp';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 950 }, deviceScaleFactor: 2 });

await page.addInitScript(() => {
  localStorage.setItem('lcyt.backend.features', JSON.stringify(['rtmp', 'graphics', 'production', 'ai', 'admin']));
  localStorage.setItem('lcyt.session.config', JSON.stringify({ backendUrl: 'http://localhost:4000', apiKey: 'test-key' }));
  localStorage.setItem('lcyt.session.autoConnect', 'true');
});

page.on('pageerror', (err) => console.log('[pageerror]', err.message));

await page.goto('http://localhost:5173/planner', { waitUntil: 'load' });
await page.waitForTimeout(1500);

// Send a message
await page.locator('.agent-chat__input').fill('Draft a rundown for a Sunday morning service');
await page.locator('.agent-chat__composer button', { hasText: 'Send' }).click();
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/chat-interaction-loading.png` });

// Wait for the (mock-backend-404) error to resolve, confirming graceful error handling
await page.waitForTimeout(1000);
await page.screenshot({ path: `${OUT}/chat-interaction-error.png` });

const bubbleCount = await page.locator('.agent-chat__msg-bubble').count();
console.log('Message bubbles rendered:', bubbleCount);

await browser.close();
