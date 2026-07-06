import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });

await page.addInitScript(() => {
  localStorage.setItem('lcyt.backend.features', JSON.stringify(['rtmp', 'graphics', 'production', 'ai', 'admin']));
  localStorage.setItem('lcyt.session.config', JSON.stringify({ backendUrl: 'http://localhost:4000', apiKey: 'test-key' }));
  localStorage.setItem('lcyt.session.autoConnect', 'true');
});

page.on('pageerror', (err) => console.log('[pageerror]', err.message));

function assert(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`OK: ${msg}`);
}

await page.goto('http://localhost:5173/graphics/editor', { waitUntil: 'load' });
await page.waitForTimeout(1500);

// ── 1. Create a new blank template so we have a clean slate ────────────────
await page.locator('button', { hasText: 'Blank' }).click();
await page.waitForTimeout(200);
await page.locator('input[placeholder="Template name"]').fill('Viewport test');

// ── 2. Add a rect layer, position it in Landscape ───────────────────────────
await page.locator('button', { hasText: '+ Rect' }).click();
await page.waitForTimeout(200);

const numberInputs = page.locator('input[type="number"]');
assert(await numberInputs.count() === 4, 'Properties panel shows X/Y/WIDTH/HEIGHT after adding a rect');

async function setXY(x, y) {
  await numberInputs.nth(0).fill(String(x));
  await numberInputs.nth(0).dispatchEvent('change');
  await numberInputs.nth(1).fill(String(y));
  await numberInputs.nth(1).dispatchEvent('change');
  await page.waitForTimeout(150);
}

await setXY(200, 150);
const landscapeX = await numberInputs.nth(0).inputValue();
const landscapeY = await numberInputs.nth(1).inputValue();
assert(landscapeX === '200' && landscapeY === '150', `Landscape position set to (${landscapeX}, ${landscapeY})`);

// ── 3. Switch to the Vertical viewport, reposition the same layer ──────────
await page.locator('select').first().selectOption({ label: 'Vertical — 1080×1920' });
await page.waitForTimeout(300);

// Before editing, the vertical view should fall back to the landscape position
const fallbackX = await numberInputs.nth(0).inputValue();
const fallbackY = await numberInputs.nth(1).inputValue();
assert(fallbackX === '200' && fallbackY === '150', `Vertical falls back to landscape position before any override (${fallbackX}, ${fallbackY})`);

await setXY(50, 800);
const verticalX = await numberInputs.nth(0).inputValue();
const verticalY = await numberInputs.nth(1).inputValue();
assert(verticalX === '50' && verticalY === '800', `Vertical position set to (${verticalX}, ${verticalY})`);

// ── 4. Switch back to Landscape — original position must be untouched ──────
await page.locator('select').first().selectOption({ label: 'Landscape — 1920×1080' });
await page.waitForTimeout(300);
const landscapeX2 = await numberInputs.nth(0).inputValue();
const landscapeY2 = await numberInputs.nth(1).inputValue();
assert(landscapeX2 === '200' && landscapeY2 === '150', `Landscape position still (${landscapeX2}, ${landscapeY2}) after editing Vertical`);

// ── 5. Save, then reload the page and re-fetch the template from the mock backend ──
await page.locator('button', { hasText: 'Save' }).click();
await page.waitForTimeout(600);

await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(1200);
await page.locator('div', { hasText: /^Viewport test$/ }).first().click();
await page.waitForTimeout(500);

// Select the rect layer from the Layers list (selection isn't restored automatically on load)
await page.locator('span', { hasText: /^rect$/ }).first().click();
await page.waitForTimeout(300);

const reloadedLandscapeX = await numberInputs.nth(0).inputValue();
const reloadedLandscapeY = await numberInputs.nth(1).inputValue();
assert(reloadedLandscapeX === '200' && reloadedLandscapeY === '150', `After reload, Landscape position persisted as (${reloadedLandscapeX}, ${reloadedLandscapeY})`);

await page.locator('select').first().selectOption({ label: 'Vertical — 1080×1920' });
await page.waitForTimeout(300);
const reloadedVerticalX = await numberInputs.nth(0).inputValue();
const reloadedVerticalY = await numberInputs.nth(1).inputValue();
assert(reloadedVerticalX === '50' && reloadedVerticalY === '800', `After reload, Vertical position persisted as (${reloadedVerticalX}, ${reloadedVerticalY})`);

console.log('\nAll viewport-position checks passed.');
await browser.close();
