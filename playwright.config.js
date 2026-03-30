// @ts-check

/**
 * Playwright E2E test configuration.
 * E2E test files live in the e2e/ directory.
 * Unit tests in packages/[pkg]/test/ run via node --test in individual
 * package test jobs and are NOT discovered here.
 *
 * Using plain object form so @playwright/test does not need to be installed
 * as a project dependency — npx playwright uses its own bundled copy.
 *
 * @type {import('@playwright/test').PlaywrightTestConfig}
 * @see https://playwright.dev/docs/test-configuration
 */
module.exports = {
  testDir: './e2e',

  fullyParallel: true,

  forbidOnly: !!process.env.CI,

  retries: process.env.CI ? 2 : 0,

  reporter: 'html',

  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
  },

  projects: [
    { name: 'chromium' },
  ],
};
