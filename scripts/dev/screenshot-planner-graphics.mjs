import { chromium } from 'playwright';

const OUT = '/home/jsilvanus/.claude/jobs/bd4fd75b/tmp';
const SAMPLE_INCLUDE_FILE = `${OUT}/sample-files/sermon-notes.md`;

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

const browser = await chromium.launch();

async function shot(path, theme, outFile, { withDraft } = {}) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });

  await page.addInitScript(({ theme, draft }) => {
    localStorage.setItem('lcyt-theme', theme);
    localStorage.setItem('lcyt.backend.features', JSON.stringify([
      'rtmp', 'graphics', 'production', 'ai', 'admin',
    ]));
    localStorage.setItem('lcyt.session.config', JSON.stringify({
      backendUrl: 'http://localhost:4000',
      apiKey: 'test-key',
    }));
    localStorage.setItem('lcyt.session.autoConnect', 'true');
    if (draft) {
      localStorage.setItem('lcyt:planner-draft', draft);
      localStorage.setItem('lcyt:planner-filename', 'sunday-service.md');
    }
  }, { theme, draft: withDraft ? SAMPLE_DRAFT : null });

  page.on('pageerror', (err) => console.log(`[pageerror ${path} ${theme}]`, err.message));

  await page.goto(`http://localhost:5173${path}`, { waitUntil: 'load' });
  await page.waitForTimeout(1800);

  if (withDraft && path === '/planner') {
    // Click "Load" on the file-include block and feed it a real file via
    // Playwright's file-chooser interception (no real OS dialog available).
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

  await page.screenshot({ path: `${OUT}/${outFile}`, fullPage: true });
  await page.close();
  console.log(`Saved ${outFile}`);
}

await shot('/planner', 'light', 'planner-light.png', { withDraft: true });
await shot('/planner', 'dark', 'planner-dark.png', { withDraft: true });
await shot('/graphics/editor', 'light', 'graphics-editor-light.png');
await shot('/graphics/editor', 'dark', 'graphics-editor-dark.png');

await browser.close();
