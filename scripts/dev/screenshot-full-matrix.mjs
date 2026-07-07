import { chromium } from 'playwright';

const OUT = '/home/jsilvanus/.claude/jobs/bd4fd75b/tmp/matrix';
const SAMPLE_INCLUDE_FILE = '/home/jsilvanus/.claude/jobs/bd4fd75b/tmp/sample-files/sermon-notes.md';

const SAMPLE_DRAFT = [
  '# Welcome',
  '<!-- section: Intro --><!-- speaker: Host -->',
  'Welcome to Sunday Service',
  '<!-- audio: start -->',
  "Good morning, everyone — so glad you're here",
  '<!-- graphics: lower-third, logo -->',
  '<!-- include: -->',
  '<!-- stanza',
  'Amazing grace, how sweet the sound',
  'That saved a wretch like me',
  '-->',
  '_ (pause for offering)',
  '# Closing',
  'Thank you for joining us today',
  '<!-- audio: stop -->',
].join('\n');

const SIZES = {
  desktop: { width: 1440, height: 900 },
  tablet:  { width: 820, height: 1180 },
  mobile:  { width: 390, height: 844 },
};

const browser = await chromium.launch();

async function shot(path, theme, size, label, { withPlannerContent } = {}) {
  const { width, height } = SIZES[size];
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });

  await page.addInitScript(({ theme, draft }) => {
    localStorage.setItem('lcyt-theme', theme);
    localStorage.setItem('lcyt.backend.features', JSON.stringify(['rtmp', 'graphics', 'production', 'ai', 'admin']));
    localStorage.setItem('lcyt.session.config', JSON.stringify({ backendUrl: 'http://localhost:4000', apiKey: 'test-key' }));
    localStorage.setItem('lcyt.session.autoConnect', 'true');
    if (draft) {
      localStorage.setItem('lcyt:planner-draft', draft);
      localStorage.setItem('lcyt:planner-filename', 'sunday-service.md');
    }
  }, { theme, draft: withPlannerContent ? SAMPLE_DRAFT : null });

  page.on('pageerror', (err) => console.log(`[pageerror ${label}]`, err.message));

  await page.goto(`http://localhost:5173${path}`, { waitUntil: 'load' });
  await page.waitForTimeout(1500);

  if (withPlannerContent) {
    const loadBtn = page.locator('.planner-include__header button', { hasText: 'Load' });
    if (await loadBtn.count() > 0) {
      const [chooser] = await Promise.all([
        page.waitForEvent('filechooser'),
        loadBtn.first().click(),
      ]);
      await chooser.setFiles(SAMPLE_INCLUDE_FILE);
      await page.waitForTimeout(500);
    }
  }

  if (path === '/graphics/editor') {
    const rectBtn = page.locator('button', { hasText: '+ Rect' });
    if (await rectBtn.count() > 0) await rectBtn.first().click();
    await page.waitForTimeout(300);
  }

  await page.screenshot({ path: `${OUT}/${label}.png`, fullPage: true });
  await page.close();
  console.log(`Saved ${label}.png`);
}

// Planner: theme comparison (desktop) + size comparison (light theme)
await shot('/planner', 'light', 'desktop', 'planner-theme-light', { withPlannerContent: true });
await shot('/planner', 'dark', 'desktop', 'planner-theme-dark', { withPlannerContent: true });
await shot('/planner', 'light', 'tablet', 'planner-size-tablet', { withPlannerContent: true });
await shot('/planner', 'light', 'mobile', 'planner-size-mobile', { withPlannerContent: true });

// Graphics Editor: theme comparison (desktop) + size comparison (light theme)
await shot('/graphics/editor', 'light', 'desktop', 'graphics-theme-light');
await shot('/graphics/editor', 'dark', 'desktop', 'graphics-theme-dark');
await shot('/graphics/editor', 'light', 'tablet', 'graphics-size-tablet');
await shot('/graphics/editor', 'light', 'mobile', 'graphics-size-mobile');

await browser.close();
