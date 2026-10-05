import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Chromium binary for the DSK renderer: PLAYWRIGHT_DSK_CHROMIUM, a system install or the Playwright cache; null when none is found. */
export function resolveChromiumExecutable(env = process.env) {
  const explicit = (env.PLAYWRIGHT_DSK_CHROMIUM || '').trim();
  if (explicit && existsSync(explicit)) return explicit;

  const candidates = [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chrome',
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  const cacheRoots = [
    join(homedir(), '.cache', 'ms-playwright'),
    '/root/.cache/ms-playwright',
    '/home/node/.cache/ms-playwright',
    '/tmp/ms-playwright',
  ];

  for (const root of cacheRoots) {
    if (!existsSync(root)) continue;
    const queue = [root];
    while (queue.length) {
      const dir = queue.pop();
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'chrome' || entry.name === 'chrome-headless-shell') {
            return fullPath;
          }
          queue.push(fullPath);
        }
      }
    }
  }

  return null;
}
