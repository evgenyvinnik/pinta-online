import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.PINTA_PERFORMANCE_PORT ?? 4175);

export default defineConfig({
  testDir: './tests/performance',
  outputDir: 'test-results/performance',
  timeout: 120_000,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report-performance', open: 'never' }]],
  expect: { timeout: 15_000 },
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
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 960 } } }],
  webServer: {
    command:
      `node scripts/run-preview-server.mjs performance-preview ` +
      `"npm run build && npm run preview -- --host 127.0.0.1 --port ${port}"`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    // Without this Playwright SIGKILLs the process group, so the wrapper never gets to record
    // why the server stopped — and "why" is the whole point of the log.
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
    // The wrapper keeps the full transcript in
    // test-results/server-logs/performance-preview.log; these only control what additionally
    // reaches the console.
    stderr: 'pipe',
    stdout: 'ignore',
    timeout: 120_000,
  },
});
