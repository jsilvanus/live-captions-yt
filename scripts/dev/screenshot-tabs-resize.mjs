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

await page.goto('http://localhost:5173/graphics/editor', { waitUntil: 'load' });
await page.waitForTimeout(1500);

// Add a rect so the Properties tab has something to show
await page.locator('button', { hasText: '+ Rect' }).click();
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/tabs-properties.png` });

// Switch to the Assistant tab
await page.locator('button', { hasText: '✨ Assistant' }).click();
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/tabs-assistant.png` });

// Drag the resize handle between Templates and Canvas
const handles = page.locator('.col-resize-handle');
const handleCount = await handles.count();
console.log('Resize handles found:', handleCount);

const firstHandle = handles.first();
const box = await firstHandle.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + 120, box.y + box.height / 2, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/tabs-resized-templates.png` });

// Drag the second handle (between Canvas and Properties) to the left, shrinking canvas / growing properties
const secondHandle = handles.nth(1);
const box2 = await secondHandle.boundingBox();
await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2);
await page.mouse.down();
await page.mouse.move(box2.x - 100, box2.y + box2.height / 2, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/tabs-resized-properties.png` });

// Reload to confirm widths persisted
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/tabs-resized-after-reload.png` });

await browser.close();
