import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.PINTA_E2E_PORT ?? 4174);

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: 'test-results/e2e',
  timeout: 45_000,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 4,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report-e2e', open: 'never' }],
  ],
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    colorScheme: 'dark',
    deviceScaleFactor: 1,
    locale: 'en-US',
    screenshot: 'only-on-failure',
    timezoneId: 'UTC',
    trace: 'retain-on-failure',
    viewport: { width: 1440, height: 960 },
  },
  projects: [{
    name: 'chromium',
    use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 960 } },
  }],
  webServer: {
    command:
      `node scripts/run-preview-server.mjs e2e-preview ` +
      `"npm run build && npm run preview -- --host 0.0.0.0 --port ${port}"`,
    url: `http://127.0.0.1:${port}`,
    // Never reuse: the command rebuilds dist/, and a server left running from an earlier run
    // keeps serving the previous index.html, whose hashed asset names no longer exist. That
    // fails as ENOENT on the stylesheet and then ERR_CONNECTION_REFUSED across the whole suite —
    // 53 false failures in one run during the refactoring work, and several single-test
    // "flakes" before anyone noticed the pattern.
    reuseExistingServer: false,
    // Without this Playwright SIGKILLs the process group, so the wrapper never gets to record
    // why the server stopped — and "why" is the whole point of the log.
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
    // The wrapper keeps the full transcript in test-results/server-logs/e2e-preview.log;
    // these only control what additionally reaches the console.
    stderr: 'pipe',
    stdout: 'ignore',
    timeout: 120_000,
  },
});
