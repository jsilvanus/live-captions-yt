// @ts-check
const { defineConfig, devices } = require('@playwright/test');

/**
 * Playwright E2E test configuration.
 * E2E test files live in the e2e/ directory.
 * Unit tests in packages/[pkg]/test/ run via node --test in individual
 * package test jobs and are NOT discovered here.
 *
 * @see https://playwright.dev/docs/test-configuration
 */
module.exports = defineConfig({
  testDir: './e2e',

  /* Run tests in files in parallel */
  fullyParallel: true,

  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,

  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,

  /* Reporter to use */
  reporter: 'html',

  /* Shared settings for all the projects */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: process.env.BASE_URL || 'http://localhost:3000',

    /* Collect trace when retrying the failed test. */
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
