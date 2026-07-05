import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });

await page.addInitScript(() => {
  localStorage.setItem('lcyt-user', JSON.stringify({
    token: 'fake-token',
    backendUrl: 'http://localhost:4000',
  }));
});

// Stub the backend calls ProjectsPage/ProjectSettingsPage/useUserAuth make.
await page.route('**/keys', (route) => {
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      keys: [
        {
          key: 'proj_abc123def456',
          owner: 'Sunday Service',
          myAccessLevel: 'owner',
          features: ['captions', 'viewer-target', 'translations', 'graphics-server'],
          createdAt: Date.now() - 1000 * 60 * 60 * 24 * 30,
          memberCount: 3,
        },
        {
          key: 'proj_xyz789',
          owner: 'Youth Conference 2026',
          myAccessLevel: 'admin',
          features: ['captions', 'ingest'],
          createdAt: Date.now() - 1000 * 60 * 60 * 24 * 5,
          expires: Date.now() + 1000 * 60 * 60 * 24 * 60,
          memberCount: 1,
        },
      ],
    }),
  });
});
await page.route('**/auth/me', (route) => {
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ userId: 'u1', email: 'demo@lcyt.fi', name: 'Demo User' }) });
});
await page.route('**/keys/*/members', (route) => {
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ members: [] }) });
});

page.on('pageerror', (err) => console.log('[pageerror]', err.message));

await page.goto('http://localhost:5173/projects', { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
await page.screenshot({ path: '/home/jsilvanus/.claude/jobs/bd4fd75b/tmp/projects-list.png', fullPage: true });

const row = await page.$('.project-row');
if (row) {
  await row.click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: '/home/jsilvanus/.claude/jobs/bd4fd75b/tmp/project-settings-slidein.png', fullPage: true });
  console.log('URL after click:', page.url());
} else {
  console.log('No .project-row found');
}

await browser.close();
